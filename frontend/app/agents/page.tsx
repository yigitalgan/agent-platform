"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";
import LoadingSpinner from "@/components/LoadingSpinner";
import Modal from "@/components/Modal";
import PageHeader from "@/components/PageHeader";
import { Agent, deleteAgent, getAgents } from "@/lib/api";

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Delete confirmation modal state.
  const [pendingDelete, setPendingDelete] = useState<Agent | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setAgents(await getAgents());
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Agent listesi alınamadı");
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
      await deleteAgent(pendingDelete.id);
      setPendingDelete(null);
      await load();
    } catch (err: unknown) {
      // e.g. 409 when the agent still has conversations.
      setDeleteError(err instanceof Error ? err.message : "Silme başarısız");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10">
      <PageHeader
        title="Agent'lar"
        description="AI agent'larınızı oluşturun, düzenleyin ve yönetin."
        action={
          <Link
            href="/agents/new"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            + Yeni Agent
          </Link>
        }
      />

      {loading && <LoadingSpinner size="md" label="Yükleniyor…" />}
      {error && (
        <ErrorBanner message={error} onRetry={load} retrying={loading} />
      )}

      {!loading && !error && agents.length === 0 && (
        <EmptyState
          icon="🤖"
          title="Henüz agent yok"
          description="İlk agent'ınızı oluşturarak başlayın."
          action={
            <Link
              href="/agents/new"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
            >
              + İlk Agent'ı Oluştur
            </Link>
          }
        />
      )}

      <ul className="flex flex-col gap-3">
        {agents.map((a) => (
          <li
            key={a.id}
            className="flex items-start justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4"
          >
            <div className="min-w-0">
              <h2 className="font-medium">{a.name}</h2>
              {a.description && (
                <p className="mt-0.5 truncate text-sm text-slate-400">
                  {a.description}
                </p>
              )}
              <p className="mt-1 font-mono text-xs text-slate-500">
                {a.model_params.provider ?? "anthropic"} ·{" "}
                {a.model_params.model ?? "(varsayılan model)"}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Link
                href={`/agents/${a.id}`}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
              >
                Düzenle
              </Link>
              <button
                onClick={() => {
                  setPendingDelete(a);
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

      {/* Delete confirmation modal */}
      {pendingDelete && (
        <Modal
          onClose={() => setPendingDelete(null)}
          closable={!deleting}
        >
          <h3 className="text-lg font-semibold">Agent'ı sil</h3>
          <p className="mt-2 text-sm text-slate-400">
            <span className="font-medium text-slate-200">
              {pendingDelete.name}
            </span>{" "}
            agent'ını silmek istediğinize emin misiniz? Bu işlem geri alınamaz.
          </p>
          {deleteError && (
            <div className="mt-3 rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-300">
              <p>{deleteError}</p>
              {deleteError.includes("konuşma") && (
                <Link
                  href={`/conversations?agent_id=${pendingDelete.id}`}
                  className="mt-2 inline-block font-medium text-red-200 underline hover:text-white"
                >
                  → Bu agent'ın konuşmalarını görüntüle ve temizle
                </Link>
              )}
            </div>
          )}
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
