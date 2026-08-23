"""Built-in template endpoints (read-only, static — see services/templates.py)."""

from fastapi import APIRouter

from app.schemas.template import AgentTemplate, WorkflowTemplate
from app.services.templates import AGENT_TEMPLATES, WORKFLOW_TEMPLATES

router = APIRouter(prefix="/templates", tags=["templates"])


@router.get("/agents", response_model=list[AgentTemplate])
def list_agent_templates():
    return AGENT_TEMPLATES


@router.get("/workflows", response_model=list[WorkflowTemplate])
def list_workflow_templates():
    return WORKFLOW_TEMPLATES
