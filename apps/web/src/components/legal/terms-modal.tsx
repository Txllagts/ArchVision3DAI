"use client";

import React, { useEffect, useState } from "react";
import { X, ExternalLink, ShieldCheck, Scale, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TermsContent } from "./terms-content";

interface TermsModalProps {
  open: boolean;
  onClose: () => void;
}

export function TermsModal({ open, onClose }: TermsModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6"
    >
      {/* Fondo desenfocado */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Ventana auxiliar */}
      <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-line bg-surface shadow-2xl overflow-hidden text-left animate-in fade-in zoom-in-95 duration-200">
        {/* Cabecera del modal */}
        <div className="flex items-center justify-between border-b border-line bg-surface-2/80 px-5 py-4 text-left">
          <div className="flex items-center gap-2.5 text-left">
            <div className="flex size-8 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-accent shrink-0">
              <Scale className="size-4" />
            </div>
            <div className="text-left">
              <h2 id="terms-modal-title" className="text-base font-semibold text-ink">
                Términos y Condiciones del Servicio
              </h2>
              <p className="text-xs text-ink-subtle">SaaS Colombia</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => window.open("/terms", "_blank")}
              className="rounded p-1.5 text-ink-subtle hover:bg-surface-3 hover:text-ink transition-colors"
              title="Abrir en pestaña completa"
              aria-label="Abrir en pestaña completa"
            >
              <ExternalLink className="size-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1.5 text-ink-subtle hover:bg-surface-3 hover:text-ink transition-colors"
              title="Cerrar ventana"
              aria-label="Cerrar ventana"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Contenido desplazable */}
        <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-8">
          <TermsContent />
        </div>

        {/* Pie del modal */}
        <div className="flex items-center justify-between border-t border-line bg-surface-2/40 px-5 py-3">
          <div className="flex items-center gap-1.5 text-xs text-ink-subtle">
            <ShieldCheck className="size-4 text-ok" />
            <span>Garantía de protección de datos (Ley 1581)</span>
          </div>
          <Button size="sm" onClick={onClose}>
            Entendido y cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Componente interactivo para avisos legales en Auth Layout y Footers.
 */
export function LegalNotice({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <p className={`text-[11px] leading-relaxed text-ink-subtle ${className}`}>
        Al continuar aceptas los{" "}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-accent hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded"
        >
          Términos y Condiciones y la Politica de Privacidad
        </button>
      </p>

      <TermsModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
