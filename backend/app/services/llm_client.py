"""Anthropic (Claude) LLM client service.

Wraps the official ``anthropic`` SDK and exposes a streaming helper that yields
structured events. Phase 4 adds native tool-use: when the agent has
``allowed_tools``, their specs are passed to Claude; if Claude returns
``tool_use``, the referenced tool is executed and its result fed back in a
follow-up turn, looping until Claude produces a final answer.

The generator yields event dicts (never raw strings) so the chat endpoint can
forward them straight onto the SSE transport. Every event carries an ISO-8601
``timestamp``. Phase 6 enriches the tool-use events for the debug panel:
  - {"type": "token", "content": "...", "timestamp": ...}
  - {"type": "iteration_start", "iteration": N, "timestamp": ...}
  - {"type": "tool_call", "call_id": "...", "tool_name": "...", "input": {...},
     "timestamp": ...}
  - {"type": "tool_result", "call_id": "...", "tool_name": "...",
     "output": "...", "duration_ms": N, "timestamp": ...}
The ``call_id`` (uuid4) on a tool_call is echoed on its matching tool_result so
the UI can pair them; ``duration_ms`` measures the tool's execution time.
"""

import os
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime, timezone

import anthropic

from app.core.config import settings
from app.services.tools import registry


def _now() -> str:
    """Current UTC time as an ISO-8601 string (for event timestamps)."""
    return datetime.now(timezone.utc).isoformat()


def build_event(event_type: str, **fields) -> dict:
    """Build an event dict with a ``type`` and ``timestamp``, plus extra fields."""
    return {"type": event_type, "timestamp": _now(), **fields}


# Default model — Claude Haiku 4.5. Overridable per-agent via model_params.
DEFAULT_MODEL = "claude-haiku-4-5-20251001"
DEFAULT_MAX_TOKENS = 1024

# Safety cap on the tool-use loop so a misbehaving model can't spin forever.
MAX_TOOL_ITERATIONS = 6

# Supervisor (Phase 7B) limits.
# Max nesting depth: supervisor=0, its sub-agent=1, … At MAX_AGENT_DEPTH a level
# is offered no sub-agent tools (runs with real tools only) — bounds recursion.
MAX_AGENT_DEPTH = 3
# Total sub-agent invocations allowed across one whole request (shared budget),
# regardless of tree shape — the primary cost/blow-up guard. Lowered to 4 to cap
# worst-case LLM calls per request at ~root(6) + 4*6 = 30 (was ~54).
MAX_SUB_AGENT_CALLS = 4
# Synthetic tool-name prefix for a sub-agent (Claude tool names must match
# ^[a-zA-Z0-9_-]{1,64}$, so we use the agent id, not its display name).
SUB_AGENT_TOOL_PREFIX = "call_agent_"

# Keys from an agent's model_params (JSON) that we forward to the API. Anything
# else is ignored so a stray key can't turn into a 400 from the SDK.
_PASSTHROUGH_PARAMS = ("temperature", "top_p", "top_k")


@dataclass
class _CallBudget:
    """Mutable, shared-by-reference counter for MAX_SUB_AGENT_CALLS.

    The SAME instance is threaded through every branch/depth of a request so the
    total number of sub-agent invocations is capped across the whole tree.
    """

    remaining: int


@dataclass
class SubAgentContext:
    """Per-level recursion state for the supervisor pattern.

    Copied (with a fresh ``visited``) for each sub-agent branch so branches don't
    pollute each other, while ``budget`` stays a shared reference so the call cap
    spans the whole request. ``visited`` holds the ancestor chain's agent ids
    (including this agent's own id) so a sub-agent can never re-enter an ancestor
    (cycle guard). ``parent_call_id`` is the tool_call id under which THIS agent
    runs (None at the root); it decorates this agent's direct events.
    """

    agent_map: dict[int, dict]
    sub_agent_ids: list[int]
    depth: int
    visited: frozenset[int]
    budget: _CallBudget
    agent_id: int | None = None
    agent_name: str | None = None
    parent_call_id: str | None = None


def make_root_context(
    agent_map: dict[int, dict],
    sub_agent_ids: list[int],
    agent_id: int,
    agent_name: str,
) -> SubAgentContext:
    """Build the depth-0 supervisor context with a fresh shared call budget."""
    return SubAgentContext(
        agent_map=agent_map,
        sub_agent_ids=list(sub_agent_ids),
        depth=0,
        visited=frozenset({agent_id}),
        budget=_CallBudget(MAX_SUB_AGENT_CALLS),
        agent_id=agent_id,
        agent_name=agent_name,
        parent_call_id=None,
    )


def _sub_agent_tool_name(agent_id: int) -> str:
    return f"{SUB_AGENT_TOOL_PREFIX}{agent_id}"


