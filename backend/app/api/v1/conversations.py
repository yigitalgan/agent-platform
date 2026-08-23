"""Conversation management endpoints.

Lets users view and delete conversations from the UI so an agent/workflow that's
blocked from deletion (409 — has conversations) can be cleared without touching
the DB directly. The agent/workflow delete guards themselves are unchanged.
"""

import json

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.agent import Agent
from app.models.conversation import Conversation
from app.models.message import Message
from app.schemas.conversation import (
    ConversationDetail,
    ConversationListItem,
    ConversationMessage,
)

router = APIRouter(prefix="/conversations", tags=["conversations"])

_PREVIEW_LEN = 100

# Opt-in debug trace size cap (~1 MB). Guards against storing a huge blob; the
# trace is a debug convenience, not a primary artifact.
_MAX_TRACE_BYTES = 1_048_576


def _agent_names(db: Session, agent_ids: set[int]) -> dict[int, str]:
    """Map the given agent ids to names (missing ids omitted)."""
    ids = {a for a in agent_ids if a is not None}
    if not ids:
        return {}
    return {
        a.id: a.name
        for a in db.scalars(select(Agent).where(Agent.id.in_(ids))).all()
    }


@router.get("", response_model=list[ConversationListItem])
def list_conversations(
    agent_id: int | None = None,
    workflow_id: int | None = None,
    db: Session = Depends(get_db),
):
    query = select(Conversation)
    if agent_id is not None:
        query = query.where(Conversation.agent_id == agent_id)
    if workflow_id is not None:
        query = query.where(Conversation.workflow_id == workflow_id)
    conversations = db.scalars(
        query.order_by(Conversation.created_at.desc())
    ).all()

    # Message counts in one grouped query.
    counts = dict(
        db.execute(
            select(Message.conversation_id, func.count(Message.id)).group_by(
                Message.conversation_id
            )
        ).all()
    )
    names = _agent_names(db, {c.agent_id for c in conversations})

    items: list[ConversationListItem] = []
    for c in conversations:
        last = db.scalars(
            select(Message)
            .where(Message.conversation_id == c.id)
            .order_by(Message.created_at.desc(), Message.id.desc())
            .limit(1)
        ).first()
        first_user = db.scalars(
            select(Message)
            .where(Message.conversation_id == c.id, Message.role == "user")
            .order_by(Message.created_at, Message.id)
            .limit(1)
        ).first()
        preview = (last.content or "")[:_PREVIEW_LEN] if last else ""
        input_preview = (
            (first_user.content or "")[:_PREVIEW_LEN] if first_user else ""
        )
        # Failed if the final message is a persisted "hata:" output, else done.
        failed = bool(last) and (last.content or "").lstrip().lower().startswith(
            "hata:"
        )
        items.append(
            ConversationListItem(
                id=c.id,
                agent_id=c.agent_id,
                agent_name=names.get(c.agent_id, "(silinmiş agent)"),
                workflow_id=c.workflow_id,
                message_count=counts.get(c.id, 0),
                created_at=c.created_at,
                preview=preview,
                input_preview=input_preview,
                status="failed" if failed else "completed",
                trace_saved=c.trace is not None,
            )
        )
    return items


@router.get("/{conversation_id}", response_model=ConversationDetail)
def get_conversation(conversation_id: int, db: Session = Depends(get_db)):
    conversation = db.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found"
        )

    messages = db.scalars(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at, Message.id)
    ).all()

    # Resolve agent names for the conversation owner + any per-message agent.
    ids = {conversation.agent_id} | {m.agent_id for m in messages}
    names = _agent_names(db, ids)

    return ConversationDetail(
        id=conversation.id,
        agent_id=conversation.agent_id,
        agent_name=names.get(conversation.agent_id, "(silinmiş agent)"),
        workflow_id=conversation.workflow_id,
        created_at=conversation.created_at,
        messages=[
            ConversationMessage(
                id=m.id,
                role=m.role,
                content=m.content,
                agent_id=m.agent_id,
                agent_name=names.get(m.agent_id) if m.agent_id else None,
                step_order=m.step_order,
                created_at=m.created_at,
            )
            for m in messages
        ],
        trace=conversation.trace,
    )


@router.put("/{conversation_id}/trace", status_code=status.HTTP_204_NO_CONTENT)
async def save_conversation_trace(
    conversation_id: int, request: Request, db: Session = Depends(get_db)
):
    """Save (opt-in) the client's debug trace blob for a conversation.

    Body is the raw trace JSON (the client's accumulated event stream). Overwrites
    any prior trace. 404 if the conversation doesn't exist, 413 if the body is
    larger than ~1 MB, 400 if the body isn't valid JSON.
    """
    conversation = db.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found"
        )

    # Reject oversized bodies early via Content-Length when the client sets it,
    # then re-check the actual bytes read (in case the header is absent/wrong).
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > _MAX_TRACE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Trace çok büyük (en fazla 1 MB).",
        )
    raw = await request.body()
    if len(raw) > _MAX_TRACE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Trace çok büyük (en fazla 1 MB).",
        )

    try:
        trace = json.loads(raw) if raw else None
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Geçersiz JSON gövdesi.",
        )

    conversation.trace = trace
    db.commit()


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(conversation_id: int, db: Session = Depends(get_db)):
    conversation = db.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found"
        )
    db.delete(conversation)  # messages cascade (ORM + FK ON DELETE CASCADE)
    db.commit()
