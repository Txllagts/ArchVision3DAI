"use client";

import { useMemo, useState } from "react";
import { useEditorStore } from "@/lib/editor/store";

/**
 * Paleta de comandos (Ctrl + K).
 *
 * Expone las mismas acciones que la interfaz, no un canal paralelo: cada
 * entrada termina llamando al mismo store.
 */

interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export function CommandPalette({ onSave }: { onSave: () => void }) {
  const open = useEditorStore((state) => state.paletteOpen);
  const setOpen = useEditorStore((state) => state.setPaletteOpen);
  const [query, setQuery] = useState("");

  const actions = useMemo<PaletteAction[]>(() => {
    const store = useEditorStore.getState();
    const floorId = store.activeFloorId;

    return [
      { id: "tool-select", label: "Herramienta: seleccionar", hint: "V", run: () => store.setTool("select") },
      { id: "tool-pan", label: "Herramienta: mover y rotar vista 3D", hint: "H", run: () => store.setTool("pan") },
      { id: "tool-wall", label: "Herramienta: crear pared", hint: "L", run: () => store.setTool("wall") },
      { id: "tool-door", label: "Herramienta: agregar puerta", hint: "P", run: () => store.setTool("door") },
      { id: "tool-window", label: "Herramienta: agregar ventana", hint: "N", run: () => store.setTool("window") },
      { id: "tool-measure", label: "Herramienta: medir", hint: "M", run: () => store.setTool("measure") },
      { id: "floor-add", label: "Agregar planta", run: () => store.dispatch({ type: "CREATE_FLOOR" }) },
      {
        id: "floor-delete",
        label: "Eliminar planta actual",
        run: () => {
          if (floorId && store.scene.floors.length > 1) {
            store.dispatch({ type: "DELETE_OBJECTS", ids: [floorId] });
          }
        },
      },
      {
        id: "assistant",
        label: "Abrir el asistente",
        hint: "A",
        run: () => store.setAssistantOpen(true),
      },
      {
        id: "assistant-review",
        label: "Revisar el modelo",
        run: () => store.setAssistantOpen(true),
      },
      {
        id: "roof-gable",
        label: "Agregar cubierta a dos aguas",
        run: () => {
          if (floorId) store.dispatch({ type: "CREATE_ROOF", floorId, kind: "gable" });
        },
      },
      {
        id: "roof-flat",
        label: "Agregar cubierta plana",
        run: () => {
          if (floorId) store.dispatch({ type: "CREATE_ROOF", floorId, kind: "flat" });
        },
      },
      { id: "view-2d", label: "Cambiar a vista 2D", run: () => store.setViewMode("2d") },
      { id: "view-3d", label: "Cambiar a vista 3D", run: () => store.setViewMode("3d") },
      { id: "view-split", label: "Cambiar a vista dividida", run: () => store.setViewMode("split") },
      { id: "view-top", label: "Vista superior", hint: "3", run: () => store.requestView("top") },
      { id: "view-front", label: "Vista frontal", hint: "1", run: () => store.requestView("front") },
      { id: "view-fit", label: "Centrar modelo", hint: "F", run: () => store.requestView("fit") },
      { id: "undo", label: "Deshacer", hint: "Ctrl+Z", run: () => store.undo() },
      { id: "redo", label: "Rehacer", hint: "Ctrl+Shift+Z", run: () => store.redo() },
      { id: "copy", label: "Copiar selección", hint: "Ctrl+C", run: () => store.copySelection() },
      { id: "paste", label: "Pegar selección", hint: "Ctrl+V", run: () => store.pasteSelection() },
      { id: "save", label: "Guardar proyecto", hint: "Ctrl+S", run: onSave },
      {
        id: "export",
        label: "Exportar modelo (GLB, OBJ, STL, DXF)",
        hint: "Ctrl+E",
        run: () => store.setExportOpen(true),
      },
    ];
  }, [onSave]);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return actions;
    return actions.filter((action) => action.label.toLowerCase().includes(text));
  }, [actions, query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-start justify-center bg-black/50 pt-32"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-panel border border-line bg-surface shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Paleta de comandos"
      >
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar accion..."
          className="w-full border-b border-line bg-transparent px-4 py-3 text-sm text-ink outline-none placeholder:text-ink-subtle"
        />
        <ul className="max-h-80 overflow-y-auto py-1">
          {filtered.map((action) => (
            <li key={action.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-4 py-2 text-left text-xs text-ink hover:bg-surface-2"
                onClick={() => {
                  action.run();
                  setOpen(false);
                  setQuery("");
                }}
              >
                <span>{action.label}</span>
                {action.hint ? (
                  <span className="font-mono text-[10px] text-ink-subtle">
                    {action.hint}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
          {filtered.length === 0 ? (
            <li className="px-4 py-6 text-center text-xs text-ink-subtle">
              Sin resultados
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
