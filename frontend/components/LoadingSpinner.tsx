// A consistent spinner. `size` picks page-level vs inline (in-button) usage.
// Pure CSS (Tailwind border-spin) — no external deps.

const SIZES = {
  sm: "h-4 w-4 border-2", // in-button / inline
  md: "h-6 w-6 border-2", // section-level
  lg: "h-8 w-8 border-[3px]", // full-page
} as const;

export default function LoadingSpinner({
  size = "md",
  label,
  className = "",
}: {
  size?: keyof typeof SIZES;
  label?: string; // optional text shown next to the spinner
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 ${className}`}
      role="status"
      aria-live="polite"
    >
      <span
        className={`${SIZES[size]} animate-spin rounded-full border-slate-600 border-t-blue-400`}
        aria-hidden
      />
      {label && <span className="text-sm text-slate-400">{label}</span>}
      <span className="sr-only">{label ?? "Yükleniyor"}</span>
    </span>
  );
}
