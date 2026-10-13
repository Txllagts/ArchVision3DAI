"use client";

import { Pause, Play, X } from "lucide-react";
import { useSunStudyStore } from "@archvision/three-engine";
import { cn } from "@/lib/utils";

export function SunStudyControls() {
  const open = useSunStudyStore((state) => state.sunPanelOpen);
  const sunTime = useSunStudyStore((state) => state.sunTime);
  const isLapsePlaying = useSunStudyStore((state) => state.isLapsePlaying);
  const setSunTime = useSunStudyStore((state) => state.setSunTime);
  const setLapsePlaying = useSunStudyStore((state) => state.setLapsePlaying);
  const setSunPanelOpen = useSunStudyStore((state) => state.setSunPanelOpen);

  if (!open) return null;

  return (
    <div className="absolute bottom-4 left-4 z-20 w-72 rounded-panel border border-line bg-surface/95 p-4 shadow-xl backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold text-ink">Estudio solar</h2>
        <button
          type="button"
          aria-label="Cerrar estudio solar"
          onClick={() => setSunPanelOpen(false)}
          className="text-ink-subtle hover:text-ink"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>

      <label className="mt-3 block text-[11px] text-ink-subtle">
        Hora (0 - 23)
        <input
          type="number"
          min={0}
          max={23}
          step={1}
          value={sunTime}
          onChange={(event) => setSunTime(Number(event.target.value))}
          className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
        />
      </label>

      <button
        type="button"
        onClick={() => setLapsePlaying(!isLapsePlaying)}
        className={cn(
          "mt-4 flex w-full items-center justify-center gap-2 rounded-md border px-2 py-1.5 text-[11px] font-medium transition-colors",
          isLapsePlaying
            ? "border-accent/50 bg-accent/15 text-accent"
            : "border-line text-ink-muted hover:bg-surface-2 hover:text-ink",
        )}
      >
        {isLapsePlaying ? (
          <Pause className="size-3.5" aria-hidden />
        ) : (
          <Play className="size-3.5" aria-hidden />
        )}
        {isLapsePlaying ? "Pausar recorrido" : "Reproducir dia"}
      </button>
    </div>
  );
}
