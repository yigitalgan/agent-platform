"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";
import LoadingSpinner from "@/components/LoadingSpinner";
import Modal from "@/components/Modal";
import PageHeader from "@/components/PageHeader";
import {
  KnowledgeBase,
  createKnowledgeBase,
  deleteKnowledgeBase,
  getKnowledgeBases,
} from "@/lib/api";

export default function KnowledgeBasesPage() {
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form.
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // Delete confirmation.
  const [pendingDelete, setPendingDelete] = useState<KnowledgeBase | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setKbs(await getKnowledgeBases());
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Bilgi tabanları alınamadı");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim() === "") return;
    setCreating(true);
    setError(null);
    try {
      await createKnowledgeBase({
        name: name.trim(),
        description: description.trim(),
      });
      setName("");
      setDescription("");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Oluşturma başarısız");
    } finally {
      setCreating(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteKnowledgeBase(pendingDelete.id);
      setPendingDelete(null);
      await load();
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : "Silme başarısız");
    } finally {
      setDeleting(false);
    }
  }

  const inputCls =
    "w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10">
      <PageHeader
        title="Bilgi Tabanları"
        description="Doküman yükleyin; agent'lar “Doküman Arama” aracıyla bu içerikte arama yapabilir (RAG)."
      />

      <form
        onSubmit={onCreate}
        className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4"
      >
        <h2 className="text-sm font-semibold text-slate-300">
          Yeni Bilgi Tabanı
        </h2>
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="İsim (ör. Şirket Politikaları)"
          className={inputCls}
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Açıklama (opsiyonel)"
          className={inputCls}
        />
        <button
          type="submit"
          disabled={creating || name.trim() === ""}
          className="self-start rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {creating ? "Oluşturuluyor…" : "Oluştur"}
        </button>
      </form>

      {error && (
        <ErrorBanner message={error} onRetry={load} retrying={loading} />
      )}
      {loading && <LoadingSpinner size="md" label="Yükleniyor…" />}

      {!loading && !error && kbs.length === 0 && (
        <EmptyState
          icon="📚"
          title="Henüz bilgi tabanı yok"
          description="Doküman yükleyebileceğiniz ilk bilgi tabanını oluşturun."
          action={
            <button
              onClick={() => nameRef.current?.focus()}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
            >
              + İlk Bilgi Tabanını Oluştur
            </button>
          }
        />
      )}

      <ul className="flex flex-col gap-3">
        {kbs.map((kb) => (
          <li
            key={kb.id}
            className="flex items-start justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4"
          >
            <div className="min-w-0">
              <h3 className="font-medium">{kb.name}</h3>
              {kb.description && (
                <p className="mt-0.5 truncate text-sm text-slate-400">
                  {kb.description}
                </p>
              )}
              <p className="mt-1 text-xs text-slate-500">
                {kb.document_count} doküman
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Link
                href={`/knowledge-bases/${kb.id}`}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
              >
                Dokümanlar
              </Link>
              <button
                onClick={() => {
                  setPendingDelete(kb);
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
          <h3 className="text-lg font-semibold">Bilgi tabanını sil</h3>
          <p className="mt-2 text-sm text-slate-400">
            <span className="font-medium text-slate-200">
              {pendingDelete.name}
            </span>{" "}
            ve içindeki tüm dokümanlar (vektör index dahil) silinecek. Bu işlem
            geri alınamaz.
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
