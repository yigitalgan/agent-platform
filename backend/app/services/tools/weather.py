"""Weather tool — Open-Meteo, no API key required.

Two-step Open-Meteo flow: geocode the location name to latitude/longitude
(``geocoding-api.open-meteo.com``), then fetch the current conditions
(``api.open-meteo.com/v1/forecast``). Both endpoints are free and keyless.

The forecast's ``weather_code`` is a WMO code; a small dictionary maps it to a
human-readable Turkish description. Errors are caught and returned as
``"hata: ..."`` (never raised) so a failed lookup comes back to Claude as a
tool_result without crashing the chat loop.
"""

import httpx

from app.services.tools.base import Tool

GEOCODING_API_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_API_URL = "https://api.open-meteo.com/v1/forecast"
_TIMEOUT = 10.0

# WMO weather interpretation codes → readable Turkish text.
_WEATHER_CODES: dict[int, str] = {
    0: "açık",
    1: "genelde açık",
    2: "parçalı bulutlu",
    3: "kapalı (çok bulutlu)",
    45: "sisli",
    48: "kırağılı sis",
    51: "hafif çisenti",
    53: "orta çisenti",
    55: "yoğun çisenti",
    56: "hafif donan çisenti",
    57: "yoğun donan çisenti",
    61: "hafif yağmurlu",
    63: "yağmurlu",
    65: "şiddetli yağmurlu",
    66: "hafif donan yağmur",
    67: "şiddetli donan yağmur",
    71: "hafif kar yağışlı",
    73: "kar yağışlı",
    75: "yoğun kar yağışlı",
    77: "kar taneli",
    80: "hafif sağanak yağışlı",
    81: "sağanak yağışlı",
    82: "şiddetli sağanak yağışlı",
    85: "hafif kar sağanağı",
    86: "yoğun kar sağanağı",
    95: "gök gürültülü fırtına",
    96: "dolu ile gök gürültülü fırtına",
    99: "şiddetli dolu ile gök gürültülü fırtına",
}


class WeatherTool(Tool):
    name = "weather"
    description = (
        "Bir şehir/konum adının güncel hava durumunu (sıcaklık + koşul) Open-Meteo "
        "ile getirir. Hava durumu, sıcaklık, 'kaç derece' türü sorular için kullan."
    )
    input_schema = {
        "type": "object",
        "properties": {
            "location": {
                "type": "string",
                "description": "Şehir veya konum adı, ör. 'İstanbul' veya 'Barcelona'.",
            }
        },
        "required": ["location"],
    }

    async def execute(self, tool_input: dict, context: dict | None = None) -> str:
        location = str(tool_input.get("location", "")).strip()
        if not location:
            return "hata: boş konum"

        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                # 1) Geocode the name → lat/lon.
                geo_resp = await client.get(
                    GEOCODING_API_URL,
                    params={
                        "name": location,
                        "count": 1,
                        "language": "tr",
                        "format": "json",
                    },
                )
                geo_resp.raise_for_status()
                geo = geo_resp.json()

                results = geo.get("results") or []
                if not results:
                    return "hata: konum bulunamadı"
                place = results[0]
                lat = place.get("latitude")
                lon = place.get("longitude")
                if lat is None or lon is None:
                    return "hata: konum bulunamadı"

                # 2) Current conditions at those coordinates.
                fc_resp = await client.get(
                    FORECAST_API_URL,
                    params={
                        "latitude": lat,
                        "longitude": lon,
                        "current": "temperature_2m,weather_code",
                    },
                )
                fc_resp.raise_for_status()
                forecast = fc_resp.json()
        except httpx.HTTPError as exc:
            return f"hata: hava durumu servisine ulaşılamadı ({exc})"
        except Exception as exc:  # noqa: BLE001 — surface unexpected parse errors safely
            return f"hata: hava durumu sonucu işlenemedi ({exc})"

        current = forecast.get("current") or {}
        temp = current.get("temperature_2m")
        code = current.get("weather_code")
        if temp is None or code is None:
            return "hata: güncel hava durumu verisi alınamadı"

        unit = (forecast.get("current_units") or {}).get("temperature_2m", "°C")
        condition = _WEATHER_CODES.get(int(code), f"bilinmeyen koşul (kod {code})")

        # A readable place label: "Şehir, Ülke" when available.
        name = place.get("name") or location
        country = place.get("country")
        label = f"{name}, {country}" if country else name

        return f"{label}: {temp}{unit}, {condition}."
