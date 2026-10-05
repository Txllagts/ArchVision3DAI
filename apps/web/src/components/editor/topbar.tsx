"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  Box,
  Camera,
  Clipboard,
  Copy,
  Home,
  Layers,
  Maximize2,
  Image as ImageIcon,
  Palette,
  Plus,
  Redo2,
  Save,
  Sparkles,
  Square,
  Trash2,
  Undo2,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { useEditorStore, useHistoryFlags } from "@/lib/editor/store";
import { cn } from "@/lib/utils";

/** Barra superior: proyecto, historial, niveles, vistas y guardado. */
export function EditorTopBar({ onSave }: { onSave: () => void }) {
  const projectId = useEditorStore((state) => state.projectId);
  const projectName = useEditorStore((state) => state.projectName);
  const scene = useEditorStore((state) => state.scene);
  const activeFloorId = useEditorStore((state) => state.activeFloorId);
  const viewMode = useEditorStore((state) => state.viewMode);
  const saveStatus = useEditorStore((state) => state.saveStatus);
  const materialsOpen = useEditorStore((state) => state.materialsOpen);
  const setMaterialsOpen = useEditorStore((state) => state.setMaterialsOpen);
  const planPanelOpen = useEditorStore((state) => state.planPanelOpen);
  const setPlanPanelOpen = useEditorStore((state) => state.setPlanPanelOpen);
  const assistantOpen = useEditorStore((state) => state.assistantOpen);
  const setAssistantOpen = useEditorStore((state) => state.setAssistantOpen);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const selection = useEditorStore((state) => state.selection);
  const clipboard = useEditorStore((state) => state.clipboard);
  const copySelection = useEditorStore((state) => state.copySelection);
  const pasteSelection = useEditorStore((state) => state.pasteSelection);
  const dispatch = useEditorStore((state) => state.dispatch);
  const setActiveFloor = useEditorStore((state) => state.setActiveFloor);
  const setViewMode = useEditorStore((state) => state.setViewMode);
  const requestView = useEditorStore((state) => state.requestView);
  const { canUndo, canRedo } = useHistoryFlags();
  const [roofOpen, setRoofOpen] = useState(false);

  const statusLabel: Record<typeof saveStatus, string> = {
    saved: "Guardado",
    dirty: "Cambios sin guardar",
    saving: "Guardando...",
    error: "Error al guardar",
    conflict: "Conflicto de version",
  };

  const statusTone: Record<typeof saveStatus, string> = {
    saved: "text-ok",
    dirty: "text-warn",
    saving: "text-accent",
    error: "text-danger",
    conflict: "text-danger",
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
      <Link href={`/projects/${projectId}`} title="Volver al proyecto">
        <span className="flex items-center gap-2 text-ink-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden />
          <Logo collapsed />
        </span>
      </Link>

      <span className="max-w-48 truncate text-sm font-medium text-ink">
        {projectName}
      </span>

      <div className="mx-1 h-5 w-px bg-line" />

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={undo}
          disabled={!canUndo}
          title="Deshacer (Ctrl+Z)"
          aria-label="Deshacer"
        >
          <Undo2 className="size-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={redo}
          disabled={!canRedo}
          title="Rehacer (Ctrl+Shift+Z)"
          aria-label="Rehacer"
        >
          <Redo2 className="size-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={copySelection}
          disabled={selection.length === 0}
          title="Copiar selección (Ctrl+C)"
          aria-label="Copiar selección"
        >
          <Copy className="size-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={pasteSelection}
          disabled={!clipboard}
          title="Pegar selección (Ctrl+V)"
          aria-label="Pegar selección"
        >
          <Clipboard className="size-4" aria-hidden />
        </Button>
      </div>

      <div className="mx-1 h-5 w-px bg-line" />

      {/* Niveles */}
      <div className="flex items-center gap-1">
        <Layers className="size-4 text-ink-subtle" aria-hidden />
        <select
          value={activeFloorId ?? ""}
          onChange={(event) => setActiveFloor(event.target.value)}
          aria-label="Nivel activo"
          className="h-8 rounded-md border border-line bg-surface px-2 text-xs text-ink"
        >
          {scene.floors.map((floor) => (
            <option key={floor.id} value={floor.id}>
              {floor.name}
            </option>
          ))}
        </select>
        <Button
          variant="ghost"
          size="icon"
          title="Agregar planta"
          aria-label="Agregar planta"
          onClick={() => dispatch({ type: "CREATE_FLOOR" })}
        >
          <Plus className="size-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title={
            scene.floors.length > 1
              ? "Eliminar planta actual"
              : "No se puede eliminar la única planta"
          }
          aria-label="Eliminar planta actual"
          disabled={scene.floors.length <= 1}
          onClick={() => {
            if (activeFloorId && scene.floors.length > 1) {
              dispatch({ type: "DELETE_OBJECTS", ids: [activeFloorId] });
            }
          }}
          className="text-ink-muted hover:text-danger disabled:opacity-30"
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>

      {/* Cubierta */}
      <div className="relative">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRoofOpen((open) => !open)}
          title="Agregar cubierta"
        >
          <Home className="size-4" aria-hidden />
          Cubierta
        </Button>
        {roofOpen ? (
          <div className="absolute left-0 top-9 z-30 w-40 overflow-hidden rounded-md border border-line bg-surface shadow-lg">
            {(
              [
                ["gable", "Dos aguas"],
                ["hip", "Cuatro aguas"],
                ["shed", "Una pendiente"],
                ["flat", "Plana"],
              ] as const
            ).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                className="block w-full px-3 py-2 text-left text-xs text-ink hover:bg-surface-2"
                onClick={() => {
                  if (activeFloorId) {
                    dispatch({ type: "CREATE_ROOF", floorId: activeFloorId, kind });
                  }
                  setRoofOpen(false);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Materiales */}
      <Button
        variant="ghost"
        size="sm"
        title="Biblioteca de materiales (G)"
        onClick={() => setMaterialsOpen(!materialsOpen)}
        className={materialsOpen ? "text-accent" : undefined}
      >
        <Palette className="size-4" aria-hidden />
        Materiales
      </Button>

      <Button
        variant="ghost"
        size="sm"
        title="Importar un plano y calcarlo"
        onClick={() => setPlanPanelOpen(!planPanelOpen)}
        className={planPanelOpen ? "text-accent" : undefined}
      >
        <ImageIcon className="size-4" aria-hidden />
        Plano
      </Button>

      <Button
        variant="ghost"
        size="sm"
        title="Asistente, revision y tutorial (A)"
        onClick={() => setAssistantOpen(!assistantOpen)}
        className={assistantOpen ? "text-accent" : undefined}
      >
        <Sparkles className="size-4" aria-hidden />
        Asistente
      </Button>

      <div className="ml-auto flex items-center gap-1">
        {/* Vistas */}
        <Button
          variant="ghost"
          size="icon"
          title="Centrar modelo (F)"
          aria-label="Centrar modelo"
          onClick={() => requestView("fit")}
        >
          <Maximize2 className="size-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Vista en perspectiva (0)"
          aria-label="Vista en perspectiva"
          onClick={() => requestView("perspective")}
        >
          <Camera className="size-4" aria-hidden />
        </Button>

        {/* Modo de vista */}
        <div className="ml-1 flex overflow-hidden rounded-md border border-line">
          {(
            [
              ["2d", "2D", Square],
              ["3d", "3D", Box],
              ["split", "Split", Layers],
            ] as const
          ).map(([mode, label, Icon]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              aria-pressed={viewMode === mode}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1.5 text-[11px] transition-colors",
                viewMode === mode
                  ? "bg-accent/15 text-accent"
                  : "text-ink-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>

        <span className={cn("ml-2 text-[11px]", statusTone[saveStatus])}>
          {statusLabel[saveStatus]}
        </span>

        <Button size="sm" onClick={onSave} title="Guardar (Ctrl+S)">
          <Save className="size-4" aria-hidden />
          Guardar
        </Button>
      </div>
    </header>
  );
}
