"use client";

import { useCallback, useEffect } from "react";
import { getSceneSaver } from "./scene-save";
import { hasUnsavedChanges, useEditorStore } from "./store";

/**
 * Autoguardado.
 *
 * El ciclo de guardado vive en `scene-save`: debounce, un unico request en
 * vuelo con coalescing del estado mas reciente, descarte de respuestas
 * obsoletas y reintentos con backoff. Este hook solo gestiona el ciclo de
 * vida del controlador y el aviso al cerrar la pestana.
 */

export function useAutosave() {
  const saveNow = useCallback(() => getSceneSaver().saveNow(), []);

  useEffect(() => {
    const saver = getSceneSaver();
    saver.start();
    return () => saver.stop();
  }, []);

  // Aviso al cerrar la pestana con cambios sin guardar.
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (hasUnsavedChanges(useEditorStore.getState())) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  return { saveNow };
}
