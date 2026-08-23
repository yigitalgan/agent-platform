"use client";

import { ReactNode, useEffect } from "react";

/**
 * Centered modal with a click-to-dismiss backdrop and Escape-to-close, plus the
 * standard dialog a11y roles. `closable` (default true) is set to false while an
 * action is in flight so the user can't dismiss mid-operation.
 */
export default function Modal({
  onClose,
  closable = true,
  children,
}: {
  onClose: () => void;
  closable?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && closable) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, closable]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={() => {
        if (closable) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
