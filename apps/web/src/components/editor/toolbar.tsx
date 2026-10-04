"use client";

import {
  Armchair,
  Columns3,
  DoorOpen,
  Hand,
  MousePointer2,
  Move3d,
  PaintBucket,
  Scaling,
  PanelTop,
  Ruler,
  Slash,
} from "lucide-react";
import { useEditorStore, type ToolId } from "@/lib/editor/store";
import { cn } from "@/lib/utils";

/** Herramientas del editor arquitectónico con metadatos técnicos. */
const TOOLS: Array<{
  id: ToolId;
  label: string;
  description: string;
  shortcut: string;
  category: string;
  icon: typeof MousePointer2;
}> = [
  {
    id: "select",
    label: "Seleccionar",
    description: "Editar nodos, mover y rotar objetos",
    shortcut: "V",
    category: "Edición",
    icon: MousePointer2,
  },
  {
    id: "pan",
    label: "Mover vista",
    description: "Desplazamiento y órbita de cámara",
    shortcut: "H",
    category: "Navegación",
    icon: Hand,
  },
  {
    id: "wall",
    label: "Pared",
    description: "Trazar muros continuos con snapping",
    shortcut: "L",
    category: "Estructura",
    icon: Slash,
  },
  {
    id: "door",
    label: "Puerta",
    description: "Apertura de vano y batiente en muro",
    shortcut: "P",
    category: "Vanos",
    icon: DoorOpen,
  },
  {
    id: "window",
    label: "Ventana",
    description: "Vano acristalado paramétrico",
    shortcut: "N",
    category: "Vanos",
    icon: PanelTop,
  },
  {
    id: "column",
    label: "Columna",
    description: "Pilar estructural de hormigón/acero",
    shortcut: "C",
    category: "Estructura",
    icon: Columns3,
  },
  {
    id: "stair",
    label: "Escalera",
    description: "Tramo recto o en L entre niveles",
    shortcut: "S",
    category: "Circulación",
    icon: Move3d,
  },
  {
    id: "furniture",
    label: "Mobiliario",
    description: "Catálogo de equipamiento y sanitarios",
    shortcut: "B",
    category: "Elementos",
    icon: Armchair,
  },
  {
    id: "paint",
    label: "Pintar material",
    description: "Aplicar texturas PBR con clic/arrastre",
    shortcut: "G",
    category: "Acabados",
    icon: PaintBucket,
  },
  {
    id: "calibrate",
    label: "Calibrar plano",
    description: "Fijar escala real con cota conocida",
    shortcut: "K",
    category: "Planimetría",
    icon: Scaling,
  },
  {
    id: "measure",
    label: "Medir",
    description: "Cota milimétrica entre 2 puntos",
    shortcut: "M",
    category: "Anotación",
    icon: Ruler,
  },
];

export function EditorToolbar() {
  const tool = useEditorStore((state) => state.tool);
  const setTool = useEditorStore((state) => state.setTool);

  return (
    <nav
      aria-label="Barra de herramientas de diseño"
      className="relative z-30 flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-2"
    >
      {TOOLS.map((item) => {
        const Icon = item.icon;
        const active = tool === item.id;
        return (
          <div key={item.id} className="group relative flex items-center">
            <button
              type="button"
              onClick={() => setTool(item.id)}
              aria-label={`${item.label} (${item.shortcut})`}
              aria-pressed={active}
              className={cn(
                "relative grid size-9 place-items-center rounded-md border cursor-pointer",
                "transition-[transform,background-color,border-color,color,box-shadow] duration-150 ease-out",
                "hover:scale-105 active:scale-95",
                active
                  ? "border-accent/70 bg-accent/15 text-accent shadow-[0_0_14px_-2px_rgb(46_167_242/0.45)]"
                  : "border-transparent text-ink-muted hover:border-line-strong hover:bg-surface-2 hover:text-ink",
              )}
            >
              <Icon className="size-4" aria-hidden />
            </button>

            {/* Tarjeta flotante técnica (estilo HUD / CAD del editor) */}
            <div
              role="tooltip"
              className={cn(
                "pointer-events-none absolute left-full ml-3 z-50 min-w-[210px]",
                "rounded-md border border-line-strong bg-surface-2/95 p-2.5 shadow-[0_12px_32px_-4px_rgba(0,0,0,0.85),0_0_1px_1px_rgba(46,167,242,0.25)] backdrop-blur-md",
                "opacity-0 scale-95 -translate-x-1",
                "transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]",
                "group-hover:opacity-100 group-hover:scale-100 group-hover:translate-x-0",
              )}
            >
              {/* Encabezado: Categoría y atajo */}
              <div className="flex items-center justify-between gap-2 pb-1 border-b border-line/60">
                <span className="font-mono text-[9px] font-semibold uppercase tracking-wider text-accent">
                  {item.category}
                </span>
                <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded border border-accent/40 bg-accent/15 px-1 font-mono text-[9px] font-bold text-accent shadow-sm">
                  {item.shortcut}
                </kbd>
              </div>

              {/* Título de herramienta */}
              <div className="pt-1.5">
                <p className="text-xs font-semibold text-ink leading-tight">
                  {item.label}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">
                  {item.description}
                </p>
              </div>

              {/* Flecha indicadora de acople lateral */}
              <span
                aria-hidden
                className="absolute -left-[5px] top-1/2 -translate-y-1/2 size-2.5 rotate-45 border-b border-l border-line-strong bg-surface-2"
              />
            </div>
          </div>
        );
      })}
    </nav>
  );
}
