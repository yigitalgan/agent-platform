from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

Transport = Literal["streamable_http", "sse"]


class MCPToolSpec(BaseModel):
    """A single tool discovered on an MCP server (normalized spec)."""

    name: str
    description: str = ""
    input_schema: dict = Field(default_factory=dict)


class _MCPServerBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    url: str = Field(..., min_length=1, max_length=1024)
    description: str = ""
    transport: Transport = "streamable_http"
    enabled: bool = True


class MCPServerCreate(_MCPServerBase):
    pass


class MCPServerUpdate(_MCPServerBase):
    """Full replacement (PUT)."""


class MCPServerResponse(BaseModel):
    id: int
    name: str
    url: str
    description: str
    transport: str
    enabled: bool
    cached_tools: list[MCPToolSpec]
    last_synced_at: Optional[datetime] = None
    last_error: Optional[str] = None
    created_at: datetime
    # Namespaced tool names (mcp_{id}_{tool}) — what goes into an agent's
    # allowed_tools. Convenience for the UI/agent builder.
    tool_names: list[str] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)
