"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ConversationDetail, getConversation } from "@/lib/api";
import DebugPanel from "@/components/DebugPanel";
import WorkflowStagesView from "@/components/WorkflowStagesView";
import { buildStagesFromEvents } from "@/lib/workflowTrace";

export default function ConversationDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const id = Number(params.id);
  const [conversation, setConversation] = useState<ConversationDetail | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getConversation(id)
      .then(setConversation)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Konuşma yüklenemedi")
      );
  }, [id]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-16">
      <div>
        <Link
          href="/conversations"
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          ← Konuşmalar
        </Link>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">
          Konuşma #{id}
        </h1>
        {conversation && (
          <p className="mt-1 text-sm text-slate-500">
            {conversation.agent_name}
            {conversation.workflow_id != null &&
              ` · workflow #${conversation.workflow_id}`}{" "}
            · {conversation.messages.length} mesaj · salt-okunur
          </p>
        )}
      </div>

      {error && (
        <p className="rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {!conversation && !error && (
        <p className="text-sm text-slate-400">Yükleniyor…</p>
      )}

      {conversation && (
        <ul className="flex flex-col gap-3">
          {conversation.messages.map((m) => (
            <li
              key={m.id}
              className={
                m.role === "user"
                  ? "self-end max-w-[85%] rounded-lg bg-blue-600/80 px-3 py-2 text-sm"
                  : "self-start max-w-[85%] rounded-lg bg-slate-800 px-3 py-2 text-sm"
              }
            >
              {m.role !== "user" && (m.agent_name || m.step_order != null) && (
                <p className="mb-1 text-[11px] uppercase tracking-wider text-slate-400">
                  {m.agent_name ?? "assistant"}
                  {m.step_order != null && ` · adım ${m.step_order + 1}`}
                </p>
              )}
              <span className="whitespace-pre-wrap">{m.content}</span>
            </li>
          ))}
          {conversation.messages.length === 0 && (
            <li className="text-sm text-slate-500">Bu konuşmada mesaj yok.</li>
          )}
        </ul>
      )}

      {conversation && (
        <section className="flex flex-col gap-3 border-t border-slate-800 pt-6">
          <h2 className="text-xl font-semibold tracking-tight">
            Detaylı İşlem Kaydı (Debug)
          </h2>

          {!conversation.trace ? (
            <p className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-6 text-center text-sm text-slate-500">
              Bu konuşma için detaylı işlem kaydı saklanmadı. Kayıt, sohbet/
              çalıştırma ekranından akış sürerken yapılır.
            </p>
          ) : conversation.trace.type === "chat" ? (
            <DebugPanel turns={conversation.trace.turns} />
          ) : (
            <WorkflowStagesView
              stages={buildStagesFromEvents(conversation.trace.events)}
            />
          )}
        </section>
      )}
    </main>
  );
}
