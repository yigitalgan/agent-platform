// Shared workflow-run trace model + reducer. Turns a stream of WorkflowEvents
// into a StageRun[] (stages, each with parallel branches). Used both live (the
// run page applies events one by one) and for replay (a saved trace is reduced
// all at once on the conversation detail page).

import { ChatEvent, Workflow, WorkflowEvent } from "@/lib/api";

export type StepStatus = "pending" | "running" | "done" | "error" | "skipped";

// One branch of a stage (Faz 7C). A sequential stage has a single branch.
export interface BranchRun {
  branch_index: number;
  agent_name: string;
  status: StepStatus;
  output: string;
  error?: string;
  events: ChatEvent[]; // inner tool events → buildTrace on render
}

export interface StageRun {
  step_order: number;
  parallel: boolean;
  branches: BranchRun[];
  merged?: string; // parallel stage's merged text (feeds the next stage)
}

export const STATUS_META: Record<StepStatus, { label: string; cls: string }> = {
  pending: { label: "bekliyor", cls: "bg-slate-800 text-slate-400" },
  running: { label: "çalışıyor…", cls: "bg-amber-900/50 text-amber-300" },
  done: { label: "tamamlandı ✓", cls: "bg-emerald-900/50 text-emerald-300" },
  error: { label: "hata", cls: "bg-red-900/50 text-red-300" },
  skipped: { label: "atlandı", cls: "bg-slate-800 text-slate-500" },
};

export function deriveStageStatus(stage: StageRun): StepStatus {
  const st = stage.branches.map((b) => b.status);
  if (st.every((s) => s === "skipped")) return "skipped";
  if (st.some((s) => s === "running")) return "running";
  // A finished branch alongside a not-yet-started one still reads as running.
  if (
    st.some((s) => s === "done" || s === "error") &&
    st.some((s) => s === "pending")
  )
    return "running";
  if (st.every((s) => s === "pending")) return "pending";
  // All finished: a sequential failure is fatal; parallel failures stay per-branch.
  if (!stage.parallel && st.some((s) => s === "error")) return "error";
  return "done";
}

/** Pre-seed all stages as "pending" from the workflow definition (live run). */
export function initialStagesFromWorkflow(wf: Workflow): StageRun[] {
  return wf.steps.map((g) => ({
    step_order: g.step_order,
    parallel: g.parallel,
    merged: undefined,
    branches: g.agents.map((a, i) => ({
      branch_index: i,
      agent_name: a.agent_name,
      status: "pending" as StepStatus,
      output: "",
      events: [],
    })),
  }));
}

function updateBranch(
  stages: StageRun[],
  stepOrder: number,
  bi: number,
  fn: (b: BranchRun) => BranchRun
): StageRun[] {
  return stages.map((s) =>
    s.step_order === stepOrder
      ? { ...s, branches: s.branches.map((b) => (b.branch_index === bi ? fn(b) : b)) }
      : s
  );
}

/**
 * Apply one event to the stages, returning a new array (pure). Upserts a stage
 * on step_start, so it works whether stages were pre-seeded (live) or start
 * empty (replay). Sequential-stage failures mark later pending stages skipped;
 * workflow_done marks any leftover pending branch skipped.
 */
export function applyWorkflowEvent(
  stages: StageRun[],
  ev: WorkflowEvent
): StageRun[] {
  switch (ev.type) {
    case "step_start": {
      const existing = stages.find((s) => s.step_order === ev.step_order);
      if (existing) {
        return stages.map((s) =>
          s.step_order === ev.step_order
            ? {
                ...s,
                branches: s.branches.map((b) => ({
                  ...b,
                  status: "running" as StepStatus,
                })),
              }
            : s
        );
      }
      const branches: BranchRun[] =
        ev.parallel && ev.branches
          ? ev.branches.map((b) => ({
              branch_index: b.branch_index,
              agent_name: b.agent_name,
              status: "running" as StepStatus,
              output: "",
              events: [],
            }))
          : [
              {
                branch_index: ev.branch_index ?? 0,
                agent_name: ev.agent_name ?? "",
                status: "running" as StepStatus,
                output: "",
                events: [],
              },
            ];
      return [
        ...stages,
        { step_order: ev.step_order, parallel: ev.parallel, branches },
      ].sort((a, b) => a.step_order - b.step_order);
    }
    case "token":
      return updateBranch(stages, ev.step_order, ev.branch_index, (b) => ({
        ...b,
        output: b.output + ev.content,
      }));
    case "iteration_start":
    case "tool_call":
    case "tool_result":
      return updateBranch(stages, ev.step_order, ev.branch_index, (b) => ({
        ...b,
        events: [...b.events, ev as unknown as ChatEvent],
      }));
    case "step_complete":
      return updateBranch(stages, ev.step_order, ev.branch_index, (b) => ({
        ...b,
        status: ev.failed ? "error" : "done",
        output: ev.output,
      }));
    case "step_merged":
      return stages.map((s) =>
        s.step_order === ev.step_order ? { ...s, merged: ev.output } : s
      );
    case "error": {
      let next = updateBranch(
        stages,
        ev.step_order,
        ev.branch_index,
        (b) => ({ ...b, status: "error", error: ev.message })
      );
      const stage = next.find((s) => s.step_order === ev.step_order);
      if (stage && !stage.parallel) {
        next = next.map((s) =>
          s.step_order > ev.step_order
            ? {
                ...s,
                branches: s.branches.map((b) =>
                  b.status === "pending"
                    ? { ...b, status: "skipped" as StepStatus }
                    : b
                ),
              }
            : s
        );
      }
      return next;
    }
    case "workflow_done":
      return stages.map((s) => ({
        ...s,
        branches: s.branches.map((b) =>
          b.status === "pending" ? { ...b, status: "skipped" as StepStatus } : b
        ),
      }));
    default:
      return stages;
  }
}

/** Reduce a full saved event stream into final stages (replay). */
export function buildStagesFromEvents(events: WorkflowEvent[]): StageRun[] {
  return events.reduce(applyWorkflowEvent, [] as StageRun[]);
}
