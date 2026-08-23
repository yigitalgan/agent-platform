# Agent Platform

A platform for building AI agents without writing code. **This repository is
currently the Phase 1 skeleton** — the backend/frontend scaffolding is in place,
but there is no LLM integration yet.

## Stack

- **Backend:** FastAPI + SQLAlchemy + SQLite (Python 3.12)
- **Frontend:** Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Orchestration:** Docker Compose (dev mode with hot-reload)

## Project structure

```
agent-platform/
├── backend/
│   └── app/
│       ├── main.py              # FastAPI app + CORS + router wiring
│       ├── core/
│       │   ├── config.py        # Pydantic Settings (.env)
│       │   └── database.py      # SQLAlchemy engine / session
│       ├── models/              # Agent, Conversation, Message
│       ├── schemas/             # Pydantic request/response models
│       └── api/v1/
│           ├── health.py        # GET /health
│           └── agents.py        # Agent CRUD
├── frontend/
│   ├── app/                     # Next.js App Router (page, layout)
│   ├── components/HealthStatus  # Shows backend health on the home page
│   └── lib/api.ts               # fetch wrapper (base URL from env)
├── docker-compose.yml
└── .env.example
```

## Quick start

1. Copy the example env file and fill in values as needed (the
   `ANTHROPIC_API_KEY` is not used yet in Phase 1, so it can stay empty):

   ```bash
   cp .env.example .env
   ```

2. Bring everything up:

   ```bash
   docker compose up --build
   ```

3. Open the apps:

   - Frontend: <http://localhost:3000> — shows a live backend health check.
   - Backend health: <http://localhost:8000/health> → `{"status": "healthy"}`
   - API docs (Swagger): <http://localhost:8000/docs>

Both services run with hot-reload: editing files under `backend/` or
`frontend/` reloads the respective server automatically.

## API endpoints (Phase 1)

| Method | Path                  | Description            |
| ------ | --------------------- | ---------------------- |
| GET    | `/health`             | Liveness check         |
| POST   | `/api/v1/agents`      | Create an agent        |
| GET    | `/api/v1/agents`      | List agents            |
| GET    | `/api/v1/agents/{id}` | Get a single agent     |
| DELETE | `/api/v1/agents/{id}` | Delete an agent        |

### Example: create an agent

```bash
curl -X POST http://localhost:8000/api/v1/agents \
  -H "Content-Type: application/json" \
  -d '{"name": "Support Bot", "system_prompt": "You are helpful.", "model_params": {"temperature": 0.7}}'
```

## Running without Docker (optional)

**Backend:**

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

**Frontend:**

```bash
cd frontend
npm install
npm run dev
```

## Roadmap

- **Phase 1 (current):** Skeleton — API + DB models + frontend health check.
- **Phase 2:** LLM integration (Anthropic), conversation/message endpoints,
  agent chat UI.
