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
  AgentTemplate,
  AVAILABLE_TOOLS,
  KB_REQUIRED_TOOLS,
  KnowledgeBase,
  McpToolGroup,
  MCPServer,
  ModelParams,
  Provider,
  createAgent,
  getAgents,
  getAgentTemplates,
  getKnowledgeBases,
  listMcpServers,
  mcpToolGroups,
  updateAgent,
} from "@/lib/api";

const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openrouter: "anthropic/claude-haiku-4.5",
};

export default function AgentForm({ initial }: { initial?: Agent | null }) {
  const router = useRouter();
  const editing = Boolean(initial);

  const initProvider: Provider =
    (initial?.model_params.provider as Provider) ?? "anthropic";

  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(
    initial?.system_prompt ?? ""
  );
  const [provider, setProvider] = useState<Provider>(initProvider);
  const [model, setModel] = useState(
    initial?.model_params.model ?? DEFAULT_MODELS[initProvider]
  );
  const [temperature, setTemperature] = useState(
    initial?.model_params.temperature ?? 0.7
  );
  const [maxTokens, setMaxTokens] = useState(
    initial?.model_params.max_tokens ?? 1024
  );
  const [allowedTools, setAllowedTools] = useState<string[]>(
    initial?.allowed_tools ?? []
  );
  const [knowledgeBaseId, setKnowledgeBaseId] = useState<number | null>(
    initial?.knowledge_base_id ?? null
  );
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [subAgentIds, setSubAgentIds] = useState<number[]>(
    initial?.sub_agent_ids ?? []
  );
  const [agents, setAgents] = useState<Agent[]>([]);
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [pickedTemplate, setPickedTemplate] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Inline validation only surfaces after a field is blurred (or on submit).
  const [touched, setTouched] = useState({
    name: false,
    prompt: false,
    kb: false,
  });
  function markTouched(field: "name" | "prompt" | "kb") {
    setTouched((t) => ({ ...t, [field]: true }));
  }

  // Load knowledge bases so the document_search tool can be pointed at one.
  useEffect(() => {
    getKnowledgeBases()
      .then(setKnowledgeBases)
      .catch(() => setKnowledgeBases([]));
  }, []);

  // Load MCP servers so their discovered tools can be added to allowed_tools.
  useEffect(() => {
    listMcpServers()
      .then(setMcpServers)
      .catch(() => setMcpServers([]));
  }, []);

  // Load agents to offer as sub-agents (supervisor mode).
  useEffect(() => {
    getAgents()
      .then(setAgents)
      .catch(() => setAgents([]));
  }, []);

  // Load built-in templates (only used on the create form).
  useEffect(() => {
    if (editing) return;
    getAgentTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [editing]);

  // Prefill the form from a template (user can still edit before saving).
  function applyTemplate(t: AgentTemplate) {
    setPickedTemplate(t.id);
    setName(t.name);
    setDescription(t.description);
    setSystemPrompt(t.system_prompt);
    const p = (t.model_params.provider as Provider) ?? "anthropic";
    setProvider(p);
    setModel(t.model_params.model ?? DEFAULT_MODELS[p]);
    setTemperature(t.model_params.temperature ?? 0.7);
    setMaxTokens(t.model_params.max_tokens ?? 1024);
    setAllowedTools(t.allowed_tools);
    setKnowledgeBaseId(t.knowledge_base_id);
    setSubAgentIds([]);
    setTouched({ name: false, prompt: false, kb: false });
    setError(null);
  }

  // Clear the form back to a blank slate ("Sıfırdan Oluştur").
  function startBlank() {
    setPickedTemplate("__blank__");
    setName("");
    setDescription("");
    setSystemPrompt("");
    setProvider("anthropic");
    setModel(DEFAULT_MODELS.anthropic);
    setTemperature(0.7);
    setMaxTokens(1024);
    setAllowedTools([]);
    setKnowledgeBaseId(null);
    setSubAgentIds([]);
    setTouched({ name: false, prompt: false, kb: false });
    setError(null);
  }

  // Candidate sub-agents: all agents except the one being edited (block
  // self-reference in the UI; the backend also rejects it with 400).
  const subAgentChoices = agents.filter((a) => a.id !== initial?.id);

  // MCP tools grouped by server (Phase 8), rendered under the static tools.
  const mcpGroups: McpToolGroup[] = mcpToolGroups(mcpServers);

  function toggleSubAgent(id: number) {
    setSubAgentIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  // Does any selected tool require a knowledge base?
  const needsKb = allowedTools.some((t) => KB_REQUIRED_TOOLS.includes(t));

  const nameError = name.trim() === "";
  const promptError = systemPrompt.trim() === "";
  const kbError = needsKb && knowledgeBaseId === null;

  function toggleTool(id: string) {
    setAllowedTools((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
    // Enabling a KB-requiring tool should immediately reveal the KB warning.
    if (KB_REQUIRED_TOOLS.includes(id)) markTouched("kb");
  }

  function onProviderChange(next: Provider) {
    setProvider(next);
    // If the model field still holds a default, swap it to the new provider's
    // default so users don't accidentally keep an incompatible slug.
    if (
      model.trim() === "" ||
      Object.values(DEFAULT_MODELS).includes(model.trim())
    ) {
      setModel(DEFAULT_MODELS[next]);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Reveal every validation message so the user sees why (don't just no-op).
    setTouched({ name: true, prompt: true, kb: true });
    if (nameError || promptError || kbError) return;

    const model_params: ModelParams = { provider, temperature };
    if (model.trim()) model_params.model = model.trim();
    if (maxTokens && maxTokens > 0) model_params.max_tokens = maxTokens;

    const input: AgentInput = {
      name: name.trim(),
      description: description.trim(),
      system_prompt: systemPrompt,
      model_params,
      allowed_tools: allowedTools,
      // Only send a KB when a tool actually needs one, so unchecking the tool
      // clears the binding.
      knowledge_base_id: needsKb ? knowledgeBaseId : null,
      sub_agent_ids: subAgentIds,
    };

    setSaving(true);
    setError(null);
    try {
      if (editing && initial) {
        await updateAgent(initial.id, input);
      } else {
        await createAgent(input);
      }
      // Brief success toast, then navigate (keep the form locked meanwhile).
      setSaved(true);
      setTimeout(() => {
        router.push("/agents");
        router.refresh();
      }, 1500);
    } catch (err: unknown) {
      // Keep the form filled so the user can fix and retry.
      setError(err instanceof Error ? err.message : "Kaydetme başarısız");
      setSaving(false);
    }
  }

  const labelCls = "block text-sm font-medium text-slate-300 mb-1";
  const inputCls =
    "w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";

  const toolLabel = (id: string) =>
    AVAILABLE_TOOLS.find((t) => t.id === id)?.label ?? id;

  return (
    <div className="flex flex-col gap-6">
      {!editing && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="text-sm font-semibold text-slate-200">
            Şablondan Başla
          </h2>
          <p className="mb-3 mt-0.5 text-xs text-slate-500">
            Hazır bir şablon seçin (formu doldurur, kaydetmeden önce
            değiştirebilirsiniz) veya sıfırdan oluşturun.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {templates.map((t) => {
              const active = pickedTemplate === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => applyTemplate(t)}
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
                  {t.allowed_tools.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {t.allowed_tools.map((tool) => (
                        <span
                          key={tool}
                          className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] text-slate-300"
                        >
                          {toolLabel(tool)}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
            <button
              type="button"
              onClick={startBlank}
              className={`rounded-lg border border-dashed p-3 text-left transition-colors ${
                pickedTemplate === "__blank__"
                  ? "border-blue-600 bg-blue-600/15"
                  : "border-slate-700 bg-slate-800/20 hover:border-slate-600"
              }`}
            >
              <div className="text-sm font-medium text-slate-200">
                Sıfırdan Oluştur
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                Boş bir formla başla.
              </div>
            </button>
          </div>
        </div>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <FormField
        label="İsim"
        htmlFor="name"
        required
        error={touched.name && nameError ? "İsim boş bırakılamaz." : undefined}
      >
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => markTouched("name")}
          className={inputCls}
          placeholder="Örn. Müşteri Destek Botu"
        />
      </FormField>

      <FormField label="Açıklama" htmlFor="description">
        <input
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputCls}
          placeholder="Bu agent ne yapar? (opsiyonel)"
        />
      </FormField>

      <FormField
        label="System Prompt"
        htmlFor="system_prompt"
        required
        error={
          touched.prompt && promptError
            ? "System prompt boş bırakılamaz."
            : undefined
        }
      >
        <textarea
          id="system_prompt"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          onBlur={() => markTouched("prompt")}
          rows={6}
          className={`${inputCls} resize-y font-mono`}
          placeholder="Sen yardımcı bir asistansın…"
        />
      </FormField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Provider" htmlFor="provider">
          <select
            id="provider"
            value={provider}
            onChange={(e) => onProviderChange(e.target.value as Provider)}
            className={inputCls}
          >
            <option value="anthropic">Anthropic</option>
            <option value="openrouter">OpenRouter</option>
          </select>
        </FormField>

        <FormField label="Model" htmlFor="model">
          <input
            id="model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className={`${inputCls} font-mono`}
            placeholder={DEFAULT_MODELS[provider]}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          label={
            <>
              Temperature:{" "}
              <span className="font-mono">{temperature.toFixed(2)}</span>
            </>
          }
          htmlFor="temperature"
        >
          <input
            id="temperature"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={temperature}
            onChange={(e) => setTemperature(Number(e.target.value))}
            className="w-full accent-blue-500"
          />
        </FormField>

        <FormField label="Max tokens" htmlFor="max_tokens">
          <input
            id="max_tokens"
            type="number"
            min={1}
            max={8192}
            value={maxTokens}
            onChange={(e) => setMaxTokens(Number(e.target.value))}
            className={inputCls}
          />
        </FormField>
      </div>

      <div>
        <span className={labelCls}>Araçlar (Tools)</span>
        <p className="mb-2 text-xs text-slate-500">
          Agent'ın kullanabileceği araçları seçin. Seçilmezse agent yalnızca
          kendi bilgisiyle yanıt verir.
        </p>
        <div className="flex flex-col gap-2">
          {AVAILABLE_TOOLS.map((tool) => (
            <label
              key={tool.id}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-700 bg-slate-800/60 px-3 py-2 hover:border-slate-600"
            >
              <input
                type="checkbox"
                checked={allowedTools.includes(tool.id)}
                onChange={() => toggleTool(tool.id)}
                className="mt-0.5 h-4 w-4 accent-blue-500"
              />
              <span>
                <span className="block text-sm text-slate-100">
                  {tool.label}
                </span>
                <span className="block text-xs text-slate-500">
                  {tool.description}
                </span>
              </span>
            </label>
          ))}
        </div>

        {/* MCP tools (Phase 8): one group per server, below the static tools. */}
        {mcpGroups.map(({ server, tools }) => (
          <div
            key={server.id}
            className="mt-3 rounded-md border border-cyan-900/50 bg-cyan-950/20 p-3"
          >
            <p className="mb-2 text-sm font-medium text-cyan-200">
              🔌 {server.name} — MCP Araçları
            </p>
            {tools.length === 0 ? (
              <p className="text-xs text-amber-400">
                Bu server'ın henüz keşfedilmiş tool'u yok.{" "}
                <Link
                  href="/mcp-servers"
                  className="underline hover:text-amber-300"
                >
                  MCP Server sayfasından yenileyin.
                </Link>
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {tools.map((tool) => (
                  <label
                    key={tool.id}
                    className="flex cursor-pointer items-start gap-3 rounded-md border border-cyan-900/40 bg-slate-900/40 px-3 py-2 hover:border-cyan-700/60"
                  >
                    <input
                      type="checkbox"
                      checked={allowedTools.includes(tool.id)}
                      onChange={() => toggleTool(tool.id)}
                      className="mt-0.5 h-4 w-4 accent-cyan-500"
                    />
                    <span>
                      <span className="block font-mono text-sm text-slate-100">
                        {tool.label}
                      </span>
                      {tool.description && (
                        <span className="block text-xs text-slate-500">
                          {tool.description}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}

        {needsKb && (
          <div className="mt-3 rounded-md border border-slate-700 bg-slate-800/40 p-3">
            <label htmlFor="knowledge_base" className={labelCls}>
              Bilgi Tabanı <span className="text-red-400">*</span>
            </label>
            <p className="mb-2 text-xs text-slate-500">
              Doküman Arama aracı bu bilgi tabanındaki dokümanlarda arar.
            </p>
            {knowledgeBases.length === 0 ? (
              <p className="text-xs text-amber-400">
                Henüz bilgi tabanı yok.{" "}
                <Link
                  href="/knowledge-bases"
                  className="underline hover:text-amber-300"
                >
                  Önce bir tane oluşturun.
                </Link>
              </p>
            ) : (
              <select
                id="knowledge_base"
                value={knowledgeBaseId ?? ""}
                onChange={(e) =>
                  setKnowledgeBaseId(
                    e.target.value === "" ? null : Number(e.target.value)
                  )
                }
                onBlur={() => markTouched("kb")}
                className={inputCls}
              >
                <option value="">— Bilgi tabanı seçin —</option>
                {knowledgeBases.map((kb) => (
                  <option key={kb.id} value={kb.id}>
                    {kb.name} ({kb.document_count} doküman)
                  </option>
                ))}
              </select>
            )}
            {touched.kb && kbError && (
              <p className="mt-1 text-xs text-red-400">
                Doküman Arama için bir bilgi tabanı seçmelisiniz.
              </p>
            )}
          </div>
        )}
      </div>

      <div>
        <span className={labelCls}>Alt Agent'lar (Supervisor modu)</span>
        <p className="mb-2 text-xs text-slate-500">
          Bu agent, seçili alt agent'lara görev devredebilir (supervisor modu).
          Araçlardan bağımsızdır — bir agent hem gerçek tool hem alt agent
          kullanabilir.
        </p>
        {subAgentChoices.length === 0 ? (
          <p className="rounded-md border border-slate-700 bg-slate-800/40 px-3 py-2 text-xs text-slate-500">
            Devredilebilecek başka agent yok.
          </p>
        ) : (
          <div className="flex max-h-56 flex-col gap-2 overflow-y-auto">
            {subAgentChoices.map((a) => (
              <label
                key={a.id}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-indigo-900/50 bg-indigo-950/20 px-3 py-2 hover:border-indigo-700/60"
              >
                <input
                  type="checkbox"
                  checked={subAgentIds.includes(a.id)}
                  onChange={() => toggleSubAgent(a.id)}
                  className="mt-0.5 h-4 w-4 accent-indigo-500"
                />
                <span>
                  <span className="block text-sm text-slate-100">
                    🤖 {a.name}
                  </span>
                  {a.description && (
                    <span className="block text-xs text-slate-500">
                      {a.description}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {saving && <LoadingSpinner size="sm" />}
          {saving
            ? "Kaydediliyor…"
            : editing
            ? "Kaydet"
            : "Oluştur"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/agents")}
          disabled={saving}
          className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          İptal
        </button>
      </div>

        {saved && <Toast message="Agent kaydedildi" />}
      </form>
    </div>
  );
}
