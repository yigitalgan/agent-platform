"""DuckDuckGo Instant Answer tool — no API key required.

Queries DuckDuckGo's Instant Answer API (``api.duckduckgo.com``). This endpoint
returns curated instant answers (definitions, abstracts, related topics) rather
than a full web-result page, so it's best for quick factual lookups. Errors are
caught and returned as ``"hata: ..."`` so a failed lookup never crashes chat.
"""

import httpx

from app.services.tools.base import Tool

DUCKDUCKGO_API_URL = "https://api.duckduckgo.com/"
_TIMEOUT = 10.0
_MAX_CHARS = 1500


def _first_topic_text(topics: list) -> str:
    """Return the first usable ``Text`` from RelatedTopics (flat or grouped)."""
    for topic in topics:
        if not isinstance(topic, dict):
            continue
        if topic.get("Text"):
            return topic["Text"]
        # Grouped results nest their own "Topics" list.
        nested = _first_topic_text(topic.get("Topics", []))
        if nested:
            return nested
    return ""


class DuckDuckGoSearchTool(Tool):
    name = "duckduckgo_search"
    description = (
        "DuckDuckGo Anlık Cevap API'siyle hızlı bir arama yapar ve varsa özet/"
        "tanım döndürür. Genel bilgi, tanım ve 'nedir' türü sorular için kullan."
    )
    input_schema = {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Arama sorgusu, ör. 'Python programlama dili'.",
            }
        },
        "required": ["query"],
    }

    async def execute(self, tool_input: dict, context: dict | None = None) -> str:
        query = str(tool_input.get("query", "")).strip()
        if not query:
            return "hata: boş sorgu"

        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.get(
                    DUCKDUCKGO_API_URL,
                    params={
                        "q": query,
                        "format": "json",
                        "no_html": 1,
                        "skip_disambig": 1,
                    },
                )
                resp.raise_for_status()
                # DuckDuckGo serves JSON with a text/javascript content-type;
                # httpx's .json() parses the body regardless of that header.
                data = resp.json()
        except httpx.HTTPError as exc:
            return f"hata: DuckDuckGo'ya ulaşılamadı ({exc})"
        except Exception as exc:  # noqa: BLE001 — surface unexpected parse errors safely
            return f"hata: DuckDuckGo sonucu işlenemedi ({exc})"

        answer = (data.get("AbstractText") or data.get("Answer") or "").strip()
        if not answer:
            answer = _first_topic_text(data.get("RelatedTopics", [])).strip()
        if not answer:
            return f"'{query}' için DuckDuckGo anlık cevabı bulunamadı."
        if len(answer) > _MAX_CHARS:
            answer = answer[:_MAX_CHARS].rstrip() + "…"
        return answer
