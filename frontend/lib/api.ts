// Base URL of the backend API. Read from an env var so it can differ between
// local dev, docker-compose, and production. Falls back to localhost.
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

// Shared API key the backend requires on every /api/v1/* request (X-API-Key).
// NOTE: NEXT_PUBLIC_* is baked into the client bundle, so this value is visible
// in the browser — it gates LAN/port-scan access, not authenticated UI users.
export const API_KEY = process.env.NEXT_PUBLIC_APP_API_KEY ?? "";
export const API_KEY_MISSING = API_KEY.trim() === "";

// Warn once (browser only) so a missing key isn't a silent stream of 401s.
if (typeof window !== "undefined" && API_KEY_MISSING) {
  // eslint-disable-next-line no-console
  console.warn(
    "[agent-platform] NEXT_PUBLIC_APP_API_KEY tanımlı değil — backend istekleri " +
      "401 dönecek. docker-compose/.env içinde APP_API_KEY ayarlayın."
  );
}

/** Merge the X-API-Key header into any caller-supplied headers. */
function withApiKey(headers?: HeadersInit): Record<string, string> {
  return {
    ...(headers as Record<string, string> | undefined),
    "X-API-Key": API_KEY,
  };
}

// Auth-failure signal: any 401 (missing OR wrong key) notifies subscribers so
// the UI can show a banner instead of silently failing.
type AuthListener = () => void;
const authFailListeners = new Set<AuthListener>();

export function onAuthFailure(cb: AuthListener): () => void {
  authFailListeners.add(cb);
  return () => {
    authFailListeners.delete(cb);
  };
}

function notifyAuthFailure(status: number): void {
  if (status === 401) authFailListeners.forEach((cb) => cb());
}

/**
 * Thin fetch wrapper around the backend API. Prefixes the base URL and throws
 * on non-2xx responses so callers can rely on the parsed JSON.
 */
export async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const url = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...init,
    headers: withApiKey({
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    }),
  });

  if (!res.ok) {
    notifyAuthFailure(res.status);
    // Surface FastAPI's `detail` message when present (string, or the
    // validation-error list) so callers can show something meaningful.
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) {
        message =
          typeof body.detail === "string"
            ? body.detail
            : JSON.stringify(body.detail);
      }
    } catch {
      /* non-JSON error body — keep the status line */
    }
    throw new Error(message);
  }

  // 204 No Content (e.g. DELETE) and empty bodies have nothing to parse.
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export interface HealthResponse {
  status: string;
}

export function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/health");
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export type Provider = "anthropic" | "openrouter";

export interface ModelParams {
  provider: Provider;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  top_k?: number;
}

export interface Agent {
  id: number;
  name: string;
  description: string;
  system_prompt: string;
  model_params: ModelParams;
  allowed_tools: string[];
  knowledge_base_id: number | null;
  // Ids of agents this agent may call as sub-agents (supervisor pattern, 7B).
  sub_agent_ids: number[];
  created_at: string;
}

export interface AgentInput {
  name: string;
  description: string;
  system_prompt: string;
  model_params: ModelParams;
  allowed_tools: string[];
  knowledge_base_id: number | null;
  sub_agent_ids: number[];
}

// Tool catalog — must match the backend registry's tool names. Rendered as a
// checkbox group in the agent form.
export const AVAILABLE_TOOLS: { id: string; label: string; description: string }[] =
  [
    {
      id: "calculator",
      label: "Hesap Makinesi",
      description: "Matematiksel ifadeleri güvenle hesaplar.",
    },
    {
      id: "wikipedia_search",
      label: "Wikipedia Arama",
      description: "Wikipedia'da arayıp madde özeti döndürür.",
    },
    {
      id: "duckduckgo_search",
      label: "DuckDuckGo Arama",
      description: "DuckDuckGo Anlık Cevap API'siyle arama yapar.",
    },
    {
      id: "document_search",
      label: "Doküman Arama (RAG)",
      description:
        "Seçilen bilgi tabanındaki yüklü dokümanlarda semantik arama yapar.",
    },
    {
      id: "weather",
      label: "Hava Durumu",
      description:
        "Bir şehrin güncel hava durumunu Open-Meteo ile getirir (ücretsiz, key gerektirmez).",
    },
    {
      id: "web_search",
      label: "Web Araması (Tavily)",
      description:
        "Tavily ile gerçek zamanlı web araması yapar (güncel bilgi/haber; ücretsiz tier ~1000 arama/ay).",
    },
  ];

