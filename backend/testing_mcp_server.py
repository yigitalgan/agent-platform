"""Minimal local MCP server for testing the Faz 8 integration.

NOT part of the app — a throwaway server exposing two trivial tools over
Streamable HTTP so we can verify tool discovery + tool calls end-to-end with
ALLOW_PRIVATE_MCP_URLS=true. Run inside the backend container:

    python testing_mcp_server.py    # listens on 0.0.0.0:9000, path /mcp
"""

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("test-server", host="0.0.0.0", port=9000)


@mcp.tool()
def add(a: int, b: int) -> int:
    """İki tam sayıyı toplar."""
    return a + b


@mcp.tool()
def shout(text: str) -> str:
    """Verilen metni büyük harfe çevirip ünlemle döndürür."""
    return text.upper() + "!"


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
