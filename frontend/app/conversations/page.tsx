"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";
import LoadingSpinner from "@/components/LoadingSpinner";
import Modal from "@/components/Modal";
import PageHeader from "@/components/PageHeader";
import {
  ConversationListItem,
  deleteConversation,
  listConversations,
} from "@/lib/api";

function ConversationsList() {
  const searchParams = useSearchParams();
  const agentIdParam = searchParams.get("agent_id");
  const workflowIdParam = searchParams.get("workflow_id");
  const agentId = agentIdParam ? Number(agentIdParam) : undefined;
  const workflowId = workflowIdParam ? Number(workflowIdParam) : undefined;

  const [items, setItems] = useState<ConversationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] =
    useState<ConversationListItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setItems(
        await listConversations({ agent_id: agentId, workflow_id: workflowId })
      );
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Konuşmalar alınamadı");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, workflowId]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteConversation(pendingDelete.id);
      setPendingDelete(null);
      await load();
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : "Silme başarısız");
    } finally {
      setDeleting(false);
    }
  }

  const filterLabel =
    agentId != null
      ? `Agent #${agentId} konuşmaları`
      : workflowId != null
      ? `Workflow #${workflowId} konuşmaları`
      : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10">
      <div>
        <PageHeader
          title="Konuşmalar"
          description="Konuşmaları görüntüleyin ve silin. Bir agent/workflow silinmiyorsa (409), önce buradan konuşmalarını temizleyin."
        />
        {filterLabel && (
          <div className="-mt-3 flex items-center gap-3">
            <span className="rounded-full bg-blue-900/50 px-3 py-1 text-xs text-blue-200">
              Filtre: {filterLabel}
            </span>
            <Link
              href="/conversations"
              className="text-xs text-slate-400 hover:text-slate-200"
            >
              Filtreyi kaldır
            </Link>
          </div>
        )}
      </div>

      {loading && <LoadingSpinner size="md" label="Yükleniyor…" />}
      {error && (
        <ErrorBanner message={error} onRetry={load} retrying={loading} />
      )}

      {!loading && !error && items.length === 0 && (
        <EmptyState
          icon="🗂️"
          title={filterLabel ? "Bu filtreye uyan konuşma yok" : "Henüz konuşma yok"}
          description={
            filterLabel
              ? "Farklı bir filtre deneyin veya filtreyi kaldırın."
              : "Bir agent ile sohbet ettiğinizde konuşmalar burada görünür."
          }
        />
      )}

      <ul className="flex flex-col gap-3">
        {items.map((c) => (
          <li
            key={c.id}
            className="flex items-start justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-medium">#{c.id} · {c.agent_name}</h2>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
                  {c.message_count} mesaj
                </span>
                {c.workflow_id != null && (
                  <span className="rounded-full bg-emerald-900/40 px-2 py-0.5 text-xs text-emerald-300">
                    workflow #{c.workflow_id}
                  </span>
                )}
                {c.trace_saved && (
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                    📋 kayıtlı
                  </span>
                )}
              </div>
              {c.preview && (
                <p className="mt-1 truncate text-sm text-slate-400">
                  {c.preview}
                </p>
              )}
              <p className="mt-1 text-xs text-slate-500">
                {new Date(c.created_at).toLocaleString()}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Link
                href={`/conversations/${c.id}`}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
              >
                Görüntüle
              </Link>
              <button
                onClick={() => {
                  setPendingDelete(c);
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
          <h3 className="text-lg font-semibold">Konuşmayı sil</h3>
          <p className="mt-2 text-sm text-slate-400">
            #{pendingDelete.id} ({pendingDelete.agent_name},{" "}
            {pendingDelete.message_count} mesaj) silinsin mi? Bu işlem geri
            alınamaz.
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

export default function ConversationsPage() {
  // useSearchParams requires a Suspense boundary.
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-3xl px-6 py-16 text-sm text-slate-400">
          Yükleniyor…
        </main>
      }
    >
      <ConversationsList />
    </Suspense>
  );
}
