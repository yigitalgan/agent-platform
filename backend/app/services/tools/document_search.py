"""Document search tool (RAG retrieval).

Unlike the other tools, this one is bound to a specific knowledge base. The
``knowledge_base_id`` is NOT part of the model-visible ``input_schema`` (Claude
only supplies a ``query``); it's injected via ``context`` from the agent's
config. ``llm_client`` only offers this tool when the agent both allows it and
has a knowledge base set, so a missing id here is an error, not a normal path.

Embedding + Chroma calls are synchronous, so they run in a worker thread to
avoid blocking the event loop.
"""

import asyncio

from app.services.rag import vector_store
from app.services.tools.base import Tool

_TOP_K = 4


class DocumentSearchTool(Tool):
    name = "document_search"
    description = (
        "Agent'a bağlı bilgi tabanındaki (yüklenmiş dokümanlar) ilgili "
        "bölümleri semantik olarak arar. Şirket politikaları, yüklenen "
        "dokümanlar veya bilgi tabanına özgü sorular için kullan."
    )
    input_schema = {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Bilgi tabanında aranacak soru/ifade.",
            }
        },
        "required": ["query"],
    }

    async def execute(self, tool_input: dict, context: dict | None = None) -> str:
        query = str(tool_input.get("query", "")).strip()
        if not query:
            return "hata: boş sorgu"

        kb_id = (context or {}).get("knowledge_base_id")
        if kb_id is None:
            return "hata: bu agent'a bir bilgi tabanı bağlı değil."

        try:
            chunks = await asyncio.to_thread(
                vector_store.query, kb_id, query, _TOP_K
            )
        except Exception as exc:  # noqa: BLE001 — surface retrieval errors safely
            return f"hata: bilgi tabanı sorgulanamadı ({exc})"

        if not chunks:
            return (
                "Bilgi tabanında bu sorguyla ilgili bir bölüm bulunamadı "
                "(doküman yüklü olmayabilir)."
            )
        # Number the retrieved passages so Claude can cite/ground its answer.
        return "\n\n".join(
            f"[Bölüm {i + 1}]\n{chunk}" for i, chunk in enumerate(chunks)
        )
