"""Built-in agent & workflow templates (static, code-only — no DB table).

MVP decision: templates are a constant list in code rather than a DB table.
They're read-only starting points the UI prefills into the create forms; there's
no per-user authoring, versioning, or persistence need yet. If that changes,
this can move to a table without touching the endpoint shape.

``model_params`` mirrors the demo agents (OpenRouter + Haiku 4.5) so a template
works out-of-the-box in this deployment; users can change provider/model in the
form before saving.
"""

_DEFAULT_MODEL_PARAMS = {
    "provider": "openrouter",
    "model": "anthropic/claude-haiku-4.5",
    "temperature": 0.4,
}


def _agent(
    template_id: str,
    name: str,
    description: str,
    system_prompt: str,
    allowed_tools: list[str],
    *,
    temperature: float = 0.4,
) -> dict:
    return {
        "id": template_id,
        "name": name,
        "description": description,
        "system_prompt": system_prompt,
        "allowed_tools": allowed_tools,
        "knowledge_base_id": None,
        "model_params": {**_DEFAULT_MODEL_PARAMS, "temperature": temperature},
    }


# --- Agent templates -------------------------------------------------------

AGENT_TEMPLATES: list[dict] = [
    _agent(
        "genel-asistan",
        "Genel Asistan",
        "Araç kullanmayan, sohbet ve genel sorular için sade bir asistan.",
        "Sen yardımcı, kibar ve net bir asistansın. Soruları açık ve öz yanıtla; "
        "emin olmadığında bunu belirt.",
        [],
        temperature=0.7,
    ),
    _agent(
        "hesap-uzmani",
        "Hesap Uzmanı",
        "Matematik işlemlerini calculator aracıyla güvenle hesaplar.",
        "Sen bir hesap uzmanısın. Matematiksel işlemler için mutlaka calculator "
        "aracını kullan, sonucu kısaca ve net şekilde ver.",
        ["calculator"],
        temperature=0.2,
    ),
    _agent(
        "arastirmaci",
        "Araştırmacı",
        "Wikipedia ve DuckDuckGo ile güncel/olgusal bilgi araştırır.",
        "Sen bir araştırmacısın. Olgusal sorularda wikipedia_search ve "
        "duckduckgo_search araçlarını kullanarak bilgi topla; cevabını bulduğun "
        "kaynaklara dayandır ve kısa bir özet ver.",
        ["wikipedia_search", "duckduckgo_search"],
        temperature=0.3,
    ),
    _agent(
        "dokuman-asistani",
        "Doküman Asistanı",
        "Bir bilgi tabanındaki yüklü dokümanlarda arama yapar (RAG). "
        "Bilgi tabanını formda seçmelisiniz.",
        "Sen bir doküman asistanısın. Kullanıcının sorularını yanıtlamak için "
        "document_search aracıyla bağlı bilgi tabanında ara ve cevabını bulunan "
        "içeriğe dayandır.",
        ["document_search"],
        temperature=0.3,
    ),
]


# --- Workflow templates ----------------------------------------------------
# Each template carries the agent specs it needs (created by the frontend if an
# agent with the same name doesn't already exist) plus the ordered step names.

WORKFLOW_TEMPLATES: list[dict] = [
    {
        "id": "ozetle-cevir",
        "name": "Özetle ve Çevir",
        "description": "Bir konuyu Türkçe özetler, ardından İngilizceye çevirir.",
        "agents": [
            _agent(
                "ozetleyici",
                "Özetleyici",
                "Verilen konuyu kısa Türkçe özetler.",
                "Sana verilen konu hakkında Türkçe, 2 cümlelik kısa bir bilgi "
                "yaz. Sadece bilgiyi yaz.",
                [],
                temperature=0.3,
            ),
            _agent(
                "ingilizce-cevirmen",
                "İngilizce Çevirmen",
                "Türkçe metni İngilizceye çevirir.",
                "Sana verilen Türkçe metni İngilizceye çevir. Sadece çeviriyi "
                "ver, ekstra açıklama yapma.",
                [],
                temperature=0.2,
            ),
        ],
        # Ordered step agent names (must match the agents above by name).
        "steps": ["Özetleyici", "İngilizce Çevirmen"],
    },
    {
        "id": "arastir-raporla",
        "name": "Araştır ve Raporla",
        "description": "Bir konuyu araştırır, sonra derli toplu bir rapora dönüştürür.",
        "agents": [
            _agent(
                "arastirmaci",
                "Araştırmacı",
                "Wikipedia/DuckDuckGo ile konu hakkında bilgi toplar.",
                "Sen bir araştırmacısın. Verilen konuyu wikipedia_search ve "
                "duckduckgo_search ile araştır; bulduğun önemli bilgileri "
                "maddeler hâlinde topla.",
                ["wikipedia_search", "duckduckgo_search"],
                temperature=0.3,
            ),
            _agent(
                "raporlayici",
                "Raporlayıcı",
                "Ham araştırma notlarını akıcı bir rapora dönüştürür.",
                "Sana verilen araştırma notlarını akıcı, düzenli ve kısa bir "
                "Türkçe rapora dönüştür. Başlık ve birkaç paragraf kullan.",
                [],
                temperature=0.5,
            ),
        ],
        "steps": ["Araştırmacı", "Raporlayıcı"],
    },
]
