"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AlertTriangle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSceneSaver } from "@/lib/editor/scene-save";
import { useEditorStore } from "@/lib/editor/store";

/**
 * Dialogo de conflicto de version.
 *
 * Se abre cuando el servidor y la local solapan en los mismos elementos: no
 * se sobrescribe nada en silencio. Los cambios locales siguen en memoria
 * hasta que el usuario elige; ninguna de las dos opciones principales se
 * cierra con Escape para que la decision sea siempre explicita.
 */

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ConflictModal() {
  const conflict = useEditorStore((state) => state.conflict);
  const projectName = useEditorStore((state) => state.projectName);
  const [busy, setBusy] = useState<"keep" | "server" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const hintId = useId();

  useEffect(() => {
    if (conflict) panelRef.current?.focus();
  }, [conflict]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // stopPropagation evita que el atajo global de Escape dispare otras cosas
    // mientras el dialogo tiene el foco; aqui Escape no cierra.
    if (event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      return;
    }
    if (event.key !== "Tab") return;

    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;

    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const resolve = async (choice: "keep" | "server") => {
    if (busy) return;
    setBusy(choice);
    setError(null);
    try {
      await getSceneSaver().resolveConflict(choice);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo resolver el conflicto");
    } finally {
      setBusy(null);
    }
  };

  const downloadLocalCopy = () => {
    const scene = useEditorStore.getState().scene;
    const blob = new Blob([JSON.stringify(scene, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${projectName.trim() || "escena"}-copia-local.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!conflict) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      role="presentation"
      onKeyDown={handleKeyDown}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-busy={busy !== null || undefined}
        aria-labelledby={titleId}
        aria-describedby={hintId}
        className="w-full max-w-md rounded-panel border border-line bg-surface p-5 shadow-2xl outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
          <div>
            <h2 id={titleId} className="text-sm font-semibold text-ink">
              Conflicto de version
            </h2>
            <p id={hintId} className="mt-1 text-xs text-ink-muted">
              La escena cambio en el servidor y los cambios solapan con los
              tuyos. Tus cambios siguen aqui hasta que elijas como resolverlo.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Button
            className="w-full justify-start"
            disabled={busy !== null}
            onClick={() => void resolve("keep")}
            title="Guarda tu escena actual sobre la del servidor"
          >
            Conservar mis cambios
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start"
            disabled={busy !== null}
            onClick={() => void resolve("server")}
            title="Reemplaza tu escena por la del servidor"
          >
            Usar la version del servidor
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start"
            disabled={busy !== null}
            onClick={downloadLocalCopy}
            title="Descarga tu escena actual como JSON"
          >
            <Download className="size-4" aria-hidden />
            Descargar copia local
          </Button>
        </div>

        {busy ? (
          <p className="mt-3 text-xs text-ink-subtle">Resolviendo...</p>
        ) : null}
        {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}
      </div>
    </div>
  );
}