def _sub_agent_specs(ctx: SubAgentContext | None) -> tuple[list[dict], dict[str, int]]:
    """Build synthetic Claude tool specs for this level's callable sub-agents.

    Returns ``(specs, name->agent_id map)``. Excludes any sub-agent already in
    the ancestor chain (``visited``) and offers nothing at/over MAX_AGENT_DEPTH.
    """
    specs: list[dict] = []
    name_map: dict[str, int] = {}
    if ctx is None or ctx.depth >= MAX_AGENT_DEPTH:
        return specs, name_map
    for sid in ctx.sub_agent_ids:
        if sid in ctx.visited:  # cycle guard — ancestor (or self) not offered
            continue
        sub = ctx.agent_map.get(sid)
        if sub is None:
            continue
        name = _sub_agent_tool_name(sid)
        description = f"'{sub['name']}' adlı uzman alt agent'ı çağır."
        if sub.get("description"):
            description += f" {sub['description']}"
        specs.append(
            {
                "name": name,
                "description": description,
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "task": {
                            "type": "string",
                            "description": "Alt agent'a verilecek görev veya soru.",
                        }
                    },
                    "required": ["task"],
                },
            }
        )
        name_map[name] = sid
    return specs, name_map


# OpenRouter'ın Anthropic-uyumlu endpoint'i. SDK buna "/v1/messages" ekler.
OPENROUTER_BASE_URL = "https://openrouter.ai/api"


class LLMConfigError(RuntimeError):
    """Raised when the LLM client cannot be configured (e.g. missing API key)."""


def _build_client(provider: str | None = None) -> anthropic.AsyncAnthropic:
    """Construct the async client for the requested provider.

    ``provider`` gelirse (agent'ın ``model_params.provider``'ı) onu kullanır,
    yoksa global ``LLM_PROVIDER``'a düşer.

    - ``anthropic`` (varsayılan): ``api_key`` ile doğrudan Anthropic API.
    - ``openrouter``: OpenRouter'ın Anthropic-uyumlu endpoint'i; api_key
      yerine ``auth_token`` (Bearer) ile OpenRouter anahtarı kullanılır.
    """
    provider = (provider or settings.LLM_PROVIDER).strip().lower()

    if provider == "openrouter":
        if not settings.OPENROUTER_API_KEY:
            raise LLMConfigError(
                "OPENROUTER_API_KEY tanımlı değil. LLM_PROVIDER=openrouter için "
                "kök dizindeki .env dosyanıza geçerli bir anahtar ekleyin."
            )
        # Auth yalnızca Bearer (auth_token) ile. SDK, api_key verilmese bile
        # ANTHROPIC_API_KEY env'ine düşer; boş bir değer bile "X-Api-Key: ''"
        # başlığı üretip Bearer ile çakışır ("Could not resolve authentication
        # method"). Bunu önlemek için openrouter modunda env'i temizliyoruz.
        os.environ.pop("ANTHROPIC_API_KEY", None)
        return anthropic.AsyncAnthropic(
            base_url=OPENROUTER_BASE_URL,
            auth_token=settings.OPENROUTER_API_KEY,
        )

    # Varsayılan: doğrudan Anthropic.
    if not settings.ANTHROPIC_API_KEY:
        raise LLMConfigError(
            "ANTHROPIC_API_KEY tanımlı değil. Kök dizindeki .env dosyanıza "
            "geçerli bir anahtar ekleyip servisi yeniden başlatın."
        )
    return anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)


async def _run_tool(
    name: str,
    tool_input: dict,
    context: dict | None = None,
    mcp_tools: dict | None = None,
) -> str:
    """Execute a tool, always returning a string (never raising).

    Resolves ``name`` first against the per-request ``mcp_tools`` map (Phase 8 —
    dynamic MCP tools) and then the static registry. Tools already wrap expected
    failures as ``"hata: ..."``; this is a second safety net so an unexpected
    exception still comes back as a tool_result instead of crashing the stream.
    ``context`` carries per-request state (e.g. ``knowledge_base_id``).
    """
    tool = (mcp_tools or {}).get(name) or registry.get_tool(name)
    if tool is None:
        return f"hata: '{name}' adlı tool bulunamadı."
    try:
        return await tool.execute(tool_input or {}, context)
    except Exception as exc:  # noqa: BLE001 — never let a tool crash the stream
        return f"hata: tool çalıştırılamadı ({exc})"


