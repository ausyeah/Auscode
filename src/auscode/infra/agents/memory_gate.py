"""Only attach memory when the user asks, or a keyword hits."""

from __future__ import annotations

from pathlib import Path

EXPLICIT_MARKERS = (
    "读取记忆",
    "读记忆",
    "查记忆",
    "看看记忆",
    "根据记忆",
    "按记忆",
    "记忆里",
    "你还记得",
    "还记得",
    "记不记得",
    "以前说过",
    "上次说过",
    "read memory",
    "from memory",
    "you remember",
    "do you remember",
)

KEYWORD_HINTS = (
    "偏好",
    "喜好",
    "审美",
    "口味",
    "约定",
    "习惯",
    "常驻",
    "本机路径",
    "工作目录",
    "项目目录",
    "端口",
    "8088",
    "8089",
    "site-packages",
    "octop",
    "auscode",
    "大白话",
    "仿宋",
    "纸感",
    "mimosa",
    "preference",
    "convention",
)


def user_asked_for_memory(text: str) -> bool:
    raw = (text or "").strip().lower()
    if not raw:
        return False
    return any(marker.lower() in raw for marker in EXPLICIT_MARKERS)


def keyword_hits(text: str) -> list[str]:
    raw = (text or "").strip().lower()
    if not raw:
        return []
    return [hint for hint in KEYWORD_HINTS if hint.lower() in raw]


def _index_lines(memory_md: Path) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    if not memory_md.is_file():
        return rows
    for line in memory_md.read_text(encoding="utf-8", errors="replace").splitlines():
        text = line.strip()
        if not text.startswith("- ["):
            continue
        end = text.find("]")
        if end < 0:
            continue
        title = text[3:end].strip()
        rest = text[end + 1 :].lstrip(" —-").strip()
        rows.append((title, rest or title))
    return rows


def _memory_files(workspace_dir: Path) -> list[Path]:
    files = [Path(workspace_dir) / "MEMORY.md"]
    home = Path.home() / ".zcode" / "cli" / "memories" / "projects"
    if home.is_dir():
        files.extend(sorted(home.glob("*/memory/MEMORY.md")))
    out: list[Path] = []
    seen: set[str] = set()
    for path in files:
        key = str(path)
        if key in seen or not path.is_file():
            continue
        seen.add(key)
        out.append(path)
    return out


def matching_memory_notes(text: str, memory_files: list[Path], *, limit: int = 4) -> list[str]:
    hits = keyword_hits(text)
    asked = user_asked_for_memory(text)
    if not hits and not asked:
        return []
    notes: list[str] = []
    lowered_hits = [h.lower() for h in hits]
    rows: list[tuple[str, str]] = []
    for path in memory_files:
        rows.extend(_index_lines(path))
    for title, rest in rows:
        blob = f"{title} {rest}".lower()
        if lowered_hits and any(h in blob for h in lowered_hits):
            notes.append(f"{title}：{rest}" if rest != title else title)
        if len(notes) >= limit:
            break
    if asked and not notes:
        local_rows = _index_lines(memory_files[0]) if memory_files else []
        notes = [f"{title}：{rest}" for title, rest in local_rows[:limit]]
    return notes


def attach_memory_if_needed(text: str, workspace_dir: Path | None) -> str:
    raw = (text or "").strip()
    if not raw or workspace_dir is None:
        return raw
    notes = matching_memory_notes(raw, _memory_files(Path(workspace_dir)))
    if not notes:
        return raw
    body = "\n".join(f"- {item}" for item in notes)
    return f"【相关记忆】\n{body}\n\n{raw}"


__all__ = [
    "attach_memory_if_needed",
    "keyword_hits",
    "matching_memory_notes",
    "user_asked_for_memory",
]
