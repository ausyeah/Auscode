"""Local desktop UI bootstrap — token is never hardcoded in the frontend."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from auscode.api.deps import current_user, get_server
from auscode.infra.utils.host_dirs import host_home_dir, host_path_text
from auscode.infra.utils.paths import PathLayout

router = APIRouter()

_LOCAL_SKILL_ROOTS = (
    Path.home() / ".agents" / "skills",
    Path.home() / ".agent" / "skills",
)


def _read_local_token() -> str | None:
    path = PathLayout.from_env().root / "credential.txt"
    if not path.is_file():
        return None
    for line in path.read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if text.startswith("eyJ"):
            return text
    return None


def _iter_local_skill_dirs() -> list[Path]:
    found: list[Path] = []
    seen: set[str] = set()
    for root in _LOCAL_SKILL_ROOTS:
        if not root.is_dir():
            continue
        for child in sorted(root.iterdir()):
            skill = child / "SKILL.md"
            if child.is_dir() and skill.is_file():
                key = child.name.lower()
                if key not in seen:
                    seen.add(key)
                    found.append(child)
    return found


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


@router.get("/ui/local-skills", summary="List SKILL.md bundles on this machine")
async def list_local_skills(_: object = Depends(current_user)) -> dict:
    items = []
    for folder in _iter_local_skill_dirs():
        items.append({
            "name": folder.name,
            "path": str(folder),
            "source": str(folder.parent),
        })
    return {"items": items}


@router.post("/ui/local-skills/import", summary="Import a local SKILL.md into the agent")
async def import_local_skill(
    body: dict,
    user: object = Depends(current_user),
    server: object = Depends(get_server),
) -> dict:
    name = str(body.get("name") or "").strip()
    allowed = {p.name: p for p in _iter_local_skill_dirs()}
    folder = allowed.get(name)
    if folder is None:
        return JSONResponse({"ok": False, "error": "找不到这个本地技能"}, status_code=404)
    skill_md = (folder / "SKILL.md").read_text(encoding="utf-8")
    from auscode.api.routers import skills as skills_router

    created = await skills_router.create_skill(
        agent_id=str(body.get("agent_id") or "TV3AHW"),
        body=skills_router.CreateSkillBody(name=name, content=skill_md, overwrite=True),
        user=user,
        server=server,
    )
    return {"ok": True, "skill": created}
