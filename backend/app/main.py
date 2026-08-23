from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import inspect, text

from app.api.v1 import (
    agents,
    chat,
    conversations,
    health,
    knowledge_bases,
    mcp_servers,
    templates,
    workflows,
)
from app.core.auth import require_api_key
from app.core.config import settings
from app.core.database import Base, engine
from app.core.ratelimit import limiter

# Import models so they are registered on Base.metadata before create_all.
from app import models  # noqa: F401


def _ensure_schema() -> None:
    """Dev-grade migration until a real tool (Alembic) is introduced.

    `create_all` only creates missing tables, never alters existing ones, so
    a column added to an already-created table won't appear. We add such
    columns here idempotently.
    """
    inspector = inspect(engine)
    if "agents" in inspector.get_table_names():
        columns = {c["name"] for c in inspector.get_columns("agents")}
        if "description" not in columns:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE agents "
                        "ADD COLUMN description TEXT NOT NULL DEFAULT ''"
                    )
                )
        if "allowed_tools" not in columns:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE agents "
                        "ADD COLUMN allowed_tools JSON NOT NULL DEFAULT '[]'"
                    )
                )
        if "knowledge_base_id" not in columns:
            # Nullable FK; SQLite can't add a column with a REFERENCES clause
            # via ALTER, so add a plain nullable INTEGER (the ORM enforces the
            # relationship; there's no DB-level FK on existing rows anyway).
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE agents ADD COLUMN knowledge_base_id INTEGER"
                    )
                )
        if "sub_agent_ids" not in columns:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE agents "
                        "ADD COLUMN sub_agent_ids JSON NOT NULL DEFAULT '[]'"
                    )
                )

    # Faz 7A: workflow-run bookkeeping on existing tables. Both are nullable
    # INTEGER columns, so a plain ADD COLUMN is safe (no REFERENCES via ALTER).
    if "conversations" in inspector.get_table_names():
        conv_columns = {c["name"] for c in inspector.get_columns("conversations")}
        if "workflow_id" not in conv_columns:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE conversations ADD COLUMN workflow_id INTEGER")
                )
        # Opt-in debug trace blob (nullable JSON). Existing rows get NULL.
        if "trace" not in conv_columns:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE conversations ADD COLUMN trace JSON")
                )
    if "messages" in inspector.get_table_names():
        msg_columns = {c["name"] for c in inspector.get_columns("messages")}
        if "agent_id" not in msg_columns:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE messages ADD COLUMN agent_id INTEGER")
                )
        if "step_order" not in msg_columns:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE messages ADD COLUMN step_order INTEGER")
                )

    # Faz 7C: parallel stages. A stage (step_order) may hold multiple
    # WorkflowStep rows (branches); branch_order sequences them. Existing rows
    # get 0 (single-branch → unchanged sequential behavior).
    if "workflow_steps" in inspector.get_table_names():
        ws_columns = {c["name"] for c in inspector.get_columns("workflow_steps")}
        if "branch_order" not in ws_columns:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE workflow_steps "
                        "ADD COLUMN branch_order INTEGER NOT NULL DEFAULT 0"
                    )
                )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Refuse to boot without an API key so auth is never silently disabled.
    if not settings.APP_API_KEY:
        raise RuntimeError(
            "APP_API_KEY .env dosyasında ayarlanmalı — auth zorunludur, "
            "boş bırakılamaz."
        )
    Base.metadata.create_all(bind=engine)
    _ensure_schema()
    yield


app = FastAPI(title="Agent Platform API", version="0.1.0", lifespan=lifespan)

# Rate limiting (slowapi): register the limiter + 429 handler.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health is exposed at /health (unversioned, PUBLIC) for simple liveness checks.
app.include_router(health.router)

# All /api/v1/* routes require a valid X-API-Key (see app.core.auth).
_api_auth = [Depends(require_api_key)]
app.include_router(agents.router, prefix="/api/v1", dependencies=_api_auth)
app.include_router(chat.router, prefix="/api/v1", dependencies=_api_auth)
app.include_router(
    knowledge_bases.router, prefix="/api/v1", dependencies=_api_auth
)
app.include_router(workflows.router, prefix="/api/v1", dependencies=_api_auth)
app.include_router(mcp_servers.router, prefix="/api/v1", dependencies=_api_auth)
app.include_router(
    conversations.router, prefix="/api/v1", dependencies=_api_auth
)
app.include_router(templates.router, prefix="/api/v1", dependencies=_api_auth)


@app.get("/")
def root():
    return {"service": "agent-platform", "docs": "/docs"}
