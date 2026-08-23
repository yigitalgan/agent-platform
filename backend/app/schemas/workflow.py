from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.services.orchestration.sequential import MAX_PARALLEL_BRANCHES


class WorkflowStepAgent(BaseModel):
    """One agent (branch) within a stage."""

    agent_id: int
    agent_name: str


class WorkflowStepGroup(BaseModel):
    """One stage of a workflow: one sequential agent, or N parallel branches."""

    step_order: int
    parallel: bool
    agents: list[WorkflowStepAgent]


class _WorkflowBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str = ""
    # Faz 7C: stages as a list of agent-id groups. Group index = step_order;
    # a group of 1 = sequential step, a group of N = parallel branches
    # (branch order = position in the group). ``agent_ids`` (flat) stays as a
    # legacy alias → normalized to one singleton group per id.
    steps: list[list[int]] | None = None
    agent_ids: list[int] | None = None

    @model_validator(mode="after")
    def _normalize_steps(self):
        groups = self.steps
        if not groups:
            if self.agent_ids:
                groups = [[aid] for aid in self.agent_ids]
            else:
                raise ValueError(
                    "steps (veya legacy agent_ids) zorunlu ve boş olamaz."
                )
        for group in groups:
            if not group:
                raise ValueError("Bir adım en az bir agent içermeli.")
            if len(group) > MAX_PARALLEL_BRANCHES:
                raise ValueError(
                    f"Bir adımda en fazla {MAX_PARALLEL_BRANCHES} paralel "
                    "agent olabilir."
                )
        self.steps = groups
        return self


class WorkflowCreate(_WorkflowBase):
    pass


class WorkflowUpdate(_WorkflowBase):
    """Full replacement (PUT): name/description + the ordered stage list."""


class WorkflowResponse(BaseModel):
    id: int
    name: str
    description: str
    created_at: datetime
    steps: list[WorkflowStepGroup]

    model_config = ConfigDict(from_attributes=True)


class WorkflowRunRequest(BaseModel):
    input: str = Field(..., min_length=1)
