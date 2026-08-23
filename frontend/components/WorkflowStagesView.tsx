"use client";

import { StepTrace, buildTrace } from "@/components/DebugPanel";
import {
  BranchRun,
  STATUS_META,
  StageRun,
  deriveStageStatus,
} from "@/lib/workflowTrace";

/** One branch's view: name/status (parallel only), output, error, tool trace. */
function BranchColumn({
  branch,
  running,
  showName,
}: {
  branch: BranchRun;
  running: boolean;
  showName: boolean;
}) {
  const meta = STATUS_META[branch.status];
  return (
    <div
      className={`rounded-lg border p-3 ${
        branch.status === "error"
          ? "border-red-800/50 bg-red-950/10"
          : "border-slate-800 bg-slate-950/30"
      }`}
    >
      {showName && (
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm font-medium text-slate-200">
            {branch.agent_name}
          </span>
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${meta.cls}`}>
            {meta.label}
          </span>
        </div>
      )}

      {branch.error && (
        <p className="mb-2 rounded-md border border-red-800/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          {branch.error}
        </p>
      )}

      {branch.output && (
        <div className="mb-2 whitespace-pre-wrap rounded-lg bg-slate-950/60 p-3 text-sm text-slate-100">
          {branch.output}
          {running && branch.status === "running" && (
            <span className="animate-pulse">▋</span>
          )}
        </div>
      )}

      {branch.status === "skipped" && (
        <p className="text-xs text-slate-600">
          Önceki adımdaki hata nedeniyle atlandı.
        </p>
      )}

      <StepTrace iterations={buildTrace(branch.events)} emptyLabel={null} />
    </div>
  );
}

/**
 * Renders a workflow run's stages (sequential single-column, parallel side-by-
 * side branches) with per-branch tool traces. Shared by the live run page
 * (running=true streams a cursor) and the read-only replay on the conversation
 * detail page (running=false).
 */
export default function WorkflowStagesView({
  stages,
  running = false,
}: {
  stages: StageRun[];
  running?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {stages.map((stage) => {
        const stageStatus = deriveStageStatus(stage);
        const meta = STATUS_META[stageStatus];
        const gridCls =
          stage.branches.length >= 3
            ? "md:grid-cols-2 lg:grid-cols-3"
            : "md:grid-cols-2";
        return (
          <section
            key={stage.step_order}
            className={`rounded-xl border p-5 ${
              stageStatus === "error"
                ? "border-red-800/60 bg-red-950/10"
                : "border-slate-800 bg-slate-900/50"
            }`}
          >
            <div className="mb-3 flex items-center gap-3">
              <h2 className="font-semibold">
                Adım {stage.step_order + 1}
                {!stage.parallel && stage.branches[0]
                  ? `: ${stage.branches[0].agent_name}`
                  : ""}
              </h2>
              {stage.parallel && (
                <span className="rounded-full bg-violet-900/50 px-2 py-0.5 text-xs text-violet-300">
                  ⇉ paralel · {stage.branches.length} dal
                </span>
              )}
              <span className={`rounded-full px-2 py-0.5 text-xs ${meta.cls}`}>
                {meta.label}
              </span>
            </div>

            {stage.parallel ? (
              <div className={`grid grid-cols-1 gap-3 ${gridCls}`}>
                {stage.branches.map((b) => (
                  <BranchColumn
                    key={b.branch_index}
                    branch={b}
                    running={running}
                    showName
                  />
                ))}
              </div>
            ) : (
              <BranchColumn
                branch={stage.branches[0]}
                running={running}
                showName={false}
              />
            )}

            {stage.parallel && stage.merged && (
              <details className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <summary className="cursor-pointer text-xs text-slate-400">
                  🔀 Birleşik çıktı (sonraki adıma giden)
                </summary>
                <div className="mt-2 whitespace-pre-wrap text-sm text-slate-300">
                  {stage.merged}
                </div>
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}
