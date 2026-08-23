"""Web search tool — Tavily API.

Real web search via Tavily (``api.tavily.com/search``). Unlike the keyless tools
(weather, wikipedia, ddg), this needs ``TAVILY_API_KEY`` in the environment. The
free tier allows ~1000 searches/month, so calls are not unlimited.

Errors are caught and returned as ``"hata: ..."`` (never raised) so a missing key,
quota exhaustion, or a network failure comes back to Claude as a tool_result
without crashing the chat loop. A missing key returns a clear, actionable message
consistent with the LLMConfigError pattern (but as a string, since tools return
strings rather than raising).
"""

import httpx

from app.core.config import settings
from app.services.tools.base import Tool

TAVILY_API_URL = "https://api.tavily.com/search"
_TIMEOUT = 10.0
_MAX_RESULTS = 5
_SNIPPET_CHARS = 300


class WebSearchTool(Tool):
    name = "web_search"
    description = (
        "Tavily ile gerçek zamanlı web araması yapar; güncel/anlık bilgi, haberler "
        "ve web'de aranması gereken sorular için kullan. Başlık + özet + kaynak URL "
        "döndürür."
    )
    input_schema = {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Web arama sorgusu, ör. 'bugünkü döviz kuru'.",
            }
        },
        "required": ["query"],
    }

    async def execute(self, tool_input: dict, context: dict | None = None) -> str:
        query = str(tool_input.get("query", "")).strip()
        if not query:
            return "hata: boş sorgu"
        if not settings.TAVILY_API_KEY:
            return (
                "hata: TAVILY_API_KEY ayarlanmamış — web araması için kök dizindeki "
                ".env dosyanıza geçerli bir Tavily anahtarı ekleyin."
            )

        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.post(
                    TAVILY_API_URL,
                    json={
                        "api_key": settings.TAVILY_API_KEY,
                        "query": query,
                        "max_results": _MAX_RESULTS,
                        "search_depth": "basic",
                    },
                )
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPError as exc:
            return f"hata: web aramasına ulaşılamadı ({exc})"
        except Exception as exc:  # noqa: BLE001 — surface unexpected parse errors safely
            return f"hata: web arama sonucu işlenemedi ({exc})"

        results = data.get("results") or []
        if not results:
            return f"'{query}' için web sonucu bulunamadı."

        lines: list[str] = []
        for i, r in enumerate(results[:_MAX_RESULTS], start=1):
            title = (r.get("title") or "(başlıksız)").strip()
            url = (r.get("url") or "").strip()
            snippet = (r.get("content") or "").strip()
            if len(snippet) > _SNIPPET_CHARS:
                snippet = snippet[:_SNIPPET_CHARS].rstrip() + "…"
            block = f"{i}. {title}"
            if snippet:
                block += f"\n{snippet}"
            if url:
                block += f"\nKaynak: {url}"
            lines.append(block)
        return "\n\n".join(lines)
