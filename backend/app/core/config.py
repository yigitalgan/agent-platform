from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables / .env file."""

    # LLM sağlayıcısı: "anthropic" (doğrudan) veya "openrouter"
    # (Anthropic-uyumlu endpoint). Varsayılan "anthropic".
    LLM_PROVIDER: str = "anthropic"
    ANTHROPIC_API_KEY: str = ""
    OPENROUTER_API_KEY: str = ""
    # Tavily web-search API key (free tier ~1000 aramas/ay). OPTIONAL — unlike the
    # LLM keys, the app boots without it; only the web_search tool needs it and
    # returns a clear "hata: ..." if it's unset.
    TAVILY_API_KEY: str = ""
    DATABASE_URL: str = "sqlite:///./app.db"
    # Shared secret required on every /api/v1/* request via the X-API-Key header.
    # MUST be set (the app refuses to start otherwise) so auth is never silently
    # disabled. Generate a strong random value; see .env.example.
    APP_API_KEY: str = ""
    # RAG: where the ChromaDB persistent index is stored. Defaults under /data
    # (the named volume) in Docker; falls back to a local dir for bare runs.
    CHROMA_DIR: str = "./chroma"
    # MCP (Faz 8): allow MCP server URLs that resolve to private/loopback IPs.
    # SECURITY: keep False in production — True disables the SSRF guard for
    # private ranges (only enable to test a local MCP server).
    ALLOW_PRIVATE_MCP_URLS: bool = False

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
