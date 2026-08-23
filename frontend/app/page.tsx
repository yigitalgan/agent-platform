"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Chat from "@/components/Chat";
import ErrorBanner from "@/components/ErrorBanner";
import HealthStatus from "@/components/HealthStatus";
import LoadingSpinner from "@/components/LoadingSpinner";
import {
  getAgents,
  getKnowledgeBases,
  listConversations,
  listMcpServers,
  listWorkflows,
} from "@/lib/api";

interface Stat {
  label: string;
  href: string;
  value: number | null; // null = still loading or failed
  icon: string;
}

export default function Home() {
  const [stats, setStats] = useState<Stat[]>([
    { label: "Agent", href: "/agents", value: null, icon: "🤖" },
    { label: "Workflow", href: "/workflows", value: null, icon: "🔗" },
    { label: "Bilgi Tabanı", href: "/knowledge-bases", value: null, icon: "📚" },
    { label: "MCP Server", href: "/mcp-servers", value: null, icon: "🔌" },
    { label: "Konuşma", href: "/conversations", value: null, icon: "🗂️" },
  ]);
  const [loading, setLoading] = useState(true);
  const [allFailed, setAllFailed] = useState(false);

  async function loadStats() {
    setLoading(true);
    setAllFailed(false);
    const results = await Promise.allSettled([
      getAgents(),
      listWorkflows(),
      getKnowledgeBases(),
      listMcpServers(),
      listConversations(),
    ]);
    setStats((prev) =>
      prev.map((s, i) => {
        const r = results[i];
        return {
          ...s,
          value:
            r.status === "fulfilled" ? (r.value as unknown[]).length : null,
        };
      })
    );
    // If every request failed, it's a connectivity/auth problem worth surfacing.
    setAllFailed(results.every((r) => r.status === "rejected"));
    setLoading(false);
  }

  useEffect(() => {
    loadStats();
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-10">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Hoş geldiniz 👋</h1>
        <p className="mt-2 text-slate-400">
          Kod yazmadan AI agent'lar oluşturun; onları araçlar, RAG, çok-agent
          orkestrasyon (sequential &amp; supervisor) ve MCP ile güçlendirin.
        </p>
      </header>

      <section>
        {allFailed ? (
          <ErrorBanner
            message="İstatistikler yüklenemedi (backend'e ulaşılamıyor olabilir)."
            onRetry={loadStats}
            retrying={loading}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {stats.map((s) => (
              <Link
                key={s.href}
                href={s.href}
                className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition-colors hover:border-slate-700 hover:bg-slate-900"
              >
                <div className="text-xl">{s.icon}</div>
                <div className="mt-2 text-2xl font-bold tabular-nums">
                  {loading ? (
                    <LoadingSpinner size="sm" />
                  ) : (
                    (s.value ?? "—")
                  )}
                </div>
                <div className="text-xs text-slate-400">{s.label}</div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
          Hızlı Sohbet
        </h2>
        <Chat />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
          Sistem durumu
        </h2>
        <HealthStatus />
      </section>
    </main>
  );
}
