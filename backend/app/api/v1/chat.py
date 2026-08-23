"""Chat endpoint: streams a Claude response over Server-Sent Events (SSE).

Event envelope is intentionally extensible; every event carries a "type" and
(Phase 6) an ISO-8601 "timestamp". Emitted events:
  - {"type": "token", "content": "..."}                            one text chunk
  - {"type": "iteration_start", "iteration": N}                    (Phase 6)
  - {"type": "tool_call", "call_id", "tool_name", "input"}         (Phase 4/6)
  - {"type": "tool_result", "call_id", "tool_name", "output",
     "duration_ms"}                                                (Phase 4/6)
  - {"type": "done",  "conversation_id": N, "message_id": M}
  - {"type": "error", "message": "..."}   configuration or API failure

The generator forwards llm_client's events as-is; done/error are built with
llm_client.build_event so they carry a timestamp too. The transport never
changes when new event types are added.
"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.core.ratelimit import STREAM_RATE_LIMIT, limiter
from app.models.agent import Agent
from app.models.conversation import Conversation
from app.models.message import Message
from app.schemas.chat import ChatRequest
from app.services import llm_client
from app.services.mcp import resolver as mcp_resolver

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])


def _sse(event: dict) -> str:
    """Serialize one event as an SSE ``data:`` frame."""
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


def _agent_snapshot(agent: Agent) -> dict:
    """Plain, session-free snapshot of an agent for the streaming generator."""
    return {
        "id": agent.id,
        "name": agent.name,
        "description": agent.description or "",
        "system_prompt": agent.system_prompt or "",
        "model_params": dict(agent.model_params or {}),
        "allowed_tools": list(agent.allowed_tools or []),
        "knowledge_base_id": agent.knowledge_base_id,
        "sub_agent_ids": list(agent.sub_agent_ids or []),
    }


def _resolve_sub_agent_graph(root: Agent, db: Session) -> dict[int, dict]:
    """Load every agent reachable from ``root`` via sub_agent_ids (BFS).

    Returns a snapshot map keyed by agent id. Missing referenced agents are
    simply skipped (the spec builder ignores unknown ids). Visited-tracking here
    is only to avoid loading the same agent twice; run-time cycle prevention is
    handled by llm_client's per-branch visited set.
    """
    agent_map: dict[int, dict] = {root.id: _agent_snapshot(root)}
    queue = list(agent_map[root.id]["sub_agent_ids"])
    while queue:
        aid = queue.pop()
        if aid in agent_map:
            continue
        sub = db.get(Agent, aid)
        if sub is None:
            continue
        agent_map[aid] = _agent_snapshot(sub)
        queue.extend(agent_map[aid]["sub_agent_ids"])
    return agent_map


@router.post("/{agent_id}/stream")
@limiter.limit(STREAM_RATE_LIMIT)
def chat_stream(
    request: Request,
    agent_id: int,
    payload: ChatRequest,
    db: Session = Depends(get_db),
):
    agent = db.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found"
        )

    # Resolve (or create) the conversation.
    if payload.conversation_id is not None:
        conversation = db.get(Conversation, payload.conversation_id)
        if conversation is None or conversation.agent_id != agent_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found for this agent",
            )
    else:
        conversation = Conversation(agent_id=agent_id)
        db.add(conversation)
        db.flush()  # assign conversation.id

    # Persist the incoming user message.
    db.add(
        Message(
            conversation_id=conversation.id,
            role="user",
            content=payload.message,
        )
    )
    db.commit()

    # Snapshot everything the generator needs as plain values — the request-
    # scoped `db` session is not safe to touch once streaming begins.
    conversation_id = conversation.id
    system_prompt = agent.system_prompt or ""
    model_params = dict(agent.model_params or {})
    allowed_tools = list(agent.allowed_tools or [])
    knowledge_base_id = agent.knowledge_base_id

    # Supervisor (7B): if this agent has sub-agents, resolve the reachable graph
    # into a session-free snapshot and build the root context. Otherwise None →
    # behaves exactly like the plain single-agent path.
    sub_ctx = None
    mcp_allowed = list(allowed_tools)
    if agent.sub_agent_ids:
        agent_map = _resolve_sub_agent_graph(agent, db)
        sub_ctx = llm_client.make_root_context(
            agent_map=agent_map,
            sub_agent_ids=list(agent.sub_agent_ids),
            agent_id=agent.id,
            agent_name=agent.name,
        )
        # Include sub-agents' allowed tools so their MCP tools are built too.
        for snap in agent_map.values():
            mcp_allowed.extend(snap.get("allowed_tools", []))

    # MCP tools (Phase 8): build the session-free MCPTool instances for every
    # MCP tool name any reachable agent is allowed to use. Built from cached
    # specs (no network); call_tool hits the server (with the SSRF guard).
    mcp_tools = mcp_resolver.build_mcp_tools(mcp_allowed, db)

    history_rows = db.scalars(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at, Message.id)
    ).all()
    history = [{"role": m.role, "content": m.content} for m in history_rows]

    async def event_generator():
        chunks: list[str] = []
        try:
            async for event in llm_client.stream_completion(
                system_prompt,
                history,
                model_params,
                allowed_tools,
                knowledge_base_id,
                sub_ctx,
                mcp_tools,
            ):
                # Persist only the supervisor's OWN text (depth 0); sub-agent
                # tokens flow through for the UI but aren't the final answer.
                if event["type"] == "token" and event.get("depth", 0) == 0:
                    chunks.append(event["content"])
                # Forward every event as-is (incl. decorated sub-agent events).
                yield _sse(event)
        except llm_client.LLMConfigError as exc:
            # Config errors are user-actionable (e.g. "set ANTHROPIC_API_KEY")
            # and don't leak internals, so they're safe to surface verbatim.
            yield _sse(llm_client.build_event("error", message=str(exc)))
            return
        except Exception:  # noqa: BLE001 — surface any SDK/API error safely
            # Log the detail server-side; return a generic message to the client.
            logger.exception("Chat stream failed (agent_id=%s)", agent_id)
            yield _sse(
                llm_client.build_event(
                    "error", message="İşlem sırasında bir hata oluştu."
                )
            )
            return

        # Persist the assistant reply using a fresh session (the request
        # session is closed by the time this runs).
        text = "".join(chunks)
        with SessionLocal() as session:
            assistant = Message(
                conversation_id=conversation_id,
                role="assistant",
                content=text,
            )
            session.add(assistant)
            session.commit()
            message_id = assistant.id

        yield _sse(
            llm_client.build_event(
                "done",
                conversation_id=conversation_id,
                message_id=message_id,
            )
        )

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable proxy buffering for live tokens
        },
    )
