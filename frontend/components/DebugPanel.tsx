"use client";

import { ReactNode, useState } from "react";
import { ChatEvent } from "@/lib/api";

// One tool (or sub-agent) invocation: the call plus its later-arriving result.
export interface DebugCall {
  call_id: string;
  tool_name: string;
  input: Record<string, unknown>;
  output?: string; // filled when the tool_result arrives
  duration_ms?: number;
  timestamp: string;
  // "sub_agent" delegates to a sub-agent (7B); "mcp" is a remote MCP tool (8);
  // else a built-in tool.
  kind?: "tool" | "sub_agent" | "mcp";
  sub_agent_name?: string;
  // For a sub_agent call: the sub-agent's own nested trace (its iterations).
  iterations?: DebugIteration[];
}

// One tool-use round-trip (Claude request → tool executions).
export interface DebugIteration {
  iteration: number;
  calls: DebugCall[];
}

// The full trace for a single user turn (one message send). Stored as the raw
// event stream; the tree is (re)built by buildTrace on render.
export interface DebugTurn {
  question: string;
  events: ChatEvent[];
  error?: string;
}

function isError(output: string | undefined): boolean {
  return (output ?? "").trimStart().toLowerCase().startsWith("hata:");
}

/**
 * Build a (possibly nested) iteration tree from a flat event stream. Events are
 * placed by `parent_call_id`: those with none go to the root; those pointing at
 * a sub-agent tool_call are nested inside that call's own iterations. Results
 * are matched to their call by `call_id` (via an index), so nesting depth is
 * unbounded (bounded in practice by the backend's MAX_AGENT_DEPTH).
 */
export function buildTrace(events: ChatEvent[]): DebugIteration[] {
  const root: DebugIteration[] = [];
  const callIndex = new Map<string, DebugCall>();

  const containerFor = (
    parentCallId: string | null | undefined
  ): DebugIteration[] => {
    if (!parentCallId) return root;
    const parent = callIndex.get(parentCallId);
    if (!parent) return root; // defensive: unknown parent → root
    if (!parent.iterations) parent.iterations = [];
    return parent.iterations;
  };

  for (const ev of events) {
    if (ev.type === "iteration_start") {
      containerFor(ev.parent_call_id).push({
        iteration: ev.iteration,
        calls: [],
      });
    } else if (ev.type === "tool_call") {
      const container = containerFor(ev.parent_call_id);
      if (container.length === 0) container.push({ iteration: 1, calls: [] });
      const call: DebugCall = {
        call_id: ev.call_id,
        tool_name: ev.tool_name,
        input: ev.input,
        timestamp: ev.timestamp,
        kind: ev.kind ?? "tool",
        sub_agent_name: ev.sub_agent_name,
      };
      container[container.length - 1].calls.push(call);
      callIndex.set(ev.call_id, call);
    } else if (ev.type === "tool_result") {
      const call = callIndex.get(ev.call_id);
      if (call) {
        call.output = ev.output;
        call.duration_ms = ev.duration_ms;
      }
    }
  }
  return root;
}

