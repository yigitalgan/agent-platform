from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict


class ConversationListItem(BaseModel):
    """One row in the conversations list (summary + preview)."""

    id: int
    agent_id: int
    agent_name: str
    workflow_id: Optional[int] = None
    message_count: int
    created_at: datetime
    preview: str = ""  # first ~100 chars of the last message (output)
    input_preview: str = ""  # first ~100 chars of the first user message (input)
    # Simple heuristic: "failed" if the last message starts with "hata:", else
    # "completed". No debug trace is stored — just final input/output text.
    status: str = "completed"
    # Whether an opt-in debug trace has been saved for this conversation.
    trace_saved: bool = False


class ConversationMessage(BaseModel):
    id: int
    role: str
    content: str
    agent_id: Optional[int] = None
    agent_name: Optional[str] = None
    step_order: Optional[int] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ConversationDetail(BaseModel):
    id: int
    agent_id: int
    agent_name: str
    workflow_id: Optional[int] = None
    created_at: datetime
    messages: list[ConversationMessage]
    # Opt-in debug trace blob (null unless the user saved it). Discriminated:
    # {"type": "chat", "turns": [...]} or {"type": "workflow", "events": [...]}.
    trace: Optional[Any] = None
