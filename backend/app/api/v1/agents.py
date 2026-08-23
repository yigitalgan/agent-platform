from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.agent import Agent
from app.models.conversation import Conversation
from app.models.knowledge_base import KnowledgeBase
from app.models.workflow_step import WorkflowStep
from app.schemas.agent import AgentCreate, AgentResponse, AgentUpdate
from app.services.mcp import resolver as mcp_resolver
from app.services.tools import mcp_tool, registry

router = APIRouter(prefix="/agents", tags=["agents"])


def _validate_tools(allowed_tools: list[str], db: Session) -> None:
    """Reject unknown tool names with a 400.

    Names split into built-in tools (validated against the registry) and MCP
    tools (``mcp_*``, validated against enabled servers' cached tool names).
    """
    builtin = [n for n in allowed_tools if not mcp_tool.is_mcp_tool_name(n)]
    mcp_names = [n for n in allowed_tools if mcp_tool.is_mcp_tool_name(n)]

    invalid = registry.invalid_tool_names(builtin)
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Geçersiz tool ismi: {', '.join(invalid)}. "
                f"Geçerli araçlar: {', '.join(registry.all_tool_names())}."
            ),
        )

    if mcp_names:
        known_mcp = mcp_resolver.all_enabled_tool_names(db)
        unknown = [n for n in mcp_names if n not in known_mcp]
        if unknown:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Geçersiz/erişilemez MCP tool ismi: {', '.join(unknown)}. "
                    "İlgili MCP server enabled ve senkron mu?"
                ),
            )


def _validate_knowledge_base(
    allowed_tools: list[str], knowledge_base_id: int | None, db: Session
) -> None:
    """Enforce the document_search ↔ knowledge_base_id coupling.

    - document_search selected but no KB → 400 (the tool is useless without one).
    - a KB id given → it must exist → 400 if not.
    """
    if "document_search" in allowed_tools and knowledge_base_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "'document_search' aracı seçildi ancak bir bilgi tabanı "
                "(knowledge_base_id) belirtilmedi."
            ),
        )
    if knowledge_base_id is not None and db.get(KnowledgeBase, knowledge_base_id) is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"knowledge_base_id={knowledge_base_id} bulunamadı.",
        )


def _validate_sub_agents(
    sub_agent_ids: list[int], db: Session, self_id: int | None = None
) -> None:
    """Validate the supervisor's sub-agent list.

    - No self-reference (an agent can't be its own sub-agent) → 400.
    - Every referenced agent must exist → 400.

    Deeper cycle prevention (A→B→A) is guaranteed at run time by the visited-set
    guard in llm_client, so we only reject the trivial self-loop here.
    """
    if self_id is not None and self_id in sub_agent_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bir agent kendisini alt agent olarak seçemez.",
        )
    if sub_agent_ids:
        existing = set(
            db.scalars(select(Agent.id).where(Agent.id.in_(sub_agent_ids))).all()
        )
        missing = [aid for aid in sub_agent_ids if aid not in existing]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Şu alt agent id'leri bulunamadı: {missing}",
            )


def _validate_provider_key(provider: str) -> None:
    """Ensure the API key for the chosen provider is configured in .env.

    Raises 400 with a clear message so the builder UI can surface it instead
    of the agent silently failing at chat time.
    """
    if provider == "openrouter" and not settings.OPENROUTER_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "'openrouter' provider seçildi ancak OPENROUTER_API_KEY .env "
                "dosyasında ayarlanmamış."
            ),
        )
    if provider == "anthropic" and not settings.ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "'anthropic' provider seçildi ancak ANTHROPIC_API_KEY .env "
                "dosyasında ayarlanmamış."
            ),
        )


@router.post("", response_model=AgentResponse, status_code=status.HTTP_201_CREATED)
def create_agent(payload: AgentCreate, db: Session = Depends(get_db)):
    _validate_provider_key(payload.model_params.provider)
    _validate_tools(payload.allowed_tools, db)
    _validate_knowledge_base(payload.allowed_tools, payload.knowledge_base_id, db)
    _validate_sub_agents(payload.sub_agent_ids, db)
    agent = Agent(
        name=payload.name,
        description=payload.description,
        system_prompt=payload.system_prompt,
        model_params=payload.model_params.model_dump(exclude_none=True),
        allowed_tools=payload.allowed_tools,
        knowledge_base_id=payload.knowledge_base_id,
        sub_agent_ids=payload.sub_agent_ids,
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return agent


@router.get("", response_model=list[AgentResponse])
def list_agents(db: Session = Depends(get_db)):
    return db.scalars(select(Agent).order_by(Agent.created_at.desc())).all()


@router.get("/{agent_id}", response_model=AgentResponse)
def get_agent(agent_id: int, db: Session = Depends(get_db)):
    agent = db.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found"
        )
    return agent


@router.put("/{agent_id}", response_model=AgentResponse)
def update_agent(
    agent_id: int, payload: AgentUpdate, db: Session = Depends(get_db)
):
    agent = db.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found"
        )
    _validate_provider_key(payload.model_params.provider)
    _validate_tools(payload.allowed_tools, db)
    _validate_knowledge_base(payload.allowed_tools, payload.knowledge_base_id, db)
    _validate_sub_agents(payload.sub_agent_ids, db, self_id=agent_id)

    agent.name = payload.name
    agent.description = payload.description
    agent.system_prompt = payload.system_prompt
    agent.model_params = payload.model_params.model_dump(exclude_none=True)
    agent.allowed_tools = payload.allowed_tools
    agent.knowledge_base_id = payload.knowledge_base_id
    agent.sub_agent_ids = payload.sub_agent_ids
    db.commit()
    db.refresh(agent)
    return agent


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_agent(agent_id: int, db: Session = Depends(get_db)):
    agent = db.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found"
        )

    # Block deletion when conversations exist — data loss must be explicit.
    convo_count = db.scalar(
        select(func.count())
        .select_from(Conversation)
        .where(Conversation.agent_id == agent_id)
    )
    if convo_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Bu agent'a bağlı {convo_count} konuşma var. Silmeden önce "
                "bu konuşmaları kaldırın."
            ),
        )

    # Block deletion when the agent is part of a workflow — otherwise the
    # workflow would silently break (its step would cascade away).
    workflow_step_count = db.scalar(
        select(func.count())
        .select_from(WorkflowStep)
        .where(WorkflowStep.agent_id == agent_id)
    )
    if workflow_step_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Bu agent {workflow_step_count} workflow adımında kullanılıyor. "
                "Silmeden önce ilgili workflow'lardan çıkarın."
            ),
        )

    # Block deletion when another agent references this one as a sub-agent —
    # otherwise that supervisor would point at a missing agent. sub_agent_ids is
    # JSON, so scan in Python (small table; avoids DB-specific JSON queries).
    supervisors = [
        a.id
        for a in db.scalars(select(Agent).where(Agent.id != agent_id)).all()
        if agent_id in (a.sub_agent_ids or [])
    ]
    if supervisors:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Bu agent şu supervisor agent'ların alt agent'ı: {supervisors}. "
                "Silmeden önce onların sub_agent_ids listesinden çıkarın."
            ),
        )

    db.delete(agent)
    db.commit()
