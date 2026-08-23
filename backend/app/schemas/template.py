from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class AgentTemplate(BaseModel):
    id: str
    name: str
    description: str = ""
    system_prompt: str
    allowed_tools: list[str] = Field(default_factory=list)
    knowledge_base_id: Optional[int] = None
    model_params: dict = Field(default_factory=dict)

    model_config = ConfigDict(protected_namespaces=())


class WorkflowTemplate(BaseModel):
    id: str
    name: str
    description: str = ""
    # Agent specs this workflow needs; the UI creates any that don't exist yet.
    agents: list[AgentTemplate] = Field(default_factory=list)
    # Ordered step agent names (match `agents[].name`).
    steps: list[str] = Field(default_factory=list)
