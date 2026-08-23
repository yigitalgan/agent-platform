from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

# Import here so the default field lives with the schema; the route validates
# tool names against the live registry to return a 400 on unknown names.

Provider = Literal["anthropic", "openrouter"]


class ModelParams(BaseModel):
    """LLM configuration stored on an agent (persisted as JSON).

    ``provider`` selects which key/endpoint the chat service uses; the rest are
    forwarded to the model. Unset fields are dropped before persisting so the
    stored JSON stays minimal.
    """

    provider: Provider = "anthropic"
    model: Optional[str] = None
    temperature: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    max_tokens: Optional[int] = Field(default=None, gt=0, le=8192)
    top_p: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    top_k: Optional[int] = Field(default=None, ge=0)

    # extra="forbid" rejects unknown keys; protected_namespaces silences the
    # pydantic warning about the `model` field name.
    model_config = ConfigDict(extra="forbid", protected_namespaces=())


class _AgentBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str = ""
    system_prompt: str = Field(..., min_length=1)
    model_params: ModelParams = Field(default_factory=ModelParams)
    allowed_tools: list[str] = Field(default_factory=list)
    knowledge_base_id: Optional[int] = None
    # Ids of agents this agent may call as sub-agents (supervisor pattern).
    sub_agent_ids: list[int] = Field(default_factory=list)

    model_config = ConfigDict(protected_namespaces=())


class AgentCreate(_AgentBase):
    pass


class AgentUpdate(_AgentBase):
    """Full replacement (PUT). Same required fields as create."""


class AgentResponse(BaseModel):
    id: int
    name: str
    description: str
    system_prompt: str
    model_params: dict
    allowed_tools: list[str]
    knowledge_base_id: Optional[int] = None
    sub_agent_ids: list[int] = Field(default_factory=list)
    created_at: datetime

    model_config = ConfigDict(from_attributes=True, protected_namespaces=())
