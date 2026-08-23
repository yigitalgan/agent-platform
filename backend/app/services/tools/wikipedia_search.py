"""Wikipedia search tool — no API key required.

Uses the MediaWiki action API (``/w/api.php``): first a full-text search to
resolve the best-matching page title, then an intro extract for that page.
Defaults to Turkish Wikipedia (``tr``); the model may pass ``language`` to use
another edition (e.g. ``en``). Network/HTTP errors are caught and returned as a
``"hata: ..."`` string so a failed lookup never crashes the chat.
"""

import httpx

from app.services.tools.base import Tool

# Overridable base host builder — kept as a module attribute so tests can point
# it at a bad URL to exercise the error path.
WIKIPEDIA_API_TEMPLATE = "https://{lang}.wikipedia.org/w/api.php"
_TIMEOUT = 10.0
_MAX_CHARS = 1500
# Wikimedia's API policy requires a descriptive User-Agent; requests with a
# generic client string (e.g. python-httpx) are rejected with 403.
_HEADERS = {
    "User-Agent": "agent-platform/0.1 (educational project; no-code AI agents)"
}


class WikipediaSearchTool(Tool):
    name = "wikipedia_search"
    description = (
        "Wikipedia'da arama yapıp ilgili maddenin özetini döndürür. Güncel "
        "olgusal bilgiler (nüfus, tarih, tanımlar, kişiler, yerler) için kullan. "
        "Varsayılan dil Türkçe; 'language' ile 'en' gibi başka bir dil seçilebilir."
    )
    input_schema = {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Aranacak konu/terim, ör. 'Türkiye nüfusu'.",
            },
            "language": {
                "type": "string",
                "description": "Wikipedia dil kodu (varsayılan 'tr'), ör. 'en'.",
            },
        },
        "required": ["query"],
    }

    async def execute(self, tool_input: dict, context: dict | None = None) -> str:
        query = str(tool_input.get("query", "")).strip()
        if not query:
            return "hata: boş sorgu"
        lang = str(tool_input.get("language", "tr")).strip() or "tr"
        base = WIKIPEDIA_API_TEMPLATE.format(lang=lang)

        try:
            async with httpx.AsyncClient(
                timeout=_TIMEOUT, headers=_HEADERS
            ) as client:
                # 1) Full-text search → best page title.
                search = await client.get(
                    base,
                    params={
                        "action": "query",
                        "list": "search",
                        "srsearch": query,
                        "srlimit": 1,
                        "format": "json",
                    },
                )
                search.raise_for_status()
                hits = search.json().get("query", {}).get("search", [])
                if not hits:
                    return f"'{query}' için Wikipedia'da ({lang}) sonuç bulunamadı."
                title = hits[0]["title"]

                # 2) Intro extract for that page.
                extract = await client.get(
                    base,
                    params={
                        "action": "query",
                        "prop": "extracts",
                        "exintro": 1,
                        "explaintext": 1,
                        "redirects": 1,
                        "titles": title,
                        "format": "json",
                    },
                )
                extract.raise_for_status()
                pages = extract.json().get("query", {}).get("pages", {})
                summary = ""
                if pages:
                    summary = next(iter(pages.values())).get("extract", "") or ""
        except httpx.HTTPError as exc:
            return f"hata: Wikipedia'ya ulaşılamadı ({exc})"
        except Exception as exc:  # noqa: BLE001 — surface unexpected parse errors safely
            return f"hata: Wikipedia sonucu işlenemedi ({exc})"

        summary = summary.strip()
        if not summary:
            return f"'{title}' maddesi bulundu ama özet çıkarılamadı."
        if len(summary) > _MAX_CHARS:
            summary = summary[:_MAX_CHARS].rstrip() + "…"
        return f"{title}: {summary}"
