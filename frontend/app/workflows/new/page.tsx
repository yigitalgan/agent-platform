import Link from "next/link";
import WorkflowForm from "@/components/WorkflowForm";

export default function NewWorkflowPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-16">
      <div>
        <Link
          href="/workflows"
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          ← Workflow'lar
        </Link>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">
          Yeni Workflow Oluştur
        </h1>
      </div>
      <WorkflowForm />
    </main>
  );
}
