"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/field";
import { getActiveViewport } from "@/lib/3d/active-scene";
import {
  exportScene,
  type ExportFormat,
  type ExportOptions,
  type ExportUnit,
} from "@/lib/3d/exporters";
import { useEditorStore } from "@/lib/editor/store";
import { cn } from "@/lib/utils";

/**
 * Modal de exportacion.
 *
 * Los formatos 3D se generan clonando la escena de Three.js del visor; el DXF
 * se genera del `SceneDocument` del store. La descarga es siempre local: Blob
 * + object URL, revocada tras iniciar la descarga.
 */

type ExportStatus = "idle" | "exporting" | "error" | "success";

const FORMAT_OPTIONS: ReadonlyArray<{ value: ExportFormat; label: string }> = [
  { value: "glb", label: "GLB (glTF binario)" },
  { value: "obj", label: "OBJ + MTL (ZIP)" },
  { value: "stl", label: "STL (malla)" },
  { value: "dxf", label: "DXF (planta 2D)" },
  { value: "png", label: "PNG (captura del visor)" },
];

const UNIT_OPTIONS: ReadonlyArray<{ value: ExportUnit; label: string }> = [
  { value: "m", label: "Metros (m)" },
  { value: "cm", label: "Centimetros (cm)" },
  { value: "mm", label: "Milimetros (mm)" },
];

const FORMAT_HINTS: Record<ExportFormat, string> = {
  glb: "Binario glTF con texturas incrustadas: se abre en Blender y en visores web.",
  obj: "ZIP con modelo.obj, materiales modelo.mtl y texturas en textures/.",
  stl: "Solo geometria: STL ignora materiales, colores y texturas.",
  dxf: "Planta 2D con capas de muros, vanos, cotas y textos; las cotas se generan al exportar.",
  png: "Imagen del visor 3D tal como se ve ahora; la resolucion es la del dispositivo.",
};

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ExportModal() {
  const open = useEditorStore((state) => state.exportOpen);
  const setOpen = useEditorStore((state) => state.setExportOpen);

  const [format, setFormat] = useState<ExportFormat>("glb");
  const [unit, setUnit] = useState<ExportUnit>("m");
  const [includeFurniture, setIncludeFurniture] = useState(true);
  const [includeMaterials, setIncludeMaterials] = useState(true);
  const [status, setStatus] = useState<ExportStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const hintId = useId();
  const errorId = useId();

  const furnitureRelevant = format !== "dxf" && format !== "png";
  const materialsRelevant = format === "glb" || format === "obj";
  const unitRelevant = format !== "png";
  const busy = status === "exporting";

  const options: ExportOptions = {
    format,
    unit,
    includeFurniture: furnitureRelevant && includeFurniture,
    includeMaterials: materialsRelevant && includeMaterials,
  };

  useEffect(() => {
    if (open) {
      setStatus("idle");
      setError(null);
      panelRef.current?.focus();
    }
  }, [open]);

  const close = () => {
    if (!busy) setOpen(false);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // stopPropagation evita que el atajo global de Escape (limpiar seleccion)
    // se dispare mientras el modal tiene el foco.
    if (event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;

    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    );
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

  const runExport = async () => {
    if (busy) return;
    setStatus("exporting");
    setError(null);

    // Cede el turno del hilo para que el spinner se pinte antes del trabajo
    // pesado de clonado y serializacion.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 30));

    try {
      const source =
        options.format === "dxf"
          ? useEditorStore.getState().scene
          : getActiveViewport();
      if (!source) {
        throw new Error(
          "El visor 3D no esta disponible; recarga la pagina e intentalo de nuevo.",
        );
      }
      const { blob, filename } = await exportScene(options, source);
      downloadBlob(blob, filename);
      setStatus("success");
      window.setTimeout(() => {
        setStatus("idle");
        setOpen(false);
      }, 900);
    } catch (caught) {
      setStatus("error");
      setError(
        caught instanceof Error ? caught.message : "No se pudo exportar el modelo",
      );
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      role="presentation"
      onClick={close}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-busy={busy || undefined}
        aria-labelledby={titleId}
        aria-describedby={hintId}
        className="w-full max-w-md rounded-panel border border-line bg-surface p-5 shadow-2xl outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-sm font-semibold text-ink">
              Exportar modelo
            </h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              La descarga se genera en tu navegador.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Cerrar dialogo"
            onClick={close}
            disabled={busy}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>

        <div className="space-y-4">
          <SelectField
            label="Formato"
            value={format}
            onChange={(event) => {
              setFormat(event.target.value as ExportFormat);
              setStatus("idle");
              setError(null);
            }}
            options={FORMAT_OPTIONS}
            hint={FORMAT_HINTS[format]}
            disabled={busy}
          />

          <SelectField
            label="Unidades"
            value={unit}
            onChange={(event) => setUnit(event.target.value as ExportUnit)}
            options={UNIT_OPTIONS}
            hint={
              unitRelevant
                ? "Las coordenadas se escalan desde metros y el archivo declara la unidad."
                : "La captura PNG no usa unidades: el tamano son pixeles del visor."
            }
            disabled={busy || !unitRelevant}
          />

          <label
            className={cn(
              "flex items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-3 py-2",
              !furnitureRelevant && "opacity-60",
            )}
          >
            <span className="text-sm text-ink">
              Incluir mobiliario
              <span className="block text-xs text-ink-subtle">
                {furnitureRelevant
                  ? "Piezas del catalogo presentes en la escena 3D."
                  : format === "png"
                    ? "PNG captura el visor tal como se ve; oculta piezas en el outliner si no las quieres."
                    : "No aplica en DXF: la planta 2D no incluye mobiliario."}
              </span>
            </span>
            <input
              type="checkbox"
              checked={furnitureRelevant && includeFurniture}
              disabled={!furnitureRelevant || busy}
              onChange={(event) => setIncludeFurniture(event.target.checked)}
              className="size-4 shrink-0 accent-[var(--accent)]"
            />
          </label>

          <label
            className={cn(
              "flex items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-3 py-2",
              !materialsRelevant && "opacity-60",
            )}
          >
            <span className="text-sm text-ink">
              Incluir materiales
              <span className="block text-xs text-ink-subtle">
                {materialsRelevant
                  ? "Colores PBR y texturas embebidos o en textures/."
                  : format === "png"
                    ? "PNG usa los materiales ya aplicados en el visor."
                    : format === "stl"
                      ? "STL es geometrico: los materiales se ignoran."
                      : "DXF trabaja con lineas: no lleva materiales."}
              </span>
            </span>
            <input
              type="checkbox"
              checked={materialsRelevant && includeMaterials}
              disabled={!materialsRelevant || busy}
              onChange={(event) => setIncludeMaterials(event.target.checked)}
              className="size-4 shrink-0 accent-[var(--accent)]"
            />
          </label>

          <div aria-live="polite">
            {status === "error" && error ? (
              <p id={errorId} role="alert" className="text-xs text-danger">
                {error}
              </p>
            ) : null}
            {status === "success" ? (
              <p role="status" className="text-xs text-ok">
                Descarga iniciada. Este dialogo se cerrara solo.
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancelar
          </Button>
          <Button
            onClick={() => void runExport()}
            loading={busy}
            disabled={status === "success"}
            title="Generar y descargar"
          >
            <Download className="size-4" aria-hidden />
            Exportar
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Descarga local via object URL. Se revoca pasados unos segundos para no
 * dejar URLs colgadas sin cortar la descarga en curso.
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
