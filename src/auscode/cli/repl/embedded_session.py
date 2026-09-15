"""Ref-counted embedded AusCodeServer for reuse within one asyncio event loop."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from auscode.infra.server import AusCodeServer

_lock = asyncio.Lock()
_server: AusCodeServer | None = None
_refs = 0


@asynccontextmanager
async def embedded_runtime() -> AsyncIterator[AusCodeServer]:
    """Boot AusCodeServer once per event loop; nested ``async with`` shares it."""
    global _server, _refs

    async with _lock:
        if _server is None:
            _server = AusCodeServer()
            await _server.start()
        _refs += 1
        server = _server

    try:
        yield server
    finally:
        async with _lock:
            _refs -= 1
            if _refs == 0 and _server is not None:
                await _server.stop()
                _server = None


@asynccontextmanager
async def embedded_chat_server() -> AsyncIterator[AusCodeServer]:
    """Alias for :func:`embedded_runtime` (one server per nested scope)."""
    async with embedded_runtime() as server:
        yield server