async def stream_completion(
    system_prompt: str,
    messages: list[dict],
    model_params: dict | None = None,
    allowed_tools: list[str] | None = None,
    knowledge_base_id: int | None = None,
    sub_ctx: SubAgentContext | None = None,
    mcp_tools: dict | None = None,
) -> AsyncIterator[dict]:
    """Stream a Claude completion as event dicts, running tools if requested.

    ``messages`` is a list of ``{"role": "user"|"assistant", "content": str}``.
    When ``allowed_tools`` resolves to known tool specs they are passed to
    Claude; a ``tool_use`` response is executed and fed back as a follow-up
    turn, looping until Claude stops requesting tools (or the iteration cap is
    hit). ``document_search`` is only offered when a ``knowledge_base_id`` is
    set, and that id is passed to tools via ``context``.

    Phase 7B — supervisor: when ``sub_ctx`` is provided, this agent's sub-agents
    are ALSO offered to Claude as synthetic tools. A sub-agent tool_use runs the
    sub-agent recursively (its own full tool loop), streaming its inner events
    (decorated with ``depth``/``parent_call_id``/``agent_id``) and returning its
    final text as the tool_result. ``sub_ctx=None`` is the plain single-agent
    path (byte-compatible with pre-7B except tool events gain a ``kind`` field).

    The client is built per ``LLM_PROVIDER``. Raises :class:`LLMConfigError` if
    the provider key is missing; SDK/API errors propagate to the caller.
    """
    params = model_params or {}
    client = _build_client(params.get("provider"))

    def deco(event: dict) -> dict:
        """Stamp this agent's identity/depth/parent onto a direct event."""
        if sub_ctx is None:
            return event
        return {
            **event,
            "depth": sub_ctx.depth,
            "agent_id": sub_ctx.agent_id,
            "agent_name": sub_ctx.agent_name,
            "parent_call_id": sub_ctx.parent_call_id,
        }

    # document_search needs a bound knowledge base; drop it if none is set so
    # Claude is never offered a tool it can't use. (The API layer also enforces
    # this at create/update time.)
    effective_tools = list(allowed_tools or [])
    if "document_search" in effective_tools and knowledge_base_id is None:
        effective_tools.remove("document_search")
    tool_specs = registry.tool_specs(effective_tools)
    tool_context = {"knowledge_base_id": knowledge_base_id}

    # MCP tools (Phase 8): dynamic per-request tools. registry.tool_specs already
    # ignored the mcp_* names (they're not in the registry); add their specs here
    # for the names this agent is allowed to use.
    mcp_tools = mcp_tools or {}
    mcp_specs = [
        mcp_tools[n].spec() for n in effective_tools if n in mcp_tools
    ]

    # Sub-agent synthetic specs (empty unless this is a supervisor with room to
    # recurse). Combined with the real + MCP tool specs for the model.
    sub_specs, sub_name_map = _sub_agent_specs(sub_ctx)
    all_specs = tool_specs + mcp_specs + sub_specs

    base_kwargs: dict = {
        "model": params.get("model", DEFAULT_MODEL),
        "max_tokens": params.get("max_tokens", DEFAULT_MAX_TOKENS),
    }
    if system_prompt:
        base_kwargs["system"] = system_prompt
    for key in _PASSTHROUGH_PARAMS:
        if key in params:
            base_kwargs[key] = params[key]
    if all_specs:
        base_kwargs["tools"] = all_specs

    # Working conversation — we append assistant turns and tool_result turns as
    # the loop progresses. Copy so we don't mutate the caller's history list.
    convo: list[dict] = list(messages)

    for iteration in range(1, MAX_TOOL_ITERATIONS + 1):
        yield deco(build_event("iteration_start", iteration=iteration))

        async with client.messages.stream(messages=convo, **base_kwargs) as stream:
            async for text in stream.text_stream:
                yield deco(build_event("token", content=text))
            final = await stream.get_final_message()

        if final.stop_reason != "tool_use":
            return

        # Record the assistant turn (text + tool_use blocks) verbatim so the
        # follow-up request can reference the tool_use ids.
        assistant_content: list[dict] = []
        tool_uses = []
        for block in final.content:
            if block.type == "text":
                assistant_content.append({"type": "text", "text": block.text})
            elif block.type == "tool_use":
                assistant_content.append(
                    {
                        "type": "tool_use",
                        "id": block.id,
                        "name": block.name,
                        "input": block.input,
                    }
                )
                tool_uses.append(block)
        convo.append({"role": "assistant", "content": assistant_content})

        # Execute each requested tool/sub-agent and collect the results for one
        # user turn. A fresh call_id ties each tool_call to its tool_result.
        tool_results: list[dict] = []
        for block in tool_uses:
            call_id = str(uuid.uuid4())

            if block.name in sub_name_map:
                # --- Sub-agent branch (recursive) ---------------------------
                output = ""
                async for event in _run_sub_agent(
                    block, call_id, sub_name_map[block.name], sub_ctx, deco,
                    mcp_tools,
                ):
                    if isinstance(event, _SubAgentResult):
                        output = event.output
                    else:
                        yield event
            else:
                # --- Real / MCP tool branch ---------------------------------
                tool_kind = "mcp" if block.name in mcp_tools else "tool"
                yield deco(
                    build_event(
                        "tool_call",
                        call_id=call_id,
                        tool_name=block.name,
                        input=block.input,
                        kind=tool_kind,
                    )
                )
                started = time.perf_counter()
                output = await _run_tool(
                    block.name, block.input, tool_context, mcp_tools
                )
                duration_ms = int((time.perf_counter() - started) * 1000)
                yield deco(
                    build_event(
                        "tool_result",
                        call_id=call_id,
                        tool_name=block.name,
                        output=output,
                        duration_ms=duration_ms,
                        kind=tool_kind,
                    )
                )

            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": output,
                }
            )
        convo.append({"role": "user", "content": tool_results})


