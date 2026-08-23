"use client";

import { useEffect, useState } from "react";
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";
import LoadingSpinner from "@/components/LoadingSpinner";
import Modal from "@/components/Modal";
import PageHeader from "@/components/PageHeader";
import {
  MCPServer,
  Transport,
  createMcpServer,
  deleteMcpServer,
  listMcpServers,
  refreshMcpServer,
} from "@/lib/api";

function StatusBadge({ server }: { server: MCPServer }) {
  if (server.last_error) {
    return (
      <span
        className="rounded-full bg-red-900/50 px-2 py-0.5 text-xs text-red-300"
        title={server.last_error}
      >
        Hata: {server.last_error.slice(0, 60)}
        {server.last_error.length > 60 ? "…" : ""}
      </span>
    );
  }
  if (server.cached_tools.length > 0) {
    return (
      <span className="rounded-full bg-emerald-900/50 px-2 py-0.5 text-xs text-emerald-300">
        {server.cached_tools.length} tool bulundu
      </span>
    );
  }
  return (
    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
      Henüz senkronize edilmedi
    </span>
  );
}

export default function MCPServersPage() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form.
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [transport, setTransport] = useState<Transport>("streamable_http");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Per-card busy state (refresh) + delete confirmation.
  const [busyId, setBusyId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MCPServer | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setServers(await listMcpServers());
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "MCP server listesi alınamadı");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim() === "" || url.trim() === "") return;
    setCreating(true);
    setCreateError(null);
    try {
      await createMcpServer({
        name: name.trim(),
        url: url.trim(),
        description: description.trim(),
        transport,
        enabled: true,
      });
      setName("");
      setUrl("");
      setDescription("");
      setTransport("streamable_http");
      setShowForm(false);
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Ekleme başarısız";
      // Surface SSRF rejections (backend returns a clear "Güvenlik: …" 400).
      setCreateError(
        msg.startsWith("Güvenlik")
          ? `Bu URL güvenlik nedeniyle reddedildi: ${msg}`
          : msg
      );
    } finally {
      setCreating(false);
    }
  }

  async function onRefresh(id: number) {
    setBusyId(id);
    try {
      await refreshMcpServer(id);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Yenileme başarısız");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteMcpServer(pendingDelete.id);
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
        title="MCP Server'lar"
        description="Remote (HTTP/SSE) MCP server'ları ekleyin; sundukları araçlar agent'ların “Araçlar” listesinde görünür."
        action={
          <button
            onClick={() => setShowForm((s) => !s)}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            + Yeni MCP Server
          </button>
        }
      />

      {showForm && (
        <form
          onSubmit={onCreate}
          className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4"
        >
          <h2 className="text-sm font-semibold text-slate-300">Yeni MCP Server</h2>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="İsim (ör. Local Test)"
            className={inputCls}
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="URL (ör. https://ornek.com/mcp)"
            className={`${inputCls} font-mono`}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Transport</label>
              <select
                value={transport}
                onChange={(e) => setTransport(e.target.value as Transport)}
                className={inputCls}
              >
                <option value="streamable_http">streamable_http</option>
                <option value="sse">sse</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Açıklama</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Opsiyonel"
                className={inputCls}
              />
            </div>
          </div>
          {createError && <ErrorBanner message={createError} />}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={creating || name.trim() === "" || url.trim() === ""}
              className="inline-flex items-center gap-2 self-start rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {creating && <LoadingSpinner size="sm" />}
              {creating ? "Ekleniyor…" : "Ekle"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setCreateError(null);
              }}
              className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              İptal
            </button>
          </div>
        </form>
      )}

      {error && (
        <ErrorBanner message={error} onRetry={load} retrying={loading} />
      )}
      {loading && <LoadingSpinner size="md" label="Yükleniyor…" />}

      {!loading && !error && servers.length === 0 && (
        <EmptyState
          icon="🔌"
          title="Henüz MCP server yok"
          description="Remote (HTTP/SSE) bir MCP server ekleyerek araçlarını kullanın."
          action={
            <button
              onClick={() => setShowForm(true)}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
            >
              + İlk MCP Server'ı Ekle
            </button>
          }
        />
      )}

      <ul className="flex flex-col gap-3">
        {servers.map((s) => (
          <li
            key={s.id}
            className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-medium">🔌 {s.name}</h2>
                  <StatusBadge server={s} />
                </div>
                <p className="mt-0.5 truncate font-mono text-xs text-slate-500">
                  {s.url} · {s.transport}
                </p>
                {s.description && (
                  <p className="mt-0.5 text-sm text-slate-400">{s.description}</p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => onRefresh(s.id)}
                  disabled={busyId === s.id}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                >
                  {busyId === s.id && <LoadingSpinner size="sm" />}
                  {busyId === s.id ? "Yenileniyor…" : "Yenile"}
                </button>
                <button
                  onClick={() => {
                    setPendingDelete(s);
                    setDeleteError(null);
                  }}
                  className="rounded-md border border-red-900 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950/50"
                >
                  Sil
                </button>
              </div>
            </div>

            {s.cached_tools.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {s.cached_tools.map((t) => (
                  <span
                    key={t.name}
                    className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-300"
                    title={t.description}
                  >
                    {t.name}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      {pendingDelete && (
        <Modal onClose={() => setPendingDelete(null)} closable={!deleting}>
          <h3 className="text-lg font-semibold">MCP server'ı sil</h3>
          <p className="mt-2 text-sm text-slate-400">
            <span className="font-medium text-slate-200">
              {pendingDelete.name}
            </span>{" "}
            silinsin mi? Bu server'ın araçlarını kullanan agent'lar artık o
            araçları çağıramaz.
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
