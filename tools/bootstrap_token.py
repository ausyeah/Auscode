"""Issue the long-lived AusCode API token and write data/credential.txt.

Run after `auscode init` (or on an already-bootstrapped home). Uses the same
DB-backed secret repo the server uses, so the signed token stays valid across
restarts. TTL is 10 years by design for a single-user headless install.

Usage:
    AUSCODE_HOME=D:/AusCode/data python tools/bootstrap_token.py
"""

from __future__ import annotations

import os
from pathlib import Path

HOME = Path(os.environ.get("AUSCODE_HOME", r"D:\AusCode\data"))
TOKEN_TTL_SECONDS = 10 * 365 * 24 * 3600
CREDENTIAL_FILE = HOME / "credential.txt"


def main() -> None:
    from auscode.api.deps import sign_token
    from auscode.config import load_config
    from auscode.infra.db.factory import open_database
    from auscode.infra.db.migrate import run_migrations
    from auscode.infra.db.repos.secrets import SecretRepo
    from auscode.infra.db.repos.users import UserRepo
    from auscode.infra.utils.paths import PathLayout

    paths = PathLayout.from_env()
    config = load_config(paths.config)
    db = open_database(config, paths)
    try:
        run_migrations(db)
        secret = SecretRepo(db).get_or_create("jwt", lambda: os.urandom(32))
        admins = [u for u in UserRepo(db).list() if u.role == "admin"]
        if not admins:
            raise SystemExit("error: no admin user found; run `auscode init` first")
        admin = admins[0]
        token = sign_token(
            secret,
            sub=admin.id,
            uname=admin.username,
            role=admin.role,
            ttl_seconds=TOKEN_TTL_SECONDS,
        )
    finally:
        db.close()

    CREDENTIAL_FILE.write_text(
        "AusCode API 凭据（妥善保管，勿提交到仓库）\n"
        f"admin 用户名: {admin.username}\n"
        f"API Token（10 年期，Bearer 用法）:\n{token}\n",
        encoding="utf-8",
    )
    print(f"OK: credential written to {CREDENTIAL_FILE}")


if __name__ == "__main__":
    main()
