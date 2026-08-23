import { ReactNode } from "react";

/**
 * Consistent form field: a label (with optional required marker), optional hint,
 * the control (children), and an optional inline error message. Keeps label +
 * error markup identical across forms.
 */
export default function FormField({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
}: {
  label?: ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div>
      {label && (
        <label
          htmlFor={htmlFor}
          className="mb-1 block text-sm font-medium text-slate-300"
        >
          {label}
          {required && <span className="text-red-400"> *</span>}
        </label>
      )}
      {hint && <p className="mb-2 text-xs text-slate-500">{hint}</p>}
      {children}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
