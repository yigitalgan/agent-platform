from sqlalchemy import ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class WorkflowStep(Base):
    """One agent slot in a workflow: which agent runs at which stage/branch.

    Surrogate ``id`` PK (not composite) so the same agent may appear at more
    than one position within a workflow. ``step_order`` is the sequential STAGE
    position; multiple rows sharing a ``step_order`` are PARALLEL branches of
    that stage (Faz 7C), ordered within the stage by ``branch_order``. A stage
    with a single row is a plain sequential step (``branch_order`` 0).
    """

    __tablename__ = "workflow_steps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    workflow_id: Mapped[int] = mapped_column(
        ForeignKey("workflows.id", ondelete="CASCADE"), index=True
    )
    agent_id: Mapped[int] = mapped_column(
        ForeignKey("agents.id", ondelete="CASCADE"), index=True
    )
    step_order: Mapped[int] = mapped_column(Integer, nullable=False)
    # Order of this branch within its parallel stage (0 for sequential steps).
    branch_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    workflow: Mapped["Workflow"] = relationship("Workflow", back_populates="steps")
    agent: Mapped["Agent"] = relationship("Agent")
