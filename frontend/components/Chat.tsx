"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Agent,
  ChatEvent,
  getAgents,
  saveConversationTrace,
  streamChat,
} from "@/lib/api";
import DebugPanel, { DebugTurn } from "@/components/DebugPanel";
import ErrorBanner from "@/components/ErrorBanner";
import LoadingSpinner from "@/components/LoadingSpinner";
import Toast from "@/components/Toast";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function Chat() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState<number | null>(null);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debug trace: one entry per user turn. Tool mechanics live here, not in the
  // chat bubbles (which show only the model's text answer).
  const [debugTurns, setDebugTurns] = useState<DebugTurn[]>([]);
  const [showDebug, setShowDebug] = useState(true);

  // Opt-in trace save.
  const [saving, setSaving] = useState(false);
  const [savedTrace, setSavedTrace] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Load available agents once.
  useEffect(() => {
    getAgents()
      .then((list) => {
        setAgents(list);
        if (list.length > 0) setAgentId(list[0].id);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Agent listesi alınamadı")
      );
  }, []);

  // Auto-scroll to the newest content.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // Switching agents starts a fresh conversation.
  function onAgentChange(id: number) {
    setAgentId(id);
    setConversationId(null);
    setMessages([]);
    setDebugTurns([]);
    setError(null);
    setSavedTrace(false);
  }

  // Save this whole conversation's debug trace (opt-in). Sends the accumulated
  // per-turn event streams the client still holds in RAM.
  async function onSaveChat() {
    if (conversationId === null || debugTurns.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await saveConversationTrace(conversationId, {
        type: "chat",
        turns: debugTurns,
      });
      setSavedTrace(true);
      setToast("Kaydedildi");
      setTimeout(() => setToast(null), 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Trace kaydedilemedi");
    } finally {
      setSaving(false);
    }
  }

  // Append a raw event to the current turn's event stream; DebugPanel builds
  // the (nested) tree from these on render.
  function pushEvent(event: ChatEvent) {
    setDebugTurns((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const turn = next[next.length - 1];
      next[next.length - 1] = { ...turn, events: [...turn.events, event] };
      return next;
    });
  }

  function setTurnError(message: string) {
    setDebugTurns((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      next[next.length - 1] = { ...next[next.length - 1], error: message };
      return next;
    });
  }

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || agentId === null || streaming) return;

    setError(null);
    setInput("");
    setStreaming(true);

    // Render the user turn and open a fresh debug turn. Assistant bubbles are
    // created lazily as token events arrive.
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setDebugTurns((prev) => [...prev, { question: text, events: [] }]);
    setSavedTrace(false); // content changed → re-save needed

    try {
      await streamChat(agentId, text, conversationId, (event: ChatEvent) => {
        if (event.type === "token") {
          // Only the supervisor's OWN text (depth 0) belongs in the bubble;
          // sub-agent tokens are surfaced via their card in the debug panel.
          if ((event.depth ?? 0) !== 0) return;
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === "assistant") {
              next[next.length - 1] = {
                role: "assistant",
                content: last.content + event.content,
              };
            } else {
              next.push({ role: "assistant", content: event.content });
            }
            return next;
          });
        } else if (
          event.type === "iteration_start" ||
          event.type === "tool_call" ||
          event.type === "tool_result"
        ) {
          pushEvent(event);
        } else if (event.type === "done") {
          setConversationId(event.conversation_id);
        } else if (event.type === "error") {
          // Only a top-level (depth 0) error is fatal for the turn; a sub-agent
          // error is shown via its tool_result card ("hata: …").
          if ((event.depth ?? 0) === 0) {
            setError(event.message);
            setTurnError(event.message);
          }
        }
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Akış hatası";
      setError(msg);
      setTurnError(msg);
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900/60 p-6 shadow-lg">
        <div className="flex items-center gap-3">
          <label htmlFor="agent" className="text-sm text-slate-400">
            Agent
          </label>
          <select
            id="agent"
            value={agentId ?? ""}
            onChange={(e) => onAgentChange(Number(e.target.value))}
            disabled={agents.length === 0 || streaming}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 disabled:opacity-50"
          >
            {agents.length === 0 && <option value="">Agent yok</option>}
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <Link
            href="/agents/new"
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            + Yeni agent
          </Link>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={showDebug}
              onChange={(e) => setShowDebug(e.target.checked)}
              className="h-3.5 w-3.5 accent-blue-500"
            />
            Debug paneli
          </label>
          {conversationId !== null && (
            <span className="text-xs text-slate-500">
              Konuşma #{conversationId}
            </span>
          )}
        </div>

        <div
          ref={scrollRef}
          className="h-80 overflow-y-auto rounded-lg bg-slate-950/60 p-4"
        >
          {messages.length === 0 ? (
            <p className="text-sm text-slate-500">
              {agents.length === 0
                ? "Önce bir agent oluşturun (POST /api/v1/agents), sonra sohbet edin."
                : "Bir mesaj gönderin; Claude Haiku 4.5 token token yanıt verecek."}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {messages.map((m, i) => (
                <li
                  key={i}
                  className={
                    m.role === "user"
                      ? "self-end max-w-[85%] rounded-lg bg-blue-600/80 px-3 py-2 text-sm"
                      : "self-start max-w-[85%] rounded-lg bg-slate-800 px-3 py-2 text-sm"
                  }
                >
                  <span className="whitespace-pre-wrap">
                    {m.content}
                    {streaming &&
                      m.role === "assistant" &&
                      i === messages.length - 1 && (
                        <span className="animate-pulse">▋</span>
                      )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <ErrorBanner message={error} />}

        <form onSubmit={onSend} className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Mesajınızı yazın…"
            disabled={agentId === null || streaming}
            className="flex-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={agentId === null || streaming || input.trim() === ""}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {streaming && <LoadingSpinner size="sm" />}
            {streaming ? "Yanıtlanıyor…" : "Gönder"}
          </button>
        </form>
      </div>

      {showDebug && (
        <DebugPanel
          turns={debugTurns}
          action={
            conversationId !== null &&
            debugTurns.length > 0 &&
            !streaming ? (
              <button
                type="button"
                onClick={onSaveChat}
                disabled={saving}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs disabled:opacity-50 ${
                  savedTrace
                    ? "border-emerald-700/60 text-emerald-300"
                    : "border-slate-700 text-slate-200 hover:bg-slate-800"
                }`}
                title="Bu sohbetin debug kaydını sakla"
              >
                {saving && <LoadingSpinner size="sm" />}
                {savedTrace ? "Kayıtlı ✓" : "📋 Bu sohbeti kaydet"}
              </button>
            ) : undefined
          }
        />
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}
