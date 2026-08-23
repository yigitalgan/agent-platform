"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  DocumentItem,
  getDocuments,
  uploadDocument,
} from "@/lib/api";

export default function KnowledgeBaseDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const kbId = Number(params.id);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadOk, setUploadOk] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      setDocuments(await getDocuments(kbId));
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Dokümanlar alınamadı");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbId]);

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);
    setUploadOk(null);
    try {
      const doc = await uploadDocument(kbId, file);
      setUploadOk(
        `“${doc.filename}” yüklendi — ${doc.chunk_count} parça indekslendi.`
      );
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "Yükleme başarısız");
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-16">
      <div>
        <Link
          href="/knowledge-bases"
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          ← Bilgi Tabanları
        </Link>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">
          Bilgi Tabanı #{kbId} — Dokümanlar
        </h1>
      </div>

      <form
        onSubmit={onUpload}
        className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4"
      >
        <h2 className="text-sm font-semibold text-slate-300">Doküman Yükle</h2>
        <p className="text-xs text-slate-500">
          Desteklenen formatlar: .txt, .pdf · En fazla 10 MB.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.pdf"
          disabled={uploading}
          className="text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-sm file:text-slate-100 hover:file:bg-slate-600 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={uploading}
          className="self-start rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {uploading ? "Yükleniyor & indeksleniyor…" : "Yükle"}
        </button>
        {uploading && (
          <p className="text-xs text-slate-400">
            Metin çıkarılıyor, parçalanıyor ve embedding hesaplanıyor — ilk
            yükleme modelin inmesi nedeniyle biraz sürebilir.
          </p>
        )}
        {uploadError && (
          <p className="rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-300">
            {uploadError}
          </p>
        )}
        {uploadOk && (
          <p className="rounded-md bg-emerald-950/50 px-3 py-2 text-sm text-emerald-300">
            {uploadOk}
          </p>
        )}
      </form>

      {error && (
        <p className="rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {loading && <p className="text-sm text-slate-400">Yükleniyor…</p>}

      {!loading && documents.length === 0 && !error && (
        <p className="rounded-lg border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-400">
          Henüz doküman yok. Yukarıdan bir .txt veya .pdf yükleyin.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {documents.map((doc) => (
          <li
            key={doc.id}
            className="flex items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3"
          >
            <span className="min-w-0 truncate text-sm text-slate-200">
              📄 {doc.filename}
            </span>
            <span className="shrink-0 text-xs text-slate-500">
              {doc.chunk_count} parça ·{" "}
              {new Date(doc.uploaded_at).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