// Tools that require a knowledge base to be selected on the agent.
export const KB_REQUIRED_TOOLS = ["document_search"];

export function getAgents(): Promise<Agent[]> {
  return apiFetch<Agent[]>("/api/v1/agents");
}

export function getAgent(id: number): Promise<Agent> {
  return apiFetch<Agent>(`/api/v1/agents/${id}`);
}

export function createAgent(input: AgentInput): Promise<Agent> {
  return apiFetch<Agent>("/api/v1/agents", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAgent(id: number, input: AgentInput): Promise<Agent> {
  return apiFetch<Agent>(`/api/v1/agents/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteAgent(id: number): Promise<void> {
  return apiFetch<void>(`/api/v1/agents/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Knowledge bases + documents (RAG)
// ---------------------------------------------------------------------------

export interface KnowledgeBase {
  id: number;
  name: string;
  description: string;
  created_at: string;
  document_count: number;
}

export interface KnowledgeBaseInput {
  name: string;
  description: string;
}

export interface DocumentItem {
  id: number;
  knowledge_base_id: number;
  filename: string;
  chunk_count: number;
  uploaded_at: string;
}

export function getKnowledgeBases(): Promise<KnowledgeBase[]> {
  return apiFetch<KnowledgeBase[]>("/api/v1/knowledge-bases");
}

export function createKnowledgeBase(
  input: KnowledgeBaseInput
): Promise<KnowledgeBase> {
  return apiFetch<KnowledgeBase>("/api/v1/knowledge-bases", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteKnowledgeBase(id: number): Promise<void> {
  return apiFetch<void>(`/api/v1/knowledge-bases/${id}`, { method: "DELETE" });
}

export function getDocuments(kbId: number): Promise<DocumentItem[]> {
  return apiFetch<DocumentItem[]>(`/api/v1/knowledge-bases/${kbId}/documents`);
}

/**
 * Upload a document file to a knowledge base (multipart/form-data). We don't set
 * Content-Type manually — the browser adds the multipart boundary — so this
 * bypasses `apiFetch` (which forces application/json) and surfaces `detail`.
 */
export async function uploadDocument(
  kbId: number,
  file: File
): Promise<DocumentItem> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(
    `${API_BASE_URL}/api/v1/knowledge-bases/${kbId}/documents`,
    // Don't set Content-Type — the browser adds the multipart boundary.
    { method: "POST", body: form, headers: withApiKey() }
  );

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) {
        message =
          typeof body.detail === "string"
            ? body.detail
            : JSON.stringify(body.detail);
      }
    } catch {
      /* keep status line */
    }
    throw new Error(message);
  }
  return (await res.json()) as DocumentItem;
}

// ---------------------------------------------------------------------------
// Chat streaming (SSE)
// ---------------------------------------------------------------------------

// Discriminated union. Every event also carries an ISO-8601 `timestamp`
// (Phase 6); tool events carry a `call_id` pairing a call with its result.
// Supervisor (7B) decoration present on inner events during a supervisor run.
// All optional — absent on the plain single-agent path. `depth` is 0 at the
// root; `parent_call_id` points at the enclosing sub-agent tool_call (null at
// root), letting the UI nest events into a tree.
export interface SupervisorMeta {
  depth?: number;
  parent_call_id?: string | null;
  agent_id?: number;
  agent_name?: string;
}

export type ChatEvent =
  | ({ type: "token"; content: string; timestamp: string } & SupervisorMeta)
  | ({
      type: "iteration_start";
      iteration: number;
      timestamp: string;
    } & SupervisorMeta)
  | ({
      type: "tool_call";
      call_id: string;
      tool_name: string;
      input: Record<string, unknown>;
      timestamp: string;
      // "sub_agent" when this call delegates to a sub-agent (7B); else "tool".
      kind?: "tool" | "sub_agent";
      sub_agent_id?: number;
      sub_agent_name?: string;
    } & SupervisorMeta)
  | ({
      type: "tool_result";
      call_id: string;
      tool_name: string;
      output: string;
      duration_ms: number;
      timestamp: string;
      kind?: "tool" | "sub_agent";
      sub_agent_id?: number;
      sub_agent_name?: string;
    } & SupervisorMeta)
  | {
      type: "done";
      conversation_id: number;
      message_id: number;
      timestamp: string;
    }
  | ({ type: "error"; message: string; timestamp: string } & SupervisorMeta);

/**
 * Consume a Server-Sent Events response, invoking `onEvent` for each parsed
 * `data:` frame. Shared by streamChat and streamWorkflow. Surfaces a FastAPI
 * `detail` message when the request fails before streaming (e.g. 400/404).
 * Uses fetch + ReadableStream so we can POST a body (EventSource can't).
 */
async function consumeSSE<E>(
  res: Response,
  onEvent: (event: E) => void
): Promise<void> {
  if (!res.ok || !res.body) {
    notifyAuthFailure(res.status);
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) {
        message =
          typeof body.detail === "string"
            ? body.detail
            : JSON.stringify(body.detail);
      }
    } catch {
      /* non-JSON error body — keep the status line */
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line. Keep the trailing partial.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const dataLine = frame
        .split("\n")
        .find((line) => line.startsWith("data:"));
      if (!dataLine) continue;

      const json = dataLine.slice("data:".length).trim();
      if (!json) continue;

      onEvent(JSON.parse(json) as E);
    }
  }
}

