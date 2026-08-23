# Agent Platform — Proje Bağlamı

Kullanıcıların **kod yazmadan AI agent oluşturabileceği** bir platform. Bu dosya
her yeni oturumda otomatik okunur ve projenin güncel bağlamını taşır.

## Mimari Özeti

- **Backend:** FastAPI + SQLAlchemy 2.0 (ORM) + SQLite. Python 3.12.
  - Ayarlar `.env`'den Pydantic Settings ile okunur.
  - Tablolar uygulama başlangıcında (`lifespan`) `Base.metadata.create_all`
    ile oluşturulur (henüz Alembic migration yok).
- **Frontend:** Next.js 14 (App Router) + TypeScript + Tailwind CSS.
  - Backend'e `lib/api.ts` içindeki fetch wrapper üzerinden erişir; base URL
    `NEXT_PUBLIC_API_BASE_URL` env değişkeninden gelir.
- **Orkestrasyon:** Docker Compose. Backend `:8000`, frontend `:3000` — **yalnız
  `127.0.0.1`'e bind** (LAN'a kapalı). Dev modunda volume mount + hot-reload açık.
  Backend'in healthcheck'i var, frontend `depends_on: backend`.
- **Auth:** tüm `/api/v1/*` endpoint'leri **`X-API-Key`** ister (paylaşılan
  `APP_API_KEY`); health public. Key yoksa backend başlamaz. `/chat` ve
  `/workflows` stream'lerinde **20/dk/IP rate-limit** (slowapi).
- **Kalıcılık:** named volume `agent_db` `/data`'ya bağlı; içinde SQLite
  (`/data/app.db`), ChromaDB indeksi (`/data/chroma`) ve embedding modeli
  cache'i (`/data/hf`) yaşar — hepsi bind-mount edilen kaynak ağacında DEĞİL.
  `docker compose down && up --build` sonrası korunur; `down -v` siler.
- **CORS:** Backend yalnızca `http://localhost:3000` origin'ine izin verir.

## Klasör Yapısı

```
agent-platform/
├── backend/
│   └── app/
│       ├── main.py          # FastAPI app, CORS, router bağlama, lifespan
│       ├── core/
│       │   ├── config.py    # Pydantic Settings (.env okuma)
│       │   ├── database.py  # engine (+FK pragma), SessionLocal, Base, get_db
│       │   ├── auth.py      # require_api_key (X-API-Key dependency)
│       │   └── ratelimit.py # slowapi limiter (paylaşılan)
│       ├── models/          # SQLAlchemy: Agent, Conversation, Message,
│       │                    #   KnowledgeBase, Document, Workflow, WorkflowStep,
│       │                    #   MCPServer
│       ├── schemas/         # Pydantic şemaları (agent, chat, knowledge_base,
│       │                    #   workflow, mcp_server, conversation, template)
│       ├── services/        # Harici entegrasyonlar (llm_client → Anthropic)
│       │   ├── tools/        # Tool sistemi: base, registry + calculator/wiki/
│       │   │                 #   ddg/document_search/weather/web_search +
│       │   │                 #   mcp_tool (dinamik)
│       │   ├── rag/          # RAG: chunking, embedding, vector_store, loader
│       │   ├── orchestration/ # Multi-agent: sequential (pipe) + parallel (7C) orkestrasyon
│       │   ├── mcp/          # MCP: client (SDK), security (SSRF), resolver, errors
│       │   └── templates.py  # Statik agent/workflow şablon listeleri (DB yok)
│       └── api/v1/          # Route'lar: health, agents, chat, knowledge_bases,
│                            #   workflows, mcp_servers, conversations, templates
├── frontend/
│   ├── app/                 # Next.js App Router
│   │   ├── layout.tsx       # kök shell: Sidebar + içerik alanı + ConfigBanner
│   │   ├── page.tsx         # ana sayfa = dashboard (hoşgeldin + istatistik
│   │   │                    #   kartları + Hızlı Sohbet + health)
│   │   ├── agents/          # agent yönetim paneli:
│   │   │   ├── page.tsx     #   liste + sil onay modalı
│   │   │   ├── new/page.tsx #   oluşturma
│   │   │   └── [id]/page.tsx#   düzenleme (client — SSR backend'e erişemez)
│   │   ├── knowledge-bases/ # RAG paneli:
│   │   │   ├── page.tsx     #   liste + oluştur + sil
│   │   │   └── [id]/page.tsx#   doküman listesi + dosya yükleme
│   │   ├── workflows/       # Sequential orkestrasyon paneli:
│   │   │   ├── page.tsx     #   liste (kart + adım özeti) + sil modalı
│   │   │   ├── new/page.tsx #   oluşturma
│   │   │   ├── [id]/page.tsx#   düzenleme
│   │   │   └── [id]/run/    #   çalıştırma + adım-bazlı streaming görünüm
│   │   ├── mcp-servers/     # MCP server yönetimi (liste+ekle+refresh+sil)
│   │   └── conversations/   # Konuşma yönetimi:
│   │       ├── page.tsx     #   liste (filtre: ?agent_id/?workflow_id) + sil modalı
│   │       └── [id]/page.tsx#   salt-okunur mesaj geçmişi
│   ├── components/          # HealthStatus, Chat, AgentForm, DebugPanel
│   │                        #   (+StepTrace), WorkflowForm, ConfigBanner,
│   │                        #   Sidebar, PageHeader, LoadingSpinner,
│   │                        #   ErrorBanner, EmptyState, FormField, Toast, Modal
│   └── lib/api.ts           # fetch wrapper + SSE (chat & workflow) + tüm CRUD'lar
├── docker-compose.yml
├── .env.example
└── README.md
```

## Tamamlanan Fazlar

