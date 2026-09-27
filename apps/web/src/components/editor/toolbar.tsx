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

/** Barra de herramientas del editor. */
const TOOLS: Array<{
  id: ToolId;
  label: string;
  shortcut: string;
  icon: typeof MousePointer2;
}> = [
  { id: "select", label: "Seleccionar", shortcut: "V", icon: MousePointer2 },
  { id: "pan", label: "Mover y rotar vista 3D", shortcut: "H", icon: Hand },
  { id: "wall", label: "Pared", shortcut: "L", icon: Slash },
  { id: "door", label: "Puerta", shortcut: "P", icon: DoorOpen },
  { id: "window", label: "Ventana", shortcut: "N", icon: PanelTop },
  { id: "column", label: "Columna", shortcut: "C", icon: Columns3 },
  { id: "stair", label: "Escalera", shortcut: "S", icon: Move3d },
  { id: "furniture", label: "Mobiliario", shortcut: "B", icon: Armchair },
  { id: "paint", label: "Pintar material", shortcut: "G", icon: PaintBucket },
  { id: "calibrate", label: "Calibrar plano", shortcut: "K", icon: Scaling },
  { id: "measure", label: "Medir", shortcut: "M", icon: Ruler },
];

export function EditorToolbar() {
  const tool = useEditorStore((state) => state.tool);
  const setTool = useEditorStore((state) => state.setTool);

  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-2">
      {TOOLS.map((item) => {
        const Icon = item.icon;
        const active = tool === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => setTool(item.id)}
            title={`${item.label} (${item.shortcut})`}
            aria-label={item.label}
            aria-pressed={active}
            className={cn(
              "grid size-9 place-items-center rounded-md border transition-colors",
              active
                ? "border-accent/50 bg-accent/15 text-accent"
                : "border-transparent text-ink-muted hover:bg-surface-2 hover:text-ink",
            )}
          >
            <Icon className="size-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
