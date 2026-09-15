"""One-shot mechanical rename: octop -> auscode inside D:\\AusCode\\src\\auscode.

Replaces three case forms (longest-safe order is irrelevant since the three
patterns do not overlap in case):
    OCTOP -> AUSCODE
    Octop -> AusCode
    octop -> auscode

Only whitelisted text extensions are touched; binary assets are skipped.
Run once; idempotent (second run finds nothing to change).
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(r"D:\AusCode\src\auscode")

REPLACEMENTS = [
    ("OCTOP", "AUSCODE"),
    ("Octop", "AusCode"),
    ("octop", "auscode"),
]

TEXT_EXTENSIONS = {
    ".py", ".md", ".json", ".yaml", ".yml", ".txt", ".sh", ".js", ".mjs",
    ".xml", ".ini", ".ps1", ".bat", ".cmd", ".html", ".css", ".toml",
    ".cfg", ".sql", ".xsd", ".j2", ".svg", ".csv",
}

changed_files = 0
changed_occurrences = 0
scanned = 0

for path in ROOT.rglob("*"):
    if not path.is_file() or path.suffix.lower() not in TEXT_EXTENSIONS:
        continue
    scanned += 1
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        print(f"SKIP non-utf8: {path.relative_to(ROOT)}", file=sys.stderr)
        continue
    new_text = text
    file_hits = 0
    for old, new in REPLACEMENTS:
        hits = new_text.count(old)
        if hits:
            file_hits += hits
            new_text = new_text.replace(old, new)
    if file_hits:
        path.write_text(new_text, encoding="utf-8", newline="")
        changed_files += 1
        changed_occurrences += file_hits
        print(f"{file_hits:5d}  {path.relative_to(ROOT)}")

print(f"\nscanned={scanned} changed_files={changed_files} total_replacements={changed_occurrences}")