@dataclass
class _SubAgentResult:
    """Sentinel yielded by ``_run_sub_agent`` carrying the final text output.

    Lets the caller stream the sub-agent's events while still receiving its
    collected final text (the tool_result content) at the end.
    """

    output: str


async def _run_sub_agent(
    block,
    call_id: str,
    sub_id: int,
    parent_ctx: SubAgentContext,
    deco,
    mcp_tools: dict | None = None,
) -> AsyncIterator:
    """Run one sub-agent for a supervisor tool_use, streaming its events.

    Yields the supervisor's decorated ``tool_call``/``tool_result`` (kind=
    "sub_agent") bracketing the sub-agent's own (decorated) inner events, and
    finally a :class:`_SubAgentResult` with the collected text. Never raises:
    config/API errors become an error event + an error tool_result so the
    supervisor keeps going.
    """
    sub = parent_ctx.agent_map[sub_id]
    task = str((block.input or {}).get("task", "")).strip()

    yield deco(
        build_event(
            "tool_call",
            call_id=call_id,
            tool_name=block.name,
            input=block.input,
            kind="sub_agent",
            sub_agent_id=sub_id,
            sub_agent_name=sub["name"],
        )
    )

    started = time.perf_counter()

    # Shared budget guard (spans the whole request). Over budget → error result.
    if parent_ctx.budget.remaining <= 0:
        output = "hata: alt agent çağrı limiti aşıldı (MAX_SUB_AGENT_CALLS)."
    else:
        parent_ctx.budget.remaining -= 1
        # Fresh visited (copy!) per branch so siblings don't pollute each other;
        # budget is the SAME object (shared) across all branches/depths.
        child_ctx = SubAgentContext(
            agent_map=parent_ctx.agent_map,
            sub_agent_ids=list(sub.get("sub_agent_ids", [])),
            depth=parent_ctx.depth + 1,
            visited=parent_ctx.visited | {sub_id},
            budget=parent_ctx.budget,
            agent_id=sub_id,
            agent_name=sub["name"],
            parent_call_id=call_id,
        )
        collected: list[str] = []
        try:
            async for event in stream_completion(
                sub["system_prompt"],
                [{"role": "user", "content": task}],
                sub["model_params"],
                sub["allowed_tools"],
                sub["knowledge_base_id"],
                child_ctx,
                mcp_tools,
            ):
                # The sub-agent's OWN text (direct tokens) forms its answer;
                # deeper descendants have a different parent_call_id.
                if event.get("type") == "token" and event.get("parent_call_id") == call_id:
                    collected.append(event["content"])
                yield event
            output = "".join(collected) or "(alt agent boş yanıt döndürdü)"
        except LLMConfigError as exc:
            output = f"hata: alt agent yapılandırma hatası ({exc})"
            yield {
                **build_event("error", message=output),
                "depth": parent_ctx.depth + 1,
                "agent_id": sub_id,
                "agent_name": sub["name"],
                "parent_call_id": call_id,
            }
        except Exception as exc:  # noqa: BLE001 — never let a sub-agent crash the run
            output = f"hata: alt agent çalışırken hata ({exc})"
            yield {
                **build_event("error", message=output),
                "depth": parent_ctx.depth + 1,
                "agent_id": sub_id,
                "agent_name": sub["name"],
                "parent_call_id": call_id,
            }

    duration_ms = int((time.perf_counter() - started) * 1000)
    yield deco(
        build_event(
            "tool_result",
            call_id=call_id,
            tool_name=block.name,
            output=output,
            duration_ms=duration_ms,
            kind="sub_agent",
            sub_agent_id=sub_id,
            sub_agent_name=sub["name"],
        )
    )
    yield _SubAgentResult(output=output)
