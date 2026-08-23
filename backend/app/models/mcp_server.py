from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import JSON, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class MCPServer(Base):
    """A remote MCP (Model Context Protocol) server the platform can call.

    Phase 8 — remote transports only (HTTP/SSE); no stdio/local process. The
    server's tool list is fetched and cached (``cached_tools``) rather than
    queried live on every chat request; ``last_error`` records the most recent
    connect/sync failure so the UI can show a server as unreachable.
    """

    __tablename__ = "mcp_servers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str] = mapped_column(String(1024), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    # "streamable_http" (default) or "sse".
    transport: Mapped[str] = mapped_column(
        String(32), default="streamable_http", server_default="streamable_http"
    )
    enabled: Mapped[bool] = mapped_column(default=True, server_default="1")
    # Cached, normalized tool specs: [{"name", "description", "input_schema"}].
    cached_tools: Mapped[list] = mapped_column(
        JSON, default=list, server_default="[]"
    )
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Most recent connect/sync error message (None when the last sync succeeded).
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
