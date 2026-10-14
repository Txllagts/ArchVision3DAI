"use client";

import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Campos de formulario accesibles: cada control lleva label asociada,
 * descripcion opcional y mensaje de error anunciado por lectores de pantalla.
 */

const CONTROL_CLASS =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle " +
  "transition-colors focus:border-accent disabled:opacity-60";

interface FieldShellProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}

function FieldShell({ id, label, hint, error, required, children }: FieldShellProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-ink-muted">
        {label}
        {required ? <span className="ml-1 text-danger">*</span> : null}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-ink-subtle">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  /** Permite desactivar el botón de alternar visibilidad en campos de tipo contraseña. Por defecto es true. */
  showPasswordToggle?: boolean;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  (
    {
      label,
      hint,
      error,
      className,
      id,
      required,
      type,
      showPasswordToggle = true,
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const fieldId = id ?? generatedId;
    const isPassword = type === "password";
    const [revealed, setRevealed] = useState(false);

    const effectiveType = isPassword && showPasswordToggle ? (revealed ? "text" : "password") : type;

    return (
      <FieldShell id={fieldId} label={label} hint={hint} error={error} required={required}>
        <div className="relative">
          <input
            ref={ref}
            id={fieldId}
            type={effectiveType}
            required={required}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
            className={cn(
              CONTROL_CLASS,
              isPassword && showPasswordToggle && "pr-10",
              error && "border-danger",
              className,
            )}
            {...props}
          />
          {isPassword && showPasswordToggle ? (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setRevealed((prev) => !prev)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-subtle transition-colors hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              aria-label={revealed ? "Ocultar contraseña" : "Mostrar contraseña"}
              title={revealed ? "Ocultar contraseña" : "Mostrar contraseña"}
            >
              {revealed ? (
                <EyeOff className="size-4" aria-hidden="true" />
              ) : (
                <Eye className="size-4" aria-hidden="true" />
              )}
            </button>
          ) : null}
        </div>
      </FieldShell>
    );
  },
);
TextField.displayName = "TextField";

export interface TextAreaFieldProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
}

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  ({ label, hint, error, className, id, required, ...props }, ref) => {
    const generatedId = useId();
    const fieldId = id ?? generatedId;
    return (
      <FieldShell id={fieldId} label={label} hint={hint} error={error} required={required}>
        <textarea
          ref={ref}
          id={fieldId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          className={cn(CONTROL_CLASS, "min-h-20 resize-y", error && "border-danger", className)}
          {...props}
        />
      </FieldShell>
    );
  },
);
TextAreaField.displayName = "TextAreaField";

export interface SelectFieldProps
  extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  error?: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(
  ({ label, hint, error, className, id, options, required, ...props }, ref) => {
    const generatedId = useId();
    const fieldId = id ?? generatedId;
    return (
      <FieldShell id={fieldId} label={label} hint={hint} error={error} required={required}>
        <select
          ref={ref}
          id={fieldId}
          required={required}
          aria-invalid={error ? true : undefined}
          className={cn(CONTROL_CLASS, "appearance-none pr-8", error && "border-danger", className)}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </FieldShell>
    );
  },
);
SelectField.displayName = "SelectField";
