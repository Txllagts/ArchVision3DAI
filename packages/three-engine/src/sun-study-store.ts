"use client";

import { create } from "zustand";

/** Hora local del sitio; Bogota no aplica horario de verano. */
export const SITE_UTC_OFFSET = -5;

// TODO: vincular a la ubicacion del proyecto (project.location /
// SceneEnvironment.latitude y longitude) cuando exista la geolocalizacion.
export const SITE_LAT = 4.6097;
export const SITE_LNG = -74.0817;

/** Velocidad del time-lapse: una hora entera por segundo real. */
export const SUN_LAPSE_HOURS_PER_SECOND = 1;

/** Fecha fija de estudio: 21 de marzo (equinoccio), ano en curso. */
export const DEFAULT_DATE = new Date(new Date().getFullYear(), 2, 21);

/** Instante del sitio para una hora entera (0 - 23). */
export function toSunDate(sunTime: number): Date {
  const hours = Math.min(23, Math.max(0, Math.round(sunTime)));
  // UTC = local - offset. Con offset -5, las 14:00 locales son las 19:00 UTC.
  return new Date(
    Date.UTC(
      DEFAULT_DATE.getFullYear(),
      DEFAULT_DATE.getMonth(),
      DEFAULT_DATE.getDate(),
      hours - SITE_UTC_OFFSET,
    ),
  );
}

export interface SunStudyState {
  /** Hora local del sitio, entera (0 - 23). */
  sunTime: number;
  isLapsePlaying: boolean;
  sunPanelOpen: boolean;

  setSunTime: (hours: number) => void;
  setLapsePlaying: (playing: boolean) => void;
  setSunPanelOpen: (open: boolean) => void;
  advance: (deltaSeconds: number) => void;
}

export const useSunStudyStore = create<SunStudyState>()((set) => ({
  sunTime: 12,
  isLapsePlaying: false,
  sunPanelOpen: false,

  setSunTime: (hours) =>
    set({ sunTime: Math.min(23, Math.max(0, Math.round(hours))) }),
  setLapsePlaying: (isLapsePlaying) => set({ isLapsePlaying }),
  setSunPanelOpen: (sunPanelOpen) => set({ sunPanelOpen }),
  advance: (deltaSeconds) =>
    set((state) => ({
      sunTime:
        (state.sunTime + deltaSeconds * SUN_LAPSE_HOURS_PER_SECOND) % 24,
    })),
}));
