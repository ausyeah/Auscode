"""Decide which harness web-search tools AusCode actually mounts.

Harness defaults ``web_search_tools="auto"``, which always includes the
zero-config ``searchfree`` backend. That public endpoint drops connections
often enough that the model wastes turns and then opens a browser anyway.

AusCode default: never mount searchfree. Mount Tavily / Brave / Google / Kimi
only when their env keys are present. Otherwise leave web lookup to
``browser_use``.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Any

_KEYED_PROVIDERS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("tavily", ("TAVILY_API_KEY",)),
    ("brave", ("BRAVE_API_KEY",)),
    ("google", ("GOOGLE_API_KEY", "GOOGLE_CSE_ID")),
    ("kimi", ("MOONSHOT_API_KEY",)),
)

WEB_LOOKUP_PROMPT = (
    "When you need current information from the open web, use browser_use "
    "to open a search engine (Bing or DuckDuckGo) and read the results. "
    "Do not call searchfree_search."
)


def _keyed_available() -> list[str]:
    names: list[str] = []
    for name, env_vars in _KEYED_PROVIDERS:
        if all(os.getenv(item) for item in env_vars):
            names.append(name)
    return names


def resolve_web_search_tools(cfg: Mapping[str, Any] | None) -> bool | list[str]:
    """Return a harness ``web_search_tools`` value with searchfree stripped."""
    raw = None if cfg is None else cfg.get("web_search_tools", None)
    if raw is False:
        return False
    if isinstance(raw, (list, tuple)):
        names = [str(item).strip() for item in raw if str(item).strip() and str(item).strip() != "searchfree"]
        return names or False
    return _keyed_available() or False


def searchfree_enabled(cfg: Mapping[str, Any] | None) -> bool:
    raw = None if cfg is None else cfg.get("web_search_tools", None)
    if raw is False:
        return False
    if isinstance(raw, (list, tuple)):
        return "searchfree" in {str(item).strip() for item in raw}
    return False


__all__ = [
    "WEB_LOOKUP_PROMPT",
    "resolve_web_search_tools",
    "searchfree_enabled",
]
