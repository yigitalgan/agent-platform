// Consistent error display: a red banner with the message and an optional
// "Tekrar Dene" (retry) button.

export default function ErrorBanner({
  message,
  onRetry,
  retrying = false,
  className = "",
}: {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={`flex items-start justify-between gap-4 rounded-md border border-red-800/60 bg-red-950/50 px-3 py-2 text-sm text-red-300 ${className}`}
    >
      <p className="min-w-0">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="shrink-0 rounded-md border border-red-700/60 px-2.5 py-1 text-xs font-medium text-red-200 hover:bg-red-900/40 disabled:opacity-50"
        >
          {retrying ? "Deneniyor…" : "Tekrar Dene"}
        </button>
      )}
    </div>
  );
}
