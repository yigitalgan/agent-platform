"""MCP tools as dynamic :class:`Tool` instances.

Unlike the built-in tools (static singletons in the registry), MCP tools are
discovered per server and instantiated per request. They still implement the
plain ``Tool`` interface (``execute`` returns a string), so they flow through
the same tool-call path as built-in tools — no separate streaming machinery is
needed (that was only for sub-agents in 7B).

Names are namespaced by server id (``mcp_{server_id}_{tool}``) so two servers
offering a same-named tool don't collide, and so the name never clashes with a
built-in tool or a sub-agent's ``call_agent_{id}``.
"""

import hashlib

from app.services.mcp import client as mcp_client
from app.services.mcp.errors import MCPError, MCPSecurityError
from app.services.tools.base import Tool

PREFIX = "mcp_"
_MAX_TOOL_NAME_LEN = 64  # Claude tool-name constraint: ^[a-zA-Z0-9_-]{1,64}$


def namespaced_name(server_id: int, base_name: str) -> str:
    """Namespaced, Claude-safe tool name for a server's tool.

    Falls back to a short hash of the base name if the full name would exceed
    the 64-char limit (still deterministic, so it round-trips for lookups).
    """
    name = f"{PREFIX}{server_id}_{base_name}"
    if len(name) <= _MAX_TOOL_NAME_LEN and _is_valid(name):
        return name
    digest = hashlib.sha1(base_name.encode("utf-8")).hexdigest()[:12]
    return f"{PREFIX}{server_id}_{digest}"


def _is_valid(name: str) -> bool:
    return all(c.isalnum() or c in "_-" for c in name)


def parse_server_id(name: str) -> int | None:
    """Extract the server id from a namespaced MCP tool name (else ``None``)."""
    if not name.startswith(PREFIX):
        return None
    sid_str = name[len(PREFIX):].partition("_")[0]
    return int(sid_str) if sid_str.isdigit() else None


def is_mcp_tool_name(name: str) -> bool:
    return parse_server_id(name) is not None


class MCPTool(Tool):
    """A single MCP server tool exposed to Claude as a tool.

    ``name`` is the namespaced name (what Claude/allowed_tools use); ``base_name``
    is the original tool name sent to the server on ``call_tool``.
    """

    def __init__(
        self,
        *,
        name: str,
        base_name: str,
        description: str,
        input_schema: dict,
        server_url: str,
        transport: str,
    ) -> None:
        self.name = name
        self.description = description
        self.input_schema = input_schema or {"type": "object", "properties": {}}
        self._base_name = base_name
        self._server_url = server_url
        self._transport = transport

    async def execute(self, tool_input: dict, context: dict | None = None) -> str:
        # call_tool re-runs the SSRF guard at call time (defense in depth) and
        # normalizes results/errors; convert failures to the "hata: …" contract.
        try:
            return await mcp_client.call_tool(
                self._server_url,
                self._transport,
                self._base_name,
                tool_input or {},
            )
        except MCPSecurityError as exc:
            return f"hata: MCP güvenlik reddi ({exc})"
        except MCPError as exc:
            return f"hata: MCP tool çağrısı başarısız ({exc})"
        except Exception as exc:  # noqa: BLE001 — never crash the stream
            return f"hata: MCP beklenmeyen hata ({exc})"


def build_mcp_tool(namespaced: str, tool_spec: dict, server) -> MCPTool:
    """Construct an :class:`MCPTool` from a cached tool spec + its server row."""
    return MCPTool(
        name=namespaced,
        base_name=tool_spec.get("name", ""),
        description=tool_spec.get("description", "") or "",
        input_schema=tool_spec.get("input_schema") or {},
        server_url=server.url,
        transport=server.transport,
    )