- **Faz 1 — Proje İskeleti** ✅
  - Backend FastAPI iskeleti: `main.py`, CORS middleware, config, database.
  - Modeller: `Agent` (id, name, system_prompt, model_params JSON, created_at),
    `Conversation`, `Message` (ilişkileriyle).
  - `GET /health` → `{"status": "healthy"}`.
  - Agent CRUD: `POST/GET/GET{id}/DELETE /api/v1/agents`.
  - Frontend ana sayfa + `HealthStatus` bileşeni (backend health'i canlı gösterir).
  - Docker Compose ile her iki servis ayağa kalkıyor, uçtan uca doğrulandı.

- **Faz 2 — Claude Haiku 4.5 Entegrasyonu + Streaming** ✅
  - `app/services/llm_client.py` — `AsyncAnthropic` ile streaming completion
    (`messages.stream`), `.env`'den `ANTHROPIC_API_KEY`, varsayılan model
    `claude-haiku-4-5-20251001`. API key eksikse `LLMConfigError`.
  - `POST /api/v1/chat/{agent_id}/stream` — SSE (`text/event-stream`).
    Body: `{"message": str, "conversation_id": int?}`. Agent'ı DB'den çeker,
    conversation/message geçmişini kaydeder, cevabı token token akıtır.
  - SSE event zarfı (genişletilebilir): `{"type":"token","content":...}`,
    `{"type":"done","conversation_id":...,"message_id":...}`,
    `{"type":"error","message":...}`. Faz 6'da "thought"/"tool_call"/
    "tool_result" event'leri aynı transport'a eklenecek.
  - Hata yönetimi: key eksik veya Anthropic API hatası → `error` event'i;
    backend çökmez.
  - Frontend `components/Chat.tsx` — agent seçici (dropdown, `/agents`'ten),
    mesaj listesi, giriş + gönder, `lib/api.ts`'teki `streamChat` (fetch +
    ReadableStream) ile token'ları canlı (typewriter) gösterir.
  - Doğrulama: SSE transport, DB kalıcılığı (conversation + user message),
    hata yolu ve frontend render doğrulandı. **Not:** gerçek token akışı
    geçerli bir `ANTHROPIC_API_KEY` gerektirir (test ortamında key yoktu).

- **Faz 3 — Single Agent Builder (yönetim paneli)** ✅
  - Backend agent CRUD tamamlandı: `GET/POST /agents`, `GET/PUT/DELETE
    /agents/{id}`. `PUT` tam değiştirme (full replacement).
  - `Agent`'a `description` kolonu eklendi; `_ensure_schema()` (lifespan)
    ile mevcut SQLite tablosuna idempotent `ALTER TABLE` yapılır (Alembic yok).
  - Şemalar: `ModelParams` (provider/model/temperature/max_tokens/top_p/top_k,
    `extra="forbid"`), `AgentCreate`, `AgentUpdate`, `AgentResponse`.
    `name` ve `system_prompt` zorunlu; `model_params` `exclude_none` ile
    kaydedilir.
  - `_validate_provider_key(provider)`: seçilen provider'ın API key'i .env'de
    yoksa 400 döner ("… provider için key ayarlanmamış").
  - `DELETE`: agent'ın konuşması varsa **409 ile engellenir** (cascade silme
    yok); yoksa 204.
  - `llm_client`: agent `model_params.provider` global `LLM_PROVIDER`'ı
    override eder (yoksa global'e düşer).
  - Frontend: `/agents` (kart listesi, sil onay modalı), `/agents/new`,
    `/agents/[id]` (düzenleme) + paylaşılan `AgentForm` (isim, açıklama,
    system prompt, provider dropdown, model, temperature slider, max tokens;
    isim/system_prompt boşsa submit engellenir). Ana sayfa ve chat'ten
    navigasyon.
  - Doğrulama (uçtan uca): OpenRouter agent oluşturma, `PUT` ile system_prompt
    değişip chat'e yansıması (PONG testi), konuşmalı agent silme → 409,
    boş isim → 422, provider key yok → 400, temiz silme → 204.

- **Faz 4 — Tool Sistemi + Claude Native Tool-Use** ✅
  - `app/services/tools/` paketi. `base.py`: `Tool` ABC (`name`,
    `description`, `input_schema` [Claude tool-use formatına uygun JSON Schema],
    async `execute(input) -> str`, `spec()` helper).
  - Üç tool: `calculator.py` (ast tabanlı **güvenli** hesaplayıcı — `eval` yok;
    yalnızca whitelist operatör/fonksiyon/sabit, `sqrt/log/sin` vb.),
    `wikipedia_search.py` (MediaWiki `/w/api.php` — arama → intro extract;
    **descriptive `User-Agent` şart**, yoksa 403), `duckduckgo_search.py`
    (DuckDuckGo Instant Answer API). İkisi de key gerektirmez, `httpx` ile async.
  - `registry.py`: tool isimlerini instance'lara eşler; `all_tool_names()`,
    `get_tool()`, `invalid_tool_names()`, `tool_specs(allowed)` (agent'ın
    `allowed_tools`'una göre filtreli Claude spec listesi).
  - `Agent.allowed_tools` (JSON liste) kolonu + `_ensure_schema()`'ya idempotent
    `ALTER TABLE ... ADD COLUMN allowed_tools JSON NOT NULL DEFAULT '[]'`.
    Şemalarda `allowed_tools: list[str]` (Create/Update/Response). Geçersiz tool
    ismi → route'ta `_validate_tools` ile **400**.
  - `llm_client.stream_completion` artık **string değil event dict yield eder**
    ve tool-use döngüsü içerir: `allowed_tools` → Claude'a `tools` geçilir;
    `stop_reason == "tool_use"` ise ilgili tool execute edilip sonucu
    `tool_result` olarak follow-up turn'de geri gönderilir (`MAX_TOOL_ITERATIONS`
    cap'i ile döngü). Yeni SSE event'leri: `{"type":"tool_call","tool_name",
    "input"}` ve `{"type":"tool_result","tool_name","output"}` (mevcut
    token/done/error zarfına ek). `_run_tool` her hatayı `"hata: ..."` string'ine
    çevirir → tool hatası Claude'a tool_result olarak döner, backend çökmez.
  - `chat.py`: generator artık dict event'leri forward eder; text yalnızca
    `token` event'lerinden biriktirilip assistant mesajı olarak kaydedilir.
  - Frontend: `AgentForm`'a araç seçimi için checkbox grubu (`AVAILABLE_TOOLS`
    kataloğu `lib/api.ts`'te; backend registry ile aynı isimler). `Chat.tsx`
    `tool_call`/`tool_result` event'lerini sade satırlar olarak gösterir
    ("🔧 … çalıştırılıyor…" / "✓ … sonucu alındı"); token'lar lazy olarak
    son assistant balonuna eklenir, araç satırları araya girebilir.
  - Doğrulama (uçtan uca, OpenRouter Haiku 4.5): calculator agent "347 * 29" →
    tool_call/tool_result (10063) + doğru cevap; wikipedia agent "Türkiye nüfusu"
    → tool çağrıldı, cevap tool sonucuna dayandı (canlı 2025 verisi); araçsız
    agent aynı soruya tool çağırmadan cevap verdi (yalnız token/done); geçersiz
    tool ismi → 400; bozuk Wikipedia URL'i → "hata: …" (backend çökmedi);
    `tsc --noEmit` temiz.

- **Faz 5 — RAG (Doküman Yükleme, Chunking, Embedding, Retrieval)** ✅
  - Yeni bağımlılıklar (`requirements.txt`): `sentence-transformers` (embedding),
    `chromadb` (vektör store), `pypdf` (PDF metin çıkarma), `python-multipart`
    (dosya yükleme). Dockerfile zaten `requirements.txt`'i koddan önce
    kopyalıyor → layer caching korunur (torch büyük indirme).
  - Modeller: `KnowledgeBase` (id, name, description, created_at) ve `Document`
    (id, knowledge_base_id FK, filename, chunk_count, uploaded_at). Yeni tablolar
    `create_all` ile; `Agent.knowledge_base_id` (nullable FK) `_ensure_schema`'ya
    idempotent `ALTER TABLE agents ADD COLUMN knowledge_base_id INTEGER` ile.
  - `app/services/rag/`: `chunking.py` (kelime bazlı, 500 kelime/50 overlap),
    `embedding.py` (`all-MiniLM-L6-v2`, **lazy-load + cache**, `embed(texts)`),
    `vector_store.py` (Chroma `PersistentClient` `settings.CHROMA_DIR`
    [`/data/chroma`], KB başına `kb_{id}` collection, `add_documents`/`query`/
    `delete_collection`; embedding'i biz veriyoruz → Chroma default ONNX modelini
    indirmez), `document_loader.py` (.txt/.pdf → metin, bilinmeyen format
    `UnsupportedFormatError`).
  - `app/api/v1/knowledge_bases.py`: `POST/GET /knowledge-bases`,
    `DELETE /knowledge-bases/{id}` (Chroma collection'ı da siler),
    `POST /{id}/documents` (multipart yükleme → metin çıkar → chunk → embed →
    Chroma'ya yaz → `Document` kaydı; embedding bloklayıcı olduğu için
    `asyncio.to_thread`), `GET /{id}/documents`. **10 MB** üstü → 413,
    desteklenmeyen format → 400, boş/metin çıkmayan dosya → 400.
  - `document_search` tool'u (`services/tools/document_search.py`): diğerlerinden
    farklı olarak `knowledge_base_id`'yi **model girdisinden değil `context`'ten**
    alır (input_schema'da yalnız `query`). Bunun için `Tool.execute` imzasına
    `context: dict | None = None` eklendi (üç mevcut tool da güncellendi).
    `llm_client.stream_completion` yeni `knowledge_base_id` parametresiyle
    `tool_context` kurar; KB yoksa `document_search` Claude'a **sunulmaz**.
  - `Agent.knowledge_base_id` + şemalarda `knowledge_base_id: Optional[int]`.
    Route'ta `_validate_knowledge_base`: `document_search` seçili ama KB yoksa
    **400**; verilen KB id yoksa **400**.
  - Frontend: `/knowledge-bases` (liste+oluştur+sil), `/knowledge-bases/[id]`
    (doküman listesi + dosya yükleme, yükleme sırasında loading göstergesi).
    `AgentForm`'da `document_search` işaretlenince **zorunlu KB seçici** dropdown
    belirir (KB seçilmeden submit engellenir). `lib/api.ts`'e KB/doküman CRUD +
    `uploadDocument` (FormData; multipart boundary tarayıcıya bırakılır).
  - Doğrulama (uçtan uca): KB oluştur → "yılda 20 gün izin" .txt yükle
    (1 chunk) → `document_search` agent'a "Kaç gün izin hakkım var?" → tool_call/
    tool_result → cevap dokümana dayalı **"20 gün"** ✅; alakasız soru
    ("İtalya başkenti") → tool çağrılmadı, "Roma" ✅; 10 MB+ → 413; .md → 400;
    document_search KB'siz agent → 400; KB sil → Chroma `kb_1` collection'ı
    temizlendi ✅; calculator regresyon ✅; `tsc --noEmit` temiz.

- **Faz 6 — Streaming Debug Paneli (genişletilmiş event şeması)** ✅
  - `llm_client`: **geriye dönük uyumlu** event genişletmesi. Yeni yardımcı
    `build_event(type, **fields)` her event'e ISO-8601 `timestamp` ekler.
    - Yeni event: `iteration_start` (`{iteration: N, timestamp}`) — her
      tool-use round-trip'inin başında (`MAX_TOOL_ITERATIONS` döngüsü, 1-based).
    - `tool_call`'a `call_id` (uuid4), `tool_result`'a **aynı** `call_id` +
      `duration_ms` (call→result arası `time.perf_counter` ile ölçülür).
    - `token`/`done`/`error` de artık `timestamp` taşır (içerik bozulmadan).
  - `chat.py`: `done`/`error` event'leri `llm_client.build_event` ile üretilir
    (timestamp taşısın); diğer event'ler zaten dict olarak forward ediliyor.
  - Frontend `components/DebugPanel.tsx`: her user turn için ayrı "İşlem
    Günlüğü". İterasyonlar "Tur N" başlığı; her `tool_call` **daraltılabilir
    kart** (varsayılan kapalı) — tool adı + süre; açınca `input`/`output`
    monospace `<pre>`. Renk: çalışırken **amber**, sonuç `hata:` ile başlıyorsa
    **kırmızı**, aksi halde **yeşil**. `call_id` ile call↔result eşleştirilir.
  - `Chat.tsx`: eski satır-içi "🔧 çalıştırılıyor…" mesajları kaldırıldı; chat
    balonunda yalnız model metni kalır, araç mekaniği panele taşındı. Debug
    trace state (`debugTurns`) event'lerden kurulur (iteration_start→iterasyon,
    tool_call→kart, tool_result→call_id eşleşen kartı doldurur). **Toggle**
    ("Debug paneli", varsayılan açık). `ChatEvent` union yeni alanlarla güncellendi.
  - Doğrulama (uçtan uca): çok araçlı soru ("Türkiye nüfusunun yarısı?") →
    Tur 1 wikipedia (86.092.168) → Tur 2 calculator (÷2=43.046.084), doğru
    sıra + call_id eşleşmesi + duration_ms ✅; tool hatası ("5/0") → output
    "hata: sıfıra bölme" (panel kırmızı) ✅; araçsız sohbet → yalnız
    iteration_start/token/done, panelde "Araç kullanılmadı" ✅; her event
    timestamp taşır ✅; debug paneli SSR'de render (toggle + boş durum) ✅;
    `tsc --noEmit` temiz.

- **Faz 7A — Sequential Multi-Agent Orkestrasyon (BACKEND + FRONTEND)** ✅
  - Modeller: `Workflow` (id, name, description, created_at) ve `WorkflowStep`
    (surrogate id PK, workflow_id FK cascade, agent_id FK, step_order). Surrogate
    PK sayesinde **aynı agent birden fazla adımda** görünebilir. `Workflow.steps`
    → `order_by(step_order)`. Yeni tablolar `create_all` ile.
  - Mevcut tablolara idempotent nullable ALTER'lar (`_ensure_schema`):
    `Conversation.workflow_id` (workflow run işareti), `Message.agent_id` +
    `Message.step_order` (assistant mesajını üreten agent/adım etiketi).
    `Conversation.agent_id` **NOT NULL kaldı**; workflow run'ında **ilk adımın
    agent'ı** ("giriş agent'ı") yazılır → tablo rebuild gerekmez.
  - `services/orchestration/sequential.py` — `run_workflow(...)` async generator.
    **Saf pipe:** kullanıcı input'u 1. agent'a; her agent'ın final metni sonraki
    agent'ın user mesajı olur (wrapper/template YOK). Her agent **taze tek turlu
    bağlamda** kendi system_prompt/model_params/allowed_tools/knowledge_base_id
    ile `llm_client.stream_completion`'ı yeniden kullanır.
  - **Event decoration:** `llm_client`'a DOKUNULMADI. Orkestratör her iç event'i
    `{**event, agent_id, agent_name, step_order}` ile decorate eder. Yeni
    orkestrasyon event'leri: `workflow_start` {workflow_id, name, step_count},
    `step_start` {step_order, agent_id, agent_name}, `step_complete` {…, output},
    `workflow_done` {conversation_id}. Bir adım hata verirse o agent'a ait
    `error` event'i + **kalan adımlar atlanır** + yine `workflow_done` (backend
    çökmez).
  - `POST /api/v1/workflows/{id}/stream` (SSE, `chat.py` deseni): body
    `{"input": str}` (continuation YOK — her run yeni conversation). Setup
    fazında workflow+step'ler+agent'lar plain snapshot'lanır; Conversation
    (workflow_id + entry agent) ve user Message yazılır; StreamingResponse
    orkestratörü sarar. Her adım çıktısı generator içinde **taze `SessionLocal`**
    ile agent/step etiketli assistant Message olarak kaydedilir.
  - Workflow CRUD: `POST/GET/GET{id}/PUT/DELETE /api/v1/workflows`. Create/Update
    body `{name, description, agent_ids: [int]}` (sıra = liste sırası, step_order
    = index). Geçersiz agent id → 400; boş `agent_ids` → 422; step'siz workflow
    run → 400. `PUT` step'leri tam değiştirir.
  - **Agent silme koruması genişletildi:** agent bir workflow adımında
    kullanılıyorsa **409** (konuşma 409'una ek). Sessiz workflow bozulması yok.
  - Doğrulama (uçtan uca, OpenRouter Haiku 4.5): "Özetleyici → İngilizce
    Çevirmen" workflow'u — Türkçe özet üretildi, İngilizceye çevrildi (pipe ✅);
    event'ler agent_id/agent_name/step_order ile decorate (token/iteration_start/
    tool_call/tool_result dahil, call_id eşleşmesi korunur ✅); persistence:
    conv workflow_id=1 + entry agent + user & 2 assistant mesajı (agent/step
    etiketli) ✅; empty agent_ids 422, nonexistent agent 400, run 404, workflow'da
    agent silme 409 ✅.
  - **Frontend:** `lib/api.ts`'e Workflow CRUD (`listWorkflows`/`getWorkflow`/
    `createWorkflow`/`updateWorkflow`/`deleteWorkflow`) + `streamWorkflow` +
    `WorkflowEvent` (ChatEvent iç tiplerinden `StepMeta` ile türetilmiş +
    workflow_start/step_start/step_complete/workflow_done). SSE tüketimi ortak
    `consumeSSE` helper'ına çıkarıldı (streamChat + streamWorkflow paylaşır,
    FastAPI `detail` hatasını yüzeye çıkarır).
  - `DebugPanel` genelleştirildi: iç iterasyon+kart render'ı **`StepTrace`**
    export component'ine çıkarıldı (`iterations` + opsiyonel `emptyLabel`); hem
    chat (turn başına) hem workflow run (adım başına) yeniden kullanır.
  - `WorkflowForm.tsx`: isim/açıklama + **sıralı adım listesi** (her adım agent
    dropdown'ı + yukarı/aşağı taşı + sil) + "Adım Ekle". En az 1 adım + her adımda
    agent zorunlu; submit'te `agent_ids` sırayla (full-list replacement) gönderilir.
  - Sayfalar: `/workflows` (kart listesi: isim + adım sayısı + "A → B" agent
    özeti, Çalıştır/Düzenle/Sil, sil onay modalı), `/workflows/new`,
    `/workflows/[id]` (düzenleme), `/workflows/[id]/run` (girdi textarea +
    Çalıştır + **adım-bazlı canlı görünüm**: her adım "Adım N: agentAdı" başlıklı,
    durum rozeti bekliyor→çalışıyor→tamamlandı/hata/atlandı, step_complete çıktısı
    ana metin olarak, `StepTrace` ile o adımın tool debug'ı; error'da adım kırmızı
    + sonraki adımlar "atlandı"; workflow_done'da genel durum). Ana sayfaya
    "Workflow'ları Yönet" linki.
  - Doğrulama: `tsc --noEmit` temiz; tüm sayfalar derlendi (200); PUT reorder
    ([7,8]→[8,7]→geri) sıra korunuyor ✅; hata senaryosu (orta adımda bozuk model
    slug'ı) → step0 complete, step1 error, step2 event almıyor (UI "atlandı"),
    workflow_done ✅; tool'lu adım event'leri step_order ile doğru grupta ✅.

- **Faz 7B — Supervisor (Hiyerarşik) Multi-Agent (BACKEND + FRONTEND)** ✅
  - `Agent.sub_agent_ids` (JSON liste; `allowed_tools` deseninin aynısı) — bir
    agent'ın alt agent olarak çağırabileceği agent id'leri. Boş = supervisor
    değil. `_ensure_schema`'ya idempotent `ADD COLUMN sub_agent_ids JSON NOT NULL
    DEFAULT '[]'`. Şemada `sub_agent_ids: list[int]` (Create/Update/Response).
  - **Mimari karşıtlık (7A vs 7B):** 7A tool-use döngüsünün *dışındaydı*
    (`sequential.py`, llm_client'a dokunmadı). 7B *içinde*: supervisor'ın Claude'u
    bir alt agent'ı "tool" olarak çağırır → onu özyinelemeli akıtmak gerekir, bu
    yüzden `llm_client.stream_completion` değişti.
  - **Alt agent'lar statik registry'ye EKLENMEZ.** Tool base class (`execute→str`)
    stream edemez; alt agent bir event akışı üretir. Sadece Tool spec *şekli*
    reuse edilir: her alt agent için request-başına **synthetic spec** üretilir
    (`_sub_agent_specs`): isim `call_agent_{id}` (Claude tool-adı kuralı için id
    tabanlı), açıklama alt agent'ın adı+description'ı, input_schema tek `task`
    alanı. Claude'a giden `tools` = `registry.tool_specs(...)` + synthetic'ler.
  - **Dispatch dallanması** (`stream_completion` döngüsünde): tool_use adı
    `sub_name_map`'te ise → `_run_sub_agent` (özyinelemeli `stream_completion`,
    alt agent kendi system_prompt/allowed_tools/knowledge_base_id/model'iyle TAM
    tur çalışır), event'leri akıtılır, biriken **kendi** metni (parent_call_id
    eşleşen token'lar) `tool_result` içeriği olur. Değilse → mevcut `_run_tool`.
  - **Özyineleme korumaları:** (1) runtime **`visited` kümesi** — her seviyede
    ata-zincirindeki id'ler synthetic spec'lerden hariç (A→B→A ve self imkânsız;
    *hard garanti*). (2) **`MAX_AGENT_DEPTH`=3** — bu derinlikte alt agent hiç
    sunulmaz. (3) config-time **self-reference → 400** (`_validate_sub_agents`).
  - **Maliyet freni:** **`MAX_SUB_AGENT_CALLS`=8** — tüm request boyunca
    **paylaşılan** sayaç (`_CallBudget`, referansla geçilir). Aşılınca alt agent
    çalıştırılmaz, `"hata: … limiti aşıldı"` tool_result'ı döner. Ek olarak her
    agent'ın kendi `MAX_TOOL_ITERATIONS`=6'sı geçerli.
  - **Çoklu tool_use / tek tur:** Claude bir turda birden çok alt agent isteyebilir;
    her dal için `child_ctx.visited = parent.visited | {sid}` **yeni frozenset**
    (dallar birbirini kirletmez), `budget` ise **aynı obje** (tüm request paylaşır).
  - **Event decoration (geriye dönük uyumlu):** her event'e `depth` (0=kök),
    `parent_call_id` (üstteki alt-agent tool_call'ı; kökte null), `agent_id`/
    `agent_name`. Alt agent çağrısı `tool_call`/`tool_result` + **`kind:"sub_agent"`**
    + `sub_agent_id`/`sub_agent_name`; gerçek tool `kind:"tool"`. `sub_ctx=None`
    (normal chat / `sequential.py`) → decoration eklenmez, davranış pre-7B ile
    aynı (tool event'lerine yalnız `kind` eklenir).
  - **Endpoint:** yeni endpoint YOK — mevcut `POST /chat/{agent_id}/stream`.
    `chat.py` setup'ta agent'ın `sub_agent_ids`'inden ulaşılabilir grafiği BFS ile
    session-free snapshot map'e (`_resolve_sub_agent_graph`) çevirir,
    `llm_client.make_root_context` ile kök context'i kurar. Persistence:
    **yalnız supervisor'ın kendi (depth 0) metni** assistant Message olur
    (`event.get("depth",0)==0` filtresi); alt agent metinleri stream'de görünür
    ama Message olarak saklanmaz.
  - **Agent silme koruması:** başka agent'ın `sub_agent_ids`'inde ise **409**
    (konuşma + workflow guard'larına ek).
  - Doğrulama (uçtan uca, OpenRouter Haiku 4.5): Koordinator supervisor + Hesap
    Uzmanı (calculator) + Bilgi Uzmanı (wikipedia) → "125×8" delege edildi:
    depth0 tool_call kind=sub_agent → depth1 Hesap Uzmanı'nın nested calculator
    (1000) parent_call_id eşleşiyor → depth0 tool_result ✅; **tek turda 2 alt
    agent** (topla + Türkiye) aynı ITERATION 1'de, her dal bağımsız visited ✅;
    self-ref 400, olmayan alt agent 400, kullanılan alt agent silme 409 ✅;
    depth/cycle/budget guard'ları unit doğrulandı ✅.
  - **Frontend:** `lib/api.ts` — `Agent.sub_agent_ids: number[]` (Create/Update'e
    geçer); `ChatEvent`'e opsiyonel `SupervisorMeta` (`depth`/`parent_call_id`/
    `agent_id`/`agent_name`) + `tool_call`/`tool_result`'a `kind`
    (`"tool"|"sub_agent"`)/`sub_agent_id`/`sub_agent_name`.
  - `AgentForm`'a **"Alt Agent'lar (Supervisor modu)"** checkbox listesi
    (indigo tonu); düzenlenen agent kendi listesinden **hariç** (UI'da
    self-reference engeli; backend zaten 400). `allowed_tools`'tan bağımsız —
    bir agent hem gerçek tool hem alt agent kullanabilir.
  - **`DebugPanel` özyinelemeli hale getirildi.** `DebugTurn` artık ham
    `events: ChatEvent[]` tutar; `buildTrace(events)` **düz event akışını ağaca**
    çevirir: `parent_call_id` yoksa kök iterasyonlara, varsa ilgili `tool_call`
    kartının kendi `iterations`'ına (call_id index'iyle) yerleşir; `tool_result`
    call_id ile eşlenir (nesting derinliği sınırsız, pratikte MAX_AGENT_DEPTH).
    `StepTrace` özyineli render eder (`depth` prop'u ile sol girinti). `kind===
    "sub_agent"` kartları **indigo + 🤖 + "alt agent" rozeti**; açılınca içinde
    alt agent'ın kendi `StepTrace`'i (kendi Tur/tool_call'ları) + alt agent yanıtı.
  - `Chat.tsx`: token'ı yalnız **depth 0** iken balona ekler (alt agent token'ları
    debug'da kartta görünür, ana balonu kirletmez); sub-agent `error` (depth>0)
    turn'ü fatal yapmaz (kartta "hata:" olarak görünür). Supervisor seçildiğinde
    ek bir şey yapmaz — mevcut chat akışı aynen çalışır.
  - Doğrulama: `tsc --noEmit` temiz; sayfalar derlendi (200); supervisor edit
    formu `sub_agent_ids=[9,10]` yüklüyor, kendisi listede yok ✅; buildTrace
    algoritması gerçek stream'lerle doğrulandı — tekli: Koordinatör Tur1 →
    🤖 Hesap Uzmanı kartı, **içinde** calculator (1000) ✅; **paralel**: aynı
    Tur1'de iki kardeş sub_agent kartı (Hesap→calculator 300, Bilgi→wikipedia
    Türkiye), her biri kendi nested trace'iyle ✅.

- **Faz 7C — Parallel (Deterministik Paralel) Multi-Agent (BACKEND + FRONTEND)** ✅
  - **Amaç:** 7A'nın aşamalı yapısını genelleştirip bir "aşama"nın 1 **veya** N
    agent'ı GARANTİLİ eşzamanlı çalıştırıp çıktılarını birleştirmesi. 7B'nin
    (supervisor) model-kararlı, olasılıksal paralelliğinden farklı: **hiç ekstra
    LLM koordinatör çağrısı yok** (deterministik).
  - **Veri modeli (seçenek a):** `WorkflowStep`'e `branch_order` kolonu
    (`ALTER TABLE workflow_steps ADD COLUMN branch_order INTEGER NOT NULL
    DEFAULT 0`, `_ensure_schema`). `step_order` artık **aşama pozisyonu**; **aynı
    `step_order`'a sahip birden çok satır = o aşamanın paralel dalları**,
    `branch_order` ile sıralı. `agent_id` **FK korundu** → agent-silme guard'ı
    (`WorkflowStep.agent_id`) aynen çalışır (seçenek b [JSON agent_ids] FK'yı
    kıracaktı, reddedildi). `Workflow.steps` order_by `[step_order, branch_order]`.
    **Geriye uyum:** mevcut satırlar branch_order=0, tek dallı → sequential
    davranış birebir korunur.
  - **API şekli:** Create/Update payload `agent_ids: list[int]` → **`steps:
    list[list[int]]`** (grup listesi; grup index=step_order, grup-içi
    index=branch_order; 1'lik grup=sequential, N'lik=paralel). `agent_ids`
    **legacy alias** olarak kabul edilir (model_validator `[[id] for id in
    agent_ids]`'e çevirir) → şablon apply akışı kırılmadı. Response gruplu:
    `steps: [{step_order, parallel: bool, agents: [{agent_id, agent_name}]}]`.
    `_set_steps` grup→satır, `_to_response`/stream snapshot `_group_steps` ile
    gruplar, `_validate_agents` düzleştirip doğrular.
  - **Eşzamanlı streaming (`orchestration/sequential.py` genelleştirildi):**
    `run_workflow(stages=...)` her aşamayı işler. Tek dallı → 7A yolu (event'ler
    birebir aynı, sadece additif `branch_index:0`/`parallel:false`). N dallı →
    **`asyncio.Queue` üretici/tüketici:** dal başına bir `asyncio` task
    (`producer`) event'lerini + final `_BranchDone` sentinel'ini kuyruğa iter;
    tek tüketici kuyruğu boşaltıp event'leri **canlı** SSE'ye forward eder.
    Her event tam bir dict, tek yield noktası → dallar araya girer ama karışmaz;
    `branch_index` doğru sütuna yönlendirir. DB yazımı **tüketicide** (eşzamanlı
    değil) → SQLite tek-yazar kilidi çekişmez.
  - **Merge (saf pipe):** paralel aşama bitince N dalın çıktısı **agent adıyla
    etiketlenip** (`[AgentAdı]\n<çıktı>`) branch sırasında concatenate edilir →
    sonraki aşamanın girdisi. Ekstra LLM yok. (Merger agent = opsiyonel gelecek
    iyileştirme, kapsam dışı.)
  - **Event şeması:** `step_start`'a `parallel: bool` + (paralel) `branches:
    [{branch_index, agent_id, agent_name}]`; iç event'ler + per-dal
    `step_complete` `branch_index` taşır; per-dal `step_complete` `failed` bayrağı
    taşır; **`step_merged {step_order, output}`** (yalnız paralel aşamada) sonraki
    aşamaya giden birleşik metni verir.
  - **Hata yönetimi:** paralel dallar **bağımsız** — biri hata verirse diğerleri
    durmaz; hatalı dalın çıktısı `"hata: ..."` metni olarak merge'e **dahil edilir**
    (pipe akmaya devam). (7A'da tek dallı adım hatası hâlâ pipe'ı kırar.)
  - **`MAX_PARALLEL_BRANCHES`=5** sanity cap (schema'da 422 ile zorlanır).
  - Doğrulama (uçtan uca, OpenRouter Haiku 4.5): iki agent'ı aynı aşamaya koyan
    workflow oluşturuldu (`steps:[[12,13]]` → parallel:true) ✅; **gerçek
    eşzamanlılık:** iki dal `iteration_start`'ı ~aynı ms'de; hızlı dal
    (tool'suz "HIZLI") **3.8s'de bitti**, yavaş dal (4 ardışık calculator turu)
    hâlâ çalışıp **13.0s'de bitti** — hızlı dal event'leri yavaş dal bitmeden
    ~9s önce aktı (timestamp'lerle) ✅; **hata dalı:** bir dal geçersiz model →
    `error`+`step_complete failed=True` "hata:…", diğer dal başarılı, **merge
    ikisini de içerdi**, workflow_done yine yayıldı ✅; **regresyon:** "Özetle ve
    Çevir" (sequential) birebir aynı — step0 tamamlanınca step1 başladı, pipe
    korundu, step_merged yok ✅; cap 6 dal→422, boş steps→422, geçersiz agent→400,
    legacy `agent_ids`→201, paralel dalda agent silme→**409** (FK guard korundu) ✅.
    Test verisi (agent 12/13/14, workflow 2/3/4, ilgili konuşmalar) temizlendi.
  - **Frontend:** `lib/api.ts` — `Workflow.steps` gruplu tip (`WorkflowStepGroup`
    {step_order, parallel, agents:[{agent_id, agent_name}]}); `WorkflowInput.steps:
    number[][]` (grup listesi, `agent_ids` kaldırıldı); `StepMeta`'ya `branch_index`;
    `WorkflowEvent`'e `step_start.parallel/.branches` (WorkflowBranchMeta), inner
    event'lerde `branch_index`, `step_complete.failed`, yeni `step_merged`.
  - `WorkflowForm`: adımlar artık **grup** (`Stage = StepValue[][]`). Her adım kartı
    içinde 1+ agent seçici; "**+ Paralel agent ekle**" aynı adıma dal ekler →
    adım otomatik **paralel** olur (mor "⇉ paralel · N dal" rozeti,
    `MAX_PARALLEL_BRANCHES=5` cap ile buton disable). Adım taşı/sil + dal sil.
    Submit `steps: number[][]` gönderir; şablon uygulama singleton grup'a çevirir.
  - `/workflows/[id]/run`: `StageRun`/`BranchRun` modeli; event'ler
    `(step_order, branch_index)` ile ilgili dala yönlendirilir. **Paralel adım
    dalları YAN YANA** responsive grid'de (7B'nin nested düzeninin aksine); her dal
    kendi başlık/durum/çıktı + **`buildTrace`+`StepTrace`** ile tool debug'ı. Paralel
    adımda `step_merged` "🔀 Birleşik çıktı" details'inde. Hata: sequential adım
    hatası sonraki adımları "atlandı" yapar (pipe kırılır); **paralel dal hatası
    kardeşleri durdurmaz** (yalnız o dal kırmızı). `workflow_done`'da pending dallar
    "atlandı". `/workflows` liste + run başlığı adım özetini gruplu gösterir
    (paralel `(A ∥ B)`, ardışık `A → B`).
  - **DebugPanel/StepTrace 7C için değişmedi** — yan-yana düzen run sayfasında yaşar;
    her dal zaten `StepTrace`'i (recursive, sub-agent nesting dahil) yeniden kullanır.
  - Doğrulama: `tsc --noEmit` temiz; tüm workflow sayfaları 200; **demo paralel
    workflow** (id 2: `[Bilgi Uzmani ∥ Ansiklopedi] → Özetleyici`) uçtan uca —
    iki wikipedia araması **interleave** oldu (br=0/br=1 tool_call'ları iç içe),
    ikisi bitti → `step_merged` ikisini de etiketli birleştirdi → sequential
    Özetleyici merge'i özetledi ✅; gruplu create/GET response run sayfasının
    `initialStages`'ini besledi ✅.

- **Faz 8 — MCP (Model Context Protocol) Entegrasyonu (BACKEND)** ✅
  - **Yalnız remote transport** (HTTP/SSE); **stdio/local process YOK** (bilinçli:
    küçük image + küçük saldırı yüzeyi). `requirements.txt`'e `mcp==1.9.4`.
  - `MCPServer` modeli: id, name, url, description, transport (`streamable_http`
    [default] | `sse`), enabled, **`cached_tools`** (JSON normalize spec listesi),
    `last_synced_at`, `last_error`, created_at. Yeni tablo → `create_all`.
  - `services/mcp/`: `client.py` (SDK sarmalayıcı — `streamablehttp_client`/
    `sse_client` + `ClientSession`; **operasyon başına kısa ömürlü bağlantı**;
    `fetch_tools`/`call_tool`, MCP `inputSchema`→bizim `input_schema`, sonuç
    text'e düzleştirilir, `isError`→"hata:"), `security.py` (**SSRF guard**
    `validate_public_url`), `resolver.py` (cache'ten MCPTool kurma/validasyon),
    `errors.py` (`MCPError`/`MCPSecurityError`).
  - **Tool entegrasyonu:** MCP tool'ları `Tool` base'ine **uyar** (call_tool
    **string** döner — 7B alt agent'ları gibi stream etmez). Ama statik registry'ye
    eklenmez; **dinamik** keşfedilir, request başına örneklenir. İsim çakışması →
    **server-id namespacing** `mcp_{server_id}_{tool}` (64-char guard, aşarsa
    base-hash). `services/tools/mcp_tool.py`: `MCPTool(Tool)` + naming helper'ları.
  - **Cache:** chat isteğinde canlı `list_tools` YAPILMAZ; Claude spec'i
    `cached_tools`'tan kurulur. Yalnız `call_tool` runtime'da ağ vurur. Yenileme:
    server create/update + manuel `POST /mcp-servers/{id}/refresh` (periyodik yok).
  - **Endpoint (yeni yok, chat reuse):** `_validate_tools` MCP isimlerini enabled
    server'ların cache'ine göre doğrular (bilinmez → 400). `chat.py` setup'ta
    (supervisor dahil ulaşılabilir tüm agent'ların) MCP tool'larından
    `mcp_resolver.build_mcp_tools` ile session-free `MCPTool` map'i kurar;
    `stream_completion`'a `mcp_tools` parametresiyle geçer. Dispatch: isim
    sub_agent → registry → **mcp_tools** sırasıyla; `_run_tool` mcp_tools'u da
    kontrol eder. MCP tool_call/tool_result event'leri **`kind:"mcp"`** taşır.
  - **Hata yönetimi (Faz 4 tutarlı):** `MCPTool.execute` bağlanma/çağrı/güvenlik
    hatalarını `"hata: ..."` string'ine çevirir → Claude'a tool_result olarak
    döner, stream/backend çökmez.
  - **SSRF guard:** `mcp-servers` `MCPServerCreate/Update/Response`
    (`api/v1/mcp_servers.py`). Create/update'te URL **hard** kontrol: http/https
    + hostname'in **public IP'ye** çözülmesi; private/loopback/link-local
    (169.254 metadata dahil)/reserved → **400**. DNS çözülemezse (typo/down) →
    `MCPError` (güvenlik değil) → server yine **oluşturulur**, `last_error`
    dolar. **KRİTİK:** aynı guard `client._session` içinde **her `call_tool`
    öncesi runtime'da da** koşar (defense in depth). Dev kaçış kapısı:
    `ALLOW_PRIVATE_MCP_URLS` env (default **False**; compose'da tanımlı).
  - Doğrulama (uçtan uca): local test MCP server (`backend/testing_mcp_server.py`,
    FastMCP, `add`+`shout`) `ALLOW_PRIVATE_MCP_URLS=true` ile — server ekle →
    tool keşfi (`mcp_2_add`/`mcp_2_shout` cache'lendi) ✅; agent'a `mcp_2_add`
    verip "137+246" sor → **kind=mcp** tool_call → canlı sonuç **383** ✅;
    private IP (127.0.0.1/192.168/169.254) create → **400** ✅; yanlış public
    host → 201 + last_error ✅; geçersiz MCP tool ismi → 400 ✅; refresh ✅;
    **runtime guard:** flag=false iken chat'te call_tool → tool_result
    "hata: MCP güvenlik reddi …" (backend çökmedi) ✅.
  - **Frontend:** `lib/api.ts` — `MCPServer`/`MCPToolSpec`/`MCPServerInput` tipleri
    + CRUD (`listMcpServers`/`create`/`update`/`delete`/`refreshMcpServer`) +
    `mcpToolGroups(servers)` yardımcısı (cached_tools + tool_names'ten agent
    formu için server-bazlı tool grupları üretir).
  - `/mcp-servers` sayfası: kart listesi (isim, URL, transport, **durum rozeti**:
    last_error→kırmızı / cached_tools→yeşil "N tool" / hiç sync olmadı→gri),
    açılır ekleme formu (isim/URL/transport dropdown/açıklama), kart başına
    **Yenile** (refresh) + **Sil** (onay modalı). SSRF 400'ü net gösterir
    ("Bu URL güvenlik nedeniyle reddedildi: …"). Ana sayfaya "MCP Server'ları
    Yönet" linki.
  - `AgentForm`: statik **Araçlar** listesinin ALTINA, her MCP server için
    **cyan tonlu gruplu checkbox listesi** ("🔌 {server} — MCP Araçları"),
    kullanıcıya sade tool adı (backend'e `mcp_{id}_{tool}`). cached_tools boşsa
    "MCP Server sayfasından yenileyin" uyarısı. Araçlar/MCP/alt-agent bölümleri
    görsel olarak ayrı.
  - `DebugPanel`: `kind==="mcp"` kartları **🔌 + cyan + "MCP" rozeti** (statik
    tool [emerald] ve sub_agent [indigo]'dan ayrık). `DebugCall.kind`'a `"mcp"`
    eklendi; `buildTrace` `kind`'ı korur.
  - Doğrulama: `tsc --noEmit` temiz; tüm sayfalar derlendi (200); "Local Test"
    server 2 tool'ları (add/shout) yeşil, "Yanlış URL" server 1 kırmızı ✅;
    agent 12 formu `mcp_2_add` seçili gösterir ✅; canlı chat stream'i
    buildTrace'e verildi → **🔌 MCP kartı** (`mcp_2_add`→100) doğru üretildi ✅;
    SSRF create reddi backend'de doğrulanmış, UI detayı yüzeye çıkarır ✅.

- **Sağlamlaştırma Turu (Denetim Sonrası) — BACKEND** ✅
  - **Calculator DoS:** `**` (üs) için taban/üs **1000 sınırı** (`_guarded_pow`);
    `9**9**9`/`2**5000` → "hata: sayı çok büyük". `execute` artık `safe_eval`'i
    `asyncio.to_thread` ile sarar (event-loop'u bloklamaz).
  - **Port bind:** compose'da backend/frontend `127.0.0.1:8000/3000` (LAN kapalı,
    yalnız localhost).
  - **Paylaşılan API key auth:** `APP_API_KEY` (config + `.env`/compose env).
    `core/auth.py → require_api_key` her `/api/v1/*` route'una `dependencies` ile
    uygulanır (health **public**). `X-API-Key` eşleşmezse **401**. Key boşsa
    backend **başlamaz** (`main.lifespan` startup guard).
  - **Rate limit:** `slowapi` — `/chat/*/stream` ve `/workflows/*/stream`'e
    **20/dakika/IP** (`core/ratelimit.py → limiter`, endpoint'lerde `@limiter.limit`
    + `request: Request`). Aşılınca **429**.
  - **Maliyet:** `MAX_SUB_AGENT_CALLS` 8→**4** (worst-case ~54 → **~30** LLM çağrısı).
  - **Veri bütünlüğü:** `database.py`'a SQLite **`PRAGMA foreign_keys=ON`** connect
    listener'ı. Mevcut orphan (agent 5 → silinmiş KB) NULL'landı; `foreign_key_check`
    temiz. KB silme ve MCP-server silme'ye **409 guard** (agent referansı varsa
    engelle) — agent-silme desenine simetrik.
  - **Hata sızıntısı:** `chat.py` (generic LLM hatası) ve `knowledge_bases.py`
    (upload 500) artık kullanıcıya **jenerik mesaj**, detayı `logging` ile
    backend log'una yazar.
  - Doğrulama (curl): key'siz → 401, key'li → 200, yanlış key → 401, health
    public → 200 ✅; 25 istek → 20×404 sonra **5×429** ✅; `9**9**9` reddedildi,
    `2**10`/`347*29` çalışıyor ✅; MCP server 2 sil → 409, KB (agent'lı) sil →
    409, agent kaldırılınca KB sil → 204 ✅; `MAX_SUB_AGENT_CALLS=4` ✅.
  - **Frontend auth (bu turda tamamlandı):** `lib/api.ts` tüm fetch'lere
    `withApiKey` ile `X-API-Key` ekler (`apiFetch`/`streamChat`/`streamWorkflow`/
    `uploadDocument`); key `NEXT_PUBLIC_APP_API_KEY` (compose'da `${APP_API_KEY}`).
    Key eksik/yanlış (401) → `components/ConfigBanner.tsx` "yapılandırma eksik"
    banner'ı + konsol uyarısı (401 sinyali `onAuthFailure` ile). Doğrulama:
    `down && up --build` sonrası UI 401 almadan çalışır; key bozulunca banner çıkar.

## Şu An Yapılan

> **Aktif faz:** Yok — **Opt-in debug trace kaydetme tamamen bitti**
> (BACKEND + FRONTEND). `Conversation.trace` (nullable JSON) + `PUT /conversations/
> {id}/trace` (~1 MB→413, yok→404, geçersiz JSON→400, boş→null); `Chat.tsx` +
> workflow run sayfasında "kaydet" butonu (client'ın RAM'indeki event'leri POST);
> `/conversations/[id]` replay render (chat→`DebugPanel`, workflow→paylaşılan
> `lib/workflowTrace.ts` indirgeyici + `WorkflowStagesView` yan-yana) + "kayıt yok"
> empty state; `trace_saved` liste rozetleri. Uçtan uca doğrulandı (chat conv 24,
> workflow conv 25).
>
> **Faz 7C (Parallel multi-agent) tamamen bitti**
> (BACKEND + FRONTEND). Gruplu `steps` modeli (`WorkflowStep.branch_order`),
> `asyncio.Queue` tabanlı eşzamanlı dal runner, etiketli merge, `branch_index`/
> `step_merged` event'leri, `MAX_PARALLEL_BRANCHES=5` cap; frontend'de gruplu
> `WorkflowForm` (adıma 2+ agent = otomatik paralel), `/workflows/[id]/run`
> paralel dalları **yan yana** + per-dal `StepTrace`. Uçtan uca doğrulandı
> (demo workflow id 2).
>
> Diğer olası adımlar: mobil sidebar (hamburger), gerçek kullanıcı-bazlı auth
> (login/JWT), koşullu/dallanan orkestrasyon, Alembic. (Auth ✅, rate-limit ✅,
> FK ✅, calc DoS ✅, konuşma yönetimi ✅, **workflow run geçmişi ✅**, Faz 9 UI/UX ✅,
> 7A ✅, 7B ✅, **7C ✅ (backend+frontend)**, MCP 8 ✅, opt-in trace ✅,
> **weather tool ✅**, **web_search (Tavily) tool ✅**.)
>
> **Not (auth):** `.env`'de `APP_API_KEY` set olmalı (yoksa backend başlamaz);
> curl testlerinde `-H "X-API-Key: <key>"`. Frontend key'i compose'dan otomatik
> alır (`NEXT_PUBLIC_APP_API_KEY=${APP_API_KEY}`). **Not (MCP test):**
> `ALLOW_PRIVATE_MCP_URLS=true docker compose up -d backend` +
> `docker compose exec -d backend python testing_mcp_server.py`; prod'da flag **false**.

_(Bir göreve başlarken bu bölümü güncel duruma göre değiştir.)_

## Demo / Test Verisi (DB'de kasıtlı bırakılan)

> DB'deki kayıtlar test/demo amaçlıdır — `agent_db` named volume'de kalıcı.
> **Temizlik turu yapıldı** (Persist Test Agent, MCP Agent ve "Yanlis URL" MCP
> server + konuşmaları silindi). Kalan kayıtlar **bilinçli** olarak bırakıldı;
> "bu neden DB'de?" diye sorulmasın diye:
>
> - **Supervisor demo:** `Koordinator` (11, `sub_agent_ids=[9,10]`) +
>   `Hesap Uzmani` (9, calculator) + `Bilgi Uzmani` (10, wikipedia). Faz 7B'yi
>   canlı denemek için.
> - **Sequential demo:** `Ozetle ve Cevir` workflow (1 → `Özetleyici` 7 →
>   `İngilizce Çevirmen` 8). Faz 7A demosu.
> - **Parallel demo (7C):** `Paralel Arastirma (7C demo)` workflow (id 2) —
>   1. adım PARALEL `[Bilgi Uzmani 10 ∥ Ansiklopedi 3]`, 2. adım sequential
>   `Özetleyici 7`. Run sayfasında yan-yana dal görünümünü canlı denemek için.
> - **MCP demo:** `Local Test Server` (id 2, `mcp_2_add`/`mcp_2_shout`). Faz 8
>   demosu; canlı çağrı için `ALLOW_PRIVATE_MCP_URLS=true` + `testing_mcp_server.py`.
> - **Kayıtlı trace demoları (opt-in debug trace):** conversation **24** (chat —
>   Hesap Uzmanı calculator, `347*29`→10063 trace'i) ve **25** (workflow 2 paralel
>   run'ının trace'i). `/conversations/24` ve `/conversations/25` replay'i canlı
>   görmek için; ikisi de `📋 kayıtlı` rozetli.
> - **Hava durumu demo:** `Hava Durumu Asistani` (13, yalnız `weather` tool'u).
>   Open-Meteo `weather` tool'unu denemek için ("Barcelona'da hava kaç derece?").
> - **Web araması demo:** `Web Arastirmacisi` (14, yalnız `web_search` tool'u).
>   Tavily `web_search`'ü denemek için (güncel bilgi/haber sorusu).
> - **Faz 2-4 zararsız artıkları (dokunulmadı):** `Hesap Makinesi` (2),
>   `Ansiklopedi` (3), `Araçsız` (4), `İK Asistanı` (5, `document_search` ama
>   `kb=None` — bağlı KB'si silinmişti, orphan referans FK turunda NULL'landı),
>   `Çok Araçlı` (6).
>
> Tümüyle sıfırlamak istenirse: `docker compose down -v` (named volume'ü de siler,
> DB baştan boş kurulur).

## Kararlar / Kısıtlar

- **Auth: paylaşılan `APP_API_KEY` + `X-API-Key` header.** Tüm `/api/v1/*`
  route'ları `main.py`'de `dependencies=[Depends(require_api_key)]` ile korunur
  (health public). Key `.env` → compose env → `settings.APP_API_KEY`. Boşsa
  `lifespan` startup guard'ı **başlatmayı reddeder** (sessiz auth-suz çalışma yok).
  Per-user değil, tek paylaşılan sır (local/küçük ekip için). Frontend key'i
  `lib/api.ts`'te tüm fetch'lere ekler (`withApiKey`); değeri
  `NEXT_PUBLIC_APP_API_KEY` (compose'da `${APP_API_KEY}` ile .env'den tek kaynak).
- **⚠️ KISIT — `NEXT_PUBLIC_` API key tarayıcı bundle'ında GÖRÜNÜR.** Frontend'in
  gönderdiği key client JS'e gömülüdür; bu **LAN/port-tarama** saldırılarına karşı
  koruma sağlar (portlar zaten 127.0.0.1'e bağlı) ama **UI'a erişimi olan
  kullanıcıya karşı KORUMAZ**. Çok-kullanıcılı / güvenilmeyen ortama geçilirse
  gerçek **kullanıcı-bazlı auth (login/JWT)** gerekir. Key eksik/yanlışsa
  `ConfigBanner` (401 sinyali veya `API_KEY_MISSING`) uyarı banner'ı gösterir;
  sessiz 401 yok.
- **Rate-limit: `slowapi`, `core/ratelimit.py`'daki tek `limiter`.** Maliyet-üreten
  stream endpoint'lerinde (`/chat/*/stream`, `/workflows/*/stream`)
  `@limiter.limit("20/dakika")` + `request: Request` parametresi. `main.py`'de
  `app.state.limiter` + 429 handler. Yeni maliyetli endpoint eklerken aynı desen.
- **Maliyet sınırları (çarpım):** worst-case LLM çağrısı = kök(`MAX_TOOL_ITERATIONS`=6)
  + `MAX_SUB_AGENT_CALLS`×6. `MAX_SUB_AGENT_CALLS`=**4** → ~30. Değiştirirken
  çarpımı gözet.
- **SQLite FK zorlaması AÇIK.** `database.py`'da `@event.listens_for(engine,
  "connect")` ile her bağlantıda `PRAGMA foreign_keys=ON` (SQLite varsayılanı
  KAPALI). Böylece `ondelete` kuralları çalışır, orphan birikmez. **Silme guard'ları
  simetrik:** agent (konuşma/workflow-step/sub-agent), **KB** (kullanan agent →
  409), **MCP server** (tool'unu kullanan agent → 409). Yeni FK ilişkisi eklerken
  ilgili silme guard'ını da ekle.
- **Şablonlar (Faz 9.4): statik, kod-içi liste (DB tablosu YOK).** `services/
  templates.py`'de `AGENT_TEMPLATES` (4: Genel Asistan/Hesap Uzmanı/Araştırmacı/
  Doküman Asistanı) + `WORKFLOW_TEMPLATES` (2: Özetle-Çevir, Araştır-Raporla).
  **Gerekçe:** read-only başlangıç noktaları; per-user authoring/versiyonlama/
  persistence ihtiyacı yok → DB fazlalık. İleride gerekirse endpoint şeklini
  bozmadan tabloya taşınabilir. `GET /templates/agents` ve `/templates/workflows`
  (auth'lu) döndürür. `model_params` demo ile aynı (openrouter + Haiku 4.5) ki
  şablon bu deployment'ta doğrudan çalışsın; kullanıcı formda değiştirebilir.
  **Frontend:** `AgentForm`/`WorkflowForm`'da "Şablondan Başla" (yalnız create'te)
  — agent şablonu formu **prefill** eder; workflow şablonu **gerekli agent'ları
  isimle kontrol edip eksikleri otomatik oluşturur** (`applyTemplate`: createAgent
  loop → createWorkflow'a giden adım id'lerini doldurur), kullanıcıya "N yeni
  agent oluşturacak" uyarısı gösterir. "Sıfırdan Oluştur" boş form verir.
- **Konuşma yönetimi (`api/v1/conversations.py`).** `GET /conversations`
  (opsiyonel `?agent_id`/`?workflow_id` filtresi; her kayıt için message_count +
  son mesaj önizlemesi [ilk 100 char] + agent_name), `GET /conversations/{id}`
  (mesajlar sırayla; assistant mesajları workflow/supervisor'da agent_name/
  step_order taşır), `DELETE /conversations/{id}` (mesajlar cascade). **Amaç:**
  agent/workflow silmede 409 alan kullanıcının konuşmaları UI'dan temizlemesi;
  agent/workflow **silme guard'ları değişmedi**. Frontend: `/conversations`
  (liste+sil), `/conversations/[id]` (salt-okunur balonlar); agents silme
  modalındaki 409, `konuşma` içeriyorsa `/conversations?agent_id=` linki gösterir.
- **Workflow "Geçmiş Çalıştırmalar" (run history).** Her workflow'un detay/
  düzenleme sayfası (`/workflows/[id]`) formun altında o workflow'a ait
  conversation'ları (`GET /conversations?workflow_id=`) listeler: tarih, **girdi**
  önizlemesi (`input_preview` = ilk `user` mesajı), **çıktı** önizlemesi (`preview`
  = son mesaj), **durum rozeti** (✓ tamamlandı / ✗ hata) + "Detayları Gör"
  (`/conversations/[id]`). Boşsa `EmptyState`, yüklenirken `LoadingSpinner`, hata
  `ErrorBanner onRetry`. `ConversationListItem`'a `input_preview` + `status`
  eklendi (yeni endpoint yok — mevcut filtre kullanıldı). **⚠️ Kapsam kısıtı:
  geçmiş run'larda DEBUG TRACE YOK** (tool_call/tool_result saklanmaz) — yalnızca
  final input/output metinleri; conversation/message modeli genişletilmedi.
  **`status` basit heuristic:** son mesaj `"hata:"` ile başlıyorsa `failed`, değilse
  `completed`. Bilinçli sınır: sequential adım hatası hiç mesaj persist etmediği
  için (pipe break) yakalanmayabilir; paralel dal hatası `"hata:"` persist eder.
- **Opt-in debug trace kaydetme (`Conversation.trace` nullable JSON).** Her
  mesajın trace'i **otomatik saklanmaz**; kullanıcı bir sohbeti/run'ı "kaydet"
  deyince o **konuşmanın tamamının** ham event akışı saklanır. **Kaynak =
  client'ın RAM'i** (backend stream'i akıtıp unutur, replay buffer tutmaz):
  `PUT /conversations/{id}/trace` gövdesi client'ın biriktirdiği event'lerdir;
  backend **hiçbir şey buffer'lamaz**. Bu yüzden kayıt **yalnız sohbet/run
  ekranındayken** (event'ler hâlâ RAM'de) yapılabilir — ekrandan ayrılınca
  geriye dönük kurtarma **yok** (yeniden çalıştırıp kaydedilir; bilinçli sınır).
  Saklanan şekil discriminated: `{"type":"chat","turns":[...]}` (tekil agent +
  supervisor; nested event'ler) veya `{"type":"workflow","events":[...]}`
  (sequential + parallel düz akış). Endpoint ham gövdeyi okur: **~1 MB üstü →
  413** (önce `Content-Length`, sonra gerçek byte), geçersiz JSON → 400, yok →
  404, boş gövde → `trace=null` (temizleme). `ConversationDetail.trace` (replay
  render için) + `ConversationListItem.trace_saved` (liste rozeti) döner.
  **Model gerekçesi:** konuşma-seviyesi tek JSON blob — `Message.trace` (per-
  mesaj) trace'i parçalar ve nested/branch'li yapıya kötü oturur; `trace_saved`
  bool tek başına veriyi tutamaz.
  **Frontend:** `lib/api.ts → saveConversationTrace(id, trace)` (`SavedTrace`
  union). `Chat.tsx`: `DebugPanel`'in `action` slot'unda "📋 Bu sohbeti kaydet"
  butonu (görünürlük: `conversationId` dolu + tamamlanmış turn var + `!streaming`);
  tık → `debugTurns`'ü `{type:"chat",turns}` PUT eder, başarıda `Toast` + "Kayıtlı
  ✓"; yeni turn/agent değişimi `savedTrace`'i sıfırlar. Workflow run sayfası:
  `workflow_done.conversation_id` + tüm event'leri düz `allEvents`'te biriktirir,
  bitince "kaydet" → `{type:"workflow",events}`. **Replay mimarisi:**
  `/conversations/[id]` `trace` gelirse "Detaylı İşlem Kaydı" bölümü —
  `type==="chat"` → mevcut `DebugPanel turns`; `type==="workflow"` → paylaşılan
  **`lib/workflowTrace.ts`** (`applyWorkflowEvent`/`buildStagesFromEvents` — run
  page'in event→`StageRun` indirgeyicisi buraya çıkarıldı; hem canlı run hem
  replay kullanır) + **`components/WorkflowStagesView`** (yan-yana dal görünümü,
  run page'den ortaklaştırıldı; `running` prop'u canlı/replay ayrımı). `trace`
  yoksa sade empty state. `📋 kayıtlı` rozeti `/conversations` + workflow "Geçmiş
  Çalıştırmalar"da (`ConversationListItem.trace_saved`).
- **Calculator kaynak-DoS guard'ı:** `**` için taban/üs **1000** üst sınırı
  (`_guarded_pow`); `execute` senkron `safe_eval`'i `asyncio.to_thread`'e atar
  (event-loop bloklanmaz). (ast whitelist RCE'ye karşı zaten sağlam.)
- **Hata mesajları:** kullanıcıya **jenerik** mesaj, detay `logging` ile backend
  log'una. Kullanıcıya `str(exc)`/`{exc}` sızdırma (LLMConfigError gibi
  user-actionable, iç-detay içermeyenler hariç).
- **LLM erişimi Anthropic SDK üzerinden.** İki anahtar seçeneği:
  `ANTHROPIC_API_KEY` (doğrudan) veya `OPENROUTER_API_KEY` (OpenRouter'ın
  Anthropic-uyumlu endpoint'i). OpenAI/Cohere gibi Anthropic-uyumsuz
  sağlayıcılara SDK bağımlılığı ekleme; embedding API key'i yok.
- **Varsayılan model:** `claude-haiku-4-5-20251001`.
- **Ücretsiz / açık kaynak araçlar tercih edilir.** Ücretli servis veya SaaS
  bağımlılığı eklemeden önce açık kaynak bir alternatif değerlendir.
- Veritabanı SQLite. Migration aracı yok; şema `create_all` +
  `main._ensure_schema()` (mevcut tabloya idempotent `ALTER TABLE`) ile
  yönetilir. **Yeni kolon eklerken** modele ekle + `_ensure_schema`'ya guard'lı
  bir ALTER ekle (`create_all` var olan tabloyu değiştirmez). **DB dosyası
  named volume `agent_db`'de** (`/data/app.db`, mutlak yol → `sqlite:////data/app.db`),
  container'dan bağımsız olarak kalıcı. Bind-mount (`./backend:/app`) yalnızca
  hot-reload için; DB oraya yazılmaz.
- **Agent silme, konuşması varsa engellenir (409).** Veri kaybı ancak konuşmalar
  önce kaldırılırsa mümkün; sessiz cascade yok. (İleride conversation yönetim
  endpoint'leri gelince gözden geçirilebilir.)
- **Tool'lar `app/services/tools/` altında, ortak `Tool` arayüzüyle.** Her tool
  ayrı dosyada; `registry.py` isimden instance'a eşler. Yeni tool eklerken:
  dosyayı yaz, `registry._TOOL_INSTANCES`'a ekle, frontend `AVAILABLE_TOOLS`
  kataloğuna (`lib/api.ts`) aynı `name` ile ekle. Tool `execute` **asla
  beklenen hatada exception fırlatmaz**, `"hata: ..."` string döner; `_run_tool`
  ikinci güvenlik ağı olarak beklenmeyen exception'ları da yakalar. Böylece tool
  hatası Claude'a tool_result olarak döner, stream/backend çökmez.
- **Calculator `eval` kullanmaz.** `ast.parse(mode="eval")` + whitelist'li node
  yürütücü (operatör/fonksiyon/sabit); `__import__`, isim erişimi, bilinmeyen
  çağrı reddedilir. Keyfi kod yürütmeye yol yok.
- **Wikipedia/DuckDuckGo API key gerektirmez** (ücretsiz, açık). Wikipedia için
  Wikimedia politikası gereği **descriptive `User-Agent` başlığı zorunlu**;
  generic client string (python-httpx) 403 alır.
- **`weather` tool'u — Open-Meteo, API KEY GEREKTİRMEZ** (tamamen ücretsiz).
  `services/tools/weather.py`. **İki adımlı akış:** önce geocoding
  (`geocoding-api.open-meteo.com/v1/search?name=&language=tr`) ile şehir adından
  lat/lon, sonra forecast (`api.open-meteo.com/v1/forecast?...&current=
  temperature_2m,weather_code`) ile güncel durum. WMO `weather_code` küçük bir
  sabit sözlükle Türkçe metne çevrilir ("açık"/"yağmurlu" vb.). 10 sn timeout,
  `httpx` async. Hata deseni Faz 4'e uygun: konum yoksa `"hata: konum
  bulunamadı"`, boş girdi `"hata: boş konum"`, ağ hatası `"hata: hava durumu
  servisine ulaşılamadı (...)"` → Claude'a tool_result olarak döner, backend
  çökmez. `input_schema` yalnız `{location: string}`.
- **`web_search` tool'u — Tavily, API KEY GEREKTİRİR (`TAVILY_API_KEY`).**
  `services/tools/web_search.py`. Gerçek zamanlı web araması (`api.tavily.com/
  search`, POST, gövdede `api_key`); ilk 5 sonucu başlık + özet (≤300 char) +
  kaynak URL olarak metne çevirir. `input_schema` yalnız `{query: string}`,
  10 sn timeout, `httpx` async. **⚠️ Ücretsiz tier ~1000 arama/ay** — çağrılar
  sınırsız değil (kotayı aşınca Tavily hata döner → `"hata: web aramasına
  ulaşılamadı (...)"`). **Key opsiyonel** (weather'dan farklı olarak key ister
  ama LLM key'lerinden farklı olarak **backend başlangıcını engellemez**):
  `config.TAVILY_API_KEY` boşsa tool `"hata: TAVILY_API_KEY ayarlanmamış …"`
  döner (LLMConfigError deseniyle tutarlı ama string; raise etmez). Compose'da
  `TAVILY_API_KEY=${TAVILY_API_KEY:-}` ile container'a geçer (backend
  `environment:` listesi açık olduğu için yeni env eklerken oraya da ekle).
  Not: Tavily neredeyse her sorguya sonuç bulur; `"sonuç bulunamadı"` yolu var
  ama pratikte nadiren tetiklenir.
- **`allowed_tools` (agent başına araç izni).** JSON liste; boşsa Claude'a
  `tools` geçilmez (araçsız davranış). Create/Update'te `_validate_tools` ile
  bilinmeyen isim → 400. Kolon `_ensure_schema` ile idempotent eklenir.
- **Tool-use döngüsü `llm_client.stream_completion` içinde.** `stop_reason ==
  "tool_use"` → tool çalıştır → `tool_result` turn'ü ekle → tekrar Claude'a; 
  `MAX_TOOL_ITERATIONS` (6) sonsuz döngüyü engeller. Generator **event dict**
  yield eder (string değil); `chat.py` bunları SSE'ye forward eder, text'i
  yalnız `token` event'lerinden biriktirir.
- **RAG embedding'leri yerel, açık kaynak (`sentence-transformers`,
  `all-MiniLM-L6-v2`).** Embedding API key'i YOK (proje kısıtı). Model
  **lazy-load + cache** (`embedding._get_model`); ilk kullanımda ~90 MB iner.
  İndirme `HF_HOME=/data/hf`'e (named volume) yazılır → rebuild'de yeniden
  inmez. torch bağımlılığı büyük ama beklenen.
- **Vektör store: ChromaDB `PersistentClient`, `settings.CHROMA_DIR`
  (`/data/chroma`, named volume → kalıcı).** KB başına ayrı collection
  (`kb_{id}`). Embedding'leri **biz** hesaplayıp Chroma'ya açıkça veriyoruz
  (add'de `embeddings=`, query'de `query_embeddings=`); bir guard Embedding
  Function da bağlı, böylece Chroma **default ONNX modelini indirmez**. KB
  silinince `vector_store.delete_collection` ile collection da düşer.
  Chroma 0.5.x telemetry log gürültüsü `chromadb.telemetry` logger'ı
  CRITICAL'e çekilerek susturulur (gönderim zaten no-op).
- **`document_search` tool'u `context` ile KB'ye bağlanır.** Diğer tool'lardan
  farklı: `knowledge_base_id` model-görünür `input_schema`'da DEĞİL, agent
  config'inden `context` üzerinden gelir. `Tool.execute(tool_input, context=None)`
  imzası bunun için var. KB yoksa `llm_client` tool'u Claude'a hiç sunmaz;
  create/update'te `_validate_knowledge_base` ile document_search ↔ KB eşleşmesi
  **400** ile zorlanır. Bloklayıcı embedding/Chroma çağrıları `asyncio.to_thread`
  ile event loop dışında koşar.
- **Doküman yükleme sınırları:** `.txt` ve `.pdf` (pypdf), **10 MB** üst sınır
  (`MAX_UPLOAD_BYTES`), aşımda 413; desteklenmeyen format 400; metin çıkmayan/
  boş dosya 400. Chunk id'leri `doc{document_id}_chunk{i}` ile namespace'lenir.
- **Sequential orkestrasyon `services/orchestration/sequential.py`'da.** Saf
  **pipe**: önceki agent'ın final metni sonraki agent'ın user mesajı olur
  (wrapper/template yok — "task" agent'ın system_prompt'unda yaşar). Her agent
  taze tek turlu bağlamda kendi config'iyle `stream_completion`'ı yeniden kullanır.
  **`llm_client` orkestrasyondan habersiz kalır**; event decoration (agent_id/
  agent_name/step_order) orkestratörde `{**event, ...}` ile yapılır (yeni event
  tipi eklerken llm_client'a dokunmaya gerek yok). Bir adım hatası kalan adımları
  atlar ama `workflow_done` yine yayınlanır (backend çökmez).
- **Workflow run persistence: run başına tek `Conversation`.** `workflow_id`
  set edilir; `agent_id` (NOT NULL) **ilk adımın agent'ı** ile doldurulur (rebuild
  yok). Mesajlar tek transkriptte; assistant mesajları `Message.agent_id`+
  `step_order` ile etiketlenir. Run'da continuation yok (her run yeni conversation).
- **Agent silme, bir workflow adımında kullanılıyorsa 409.** Konuşma 409'una ek
  koruma; sessiz workflow bozulması engellenir. (`WorkflowStep.agent_id` sayımı.)
- **`WorkflowStep` surrogate id PK (composite değil).** Aynı agent bir workflow'da
  birden çok adımda geçebilsin diye; adımlar `step_order` (aşama) + `branch_order`
  (aşama-içi dal) ile sıralanır.
- **Parallel orkestrasyon (7C): aşama = `step_order` grubu.** **Aynı `step_order`'a
  sahip birden çok `WorkflowStep` satırı = o aşamanın paralel dalları**
  (`branch_order` sıralar); tek satır = sequential adım (7A). `agent_id` FK
  **korundu** (agent-silme guard'ı çalışsın diye) — JSON `agent_ids` alternatifi
  FK'yı kıracağı için reddedildi. `run_workflow` `stages: list[list[dict]]` alır;
  tek dallı aşama 7A yolundan gider (event'ler additif `branch_index:0`/
  `parallel:false` dışında **birebir aynı** → sequential regresyon yok). N dallı
  aşama **`asyncio.Queue` üretici/tüketici**: dal başına bir `asyncio` task
  event'lerini kuyruğa iter, **tek tüketici** kuyruğu boşaltıp SSE'ye canlı
  forward eder (her event tam dict, tek yield → dallar karışmadan multiplex olur).
  **Merge = saf pipe:** dal çıktıları `[AgentAdı]\n<çıktı>` etiketiyle branch
  sırasında concatenate → sonraki aşamanın girdisi (ekstra LLM yok). **Dallar
  bağımsız:** biri hata verse (`"hata: ..."` metni merge'e girer) diğerleri durmaz
  (7A'da tek dallı adım hatası hâlâ pipe'ı kırar). DB yazımı tüketicide sıralı
  (SQLite tek-yazar çekişmesi yok). **`MAX_PARALLEL_BRANCHES`=5** cap (schema 422).
  Yeni event'ler: `step_start.parallel`/`.branches`, iç event'lerde `branch_index`,
  per-dal `step_complete.failed`, `step_merged` (yalnız paralel).
- **7C API şekli: gruplu `steps: list[list[int]]`** (grup=aşama, grup-içi=paralel
  dal). `agent_ids: list[int]` **legacy alias** (model_validator singleton grup'a
  çevirir) → eski çağrılar/şablon apply kırılmaz. `WorkflowResponse.steps` gruplu:
  `[{step_order, parallel, agents:[{agent_id, agent_name}]}]`. Snapshot/response
  `_group_steps` ile gruplanır; `_validate_agents` düzleştirip doğrular.
- **Supervisor deseni (7B): `Agent.sub_agent_ids` JSON liste** (junction değil —
  `allowed_tools` gibi sırasız yetenek listesi). Alt agent'lar statik registry'ye
  eklenmez; request-başına synthetic tool spec (`call_agent_{id}`) üretilir ve
  `stream_completion` içinde dispatch dallanır (gerçek tool `_run_tool` [str] ↔
  alt agent `_run_sub_agent` [özyinelemeli stream]). Tool base `execute→str`
  stream edemediği için alt agent Tool sınıfı DEĞİL.
- **Özyineleme garantisi = runtime `visited` kümesi** (ata-zinciri synthetic
  spec'lerden hariç). Ek koruma: `MAX_AGENT_DEPTH`=3 (bu derinlikte alt agent
  sunulmaz) + config-time self-reference 400. **`MAX_SUB_AGENT_CALLS`=8** tüm
  request'te paylaşılan `_CallBudget` ile maliyet freni. **Kritik:** çoklu
  tool_use'da her dal `visited`'i **kopyalar** (`| {sid}` yeni frozenset),
  `budget` **paylaşılır** (aynı obje).
- **Supervisor için yeni endpoint yok:** `POST /chat/{agent_id}/stream` kullanılır;
  `chat.py` `sub_agent_ids` grafiğini BFS ile snapshot'lar, `make_root_context`
  ile `sub_ctx` kurup `stream_completion`'a geçer. Yalnız kök (depth 0) metni
  Message olarak saklanır. Non-supervisor agent'ta `sub_ctx=None` → pre-7B davranış.
- **MCP (Faz 8) yalnız remote (HTTP/SSE); stdio/local YOK** (bilinçli kapsam:
  küçük image + saldırı yüzeyi). MCP tool'ları `Tool` base'ine uyar (call_tool
  **string** döner) ama **statik registry'ye eklenmez** — request başına dinamik
  keşfedilir/örneklenir. İsimler **`mcp_{server_id}_{tool}`** ile namespace'lenir
  (server-arası çakışma + registry/`call_agent_` ile çakışma yok). Tool listesi
  `MCPServer.cached_tools`'ta cache'lenir (chat'te canlı `list_tools` yok; yalnız
  `call_tool` ağ vurur). `_validate_tools` MCP isimlerini cache'e karşı doğrular.
  `chat.py` `mcp_tools` map'ini kurup `stream_completion`'a geçer; dispatch sırası
  sub_agent → registry → mcp_tools. Event'lerde `kind:"mcp"`. Hatalar Faz 4
  "hata:" desenine uyar.
- **⚠️ MCP SSRF guard (`services/mcp/security.py`).** Kullanıcı URL'si →
  `validate_public_url`: yalnız http/https + hostname'in **public IP'ye** çözülmesi
  (private/loopback/link-local [169.254 metadata]/reserved → reddet). **Create/
  update'te hard 400 VE her `call_tool` öncesi runtime'da** çalışır (defense in
  depth; `client._session` içinde). DNS çözülemezse güvenlik değil `MCPError` →
  server oluşturulur, `last_error` dolar. Dev kaçışı `ALLOW_PRIVATE_MCP_URLS`
  (default False, compose env). **Sınır:** DNS rebinding/redirect'e karşı
  bulletproof değil (baseline); production'da ek egress kontrolü gerekir.
  (`backend/testing_mcp_server.py` = throwaway FastMCP test server; app'in parçası
  değil.)
- **Agent `model_params.provider`, global `LLM_PROVIDER`'ı override eder.**
  Create/Update'te `_validate_provider_key` ile seçilen provider'ın key'i
  kontrol edilir (yoksa 400).
- **LLM çağrıları `anthropic` SDK ile, `AsyncAnthropic` streaming.** Model
  agent'ın `model_params` JSON'ından override edilebilir (`model`, `max_tokens`,
  `temperature`, `top_p`, `top_k` whitelist'i); bilinmeyen key'ler yok sayılır.
- **İki LLM sağlayıcı modu (`LLM_PROVIDER`).** `anthropic` (varsayılan) →
  `ANTHROPIC_API_KEY` ile doğrudan Anthropic API. `openrouter` → OpenRouter'ın
  Anthropic-uyumlu endpoint'i (`base_url=https://openrouter.ai/api`), auth
  `OPENROUTER_API_KEY` ile Bearer `auth_token` (api_key kullanılmaz). Client
  kurulumu `llm_client._build_client()` içinde. **Önemli:** OpenRouter modunda
  agent `model_params.model` bir OpenRouter slug'ı olmalı (ör. doğrulanmış:
  `anthropic/claude-haiku-4.5`); varsayılan Anthropic model ID'si
  (`claude-haiku-4-5-20251001`) OpenRouter'da 404 verir. Ayrıca openrouter
  modunda `_build_client` boş `ANTHROPIC_API_KEY` env'ini temizler, aksi halde
  SDK boş `X-Api-Key` başlığı üretip Bearer ile çakışır.

## Konvansiyonlar

- **API route'ları** `app/api/v1/` altında, her kaynak için ayrı dosya
  (`health.py`, `agents.py`). Sürümleme prefix'i `main.py`'de eklenir
  (`/api/v1`). Sağlık kontrolü sürümsüz kök `/health`'te.
- **Pydantic şemaları** `app/schemas/` altında; girdi (`*Create`/`*Update`) ve
  çıktı (`*Response`, `from_attributes=True`) ayrımı yapılır. `model_` ile
  başlayan alanlar için `ConfigDict(protected_namespaces=())`.
- **SQLAlchemy modelleri** `app/models/` altında, dosya başına bir model;
  `app/models/__init__.py` hepsini re-export eder.
- **DB erişimi** route'larda `Depends(get_db)` ile session enjekte edilerek
  yapılır.
- **Harici entegrasyonlar `app/services/` altında** (ör. `llm_client.py`);
  route'lar iş mantığını doğrudan SDK ile değil servis fonksiyonları üzerinden
  çağırır.
- **Streaming endpoint'lerinde DB session yönetimi:** `StreamingResponse`
  generator'ı endpoint döndükten sonra çalışır, bu yüzden `Depends(get_db)`
  session'ı sadece kurulum (setup) için kullanılır; generator içindeki geç
  yazımlar (ör. assistant mesajı) yeni bir `SessionLocal()` açar.
- **SSE event zarfı her zaman `type` + `timestamp` (ISO-8601) taşır**
  (genişletilebilir union); yeni event tipleri transport'u değiştirmeden eklenir.
  Tek-agent tipleri: `token`, `iteration_start`, `tool_call`, `tool_result`,
  `done`, `error`. Event'ler `llm_client.build_event(type, **fields)` ile
  kurulur (timestamp'i o ekler). `tool_call`/`tool_result` ortak `call_id`
  (uuid4) ile eşleşir; `tool_result` ayrıca `duration_ms` taşır.
  `stream_completion` event'leri **dict** olarak yield eder; `chat.py` doğrudan
  SSE'ye forward eder (yeni tip eklerken generator'a bir yield eklemek yeterli).
  **Workflow (7A) tipleri:** `workflow_start`, `step_start`, `step_complete`,
  `workflow_done`; ayrıca tüm iç event'ler workflow akışında `agent_id`/
  `agent_name`/`step_order` ile decorate edilir (orkestratörde, llm_client'a
  dokunmadan). **Parallel (7C) eklentileri:** `step_start` `parallel: bool` +
  (paralel) `branches: [{branch_index, agent_id, agent_name}]`; iç event'ler +
  per-dal `step_complete` `branch_index` taşır (sequential'da 0); per-dal
  `step_complete` `failed` bayrağı taşır; **`step_merged {step_order, output}`**
  (yalnız paralel aşama) sonraki aşamaya giden birleşik metni verir. Bu decoration
  da orkestratörde yapılır (llm_client'a dokunulmaz). **Supervisor (7B) decoration:** `sub_ctx` verildiğinde iç
  event'ler `depth`/`parent_call_id`/`agent_id`/`agent_name` taşır; `tool_call`/
  `tool_result` ayrıca `kind` (`"tool"`|`"sub_agent"`|`"mcp"`) ve sub_agent
  çağrısında `sub_agent_id`/`sub_agent_name` taşır. Bu decoration
  `stream_completion` içinde yapılır (7B döngü-içi olduğu için, 7A'dan farklı).
  MCP tool'ları (Faz 8) `kind:"mcp"` ile işaretlenir.
- **Frontend:** backend'e erişim daima `lib/api.ts` üzerinden; component'ler
  fetch'i doğrudan çağırmaz. Tailwind utility-class'ları kullanılır. SSE
  tüketimi `streamChat` (fetch + `ReadableStream`) ile; `EventSource` POST
  body desteklemediği için kullanılmaz.
- **Chat balonu vs Debug paneli ayrımı.** Chat balonunda yalnız model metni
  (`token`) gösterilir; araç mekaniği (`iteration_start`/`tool_call`/
  `tool_result`) `DebugPanel`'e taşınır. `Chat.tsx` event'lerden `debugTurns`
  state'i kurar (user turn başına bir kayıt), `call_id` ile call↔result
  eşleştirir. Panel toggle'lı (varsayılan açık).
- **SSE tüketimi tek yerde: `lib/api.ts` → `consumeSSE`.** Hem `streamChat` hem
  `streamWorkflow` bunu kullanır (fetch + ReadableStream, `data:` frame parse,
  hata gövdesindeki `detail`'i yüzeye çıkarır). Yeni bir stream endpoint'i
  eklerken kendi loop'unu yazma, `consumeSSE<EventTipi>` çağır.
- **Tool debug render'ı `DebugPanel`'in `StepTrace` export'unda.** İterasyon
  ("Tur N") + tool kart mantığı `StepTrace({iterations, emptyLabel, depth})` ile
  hem chat turn'ünde hem workflow adımında tekrar kullanılır. Workflow run
  görünümü (`/workflows/[id]/run`) event'leri **`(step_order, branch_index)`**'e
  göre `StageRun`/`BranchRun`'a toplar; her adım kendi başlığı + durum rozeti,
  **paralel adım dalları yan-yana grid**'de (her dal kendi çıktısı + `buildTrace`+
  `StepTrace`'iyle), `step_merged` "🔀 Birleşik çıktı" details'inde. `DebugPanel`
  kart türleri `kind` ile ayrışır: statik tool (emerald), `sub_agent` (indigo, 🤖),
  `mcp` (cyan, 🔌). **7C paralellik = run sayfasındaki yan-yana düzen** (7B'nin
  nested üst-alt kartlarından ayrı); `DebugPanel`/`StepTrace` 7C için değişmedi.
- **Ortak shell (Faz 9.1): `layout.tsx` → `Sidebar` + içerik alanı.** Sol sabit
  sidebar (`components/Sidebar.tsx`, `md:` üstünde görünür — mobil hamburger
  henüz yok) tüm sayfaları sarar; nav linkleri `usePathname` ile vurgulanır
  (`/` tam eşleşme `exact:true`, diğerleri prefix — `/agents/new` → Agent'lar
  aktif; `aria-current="page"`). Ana sayfa artık **dashboard** (istatistik
  kartları list endpoint'lerinden `Promise.allSettled` ile sayılır — yeni
  endpoint yok — + Hızlı Sohbet + health).
- **Sayfa başlığı konvansiyonu: `components/PageHeader.tsx`.** Her liste sayfası
  `<PageHeader title description action={...} />` kullanır (başlık + kısa açıklama
  solda, ana eylem butonu — "+ Yeni …" — sağda). Sayfa-içi "← Ana sayfa" geri
  linkleri kaldırıldı (sidebar hallediyor); alt sayfalar (new/[id]/run) ise
  ebeveyn listeye "← …" breadcrumb linkini korur. İçerik `<main class="mx-auto
  max-w-3xl px-6 py-10">` ile ortalanır.
- **Loading/hata/boş durum ortak bileşenleri (Faz 9.2).** Ad-hoc `<p>Yükleniyor…</p>`
  / kırmızı `<p>` yerine: **`LoadingSpinner`** (`size`: `sm` buton-içi / `md`
  bölüm / `lg` sayfa), **`ErrorBanner`** (`message` + opsiyonel `onRetry`/`retrying`
  → "Tekrar Dene"), **`EmptyState`** (`icon`/`title`/`description` + opsiyonel
  `action`, "İlk …'i Oluştur"). Kullanım deseni: liste sayfaları `load()`'ı
  `ErrorBanner onRetry` ile yeniden çağırır; boş liste → `EmptyState`; buton-içi
  işlemler (Gönder/Çalıştır/Ekle/Yenile/Siliniyor) `LoadingSpinner size="sm"`.
  **Silme akışı:** her sayfada ayrı `deleteError` state → hata modal içinde
  `ErrorBanner` ile gösterilir (sessiz başarısızlık yok); buton "Siliniyor…"
  durumuna geçer. (Agents silme modalı 409'da ek olarak `/conversations?agent_id=`
  linki gösterir.) List sayfaları client-fetch olduğu için loading SSR'de görünür;
  error/empty durumları fetch sonrası client'ta render olur.
- **Form deseni (Faz 9.3): `FormField` + onBlur inline validasyon + `Toast`.**
  `FormField` (label + required + hint + inline hata) hem `AgentForm` hem
  `WorkflowForm`'da kullanılır. Validasyon **onBlur/submit'te** görünür (`touched`
  state; submit'te tümü açılır) — buton yalnız `saving` iken disabled (validasyon
  nedeniyle değil, kullanıcı NEDEN'i görsün). WorkflowForm'da boş adım için
  **per-step** uyarı. Kaydet: `LoadingSpinner size="sm"` + "Kaydediliyor…",
  başarıda yeşil `Toast` (~1.5s) sonra `router.push`; hata `ErrorBanner` ile
  gösterilir ve **form korunur** (kullanıcı tekrar doldurmaz).
- **Onay modalları: `components/Modal.tsx`.** Backdrop tıklaması + **ESC** ile
  kapanır (`closable={!deleting}` → işlem sırasında kapanmaz), `role="dialog"`/
  `aria-modal`. 5 silme modalı (agents/workflows/knowledge-bases/mcp-servers/
  conversations) bunu kullanır; içerik `<Modal onClose closable>{...}</Modal>`.
- **MCP tool seçimi `AgentForm`'da dinamik.** Statik `AVAILABLE_TOOLS`'un altına,
  `lib/api.ts → mcpToolGroups(servers)` ile server-bazlı gruplar render edilir;
  checkbox değeri backend'in namespaced adı (`mcp_{id}_{tool}`), kullanıcıya sade
  tool adı gösterilir. Yeni MCP server eklendikçe/refresh oldukça grup güncellenir.
- **Supervisor (7B) debug'ı `buildTrace` ile ağaca çevrilir, `StepTrace`
  özyinelemeli.** `Chat.tsx` turn başına ham `events: ChatEvent[]` biriktirir;
  `DebugPanel` her turn için `buildTrace(events)` çağırır: `parent_call_id` ile
  nesting, `call_id` ile result eşleşmesi (call_index). `kind==="sub_agent"`
  kartı açılınca alt agent'ın kendi `iterations`'ı için `StepTrace` yeniden
  çağrılır (recursive component). Token'lar debug ağacına girmez — chat balonu
  yalnız **depth 0** token'ı gösterir (alt agent metni ilgili kartın
  `tool_result` çıktısındadır). Bu, yeni event tipi eklemeden çalışır.
- **⚠️ Git Bash + Türkçe karakter:** curl gövdesini **inline `-d` ile Türkçe
  karakterli JSON** göndermek gövdeyi bozar ("There was an error parsing the
  body" / mangle). Non-ASCII gövdeleri bir dosyaya yazıp `--data-binary @dosya`
  ile gönder (ASCII gövdelerde inline `-d` sorun değil). Frontend'in
  `fetch`/`FormData`'sı etkilenmez; bu yalnız komut satırı testleri için geçerli.
- **Windows/macOS'ta Next hot-reload için `WATCHPACK_POLLING=true`**
  (docker-compose frontend env); bind mount üzerinden FS event'leri
  container'a iletilmediği için polling gerekir.
- **Backend'e veri çeken sayfalar client component olmalı.** SSR frontend
  container'ında `localhost:8000` backend'e gitmez (kendisini gösterir); bu
  yüzden `getAgent`/`getAgents` gibi çağrılar tarayıcıda (`useEffect`) yapılır.
  Statik/form sayfaları server component kalabilir.
- **`apiFetch`** hata gövdesindeki FastAPI `detail`'ini yüzeye çıkarır ve 204/
  boş gövdeyi güvenle işler (DELETE için).

---

## ⚠️ KALICI KURAL — Bu dosyayı güncel tut

Her görevi tamamladığında (yeni bir faz, önemli bir özellik veya mimari bir
karar) **ayrı onay istemeden** bu CLAUDE.md'yi güncelle:

1. Yeni tamamlanan fazı **"Tamamlanan Fazlar"** listesine ekle.
2. **"Şu An Yapılan"** bölümünü güncel duruma göre değiştir.
3. Yeni bir mimari karar (yeni kütüphane, yeni klasör/kod konvansiyonu vb.)
   varsa **"Kararlar / Kısıtlar"** veya **"Konvansiyonlar"** bölümüne ekle.
4. Görev sonunda kullanıcıya CLAUDE.md'de **ne değiştirdiğini** kısaca özetle.
