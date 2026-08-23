from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    # When omitted, a new conversation is created for the agent.
    conversation_id: int | None = None
