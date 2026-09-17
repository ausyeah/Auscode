"""Harden the zero-config searchfree tool: serialize, retry, then fall back.

The public ``searchfree.site`` endpoint frequently drops the TCP connection
(``Server disconnected without sending a response``), especially under
concurrent calls. The stock harness tool has no retry, so the model burns
turns retrying the same dead backend.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

logger = logging.getLogger(__name__)

_FALLBACK = (
    "Error: web search is temporarily unreachable (the free search backend "
    "closed the connection). Do not call searchfree_search again this turn. "
    "Use browser_use to open a search page (for example Bing or DuckDuckGo) "
    "and read the results there."
)
_LOCK = asyncio.Lock()
_INSTALLED = False


def install_searchfree_guard() -> None:
    """Wrap the harness searchfree tool once per process."""
    global _INSTALLED
    if _INSTALLED:
        return
    try:
        from harness_agent.builtin.tools.web_search import searchfree as mod
    except Exception:
        logger.debug("searchfree tool not importable", exc_info=True)
        return
    tool = getattr(mod, "searchfree_search", None)
    orig = getattr(tool, "coroutine", None)
    if orig is None or getattr(tool, "_auscode_hardened", False):
        _INSTALLED = True
        return

    async def _guarded(*args: Any, **kwargs: Any) -> str:
        kwargs.setdefault("search_depth", "basic")
        last = ""
        async with _LOCK:
            for attempt in range(3):
                try:
                    result = await orig(*args, **kwargs)
                except Exception as exc:
                    last = str(exc)
                    result = f"Error: searchfree request failed: {exc}"
                if not isinstance(result, str) or "searchfree request failed" not in result:
                    return result
                last = result
                logger.info("searchfree attempt %s failed: %s", attempt + 1, result[:160])
                if attempt < 2:
                    await asyncio.sleep(0.7 * (attempt + 1))
                    if kwargs.get("search_depth") == "advanced":
                        kwargs["search_depth"] = "basic"
        return _FALLBACK if last else _FALLBACK

    tool.coroutine = _guarded
    tool._auscode_hardened = True
    _INSTALLED = True


__all__ = ["install_searchfree_guard"]
