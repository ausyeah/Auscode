"""Local desktop UI bootstrap — token is never hardcoded in the frontend."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from auscode.infra.utils.host_dirs import host_home_dir, host_path_text
from auscode.infra.utils.paths import PathLayout

router = APIRouter()


def _read_local_token() -> str | None:
    path = PathLayout.from_env().root / "credential.txt"
    if not path.is_file():
        return None
    for line in path.read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if text.startswith("eyJ"):
            return text
    return None


@router.get("/ui/session", summary="Local desktop session bootstrap")
async def ui_session() -> JSONResponse:
    token = _read_local_token()
    if not token:
        return JSONResponse(
            {"ok": False, "error": "credential.txt 中没有 Token，请先运行 bootstrap_token.py"},
            status_code=503,
        )
    return JSONResponse({
        "ok": True,
        "token": token,
        "agent_id": "TV3AHW",
        "home_dir": host_path_text(host_home_dir()),
        "project_dir": "D:/AusCode",
    })
