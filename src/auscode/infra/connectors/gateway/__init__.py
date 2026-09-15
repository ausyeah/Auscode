"""In-process MCP gateway for AusCode-hosted connector adapters."""

from auscode.infra.connectors.gateway.langchain import build_gateway_langchain_tools
from auscode.infra.connectors.gateway.protocol import handle_mcp_request
from auscode.infra.connectors.gateway.registry import mcp_tools_for_kind

__all__ = [
    "build_gateway_langchain_tools",
    "handle_mcp_request",
    "mcp_tools_for_kind",
]
