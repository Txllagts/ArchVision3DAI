"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  FURNITURE_CATALOG,
  FURNITURE_CATEGORY_LABELS,
} from "@archvision/shared";
import type { SceneDocument, UnitSystem } from "@archvision/types";
import { useEditorStore } from "@/lib/editor/store";
import { useAutosave } from "@/lib/editor/use-autosave";
import { useEditorShortcuts } from "@/lib/editor/use-shortcuts";
import { EditorTopBar } from "./topbar";
import { EditorToolbar } from "./toolbar";
import { Outliner } from "./outliner";
import { Inspector } from "./inspector";
import { EditorStatusBar } from "./status-bar";
import { CommandPalette } from "./command-palette";
import { ExportModal } from "./export-modal";
import { ConflictModal } from "./conflict-modal";
import { MaterialsPanel } from "./materials-panel";
import { PlanImportPanel } from "./plan-import-panel";
import { AssistantPanel } from "./assistant-panel";
import { Viewport2D } from "./viewport-2d";
import { cn } from "@/lib/utils";

/**
 * Contenedor del editor.
 *
 * El visor 3D se carga solo en el cliente: WebGL no existe durante el
 * renderizado en servidor y no aporta nada al HTML inicial.
 */
const Viewport3D = dynamic(
  () => import("./viewport-3d").then((module) => module.Viewport3D),
  {
    ssr: false,
    loading: () => (
      <div className="grid size-full place-items-center bg-[#0d1117] text-xs text-ink-subtle">
        Cargando visor 3D...
      </div>
    ),
  },
);

const ONBOARDING_KEY = "archvision.editor.onboarding";

const ONBOARDING_STEPS = [
  "Orbita con el boton izquierdo, desplaza con el derecho y acerca con la rueda.",
  "Pulsa L y traza paredes con clics; cada tramo continua en el punto anterior.",
  "Pulsa P o N y haz clic sobre una pared para colocar puertas o ventanas.",
  "Los cambios se guardan solos; Ctrl+S fuerza el guardado.",
];

function OnboardingCard() {
  const [visible, setVisible] = useState(false);
  const assistantOpen = useEditorStore((state) => state.assistantOpen);
  const setAssistantOpen = useEditorStore((state) => state.setAssistantOpen);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setVisible(window.localStorage.getItem(ONBOARDING_KEY) !== "done");
  }, []);

  // Ambos ocupan la esquina superior derecha, y el asistente dice lo mismo
  // mejor: en cuanto se abre, esta tarjeta sobra.
  if (!visible || assistantOpen) return null;

  return (
    <div className="absolute right-4 top-4 z-20 w-72 rounded-panel border border-line bg-surface/95 p-4 shadow-xl backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-xs font-semibold text-ink">Primeros pasos</h2>
        <button
          type="button"
          aria-label="Cerrar ayuda"
          onClick={() => {
            window.localStorage.setItem(ONBOARDING_KEY, "done");
            setVisible(false);
          }}
          className="text-ink-subtle hover:text-ink"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <ol className="mt-3 space-y-2 text-[11px] leading-relaxed text-ink-muted">
        {ONBOARDING_STEPS.map((step, index) => (
          <li key={step} className="flex gap-2">
            <span className="font-mono text-accent">{index + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={() => setAssistantOpen(true)}
        className="mt-3 w-full rounded bg-accent px-2 py-1 text-[11px] font-medium text-accent-ink hover:opacity-90"
      >
        Abrir el asistente (A)
      </button>
    </div>
  );
}

/** Selector de mobiliario visible solo con la herramienta activa. */
function FurniturePicker() {
  const tool = useEditorStore((state) => state.tool);
  const catalogId = useEditorStore((state) => state.furnitureCatalogId);
  const setCatalogId = useEditorStore((state) => state.setFurnitureCatalogId);

  if (tool !== "furniture") return null;

  return (
    <div className="absolute left-4 top-4 z-20 max-h-72 w-56 overflow-y-auto rounded-panel border border-line bg-surface/95 p-2 shadow-xl backdrop-blur">
      <p className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
        Biblioteca de mobiliario
      </p>
      {FURNITURE_CATALOG.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => setCatalogId(item.id)}
          className={cn(
            "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px]",
            catalogId === item.id
              ? "bg-accent/15 text-accent"
              : "text-ink-muted hover:bg-surface-2 hover:text-ink",
          )}
        >
          <span
            aria-hidden
            className="size-3 rounded-sm"
            style={{ backgroundColor: item.color }}
          />
          <span className="flex-1 truncate">{item.name}</span>
          <span className="text-[9px] text-ink-subtle">
            {FURNITURE_CATEGORY_LABELS[item.category]}
          </span>
        </button>
      ))}
    </div>
  );
}

function MessageToast() {
  const message = useEditorStore((state) => state.message);
  const setMessage = useEditorStore((state) => state.setMessage);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message, setMessage]);

  if (!message) return null;

  return (
    <div
      role="status"
      className={cn(
        "absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-md border px-3 py-2 text-xs shadow-lg",
        message.kind === "error"
          ? "border-danger/50 bg-danger/15 text-danger"
          : "border-accent/50 bg-accent/15 text-accent",
      )}
    >
      {message.text}
    </div>
  );
}

export function EditorShell({
  project,
  scene,
  revision,
}: {
  project: { id: string; name: string; units: UnitSystem };
  scene: SceneDocument;
  revision: number;
}) {
  const initialize = useEditorStore((state) => state.initialize);
  const viewMode = useEditorStore((state) => state.viewMode);
  const { saveNow } = useAutosave();
  const initializedProjectId = useRef<string | null>(null);

  useEditorShortcuts({ onSave: () => void saveNow() });

  useEffect(() => {
    if (initializedProjectId.current === project.id) return;
    initializedProjectId.current = project.id;
    initialize({
      projectId: project.id,
      projectName: project.name,
      units: project.units,
      scene,
      revision,
    });
  }, [initialize, project.id, project.name, project.units, scene, revision]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      <EditorTopBar onSave={() => void saveNow()} />

      <div className="flex min-h-0 flex-1">
        <EditorToolbar />

        <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          {/*
            Cada panel necesita `min-w-0 min-h-0` y recorte propio: el lienzo
            de WebGL mide a su contenedor y, si este puede crecer con su
            contenido, el par lienzo/contenedor entra en una realimentacion
            que hace crecer el canvas sin limite.
          */}
          {/*
            Ambos visores permanecen montados y solo se ocultan por CSS. Al
            desmontar el lienzo se destruia su contexto de WebGL y el visor
            volvia en negro tras cambiar de modo; conservarlo tambien hace el
            cambio instantaneo.
          */}
          <div className="flex size-full divide-x divide-line">
            <div
              className={cn(
                "relative min-h-0 min-w-0 overflow-hidden",
                viewMode === "3d" ? "hidden" : "flex-1",
              )}
            >
              <Viewport2D />
            </div>
            <div
              className={cn(
                "relative min-h-0 min-w-0 overflow-hidden",
                viewMode === "2d" ? "hidden" : "flex-1",
              )}
            >
              <Viewport3D />
            </div>
          </div>

          <FurniturePicker />
          <MaterialsPanel />
          <PlanImportPanel />
          <AssistantPanel onSave={saveNow} />
          <OnboardingCard />
          <MessageToast />
        </main>

        <aside className="flex w-72 shrink-0 flex-col border-l border-line bg-surface">
          <Outliner />
          <Inspector />
        </aside>
      </div>

      <EditorStatusBar />
      <CommandPalette onSave={() => void saveNow()} />
      <ExportModal />
      <ConflictModal />
    </div>
  );
}
