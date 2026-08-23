"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Workflow,
  WorkflowEvent,
  getWorkflow,
  saveConversationTrace,
  streamWorkflow,
} from "@/lib/api";
import {
  StageRun,
  applyWorkflowEvent,
  initialStagesFromWorkflow,
} from "@/lib/workflowTrace";
import WorkflowStagesView from "@/components/WorkflowStagesView";
import ErrorBanner from "@/components/ErrorBanner";
import LoadingSpinner from "@/components/LoadingSpinner";
import Toast from "@/components/Toast";

export default function RunWorkflowPage({
  params,
}: {
  params: { id: string };
}) {
  const id = Number(params.id);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [input, setInput] = useState("");
  const [stages, setStages] = useState<StageRun[]>([]);
  const [running, setRunning] = useState(false);
  const [overall, setOverall] = useState<"idle" | "running" | "done" | "error">(
    "idle"
  );
  const [runError, setRunError] = useState<string | null>(null);

  // Opt-in trace save: the finished run's conversation id + full event stream.
  const [runConversationId, setRunConversationId] = useState<number | null>(
    null
  );
  const [allEvents, setAllEvents] = useState<WorkflowEvent[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedTrace, setSavedTrace] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function loadWorkflow() {
    setLoadError(null);
    getWorkflow(id)
      .then((wf) => {
        setWorkflow(wf);
        setStages(initialStagesFromWorkflow(wf));
      })
      .catch((err: unknown) =>
        setLoadError(err instanceof Error ? err.message : "Workflow yüklenemedi")
      );
  }

  useEffect(() => {
    loadWorkflow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onRun(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || !workflow || running) return;

    // Reset the run view.
    setStages(initialStagesFromWorkflow(workflow));
    setRunError(null);
    setRunning(true);
    setOverall("running");
    setRunConversationId(null);
    setSavedTrace(false);
    const collected: WorkflowEvent[] = [];
    let pipeBroken = false; // set only by a sequential (non-parallel) failure

    try {
      await streamWorkflow(id, text, (event: WorkflowEvent) => {
        collected.push(event);
        setStages((prev) => applyWorkflowEvent(prev, event));
        if (event.type === "workflow_done") {
          setRunConversationId(event.conversation_id);
          setOverall(pipeBroken ? "error" : "done");
        } else if (event.type === "error") {
          const parallel =
            workflow.steps.find((g) => g.step_order === event.step_order)
              ?.parallel ?? false;
          if (!parallel) pipeBroken = true;
        }
      });
    } catch (err: unknown) {
      setRunError(err instanceof Error ? err.message : "Akış hatası");
      setOverall("error");
    } finally {
      setAllEvents(collected);
      setRunning(false);
    }
  }

  async function onSaveRun() {
    if (runConversationId === null) return;
    setSaving(true);
    setRunError(null);
    try {
      await saveConversationTrace(runConversationId, {
        type: "workflow",
        events: allEvents,
      });
      setSavedTrace(true);
      setToast("Kaydedildi");
      setTimeout(() => setToast(null), 1500);
    } catch (err: unknown) {
      setRunError(err instanceof Error ? err.message : "Kayıt başarısız");
    } finally {
      setSaving(false);
    }
  }

  const overallBanner = {
    idle: null,
    running: { text: "Workflow çalışıyor…", cls: "text-amber-300" },
    done: { text: "Workflow tamamlandı ✓", cls: "text-emerald-300" },
    error: { text: "Workflow bir adımda durdu", cls: "text-red-300" },
  }[overall];

  const canSave =
    (overall === "done" || overall === "error") &&
    runConversationId !== null &&
    !running;

  const summary = workflow
    ? workflow.steps
        .map((g) =>
          g.parallel
            ? `(${g.agents.map((a) => a.agent_name).join(" ∥ ")})`
            : g.agents[0]?.agent_name
        )
        .join(" → ")
    : "";

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-16">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/workflows"
            className="text-sm text-slate-400 hover:text-slate-200"
          >
            ← Workflow'lar
          </Link>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">
            {workflow ? workflow.name : `Workflow #${id}`}
          </h1>
          {workflow && (
            <p className="mt-1 text-sm text-slate-500">
              {workflow.steps.length} adım: {summary}
            </p>
          )}
        </div>
        {workflow && (
          <Link
            href={`/workflows/${id}`}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
          >
            Düzenle
          </Link>
        )}
      </div>

      {loadError && <ErrorBanner message={loadError} onRetry={loadWorkflow} />}

      <form
        onSubmit={onRun}
        className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-5"
      >
        <label htmlFor="wf-input" className="text-sm font-medium text-slate-300">
          Girdi (ilk adıma gider)
        </label>
        <textarea
          id="wf-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={3}
          disabled={running || !workflow}
          placeholder="Örn. Ay (Dünya'nın uydusu)"
          className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={running || !workflow || input.trim() === ""}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {running && <LoadingSpinner size="sm" />}
            {running ? "Çalışıyor…" : "Çalıştır"}
          </button>
          {canSave && (
            <button
              type="button"
              onClick={onSaveRun}
              disabled={saving}
              className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50 ${
                savedTrace
                  ? "border-emerald-700/60 text-emerald-300"
                  : "border-slate-700 text-slate-200 hover:bg-slate-800"
              }`}
              title="Bu çalıştırmanın debug kaydını sakla"
            >
              {saving && <LoadingSpinner size="sm" />}
              {savedTrace ? "Kayıtlı ✓" : "📋 Bu çalıştırmayı kaydet"}
            </button>
          )}
          {overallBanner && (
            <span className={`text-sm ${overallBanner.cls}`}>
              {overallBanner.text}
            </span>
          )}
        </div>
      </form>

      {runError && <ErrorBanner message={runError} />}

      <WorkflowStagesView stages={stages} running={running} />

      {toast && <Toast message={toast} />}
    </main>
  );
}
