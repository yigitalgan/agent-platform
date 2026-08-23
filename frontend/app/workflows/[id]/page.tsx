"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import WorkflowForm from "@/components/WorkflowForm";
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";
import LoadingSpinner from "@/components/LoadingSpinner";
import {
  ConversationListItem,
  Workflow,
  getWorkflow,
  listConversations,
} from "@/lib/api";

export default function EditWorkflowPage({
  params,
}: {
  params: { id: string };
}) {
  const id = Number(params.id);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Past runs (conversations tagged with this workflow_id). No debug trace is
  // stored — only the final input/output text (deliberate scope decision).
  const [runs, setRuns] = useState<ConversationListItem[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);

  const loadRuns = useCallback(() => {
    setRunsLoading(true);
    setRunsError(null);
    listConversations({ workflow_id: id })
      .then(setRuns)
      .catch((err: unknown) =>
        setRunsError(
          err instanceof Error ? err.message : "Geçmiş çalıştırmalar alınamadı"
        )
      )
      .finally(() => setRunsLoading(false));
  }, [id]);

  useEffect(() => {
    getWorkflow(id)
      .then(setWorkflow)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Workflow yüklenemedi")
      );
    loadRuns();
  }, [id, loadRuns]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-16">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/workflows"
            className="text-sm text-slate-400 hover:text-slate-200"
          >
            ← Workflow'lar
          </Link>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">
            Workflow'u Düzenle
          </h1>
        </div>
        {workflow && (
          <Link
            href={`/workflows/${id}/run`}
            className="rounded-md bg-emerald-700/80 px-4 py-2 text-sm text-white hover:bg-emerald-600"
          >
            Çalıştır →
          </Link>
        )}
      </div>

      {error && (
        <p className="rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {!workflow && !error && (
        <p className="text-sm text-slate-400">Yükleniyor…</p>
      )}
      {workflow && <WorkflowForm initial={workflow} />}

      {/* Past runs */}
      <section className="mt-4 flex flex-col gap-3 border-t border-slate-800 pt-6">
        <h2 className="text-xl font-semibold tracking-tight">
          Geçmiş Çalıştırmalar
        </h2>

        {runsLoading && <LoadingSpinner size="md" label="Yükleniyor…" />}
        {runsError && <ErrorBanner message={runsError} onRetry={loadRuns} />}

        {!runsLoading && !runsError && runs.length === 0 && (
          <EmptyState
            icon="🕘"
            title="Henüz bu workflow hiç çalıştırılmadı"
            description="Bu workflow'u çalıştırdığınızda geçmiş buraya düşer."
          />
        )}

        {!runsLoading && !runsError && runs.length > 0 && (
          <ul className="flex flex-col gap-3">
            {runs.map((r) => (
              <li
                key={r.id}
                className="flex items-start justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {r.status === "failed" ? (
                      <span className="rounded-full bg-red-900/50 px-2 py-0.5 text-xs text-red-300">
                        ✗ hata
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-900/50 px-2 py-0.5 text-xs text-emerald-300">
                        ✓ tamamlandı
                      </span>
                    )}
                    <time className="text-xs text-slate-500">
                      {new Date(r.created_at).toLocaleString("tr-TR")}
                    </time>
                    {r.trace_saved && (
                      <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                        📋 kayıtlı
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 truncate text-sm text-slate-300">
                    <span className="text-slate-500">Girdi:</span>{" "}
                    {r.input_preview || "—"}
                  </p>
                  <p className="mt-0.5 truncate text-sm text-slate-400">
                    <span className="text-slate-500">Çıktı:</span>{" "}
                    {r.preview || "—"}
                  </p>
                </div>
                <Link
                  href={`/conversations/${r.id}`}
                  className="shrink-0 rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
                >
                  Detayları Gör →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
