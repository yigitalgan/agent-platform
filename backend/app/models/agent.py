from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    system_prompt: Mapped[str] = mapped_column(Text, default="")
    # Stored as JSON. SQLite has no native JSON type, so SQLAlchemy's generic
    # JSON type serializes this to TEXT under the hood.
    model_params: Mapped[dict] = mapped_column(JSON, default=dict)
    # Names of tools this agent may use (subset of the tool registry), e.g.
    # ["calculator", "wikipedia_search"]. Empty = no tools.
    allowed_tools: Mapped[list] = mapped_column(
        JSON, default=list, server_default="[]"
    )
    # Optional knowledge base for the document_search tool. Only meaningful when
    # "document_search" is in allowed_tools (enforced at the API layer).
    knowledge_base_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("knowledge_bases.id", ondelete="SET NULL"), nullable=True
    )
    # Ids of other agents this agent may call as sub-agents (Phase 7B —
    # supervisor pattern). Each is surfaced to the model as a synthetic tool.
    # Empty = not a supervisor. Mirrors the allowed_tools JSON-list pattern.
    sub_agent_ids: Mapped[list] = mapped_column(
        JSON, default=list, server_default="[]"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    conversations: Mapped[list["Conversation"]] = relationship(
        "Conversation",
        back_populates="agent",
        cascade="all, delete-orphan",
    )
