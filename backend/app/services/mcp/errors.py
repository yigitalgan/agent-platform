"""MCP error types."""


class MCPError(RuntimeError):
    """Generic MCP failure (connection, protocol, or tool call error)."""


class MCPSecurityError(MCPError):
    """Raised when an MCP URL is rejected by the SSRF guard."""
