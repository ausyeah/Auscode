"""CLI in-process chat transport: connection hub + virtual IM channel."""

from auscode.infra.gateway.cli.cli_channel import CLI_CHANNEL_ID, CLI_CONNECTION_META, CliChannel
from auscode.infra.gateway.ws.ws_hub import WebSocketHub as CliHub

__all__ = [
    "CLI_CHANNEL_ID",
    "CLI_CONNECTION_META",
    "CliChannel",
    "CliHub",
]
