"use client";

import { useEffect, useState } from "react";
import { API_BASE_URL, getHealth } from "@/lib/api";

type Status = "loading" | "healthy" | "error";

export default function HealthStatus() {
  const [status, setStatus] = useState<Status>("loading");
  const [detail, setDetail] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    getHealth()
      .then((data) => {
        if (cancelled) return;
        setStatus(data.status === "healthy" ? "healthy" : "error");
        setDetail(data.status);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus("error");
        setDetail(err instanceof Error ? err.message : "Unknown error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const config = {
    loading: { dot: "bg-yellow-400", label: "Checking backend…" },
    healthy: { dot: "bg-green-400", label: "Backend is healthy" },
    error: { dot: "bg-red-400", label: "Backend unreachable" },
  }[status];

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 shadow-lg">
      <div className="flex items-center gap-3">
        <span
          className={`inline-block h-3 w-3 rounded-full ${config.dot} ${
            status === "loading" ? "animate-pulse" : ""
          }`}
        />
        <span className="text-lg font-medium">{config.label}</span>
      </div>
      <dl className="mt-4 space-y-1 text-sm text-slate-400">
        <div className="flex gap-2">
          <dt className="font-mono">API:</dt>
          <dd className="font-mono">{API_BASE_URL}</dd>
        </div>
        {detail && (
          <div className="flex gap-2">
            <dt className="font-mono">status:</dt>
            <dd className="font-mono">{detail}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
