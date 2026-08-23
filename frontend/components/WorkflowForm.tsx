"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ErrorBanner from "@/components/ErrorBanner";
import FormField from "@/components/FormField";
import LoadingSpinner from "@/components/LoadingSpinner";
import Toast from "@/components/Toast";
import {
  Agent,
  AgentInput,
  Workflow,
  WorkflowInput,
  WorkflowTemplate,
  createAgent,
  createWorkflow,
  getAgents,
  getWorkflowTemplates,
  updateWorkflow,
} from "@/lib/api";

// "" means a branch slot exists but no agent is chosen yet.
type StepValue = number | "";
// Faz 7C: a stage is a list of branches. length 1 = sequential, >1 = parallel.
type Stage = StepValue[];

// Mirror of backend MAX_PARALLEL_BRANCHES (sanity cap on concurrent branches).
const MAX_PARALLEL_BRANCHES = 5;

export default function WorkflowForm({ initial }: { initial?: Workflow | null }) {
  const router = useRouter();
  const editing = Boolean(initial);

  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [steps, setSteps] = useState<Stage[]>(
    initial?.steps.map((g) => g.agents.map((a) => a.agent_id)) ?? [[""]]
  );
  const [agents, setAgents] = useState<Agent[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Inline validation only surfaces after blur / submit.
  const [nameTouched, setNameTouched] = useState(false);
  const [stepsTouched, setStepsTouched] = useState(false);

  // Templates.
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [pickedTemplate, setPickedTemplate] = useState<WorkflowTemplate | null>(
    null
  );
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  function loadAgents() {
    return getAgents().then(setAgents);
  }

  useEffect(() => {
    loadAgents().catch(() => setAgents([]));
  }, []);

  useEffect(() => {
    if (editing) return;
    getWorkflowTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [editing]);

  // Which of the picked template's agents don't exist yet (by name).
  const missingAgents = pickedTemplate
    ? pickedTemplate.agents.filter(
        (ta) => !agents.some((a) => a.name === ta.name)
      )
    : [];

  // Create any missing agents (by name), then prefill name/description/steps
  // with the resulting agent ids. The user reviews and saves the workflow.
  async function applyTemplate(t: WorkflowTemplate) {
    setApplying(true);
    setApplyError(null);
    try {
      const existing = await getAgents();
      const byName = new Map(existing.map((a) => [a.name, a.id]));
      for (const ta of t.agents) {
        if (byName.has(ta.name)) continue;
        const input: AgentInput = {
          name: ta.name,
          description: ta.description,
          system_prompt: ta.system_prompt,
          model_params: ta.model_params,
          allowed_tools: ta.allowed_tools,
          knowledge_base_id: ta.knowledge_base_id,
          sub_agent_ids: [],
        };
        const created = await createAgent(input);
        byName.set(created.name, created.id);
      }
      await loadAgents(); // refresh dropdowns to include new agents
      setName(t.name);
      setDescription(t.description);
      // Template stages are sequential (one agent each) → singleton stages.
      setSteps(t.steps.map((stepName) => [byName.get(stepName) ?? ""]));
      setNameTouched(false);
      setStepsTouched(false);
      setError(null);
      setPickedTemplate(null);
    } catch (err: unknown) {
      setApplyError(
        err instanceof Error ? err.message : "Şablon uygulanamadı"
      );
    } finally {
      setApplying(false);
    }
  }

  function startBlank() {
    setPickedTemplate(null);
    setApplyError(null);
    setName("");
    setDescription("");
    setSteps([[""]]);
    setNameTouched(false);
    setStepsTouched(false);
    setError(null);
  }

  const nameError = name.trim() === "";
  const stepsError =
    steps.length === 0 ||
    steps.some((stage) => stage.length === 0 || stage.some((s) => s === ""));

  // --- Branch (within a stage) helpers ---
  function setBranchAgent(si: number, bi: number, value: StepValue) {
    setSteps((prev) =>
      prev.map((stage, i) =>
        i === si ? stage.map((b, j) => (j === bi ? value : b)) : stage
      )
    );
  }
  function addBranch(si: number) {
    setSteps((prev) =>
      prev.map((stage, i) =>
        i === si && stage.length < MAX_PARALLEL_BRANCHES
          ? [...stage, ""]
          : stage
      )
    );
  }
  function removeBranch(si: number, bi: number) {
    setSteps((prev) =>
      prev.map((stage, i) =>
        i === si && stage.length > 1
          ? stage.filter((_, j) => j !== bi)
          : stage
      )
    );
  }

  // --- Stage helpers ---
  function addStep() {
    setSteps((prev) => [...prev, [""]]);
  }
  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }
  function move(index: number, dir: -1 | 1) {
    setSteps((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Reveal every validation message so the user sees why.
    setNameTouched(true);
    setStepsTouched(true);
    if (nameError || stepsError) return;

    const input: WorkflowInput = {
      name: name.trim(),
      description: description.trim(),
      // Full-list replacement: stage index = step order, branch order = position
      // within the stage. A stage with >1 agent runs in parallel.
      steps: steps.map((stage) => stage.map((s) => s as number)),
    };

    setSaving(true);
    setError(null);
    try {
      if (editing && initial) {
        await updateWorkflow(initial.id, input);
      } else {
        await createWorkflow(input);
      }
      setSaved(true);
      setTimeout(() => {
        router.push("/workflows");
        router.refresh();
      }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Kaydetme başarısız");
      setSaving(false);
    }
  }

  const labelCls = "block text-sm font-medium text-slate-300 mb-1";
  const inputCls =
    "w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";
  const iconBtn =
    "rounded-md border border-slate-700 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-30";

  return (
    <div className="flex flex-col gap-6">
      {!editing && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="text-sm font-semibold text-slate-200">
            Şablondan Başla
          </h2>
          <p className="mb-3 mt-0.5 text-xs text-slate-500">
            Hazır bir zincir seçin. Gerekli agent'lardan eksik olanlar
            otomatik oluşturulur, sonra workflow adımları doldurulur.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {templates.map((t) => {
              const active = pickedTemplate?.id === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setPickedTemplate(t);
                    setApplyError(null);
                  }}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    active
                      ? "border-blue-600 bg-blue-600/15"
                      : "border-slate-700 bg-slate-800/40 hover:border-slate-600"
                  }`}
                >
                  <div className="text-sm font-medium text-slate-100">
                    {t.name}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    {t.description}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {t.steps.join(" → ")}
                  </div>
                </button>
              );
            })}
            <button
              type="button"
              onClick={startBlank}
              className="rounded-lg border border-dashed border-slate-700 bg-slate-800/20 p-3 text-left transition-colors hover:border-slate-600"
            >
              <div className="text-sm font-medium text-slate-200">
                Sıfırdan Oluştur
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                Boş bir workflow'la başla.
              </div>
            </button>
          </div>

          {pickedTemplate && (
            <div className="mt-3 rounded-md border border-slate-700 bg-slate-800/40 p-3">
              <p className="text-xs text-slate-300">
                <span className="font-medium">{pickedTemplate.name}</span> —
                adımlar: {pickedTemplate.steps.join(" → ")}
              </p>
              {missingAgents.length > 0 ? (
                <p className="mt-1 text-xs text-amber-300">
                  ⚠️ Bu şablon {missingAgents.length} yeni agent oluşturacak:{" "}
                  {missingAgents.map((a) => a.name).join(", ")}
                </p>
              ) : (
                <p className="mt-1 text-xs text-slate-500">
                  Gerekli tüm agent'lar zaten mevcut; yeni agent oluşturulmayacak.
                </p>
              )}
              {applyError && (
                <ErrorBanner message={applyError} className="mt-2" />
              )}
              <button
                type="button"
                onClick={() => applyTemplate(pickedTemplate)}
                disabled={applying}
                className="mt-2 inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {applying && <LoadingSpinner size="sm" />}
                {applying ? "Uygulanıyor…" : "Şablonu Uygula"}
              </button>
            </div>
          )}
        </div>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <FormField
        label="İsim"
        htmlFor="name"
        required
        error={nameTouched && nameError ? "İsim boş bırakılamaz." : undefined}
      >
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setNameTouched(true)}
          className={inputCls}
          placeholder="Örn. Özetle ve Çevir"
        />
      </FormField>

      <FormField label="Açıklama" htmlFor="description">
        <input
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputCls}
          placeholder="Bu workflow ne yapar? (opsiyonel)"
        />
      </FormField>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className={labelCls}>
            Adımlar <span className="text-red-400">*</span>
          </span>
          <span className="text-xs text-slate-500">
            Adımlar sırayla çalışır. Bir adıma birden çok agent eklerseniz o adım
            paralel çalışır (çıktıları birleşip sonraki adıma gider).
          </span>
        </div>

        {agents.length === 0 ? (
          <p className="rounded-md border border-amber-800/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
            Henüz agent yok.{" "}
            <Link href="/agents/new" className="underline hover:text-amber-200">
              Önce en az bir agent oluşturun.
            </Link>
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {steps.map((stage, i) => {
              const parallel = stage.length > 1;
              return (
                <div
                  key={i}
                  className={`rounded-lg border p-3 ${
                    parallel
                      ? "border-violet-800/60 bg-violet-950/10"
                      : "border-slate-800 bg-slate-900/40"
                  }`}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-400">
                      Adım {i + 1}
                    </span>
                    {parallel && (
                      <span className="rounded-full bg-violet-900/50 px-2 py-0.5 text-[10px] text-violet-300">
                        ⇉ paralel · {stage.length} dal
                      </span>
                    )}
                    <div className="ml-auto flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        className={iconBtn}
                        title="Yukarı taşı"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => move(i, 1)}
                        disabled={i === steps.length - 1}
                        className={iconBtn}
                        title="Aşağı taşı"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => removeStep(i)}
                        disabled={steps.length === 1}
                        className={`${iconBtn} hover:bg-red-950/50`}
                        title="Adımı sil"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    {stage.map((branch, j) => (
                      <div key={j} className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          {parallel && (
                            <span className="w-12 shrink-0 text-[11px] text-slate-500">
                              Dal {j + 1}
                            </span>
                          )}
                          <select
                            value={branch}
                            onChange={(e) =>
                              setBranchAgent(
                                i,
                                j,
                                e.target.value === ""
                                  ? ""
                                  : Number(e.target.value)
                              )
                            }
                            onBlur={() => setStepsTouched(true)}
                            className={inputCls}
                          >
                            <option value="">— Agent seçin —</option>
                            {agents.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => removeBranch(i, j)}
                            disabled={stage.length === 1}
                            className={`${iconBtn} shrink-0 hover:bg-red-950/50`}
                            title="Bu dalı kaldır"
                          >
                            ✕
                          </button>
                        </div>
                        {stepsTouched && branch === "" && (
                          <p className="text-xs text-red-400">
                            Bu dal için bir agent seçmelisiniz.
                          </p>
                        )}
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => addBranch(i)}
                    disabled={stage.length >= MAX_PARALLEL_BRANCHES}
                    className="mt-2 rounded-md border border-violet-800/50 px-2.5 py-1 text-xs text-violet-300 hover:bg-violet-950/30 disabled:opacity-40"
                    title={
                      stage.length >= MAX_PARALLEL_BRANCHES
                        ? `En fazla ${MAX_PARALLEL_BRANCHES} paralel dal`
                        : undefined
                    }
                  >
                    + Paralel agent ekle
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={addStep}
          disabled={agents.length === 0}
          className="mt-3 rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
        >
          + Adım Ekle
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {saving && <LoadingSpinner size="sm" />}
          {saving ? "Kaydediliyor…" : editing ? "Kaydet" : "Oluştur"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/workflows")}
          disabled={saving}
          className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          İptal
        </button>
      </div>

        {saved && <Toast message="Workflow kaydedildi" />}
      </form>
    </div>
  );
}
