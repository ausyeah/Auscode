"""CLI error helpers."""

from __future__ import annotations

import click

from auscode.infra.errors import AusCodeError


def fail_auscode(exc: AusCodeError) -> None:
    click.echo(f"error: {exc.message}", err=True)
    raise SystemExit(1) from exc
