"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";
import LoadingSpinner from "@/components/LoadingSpinner";
import Modal from "@/components/Modal";
import PageHeader from "@/components/PageHeader";
import { Workflow, deleteWorkflow, listWorkflows } from "@/lib/api";

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<Workflow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setWorkflows(await listWorkflows());
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Workflow listesi alınamadı");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteWorkflow(pendingDelete.id);
      setPendingDelete(null);
      await load();
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : "Silme başarısız");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10">
      <PageHeader
        title="Workflow'lar"
        description="Agent'ları sırayla zincirleyin; her adımın çıktısı bir sonrakine girdi olur."
        action={
          <Link
            href="/workflows/new"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            + Yeni Workflow
          </Link>
        }
      />

      {loading && <LoadingSpinner size="md" label="Yükleniyor…" />}
      {error && (
        <ErrorBanner message={error} onRetry={load} retrying={loading} />
      )}

      {!loading && !error && workflows.length === 0 && (
        <EmptyState
          icon="🔗"
          title="Henüz workflow yok"
          description="Agent'ları zincirleyen ilk workflow'unuzu oluşturun."
          action={
            <Link
              href="/workflows/new"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
            >
              + İlk Workflow'u Oluştur
            </Link>
          }
        />
      )}

      <ul className="flex flex-col gap-3">
        {workflows.map((w) => (
          <li
            key={w.id}
            className="flex items-start justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4"
          >
            <div className="min-w-0">
              <h2 className="font-medium">{w.name}</h2>
              {w.description && (
                <p className="mt-0.5 truncate text-sm text-slate-400">
                  {w.description}
                </p>
              )}
              <p className="mt-1 text-xs text-slate-500">
                {w.steps.length} adım:{" "}
                <span className="text-slate-400">
                  {w.steps
                    .map((g) =>
                      g.parallel
                        ? `(${g.agents.map((a) => a.agent_name).join(" ∥ ")})`
                        : g.agents[0]?.agent_name
                    )
                    .join(" → ")}
                </span>
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Link
                href={`/workflows/${w.id}/run`}
                className="rounded-md bg-emerald-700/80 px-3 py-1.5 text-sm text-white hover:bg-emerald-600"
              >
                Çalıştır
              </Link>
              <Link
                href={`/workflows/${w.id}`}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
              >
                Düzenle
              </Link>
              <button
                onClick={() => {
                  setPendingDelete(w);
                  setDeleteError(null);
                }}
                className="rounded-md border border-red-900 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950/50"
              >
                Sil
              </button>
            </div>
          </li>
        ))}
      </ul>

      {pendingDelete && (
        <Modal onClose={() => setPendingDelete(null)} closable={!deleting}>
          <h3 className="text-lg font-semibold">Workflow'u sil</h3>
          <p className="mt-2 text-sm text-slate-400">
            <span className="font-medium text-slate-200">
              {pendingDelete.name}
            </span>{" "}
            workflow'unu silmek istediğinize emin misiniz? Bu işlem geri
            alınamaz. (Agent'lar silinmez.)
          </p>
          {deleteError && <ErrorBanner message={deleteError} className="mt-3" />}
          <div className="mt-5 flex justify-end gap-3">
            <button
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
              className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            >
              İptal
            </button>
            <button
              onClick={confirmDelete}
              disabled={deleting}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
            >
              {deleting ? "Siliniyor…" : "Sil"}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
