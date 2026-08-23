"""Staged multi-agent orchestration (sequential + parallel).

A workflow is a list of STAGES run in order. Each stage is a list of BRANCHES
(agent snapshots):

  - 1 branch  → a plain sequential step (Faz 7A behavior, unchanged): the agent's
    final text becomes the next stage's input (a plain "pipe").
  - N branches → a PARALLEL stage (Faz 7C): the N agents run GENUINELY
    concurrently (one asyncio task each, multiplexed onto a single SSE stream via
    an ``asyncio.Queue``). Their outputs are merged deterministically — each
    branch's text, labeled with its agent name, concatenated in branch order —
    and that merged text becomes the next stage's input. No extra LLM
    coordinator call; the merge is pure string concatenation.

Each agent runs in a fresh single-turn context with its own system_prompt /
model_params / tools / knowledge base, so it doesn't see other agents' internals.

Events reuse the chat SSE envelope. Every inner event from ``llm_client`` is
decorated with ``agent_id`` / ``agent_name`` / ``step_order`` / ``branch_index``
so the UI can attribute it (``branch_index`` is 0 for sequential steps). Stage
brackets:
  - workflow_start {workflow_id, name, step_count}
  - step_start     {step_order, parallel, ...}
        sequential: + {agent_id, agent_name, branch_index:0}
        parallel:   + {branches: [{branch_index, agent_id, agent_name}, ...]}
  - step_complete  {step_order, branch_index, agent_id, agent_name, output, failed}
        (one per branch; for a sequential step this is the single output)
  - step_merged    {step_order, output}    (parallel stages only — the merged
        text that feeds the next stage)
  - workflow_done  {conversation_id}

Error policy:
  - Sequential step failure breaks the pipe (remaining stages skipped), same as
    Faz 7A.
  - Parallel branches are INDEPENDENT: one failing branch does not stop its
    siblings. A failed branch's output is represented as ``"hata: ..."`` text and
    is still included in the merge, so the pipe keeps flowing to the next stage.
"""

import asyncio
from collections.abc import AsyncIterator

from app.core.database import SessionLocal
from app.models.message import Message
from app.services import llm_client

# Faz 7C sanity cap: max agents allowed to run concurrently in one stage. Keeps
# a user from defining, say, 50 parallel branches and hammering the provider.
# Enforced at create/update time (schema) and documented here as the source.
MAX_PARALLEL_BRANCHES = 5


class _BranchDone:
    """Sentinel marking a branch's completion, carrying its final text/output.

    Yielded by :func:`_run_branch` after its event stream so the consumer can
    collect the branch's output (for persistence + merge) while still forwarding
    every inner event live.
    """

    __slots__ = ("branch_index", "output", "failed")

    def __init__(self, branch_index: int, output: str, failed: bool):
        self.branch_index = branch_index
        self.output = output
        self.failed = failed


async def _run_branch(
    branch: dict, current_input: str, meta: dict
) -> AsyncIterator:
    """Run one agent branch, yielding its decorated events then a _BranchDone.

    ``meta`` is stamped onto every event (agent_id/agent_name/step_order/
    branch_index). Never raises: LLM config/API errors become an ``error`` event
    and a failed :class:`_BranchDone` whose ``output`` carries the ``"hata: ..."``
    text (so a parallel merge can include it).
    """
    messages = [{"role": "user", "content": current_input}]
    chunks: list[str] = []
    err_msg: str | None = None
    try:
        async for event in llm_client.stream_completion(
            branch["system_prompt"],
            messages,
            branch["model_params"],
            branch["allowed_tools"],
            branch["knowledge_base_id"],
        ):
            if event["type"] == "token":
                chunks.append(event["content"])
            yield {**event, **meta}
    except llm_client.LLMConfigError as exc:
        err_msg = str(exc)
        yield llm_client.build_event("error", message=err_msg, **meta)
    except Exception as exc:  # noqa: BLE001 — surface any SDK/API error safely
        err_msg = f"LLM hatası: {exc}"
        yield llm_client.build_event("error", message=err_msg, **meta)

    if err_msg is not None:
        yield _BranchDone(meta["branch_index"], f"hata: {err_msg}", True)
    else:
        yield _BranchDone(meta["branch_index"], "".join(chunks), False)


def _persist(conversation_id: int, agent_id: int, step_order: int, output: str) -> None:
    """Persist one branch/step output as an assistant message (fresh session).

    The request session is gone once streaming starts, so we open our own. In a
    parallel stage this is called from the single consumer (never concurrently),
    so SQLite's single-writer constraint is never contended.
    """
    with SessionLocal() as session:
        session.add(
            Message(
                conversation_id=conversation_id,
                role="assistant",
                content=output,
                agent_id=agent_id,
                step_order=step_order,
            )
        )
        session.commit()


def _merge(branches: list[dict], outputs: dict[int, str]) -> str:
    """Deterministically merge a parallel stage's branch outputs.

    Each branch's text is labeled with its agent name and concatenated in branch
    order. Failed branches contribute their ``"hata: ..."`` text like any other.
    """
    parts = [
        f"[{b['agent_name']}]\n{outputs.get(i, '')}"
        for i, b in enumerate(branches)
    ]
    return "\n\n".join(parts)


