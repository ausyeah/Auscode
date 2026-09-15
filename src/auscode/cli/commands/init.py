"""`auscode init` — bootstrap a fresh AusCode install (DB + first admin)."""

from __future__ import annotations

import shutil

import click


@click.command("init")
@click.option(
    "--admin-username",
    envvar="AUSCODE_ADMIN_USERNAME",
    default=None,
    help="First admin username (or set AUSCODE_ADMIN_USERNAME).",
)
@click.option(
    "--admin-password",
    envvar="AUSCODE_ADMIN_PASSWORD",
    default=None,
    help="First admin password (or set AUSCODE_ADMIN_PASSWORD).",
)
@click.option(
    "--admin-display-name",
    envvar="AUSCODE_ADMIN_DISPLAY_NAME",
    default=None,
    help="Optional display name for the admin user.",
)
@click.option(
    "--force",
    is_flag=True,
    default=False,
    help="Wipe existing ~/.auscode contents before bootstrapping.",
)
@click.option(
    "--yes",
    "non_interactive",
    is_flag=True,
    default=False,
    help="Skip all interactive prompts.",
)
def init(
    admin_username: str | None,
    admin_password: str | None,
    admin_display_name: str | None,
    force: bool,
    non_interactive: bool,
) -> None:
    """Bootstrap an AusCode server (~/.auscode dir, DB migrations, first admin)."""
    from auscode.config import load_config
    from auscode.infra.agents.plugins.manager import PluginManager
    from auscode.infra.db.factory import open_database
    from auscode.infra.db.migrate import run_migrations
    from auscode.infra.db.repos.users import UserRepo
    from auscode.infra.errors import AusCodeError
    from auscode.infra.users.password import hash_password, validate_password_policy
    from auscode.infra.utils.env_file import apply_env_file, env_file_path
    from auscode.infra.utils.paths import PathLayout

    paths = PathLayout.from_env()
    home = paths.root

    if home.exists() and any(home.iterdir()):
        if not force:
            click.echo(
                f"error: {home} already exists and is not empty. Use --force to reset.",
                err=True,
            )
            raise SystemExit(1)
        if not non_interactive:
            from auscode.cli.support import prompts as _prompts

            if not _prompts.confirm(f"Wipe {home}? This deletes ALL AusCode state.", default=False):
                click.echo("aborted", err=True)
                raise SystemExit(1)
        shutil.rmtree(home)

    paths.ensure_root()
    PluginManager(plugins_dir=paths.plugins_dir, config_path=paths.config).seed_bundled()
    apply_env_file(env_file_path(paths.root))
    config = load_config(paths.config)
    db = open_database(config, paths)
    try:
        run_migrations(db)

        username = admin_username
        password = admin_password
        display_name = admin_display_name

        if not non_interactive:
            from auscode.cli.support import prompts as _prompts

            if not username:
                username = _prompts.text("Admin username:")
            if not password:
                password = _prompts.password("Admin password:")
            if display_name is None:
                display_name = _prompts.text("Display name (optional):", default="") or None

        if not username:
            click.echo("error: admin username is required", err=True)
            raise SystemExit(1)
        try:
            validate_password_policy(password or "")
        except AusCodeError as exc:
            click.echo(f"error: {exc.message}", err=True)
            raise SystemExit(1) from None

        UserRepo(db).create(
            username=username,
            password_hash=hash_password(password or ""),
            role="admin",
            display_name=display_name,
        )
    finally:
        db.close()

    click.echo(f"\u2705 AusCode bootstrapped at {home}")
    click.echo(f"   admin user: {username}")
    click.echo("   next: `auscode run` (optional: `auscode agent use <id>` to pin default agent)")