/**
 * POST a chat message and consume the SSE stream, invoking `onEvent` for each
 * parsed event as it arrives (token, tool_call, tool_result, done, or error).
 */
export async function streamChat(
  agentId: number,
  message: string,
  conversationId: number | null,
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/v1/chat/${agentId}/stream`, {
    method: "POST",
    headers: withApiKey({ "Content-Type": "application/json" }),
    body: JSON.stringify({ message, conversation_id: conversationId }),
    signal,
  });
  await consumeSSE<ChatEvent>(res, onEvent);
}

// ---------------------------------------------------------------------------
// Workflows (sequential multi-agent orchestration)
// ---------------------------------------------------------------------------

export interface WorkflowStepAgent {
  agent_id: number;
  agent_name: string;
}

// Faz 7C: a stage. `parallel` is true when it holds >1 branch (agents that run
// concurrently); a single-agent stage is a plain sequential step.
export interface WorkflowStepGroup {
  step_order: number;
  parallel: boolean;
  agents: WorkflowStepAgent[];
}

export interface Workflow {
  id: number;
  name: string;
  description: string;
  created_at: string;
  steps: WorkflowStepGroup[];
}

export interface WorkflowInput {
  name: string;
  description: string;
  // Faz 7C: stages as agent-id groups. Group index = step order; a group of 1 =
  // sequential step, a group of N = parallel branches (order within the group).
  steps: number[][];
}

export function listWorkflows(): Promise<Workflow[]> {
  return apiFetch<Workflow[]>("/api/v1/workflows");
}

export function getWorkflow(id: number): Promise<Workflow> {
  return apiFetch<Workflow>(`/api/v1/workflows/${id}`);
}

export function createWorkflow(input: WorkflowInput): Promise<Workflow> {
  return apiFetch<Workflow>("/api/v1/workflows", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateWorkflow(
  id: number,
  input: WorkflowInput
): Promise<Workflow> {
  return apiFetch<Workflow>(`/api/v1/workflows/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteWorkflow(id: number): Promise<void> {
  return apiFetch<void>(`/api/v1/workflows/${id}`, { method: "DELETE" });
}

// Per-agent step attribution carried on every inner event during a workflow run.
// Faz 7C: `branch_index` distinguishes parallel branches within a stage (0 for
// sequential steps).
export interface StepMeta {
  agent_id: number;
  agent_name: string;
  step_order: number;
  branch_index: number;
}

// One branch listed on a parallel stage's step_start.
export interface WorkflowBranchMeta {
  branch_index: number;
  agent_id: number;
  agent_name: string;
}

// Workflow run events. The inner per-agent events (token/iteration_start/
// tool_call/tool_result/error) are the ChatEvent shapes decorated with StepMeta;
// plus the orchestration-level bracketing events.
export type WorkflowEvent =
  | (Extract<ChatEvent, { type: "token" }> & StepMeta)
  | (Extract<ChatEvent, { type: "iteration_start" }> & StepMeta)
  | (Extract<ChatEvent, { type: "tool_call" }> & StepMeta)
  | (Extract<ChatEvent, { type: "tool_result" }> & StepMeta)
  | (Extract<ChatEvent, { type: "error" }> & StepMeta)
  | {
      type: "workflow_start";
      workflow_id: number;
      name: string;
      step_count: number;
      timestamp: string;
    }
  // step_start: sequential stages carry StepMeta; parallel stages carry the
  // branch list instead of a single agent.
  | {
      type: "step_start";
      timestamp: string;
      step_order: number;
      parallel: boolean;
      agent_id?: number;
      agent_name?: string;
      branch_index?: number;
      branches?: WorkflowBranchMeta[];
    }
  | ({
      type: "step_complete";
      output: string;
      failed?: boolean;
      timestamp: string;
    } & StepMeta)
  // step_merged: the merged text of a parallel stage that feeds the next stage.
  | {
      type: "step_merged";
      step_order: number;
      output: string;
      timestamp: string;
    }
  | { type: "workflow_done"; conversation_id: number; timestamp: string };

/**
 * POST an input to a workflow and consume its SSE run stream. Emits
 * workflow_start / step_start / (decorated inner events) / step_complete /
 * workflow_done, plus decorated error events on a failing step.
 */
export async function streamWorkflow(
  workflowId: number,
  input: string,
  onEvent: (event: WorkflowEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(
    `${API_BASE_URL}/api/v1/workflows/${workflowId}/stream`,
    {
      method: "POST",
      headers: withApiKey({ "Content-Type": "application/json" }),
      body: JSON.stringify({ input }),
      signal,
    }
  );
  await consumeSSE<WorkflowEvent>(res, onEvent);
}

// ---------------------------------------------------------------------------
// MCP servers (Phase 8 — remote HTTP/SSE)
// ---------------------------------------------------------------------------

export type Transport = "streamable_http" | "sse";

export interface MCPToolSpec {
  name: string; // original tool name on the server (not namespaced)
  description: string;
  input_schema: Record<string, unknown>;
}

export interface MCPServer {
  id: number;
  name: string;
  url: string;
  description: string;
  transport: Transport;
  enabled: boolean;
  cached_tools: MCPToolSpec[];
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  // Namespaced names (mcp_{id}_{tool}) — what goes into an agent's allowed_tools.
  tool_names: string[];
}

export interface MCPServerInput {
  name: string;
  url: string;
  description: string;
  transport: Transport;
  enabled: boolean;
}

export function listMcpServers(): Promise<MCPServer[]> {
  return apiFetch<MCPServer[]>("/api/v1/mcp-servers");
}

export function createMcpServer(input: MCPServerInput): Promise<MCPServer> {
  return apiFetch<MCPServer>("/api/v1/mcp-servers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateMcpServer(
  id: number,
  input: MCPServerInput
): Promise<MCPServer> {
  return apiFetch<MCPServer>(`/api/v1/mcp-servers/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteMcpServer(id: number): Promise<void> {
  return apiFetch<void>(`/api/v1/mcp-servers/${id}`, { method: "DELETE" });
}

export function refreshMcpServer(id: number): Promise<MCPServer> {
  return apiFetch<MCPServer>(`/api/v1/mcp-servers/${id}/refresh`, {
    method: "POST",
  });
}

// One selectable tool for the agent builder — either a built-in (static) tool
// or a discovered MCP tool (grouped under its server).
export interface ToolChoice {
  id: string; // the allowed_tools value (built-in name or mcp_{id}_{tool})
  label: string; // user-facing label (MCP: plain tool name, no mcp_ prefix)
  description: string;
}

export interface McpToolGroup {
  server: MCPServer;
  tools: ToolChoice[];
}

/**
 * Build the MCP tool groups (one per server) for the agent form, deriving each
 * tool's namespaced id + friendly label from the server's cached tools.
 */
export function mcpToolGroups(servers: MCPServer[]): McpToolGroup[] {
  return servers.map((server) => ({
    server,
    tools: server.cached_tools.map((t, i) => ({
      // tool_names is aligned with cached_tools order on the backend.
      id: server.tool_names[i],
      label: t.name,
      description: t.description,
    })),
  }));
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export interface ConversationListItem {
  id: number;
  agent_id: number;
  agent_name: string;
  workflow_id: number | null;
  message_count: number;
  created_at: string;
  preview: string; // last message (output)
  input_preview: string; // first user message (input)
  status: "completed" | "failed";
  trace_saved: boolean; // an opt-in debug trace has been saved
}

// Opt-in saved debug trace. Discriminated: a chat trace holds per-turn event
// streams; a workflow trace holds the flat run event stream. Rendered read-only
// on the conversation detail page (chat → DebugPanel, workflow → StepTrace grid).
export interface SavedChatTurn {
  question: string;
  events: ChatEvent[];
  error?: string;
}
export type SavedTrace =
  | { type: "chat"; turns: SavedChatTurn[] }
  | { type: "workflow"; events: WorkflowEvent[] };

export interface ConversationMessage {
  id: number;
  role: string;
  content: string;
  agent_id: number | null;
  agent_name: string | null;
  step_order: number | null;
  created_at: string;
}

export interface ConversationDetail {
  id: number;
  agent_id: number;
  agent_name: string;
  workflow_id: number | null;
  created_at: string;
  messages: ConversationMessage[];
  trace?: SavedTrace | null; // opt-in debug trace (null unless saved)
}

export function listConversations(params?: {
  agent_id?: number;
  workflow_id?: number;
}): Promise<ConversationListItem[]> {
  const q = new URLSearchParams();
  if (params?.agent_id != null) q.set("agent_id", String(params.agent_id));
  if (params?.workflow_id != null)
    q.set("workflow_id", String(params.workflow_id));
  const qs = q.toString();
  return apiFetch<ConversationListItem[]>(
    `/api/v1/conversations${qs ? `?${qs}` : ""}`
  );
}

export function getConversation(id: number): Promise<ConversationDetail> {
  return apiFetch<ConversationDetail>(`/api/v1/conversations/${id}`);
}

export function deleteConversation(id: number): Promise<void> {
  return apiFetch<void>(`/api/v1/conversations/${id}`, { method: "DELETE" });
}

/**
 * Save (opt-in) a conversation's debug trace. The body is the client's
 * accumulated event stream ({type:"chat",turns} or {type:"workflow",events});
 * overwrites any prior trace. 413 if >~1 MB, 404 if the conversation is gone.
 */
export function saveConversationTrace(
  id: number,
  trace: SavedTrace
): Promise<void> {
  return apiFetch<void>(`/api/v1/conversations/${id}/trace`, {
    method: "PUT",
    body: JSON.stringify(trace),
  });
}

// ---------------------------------------------------------------------------
// Templates (built-in, read-only starting points)
// ---------------------------------------------------------------------------

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  allowed_tools: string[];
  knowledge_base_id: number | null;
  model_params: ModelParams;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  // Agent specs this workflow needs; the UI creates any missing ones by name.
  agents: AgentTemplate[];
  // Ordered step agent names (match agents[].name).
  steps: string[];
}

export function getAgentTemplates(): Promise<AgentTemplate[]> {
  return apiFetch<AgentTemplate[]>("/api/v1/templates/agents");
}

export function getWorkflowTemplates(): Promise<WorkflowTemplate[]> {
  return apiFetch<WorkflowTemplate[]>("/api/v1/templates/workflows");
}
