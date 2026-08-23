"""Workflow (sequential multi-agent) endpoints.

CRUD for workflows (an ordered list of agents) plus a streaming run endpoint
that pipes each agent's output into the next. See
``app/services/orchestration/sequential.py`` for the run mechanics.
"""

import json

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.ratelimit import STREAM_RATE_LIMIT, limiter
from app.models.agent import Agent
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.workflow import Workflow
from app.models.workflow_step import WorkflowStep
from app.schemas.workflow import (
    WorkflowCreate,
    WorkflowResponse,
    WorkflowRunRequest,
    WorkflowStepAgent,
    WorkflowStepGroup,
    WorkflowUpdate,
)
from app.services.orchestration import sequential


def _group_steps(workflow: Workflow) -> list[list[WorkflowStep]]:
    """Group a workflow's steps into ordered stages by ``step_order``.

    ``workflow.steps`` is already ordered by (step_order, branch_order), so a
    plain group-preserving pass yields stages in order with branches in order.
    """
    stages: list[list[WorkflowStep]] = []
    current_order: int | None = None
    for step in workflow.steps:
        if step.step_order != current_order:
            stages.append([])
            current_order = step.step_order
        stages[-1].append(step)
    return stages

router = APIRouter(prefix="/workflows", tags=["workflows"])


def _sse(event: dict) -> str:
    """Serialize one event as an SSE ``data:`` frame."""
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


def _to_response(workflow: Workflow) -> WorkflowResponse:
    """Build the response, grouping steps into stages (parallel branches)."""
    stages = _group_steps(workflow)
    return WorkflowResponse(
        id=workflow.id,
        name=workflow.name,
        description=workflow.description,
        created_at=workflow.created_at,
        steps=[
            WorkflowStepGroup(
                step_order=rows[0].step_order,
                parallel=len(rows) > 1,
                agents=[
                    WorkflowStepAgent(agent_id=s.agent_id, agent_name=s.agent.name)
                    for s in rows
                ],
            )
            for rows in stages
        ],
    )


def _validate_agents(groups: list[list[int]], db: Session) -> None:
    """400 if any referenced agent id (across all stages) doesn't exist."""
    agent_ids = [aid for group in groups for aid in group]
    existing = set(
        db.scalars(select(Agent.id).where(Agent.id.in_(agent_ids))).all()
    )
    missing = [aid for aid in agent_ids if aid not in existing]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Şu agent id'leri bulunamadı: {missing}",
        )


def _get_workflow_or_404(workflow_id: int, db: Session) -> Workflow:
    workflow = db.get(Workflow, workflow_id)
    if workflow is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found"
        )
    return workflow


def _set_steps(workflow: Workflow, groups: list[list[int]], db: Session) -> None:
    """Replace a workflow's steps with the given stages.

    ``groups`` is a list of stages; each stage is a list of agent ids that run
    in parallel. Stage index → ``step_order``; position within a stage →
    ``branch_order``. A singleton stage is a plain sequential step.
    """
    for existing in list(workflow.steps):
        db.delete(existing)
    db.flush()
    for step_order, group in enumerate(groups):
        for branch_order, agent_id in enumerate(group):
            db.add(
                WorkflowStep(
                    workflow_id=workflow.id,
                    agent_id=agent_id,
                    step_order=step_order,
                    branch_order=branch_order,
                )
            )


@router.post(
    "", response_model=WorkflowResponse, status_code=status.HTTP_201_CREATED
)
def create_workflow(payload: WorkflowCreate, db: Session = Depends(get_db)):
    _validate_agents(payload.steps, db)
    workflow = Workflow(name=payload.name, description=payload.description)
    db.add(workflow)
    db.flush()  # assign workflow.id
    _set_steps(workflow, payload.steps, db)
    db.commit()
    db.refresh(workflow)
    return _to_response(workflow)


@router.get("", response_model=list[WorkflowResponse])
def list_workflows(db: Session = Depends(get_db)):
    workflows = db.scalars(
        select(Workflow).order_by(Workflow.created_at.desc())
    ).all()
    return [_to_response(w) for w in workflows]


@router.get("/{workflow_id}", response_model=WorkflowResponse)
def get_workflow(workflow_id: int, db: Session = Depends(get_db)):
    return _to_response(_get_workflow_or_404(workflow_id, db))


@router.put("/{workflow_id}", response_model=WorkflowResponse)
def update_workflow(
    workflow_id: int, payload: WorkflowUpdate, db: Session = Depends(get_db)
):
    workflow = _get_workflow_or_404(workflow_id, db)
    _validate_agents(payload.steps, db)
    workflow.name = payload.name
    workflow.description = payload.description
    _set_steps(workflow, payload.steps, db)
    db.commit()
    db.refresh(workflow)
    return _to_response(workflow)


@router.delete("/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workflow(workflow_id: int, db: Session = Depends(get_db)):
    workflow = _get_workflow_or_404(workflow_id, db)
    db.delete(workflow)  # steps cascade via relationship
    db.commit()


@router.post("/{workflow_id}/stream")
@limiter.limit(STREAM_RATE_LIMIT)
def run_workflow_stream(
    request: Request,
    workflow_id: int,
    payload: WorkflowRunRequest,
    db: Session = Depends(get_db),
):
    workflow = _get_workflow_or_404(workflow_id, db)
    if not workflow.steps:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Workflow'da hiç adım (agent) yok.",
        )

    # Snapshot each step to plain values, grouped into stages (parallel
    # branches) — the request session is not safe to touch once the streaming
    # generator runs (it executes after this returns).
    stages: list[list[dict]] = []
    for rows in _group_steps(workflow):
        stage: list[dict] = []
        for s in rows:
            agent = s.agent
            stage.append(
                {
                    "agent_id": agent.id,
                    "agent_name": agent.name,
                    "step_order": s.step_order,
                    "branch_order": s.branch_order,
                    "system_prompt": agent.system_prompt or "",
                    "model_params": dict(agent.model_params or {}),
                    "allowed_tools": list(agent.allowed_tools or []),
                    "knowledge_base_id": agent.knowledge_base_id,
                }
            )
        stages.append(stage)

    # One conversation per run. agent_id holds the entry (first-stage, first-
    # branch) agent so the NOT NULL column is satisfied; workflow_id marks it as
    # a workflow run.
    conversation = Conversation(
        workflow_id=workflow.id, agent_id=stages[0][0]["agent_id"]
    )
    db.add(conversation)
    db.flush()
    db.add(
        Message(
            conversation_id=conversation.id,
            role="user",
            content=payload.input,
        )
    )
    db.commit()

    conversation_id = conversation.id
    workflow_name = workflow.name

    async def event_generator():
        async for event in sequential.run_workflow(
            workflow_id=workflow_id,
            workflow_name=workflow_name,
            conversation_id=conversation_id,
            stages=stages,
            initial_input=payload.input,
        ):
            yield _sse(event)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
