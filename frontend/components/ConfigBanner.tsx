"use client";

import { useEffect, useState } from "react";
import { API_KEY_MISSING, onAuthFailure } from "@/lib/api";

/**
 * Shows a fixed banner when the API key is missing at build time, or when the
 * backend rejects a request with 401 (e.g. a wrong key). Avoids the confusing
 * "everything silently 401s" experience.
 */
export default function ConfigBanner() {
  const [authFailed, setAuthFailed] = useState(false);

  useEffect(() => onAuthFailure(() => setAuthFailed(true)), []);

  if (!API_KEY_MISSING && !authFailed) return null;

  return (
    <div className="sticky top-0 z-50 border-b border-amber-700/60 bg-amber-950/90 px-4 py-2 text-center text-sm text-amber-200 backdrop-blur">
      ⚠️ Yapılandırma eksik: backend API anahtarı{" "}
      {API_KEY_MISSING ? "ayarlanmamış" : "geçersiz"} — istekler{" "}
      <span className="font-mono">401</span> ile reddediliyor.{" "}
      <span className="text-amber-300/80">
        <span className="font-mono">.env</span> içinde{" "}
        <span className="font-mono">APP_API_KEY</span> ayarlayın (frontend{" "}
        <span className="font-mono">NEXT_PUBLIC_APP_API_KEY</span>) ve yeniden
        başlatın.
      </span>
    </div>
  );
}
