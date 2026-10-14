"use client";

import { useEffect, useState } from "react";
import { computeSceneMetrics, formatArea } from "@archvision/shared";
import { hasUnsavedChanges, useEditorStore } from "@/lib/editor/store";
import { cn } from "@/lib/utils";

/** Medidor de fotogramas por segundo, independiente del lienzo. */
function useFps(): number {
  const [fps, setFps] = useState(0);

  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let handle = 0;

    const loop = (now: number) => {
      frames += 1;
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      handle = requestAnimationFrame(loop);
    };

    handle = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(handle);
  }, []);

  return fps;
}

const TOOL_HINTS: Record<string, string> = {
  select: "Clic para seleccionar · arrastra nodos para mover paredes",
  pan: "Arrastra con clic izquierdo para voltear/rotar la vista 3D · Clic derecho para desplazar · Rueda para zoom",
  wall: "Clic para el primer punto, clic para cerrar el tramo · Esc cancela",
  door: "Clic sobre una pared para colocar la puerta",
  window: "Clic sobre una pared para colocar la ventana",
  column: "Clic para situar la columna",
  stair: "Clic para situar la escalera",
  furniture: "Clic para colocar el mueble seleccionado",
  measure: "Clic en dos puntos para medir",
};

export function EditorStatusBar() {
  const fps = useFps();
  const scene = useEditorStore((state) => state.scene);
  const units = useEditorStore((state) => state.units);
  const tool = useEditorStore((state) => state.tool);
  const snapEnabled = useEditorStore((state) => state.snapEnabled);
  const gridStep = useEditorStore((state) => state.gridStep);
  const showGrid = useEditorStore((state) => state.showGrid);
  const saveStatus = useEditorStore((state) => state.saveStatus);
  const saveError = useEditorStore((state) => state.saveError);
  const lastSavedAt = useEditorStore((state) => state.lastSavedAt);
  const setSnapEnabled = useEditorStore((state) => state.setSnapEnabled);
  const setGridStep = useEditorStore((state) => state.setGridStep);
  const setShowGrid = useEditorStore((state) => state.setShowGrid);

  const metrics = computeSceneMetrics(scene);

  const pending = hasUnsavedChanges({ saveStatus });
  let syncLabel: string;
  if (!pending) {
    syncLabel = lastSavedAt
      ? `Guardado ${new Date(lastSavedAt).toLocaleTimeString("es-CO", {
          hour: "2-digit",
          minute: "2-digit",
        })}`
      : "Guardado";
  } else if (saveStatus === "saving") {
    syncLabel = "Guardando...";
  } else if (saveStatus === "error") {
    syncLabel = "Pendiente · error al guardar";
  } else if (saveStatus === "conflict") {
    syncLabel = "Pendiente · conflicto de version";
  } else {
    syncLabel = "Pendiente";
  }

  return (
    <footer className="flex h-8 shrink-0 items-center gap-4 border-t border-line bg-surface px-3 text-[11px] text-ink-subtle">
      <span className="truncate">{TOOL_HINTS[tool] ?? ""}</span>

      <div className="ml-auto flex items-center gap-3">
        <span className="font-mono">
          {scene.walls.length} paredes · {metrics.roomCount} habitaciones ·{" "}
          {formatArea(metrics.usableArea, units)}
        </span>

        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={snapEnabled}
            onChange={(event) => setSnapEnabled(event.target.checked)}
            className="size-3 accent-[var(--accent)]"
          />
          Snap
        </label>

        <label className="flex items-center gap-1">
          <span>Rejilla</span>
          <select
            value={gridStep}
            onChange={(event) => setGridStep(Number(event.target.value))}
            className="h-5 rounded border border-line bg-surface px-1 text-[10px] text-ink"
            aria-label="Paso de rejilla"
          >
            <option value={0.05}>5 cm</option>
            <option value={0.1}>10 cm</option>
            <option value={0.25}>25 cm</option>
            <option value={0.5}>50 cm</option>
            <option value={1}>1 m</option>
          </select>
        </label>

        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={showGrid}
            onChange={(event) => setShowGrid(event.target.checked)}
            className="size-3 accent-[var(--accent)]"
          />
          Ver rejilla
        </label>

        <span className="font-mono">{units}</span>
        <span className="font-mono">{fps} FPS</span>

        <span
          className={cn(
            "font-mono",
            saveStatus === "saved" && "text-ok",
            saveStatus === "dirty" && "text-warn",
            (saveStatus === "error" || saveStatus === "conflict") && "text-danger",
          )}
          title={saveError ?? undefined}
        >
          {syncLabel}
        </span>
      </div>
    </footer>
  );
}
