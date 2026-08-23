"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AgentForm from "@/components/AgentForm";
import { Agent, getAgent } from "@/lib/api";

export default function EditAgentPage({
  params,
}: {
  params: { id: string };
}) {
  const id = Number(params.id);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAgent(id)
      .then(setAgent)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Agent yüklenemedi")
      );
  }, [id]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-16">
      <div>
        <Link
          href="/agents"
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          ← Agent'lar
        </Link>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">
          Agent'ı Düzenle
        </h1>
      </div>

      {error && (
        <p className="rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {!agent && !error && (
        <p className="text-sm text-slate-400">Yükleniyor…</p>
      )}
      {agent && <AgentForm initial={agent} />}
    </main>
  );
}
