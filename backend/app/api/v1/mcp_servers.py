"""MCP server management endpoints (Phase 8 — remote HTTP/SSE only).

CRUD plus a manual ``/refresh`` that re-fetches a server's tool list. On create
and update we hard-reject SSRF-unsafe URLs (private IP / bad scheme → 400) and
then best-effort sync the tool list; an unreachable-but-public server is still
created, with the failure recorded in ``last_error``.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.agent import Agent
from app.models.mcp_server import MCPServer
from app.schemas.mcp_server import (
    MCPServerCreate,
    MCPServerResponse,
    MCPServerUpdate,
)
from app.services.mcp import client as mcp_client
from app.services.mcp.errors import MCPError, MCPSecurityError
from app.services.mcp.security import validate_public_url
from app.services.tools.mcp_tool import namespaced_name, parse_server_id

router = APIRouter(prefix="/mcp-servers", tags=["mcp-servers"])


def _to_response(server: MCPServer) -> MCPServerResponse:
    tool_names = [
        namespaced_name(server.id, spec["name"])
        for spec in (server.cached_tools or [])
        if spec.get("name")
    ]
    return MCPServerResponse(
        id=server.id,
        name=server.name,
        url=server.url,
        description=server.description,
        transport=server.transport,
        enabled=server.enabled,
        cached_tools=server.cached_tools or [],
        last_synced_at=server.last_synced_at,
        last_error=server.last_error,
        created_at=server.created_at,
        tool_names=tool_names,
    )


def _guard_url(url: str) -> None:
    """Hard SSRF check: 400 on scheme/private-IP violations only.

    DNS/unreachable failures are MCPError (not MCPSecurityError) and are left to
    the sync step to record as ``last_error`` — a typo'd/down public server can
    still be created.
    """
    try:
        validate_public_url(url)
    except MCPSecurityError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except MCPError:
        pass  # unreachable/DNS → soft; sync will populate last_error


async def _sync_server(server: MCPServer) -> None:
    """Best-effort refresh of a server's cached tool list.

    Success → update cache + last_synced_at, clear last_error. Failure → set
    last_error, keep any previously-cached tools (don't wipe a good cache on a
    transient outage).
    """
    try:
        tools = await mcp_client.fetch_tools(server.url, server.transport)
        server.cached_tools = tools
        server.last_synced_at = datetime.now(timezone.utc)
        server.last_error = None
    except MCPError as exc:
        server.last_error = str(exc)


def _get_or_404(server_id: int, db: Session) -> MCPServer:
    server = db.get(MCPServer, server_id)
    if server is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="MCP server not found"
        )
    return server


@router.post(
    "", response_model=MCPServerResponse, status_code=status.HTTP_201_CREATED
)
async def create_mcp_server(payload: MCPServerCreate, db: Session = Depends(get_db)):
    _guard_url(payload.url)
    server = MCPServer(
        name=payload.name,
        url=payload.url,
        description=payload.description,
        transport=payload.transport,
        enabled=payload.enabled,
    )
    db.add(server)
    db.flush()  # assign id (used for namespaced tool names)
    await _sync_server(server)
    db.commit()
    db.refresh(server)
    return _to_response(server)


@router.get("", response_model=list[MCPServerResponse])
def list_mcp_servers(db: Session = Depends(get_db)):
    servers = db.scalars(
        select(MCPServer).order_by(MCPServer.created_at.desc())
    ).all()
    return [_to_response(s) for s in servers]


@router.get("/{server_id}", response_model=MCPServerResponse)
def get_mcp_server(server_id: int, db: Session = Depends(get_db)):
    return _to_response(_get_or_404(server_id, db))


@router.put("/{server_id}", response_model=MCPServerResponse)
async def update_mcp_server(
    server_id: int, payload: MCPServerUpdate, db: Session = Depends(get_db)
):
    server = _get_or_404(server_id, db)
    _guard_url(payload.url)
    server.name = payload.name
    server.url = payload.url
    server.description = payload.description
    server.transport = payload.transport
    server.enabled = payload.enabled
    await _sync_server(server)  # URL/transport may have changed → re-sync
    db.commit()
    db.refresh(server)
    return _to_response(server)


@router.post("/{server_id}/refresh", response_model=MCPServerResponse)
async def refresh_mcp_server(server_id: int, db: Session = Depends(get_db)):
    server = _get_or_404(server_id, db)
    _guard_url(server.url)
    await _sync_server(server)
    db.commit()
    db.refresh(server)
    return _to_response(server)


@router.delete("/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_mcp_server(server_id: int, db: Session = Depends(get_db)):
    server = _get_or_404(server_id, db)

    # Block deletion when an agent uses any of this server's tools — otherwise
    # the agent keeps a dangling mcp_{id}_* name in allowed_tools. Consistent
    # with the agent/KB delete guards.
    referencing = [
        agent.id
        for agent in db.scalars(select(Agent)).all()
        if any(
            parse_server_id(name) == server_id
            for name in (agent.allowed_tools or [])
        )
    ]
    if referencing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Bu MCP server şu agent'ların araçlarında kullanılıyor: "
                f"{referencing}. Silmeden önce o agent'lardan çıkarın."
            ),
        )

    db.delete(server)
    db.commit()
