import Link from "next/link";
import AgentForm from "@/components/AgentForm";

export default function NewAgentPage() {
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
          Yeni Agent Oluştur
        </h1>
      </div>
      <AgentForm />
    </main>
  );
}
