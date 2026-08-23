import { ReactNode } from "react";

/**
 * Consistent "nothing here yet" state for empty lists: an icon, a message, and
 * an optional primary action (e.g. an "İlk Agent'ı Oluştur" link/button).
 */
export default function EmptyState({
  icon = "📭",
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-700 bg-slate-900/40 px-6 py-12 text-center">
      <div className="text-3xl" aria-hidden>
        {icon}
      </div>
      <div>
        <p className="font-medium text-slate-200">{title}</p>
        {description && (
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
