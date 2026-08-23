"""Resolve an agent's MCP tool names against enabled servers' cached tools.

Used by the agents API (validation) and the chat endpoint (building the live
:class:`MCPTool` instances passed to the stream). Works off the cached tool
specs in the DB — no network — so it's fast per request.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.mcp_server import MCPServer
from app.services.tools.mcp_tool import (
    MCPTool,
    build_mcp_tool,
    is_mcp_tool_name,
    namespaced_name,
)


def all_enabled_tool_names(db: Session) -> set[str]:
    """Namespaced tool names offered by all enabled servers (from cache)."""
    names: set[str] = set()
    servers = db.scalars(
        select(MCPServer).where(MCPServer.enabled.is_(True))
    ).all()
    for server in servers:
        for spec in server.cached_tools or []:
            base = spec.get("name")
            if base:
                names.add(namespaced_name(server.id, base))
    return names


def build_mcp_tools(allowed_tools: list[str], db: Session) -> dict[str, MCPTool]:
    """Build MCPTool instances for the agent's allowed MCP tool names.

    Only enabled servers and cached tools are considered; unknown/disabled names
    are silently skipped (validation happens separately at create/update).
    """
    wanted = {n for n in allowed_tools if is_mcp_tool_name(n)}
    if not wanted:
        return {}
    tools: dict[str, MCPTool] = {}
    servers = db.scalars(
        select(MCPServer).where(MCPServer.enabled.is_(True))
    ).all()
    for server in servers:
        for spec in server.cached_tools or []:
            base = spec.get("name")
            if not base:
                continue
            ns = namespaced_name(server.id, base)
            if ns in wanted:
                tools[ns] = build_mcp_tool(ns, spec, server)
    return tools
