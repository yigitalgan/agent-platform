"""Thin async wrapper over the MCP SDK for remote (HTTP/SSE) servers.

Each operation opens a short-lived connection (connect → initialize → do →
close). This keeps things simple and stateless — matching our per-request
streaming model — at the cost of a handshake per operation. Tool lists are
cached in the DB (see the mcp_servers API), so only ``call_tool`` runs live at
chat time.

Every entry point re-validates the URL through the SSRF guard immediately
before connecting (defense in depth; also enforced at create/update).
"""

from contextlib import asynccontextmanager
from datetime import timedelta

from mcp import ClientSession
from mcp.client.sse import sse_client
from mcp.client.streamable_http import streamablehttp_client

from app.services.mcp.errors import MCPError
from app.services.mcp.security import validate_public_url

# Bound each connect/call so an unresponsive server can't hang a request.
_CONNECT_TIMEOUT = 15.0
_CALL_TIMEOUT = timedelta(seconds=30)


@asynccontextmanager
async def _session(url: str, transport: str):
    """Open an initialized MCP ClientSession over the chosen remote transport.

    Runs the SSRF guard first, then connects. Yields a ready ``ClientSession``.
    """
    validate_public_url(url)  # runtime guard, right before connecting

    if transport == "sse":
        async with sse_client(url, timeout=_CONNECT_TIMEOUT) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                yield session
    else:  # streamable_http (default)
        async with streamablehttp_client(url) as (read, write, _get_id):
            async with ClientSession(read, write) as session:
                await session.initialize()
                yield session


def _normalize_tool(tool) -> dict:
    """Convert an SDK Tool to our cached spec shape."""
    return {
        "name": tool.name,
        "description": tool.description or "",
        # MCP's `inputSchema` maps directly to Claude's `input_schema`.
        "input_schema": tool.inputSchema or {"type": "object", "properties": {}},
    }


async def fetch_tools(url: str, transport: str = "streamable_http") -> list[dict]:
    """Connect and return the server's tools as normalized specs.

    Raises :class:`MCPError` (subclass :class:`MCPSecurityError` for guard
    rejections) on any failure so the caller can record ``last_error``.
    """
    try:
        async with _session(url, transport) as session:
            result = await session.list_tools()
            return [_normalize_tool(t) for t in result.tools]
    except MCPError:
        raise
    except Exception as exc:  # noqa: BLE001 — normalize SDK/transport errors
        raise MCPError(f"{type(exc).__name__}: {exc}") from exc


def _result_to_text(result) -> str:
    """Flatten a CallToolResult's content blocks into a single string."""
    parts: list[str] = []
    for block in result.content or []:
        text = getattr(block, "text", None)
        if text is not None:
            parts.append(text)
        else:
            # Non-text content (image/resource) — note its type rather than drop.
            parts.append(f"[{getattr(block, 'type', 'content')}]")
    return "\n".join(parts).strip()


async def call_tool(
    url: str,
    transport: str,
    tool_name: str,
    arguments: dict,
) -> str:
    """Call a tool on the server and return its text result.

    A server-reported error (``isError``) is returned as a ``"hata: ..."``
    string (consistent with the built-in tool contract). Connection/protocol
    failures raise :class:`MCPError`.
    """
    async with _session(url, transport) as session:
        result = await session.call_tool(
            tool_name, arguments or {}, read_timeout_seconds=_CALL_TIMEOUT
        )
    text = _result_to_text(result)
    if getattr(result, "isError", False):
        return f"hata: MCP tool '{tool_name}' hata döndürdü: {text or '(detay yok)'}"
    return text or "(MCP tool boş yanıt döndürdü)"
