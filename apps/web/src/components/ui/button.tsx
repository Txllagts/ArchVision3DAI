import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Boton base del sistema de diseno.
 * Variantes pensadas para una herramienta de diseno: densidad alta, bordes
 * finos y un unico acento cromatico.
 */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "outline"
  | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: cn(
    "btn-sheen bg-accent-fill text-accent-fill-ink border border-transparent font-semibold",
    "hover:bg-accent-hover hover:-translate-y-px",
    "hover:shadow-[0_8px_24px_-8px_color-mix(in_oklab,var(--accent-fill)_70%,transparent)]",
  ),
  secondary:
    "bg-surface-3 text-ink hover:bg-surface-2 border border-line hover:border-line-strong",
  ghost: "bg-transparent text-ink-muted hover:text-ink hover:bg-surface-2 border border-transparent",
  outline:
    "bg-transparent text-ink border border-line-strong hover:bg-surface-2 hover:border-accent/60 hover:-translate-y-px",
  danger: "bg-transparent text-danger border border-danger/40 hover:bg-danger/10",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
  lg: "h-11 px-6 text-sm gap-2",
  icon: "h-9 w-9 justify-center",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = "primary", size = "md", loading, disabled, children, ...props },
    ref,
  ) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "group/btn inline-flex items-center rounded-md font-medium",
        "transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
        "active:translate-y-0 active:scale-[0.97] active:duration-75",
        "motion-reduce:transform-none",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : null}
      {children}
    </button>
  ),
);

Button.displayName = "Button";
