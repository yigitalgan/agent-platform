"""SSRF guard for outbound MCP server URLs.

The MCP server URL is user-supplied, so before the backend connects we validate
it: only http/https, and (unless ``ALLOW_PRIVATE_MCP_URLS`` is set) the hostname
must resolve exclusively to public IP addresses. This blocks pointing the
backend at internal services, localhost, or the cloud metadata endpoint.

This is a pragmatic baseline, NOT bulletproof: DNS rebinding (resolution can
change between this check and the actual connect) and HTTP redirects are not
covered. ``validate_public_url`` is therefore called both at create/update time
AND again immediately before every connect (defense in depth).
"""

import ipaddress
import socket
from urllib.parse import urlparse

from app.core.config import settings
from app.services.mcp.errors import MCPError, MCPSecurityError

_ALLOWED_SCHEMES = ("http", "https")


def _is_blocked_ip(ip: str) -> bool:
    """True if ``ip`` is private/loopback/link-local/reserved (i.e. not public)."""
    addr = ipaddress.ip_address(ip)
    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local  # includes 169.254.0.0/16 (cloud metadata)
        or addr.is_reserved
        or addr.is_multicast
        or addr.is_unspecified
    )


def validate_public_url(url: str) -> None:
    """Raise :class:`MCPSecurityError` if ``url`` is unsafe to connect to.

    Passes silently for a well-formed http(s) URL whose host resolves to public
    IPs only. When ``ALLOW_PRIVATE_MCP_URLS`` is true, the private-range check is
    skipped (scheme/host are still validated) — intended for local testing only.
    """
    parsed = urlparse(url)
    if parsed.scheme not in _ALLOWED_SCHEMES:
        raise MCPSecurityError(
            f"Yalnızca http/https şemasına izin verilir (verilen: '{parsed.scheme}')."
        )
    host = parsed.hostname
    if not host:
        raise MCPSecurityError("URL'de geçerli bir host yok.")

    if settings.ALLOW_PRIVATE_MCP_URLS:
        return  # dev/testing escape hatch — private ranges allowed

    # Resolve every address the host maps to; block if ANY is non-public.
    # A DNS failure is NOT a security violation (nothing to connect to) — raise
    # a plain MCPError so create/update treats it as "unreachable" (last_error),
    # not a hard 400. The private-IP check below is the actual SSRF guard.
    try:
        infos = socket.getaddrinfo(host, parsed.port or None)
    except socket.gaierror as exc:
        raise MCPError(f"Host çözümlenemedi ({host}): {exc}")

    for info in infos:
        ip = info[4][0]
        if _is_blocked_ip(ip):
            raise MCPSecurityError(
                f"Güvenlik: '{host}' özel/dahili bir adrese ({ip}) çözülüyor; "
                "MCP server'ı yalnızca herkese açık (public) bir adres olabilir. "
                "(Local test için ALLOW_PRIVATE_MCP_URLS=true.)"
            )
