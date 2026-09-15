"""auscode version command."""

from __future__ import annotations

import click


@click.command("version")
def version() -> None:
    """Show the installed auscode version."""
    try:
        from importlib.metadata import version as _v

        v = _v("auscode")
    except Exception:
        v = "unknown"
    click.echo(f"auscode v{v}")
