"use client";

// A small fixed success toast (green), bottom-right. Rendered while `message`
// is set; the parent controls its lifetime (e.g. show, then redirect).
export default function Toast({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-50 rounded-md border border-emerald-700/60 bg-emerald-950/95 px-4 py-2 text-sm text-emerald-200 shadow-lg backdrop-blur"
    >
      ✓ {message}
    </div>
  );
}
