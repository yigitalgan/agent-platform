"""Remote MCP (Model Context Protocol) integration — Phase 8.

Remote transports only (HTTP / SSE); no stdio/local process (deliberate scope
limit: smaller image + smaller attack surface). ``security`` guards outbound
URLs against SSRF; ``client`` wraps the MCP SDK to list/call tools over a
short-lived connection.
"""

from app.services.mcp.errors import MCPError, MCPSecurityError

__all__ = ["MCPError", "MCPSecurityError"]