function ToolCard({ call, depth }: { call: DebugCall; depth: number }) {
  const [open, setOpen] = useState(false);
  const pending = call.output === undefined;
  const failed = !pending && isError(call.output);
  const isSubAgent = call.kind === "sub_agent";
  const isMcp = call.kind === "mcp";

  // Accent: errors are always red. Sub-agents = indigo, MCP tools = cyan, and
  // built-in tools = green/emerald — each visually distinct.
  const accent = failed
    ? "border-red-800/60 bg-red-950/20"
    : isSubAgent
    ? "border-indigo-700/60 bg-indigo-950/30"
    : isMcp
    ? "border-cyan-700/60 bg-cyan-950/30"
    : pending
    ? "border-amber-700/60 bg-amber-950/20"
    : "border-emerald-800/60 bg-emerald-950/20";

  const title = isSubAgent
    ? `🤖 ${call.sub_agent_name ?? call.tool_name}`
    : isMcp
    ? `🔌 ${call.tool_name}`
    : call.tool_name;

  return (
    <div className={`rounded-md border ${accent}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
      >
        <span className="text-slate-400">{open ? "▾" : "▸"}</span>
        <span
          className={`font-medium ${
            isSubAgent
              ? "text-indigo-200"
              : isMcp
              ? "text-cyan-200"
              : "font-mono text-slate-200"
          }`}
        >
          {title}
        </span>
        {isSubAgent && (
          <span className="rounded-full bg-indigo-900/60 px-1.5 py-0.5 text-[10px] text-indigo-300">
            alt agent
          </span>
        )}
        {isMcp && (
          <span className="rounded-full bg-cyan-900/60 px-1.5 py-0.5 text-[10px] text-cyan-300">
            MCP
          </span>
        )}
        {pending ? (
          <span className="ml-auto flex items-center gap-1 text-amber-300">
            <span className="animate-pulse">●</span>
            {isSubAgent ? " devrediliyor…" : " çalışıyor…"}
          </span>
        ) : (
          <span
            className={`ml-auto font-mono ${
              failed ? "text-red-300" : "text-emerald-300"
            }`}
          >
            {failed ? "hata" : "✓"} · {call.duration_ms}ms
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-slate-800/80 px-3 py-2 text-xs">
          <p className="mb-1 text-slate-500">
            {isSubAgent ? "görev (task)" : "input"}
          </p>
          <pre className="mb-2 overflow-x-auto rounded bg-slate-950/70 p-2 font-mono text-[11px] text-slate-300">
            {JSON.stringify(call.input, null, 2)}
          </pre>

          {/* A sub-agent's own trace, nested one level deeper. */}
          {isSubAgent && call.iterations && call.iterations.length > 0 && (
            <div className="mb-2 border-l-2 border-indigo-800/50 pl-3">
              <p className="mb-1 text-[11px] uppercase tracking-wider text-indigo-400/70">
                {call.sub_agent_name ?? "alt agent"} işlemleri
              </p>
              <StepTrace
                iterations={call.iterations}
                emptyLabel={null}
                depth={depth + 1}
              />
            </div>
          )}

          {!pending && (
            <>
              <p className="mb-1 text-slate-500">
                {isSubAgent ? "alt agent yanıtı" : "output"}
              </p>
              <pre
                className={`overflow-x-auto whitespace-pre-wrap rounded bg-slate-950/70 p-2 font-mono text-[11px] ${
                  failed ? "text-red-300" : "text-slate-300"
                }`}
              >
                {call.output}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Renders one trace's iterations ("Tur N" + tool/sub-agent cards). Recursive: a
 * sub-agent card renders a nested StepTrace for the sub-agent's own iterations.
 * Reused per chat turn (DebugPanel) and per workflow step (workflow run view).
 */
export function StepTrace({
  iterations,
  emptyLabel = "Araç kullanılmadı — doğrudan yanıt verildi.",
  depth = 0,
}: {
  iterations: DebugIteration[];
  emptyLabel?: string | null;
  depth?: number;
}) {
  const anyCalls = iterations.some((it) => it.calls.length > 0);
  if (!anyCalls) {
    return emptyLabel ? (
      <p className="text-xs text-slate-600">{emptyLabel}</p>
    ) : null;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {iterations.map(
        (it) =>
          it.calls.length > 0 && (
            <div key={it.iteration} className="flex flex-col gap-1.5">
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-600">
                Tur {it.iteration}
              </p>
              {it.calls.map((call) => (
                <ToolCard key={call.call_id} call={call} depth={depth} />
              ))}
            </div>
          )
      )}
    </div>
  );
}

export default function DebugPanel({
  turns,
  action,
}: {
  turns: DebugTurn[];
  action?: ReactNode;
}) {
  const hasContent = turns.length > 0;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          İşlem Günlüğü (Debug)
        </h3>
        {action}
      </div>

      {!hasContent ? (
        <p className="text-xs text-slate-600">
          Henüz işlem yok. Bir mesaj gönderin; agent'ın araç adımları burada
          canlı görünecek.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {turns.map((turn, ti) => (
            <div key={ti} className="flex flex-col gap-2">
              <p className="truncate text-xs text-slate-400">
                <span className="text-slate-600">soru:</span> {turn.question}
              </p>

              {turn.error && (
                <p className="rounded-md border border-red-800/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                  {turn.error}
                </p>
              )}

              <StepTrace
                iterations={buildTrace(turn.events)}
                emptyLabel={turn.error ? null : undefined}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