async def _run_parallel_stage(
    branches: list[dict],
    current_input: str,
    step_order: int,
    conversation_id: int,
) -> AsyncIterator:
    """Run a stage's N branches concurrently, multiplexing events via a queue.

    One producer task per branch pushes its decorated events (and a final
    _BranchDone) onto a shared queue; this single consumer drains the queue,
    forwarding each event live to the SSE stream. Because every event is a
    complete dict emitted from one ``yield`` point, branches interleave without
    corrupting each other — ``branch_index`` routes each to the right column.

    Yields inner/step_complete events, then a final ``_BranchDone`` sentinel with
    the merged output (branch_index -1) so the caller can pipe it onward.
    """
    queue: asyncio.Queue = asyncio.Queue()

    async def producer(branch: dict, branch_index: int) -> None:
        meta = {
            "agent_id": branch["agent_id"],
            "agent_name": branch["agent_name"],
            "step_order": step_order,
            "branch_index": branch_index,
        }
        try:
            async for item in _run_branch(branch, current_input, meta):
                await queue.put(item)
        except Exception as exc:  # noqa: BLE001 — never leave the consumer hanging
            await queue.put(
                llm_client.build_event(
                    "error", message=f"LLM hatası: {exc}", **meta
                )
            )
            await queue.put(_BranchDone(branch_index, f"hata: {exc}", True))

    tasks = [
        asyncio.create_task(producer(b, i)) for i, b in enumerate(branches)
    ]

    outputs: dict[int, str] = {}
    finished = 0
    try:
        while finished < len(branches):
            item = await queue.get()
            if isinstance(item, _BranchDone):
                outputs[item.branch_index] = item.output
                branch = branches[item.branch_index]
                # Persist + emit step_complete live as each branch finishes.
                _persist(
                    conversation_id,
                    branch["agent_id"],
                    step_order,
                    item.output,
                )
                yield llm_client.build_event(
                    "step_complete",
                    step_order=step_order,
                    branch_index=item.branch_index,
                    agent_id=branch["agent_id"],
                    agent_name=branch["agent_name"],
                    output=item.output,
                    failed=item.failed,
                )
                finished += 1
            else:
                yield item
    finally:
        await asyncio.gather(*tasks, return_exceptions=True)

    merged = _merge(branches, outputs)
    yield llm_client.build_event("step_merged", step_order=step_order, output=merged)
    yield _BranchDone(-1, merged, False)


async def run_workflow(
    workflow_id: int,
    workflow_name: str,
    conversation_id: int,
    stages: list[list[dict]],
    initial_input: str,
) -> AsyncIterator[dict]:
    """Run ``stages`` in order, yielding SSE event dicts.

    ``stages`` are plain snapshots (no ORM/session): a list of stages, each a
    list of branch dicts ``{agent_id, agent_name, step_order, branch_order,
    system_prompt, model_params, allowed_tools, knowledge_base_id}``.
    ``conversation_id`` is created by the caller; assistant messages are
    persisted here with fresh sessions.
    """
    yield llm_client.build_event(
        "workflow_start",
        workflow_id=workflow_id,
        name=workflow_name,
        step_count=len(stages),
    )

    current_input = initial_input

    for stage in stages:
        step_order = stage[0]["step_order"]

        if len(stage) == 1:
            # ---- Sequential step (Faz 7A) — a broken step breaks the pipe. ----
            branch = stage[0]
            meta = {
                "agent_id": branch["agent_id"],
                "agent_name": branch["agent_name"],
                "step_order": step_order,
                "branch_index": 0,
            }
            yield llm_client.build_event("step_start", parallel=False, **meta)

            output = ""
            failed = False
            async for item in _run_branch(branch, current_input, meta):
                if isinstance(item, _BranchDone):
                    output, failed = item.output, item.failed
                else:
                    yield item

            if failed:
                break  # a broken step breaks the pipe; skip the rest

            _persist(conversation_id, branch["agent_id"], step_order, output)
            yield llm_client.build_event("step_complete", output=output, **meta)
            current_input = output
        else:
            # ---- Parallel stage (Faz 7C) — independent branches, merged. ----
            yield llm_client.build_event(
                "step_start",
                step_order=step_order,
                parallel=True,
                branches=[
                    {
                        "branch_index": i,
                        "agent_id": b["agent_id"],
                        "agent_name": b["agent_name"],
                    }
                    for i, b in enumerate(stage)
                ],
            )

            merged = current_input
            async for item in _run_parallel_stage(
                stage, current_input, step_order, conversation_id
            ):
                if isinstance(item, _BranchDone):
                    merged = item.output  # the merged stage output
                else:
                    yield item
            # Parallel stages never break the pipe: the merged text (which may
            # embed "hata:" branches) always feeds the next stage.
            current_input = merged

    yield llm_client.build_event("workflow_done", conversation_id=conversation_id)
