"use client";

import { useShallow } from "zustand/react/shallow";
import { useEditorStore } from "@/lib/editor/store";

const SIZE = 44;

export function CompassWidget() {
  const { viewMode, assistantOpen, planPanelOpen, materialsOpen } =
    useEditorStore(
      useShallow((state) => ({
        viewMode: state.viewMode,
        assistantOpen: state.assistantOpen,
        planPanelOpen: state.planPanelOpen,
        materialsOpen: state.materialsOpen,
      })),
    );

  // Visor 3D (3d o split) y ningun panel lateral abierto.
  const isVisible =
    viewMode !== "2d" && !assistantOpen && !planPanelOpen && !materialsOpen;
  if (!isVisible) return null;

  const resetNorth = () => {
    window.dispatchEvent(new CustomEvent("reset-compass"));
  };

  return (
    <button
      type="button"
      onClick={resetNorth}
      title="Volver al norte"
      aria-label="Volver al norte"
      // Posición relativa al <main> del visor 3D.
      // Si el layout cambia, revisar offset.
      className="absolute right-4 top-4 z-50 grid place-items-center rounded-full opacity-[0.85] shadow-md transition-opacity duration-150 hover:opacity-100"
      style={{ width: SIZE, height: SIZE, backgroundColor: "#1a1a2e" }}
    >
      <span
        className="block"
        style={{ transform: "rotate(var(--compass-angle, 0rad))" }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
          <polygon points="12,2 17,12 7,12" fill="#ef4444" />
          <polygon points="7,12 17,12 12,22" fill="#94a3b8" />
        </svg>
      </span>
    </button>
  );
}
