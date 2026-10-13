import type { SceneEnvironment } from "@archvision/types";
import { getPosition } from "suncalc";

const DEG_TO_RAD = Math.PI / 180;

/**
 * Ambientes de iluminacion.
 *
 * Cada preset define color de cielo, intensidad y direccion del sol. Los HDRI
 * llegan en la fase 9; el contrato de esta funcion no cambiara al sustituir
 * los valores por mapas de entorno reales.
 */

export interface EnvironmentPreset {
  skyColor: string;
  groundColor: string;
  sunColor: string;
  sunIntensity: number;
  ambientIntensity: number;
  /** Direccion del sol normalizada, en coordenadas de mundo. */
  sunDirection: [number, number, number];
  fogColor: string;
  fogDensity: number;
}

const PRESETS: Record<SceneEnvironment["sky"], EnvironmentPreset> = {
  clear: {
    skyColor: "#8fbde8",
    groundColor: "#6b6f63",
    sunColor: "#fff4e0",
    sunIntensity: 2.4,
    ambientIntensity: 0.5,
    sunDirection: [0.6, 0.75, 0.3],
    fogColor: "#9dc3e6",
    fogDensity: 0.004,
  },
  cloudy: {
    skyColor: "#b9c3cc",
    groundColor: "#6d7069",
    sunColor: "#e8ecf2",
    sunIntensity: 1.2,
    ambientIntensity: 0.85,
    sunDirection: [0.4, 0.85, 0.2],
    fogColor: "#c2ccd6",
    fogDensity: 0.008,
  },
  sunset: {
    skyColor: "#e8a56b",
    groundColor: "#4a3f36",
    sunColor: "#ffb066",
    sunIntensity: 2.1,
    ambientIntensity: 0.45,
    sunDirection: [0.9, 0.22, -0.35],
    fogColor: "#d99a68",
    fogDensity: 0.01,
  },
  night: {
    skyColor: "#0e1626",
    groundColor: "#10141c",
    sunColor: "#9fb6e8",
    sunIntensity: 0.35,
    ambientIntensity: 0.22,
    sunDirection: [-0.4, 0.7, -0.5],
    fogColor: "#0b111c",
    fogDensity: 0.014,
  },
  studio: {
    skyColor: "#1b1f26",
    groundColor: "#15181d",
    sunColor: "#ffffff",
    sunIntensity: 1.8,
    ambientIntensity: 0.9,
    sunDirection: [0.5, 0.9, 0.4],
    fogColor: "#1b1f26",
    fogDensity: 0,
  },
};

export function environmentPreset(
  environment: SceneEnvironment,
): EnvironmentPreset {
  return PRESETS[environment.sky] ?? PRESETS.clear;
}

export interface SunPosition {
  /** Azimut en grados, base norte, sentido horario (0 = N, 90 = E, 180 = S). */
  azimuth: number;
  /** Altura sobre el horizonte en grados (negativa de noche). */
  altitude: number;
  /** Direccion normalizada en coordenadas de mundo (norte = -Z, Y arriba). */
  direction: [number, number, number];
}

export function sunPositionFor(params: {
  latitude: number;
  longitude: number;
  date: Date;
  northAngleDeg?: number;
}): SunPosition {
  const position = getPosition(params.date, params.latitude, params.longitude);
  const altitude = position.altitude;
  const north = params.northAngleDeg ?? 0;

  // Compass (norte = -Z) -> esfericas de Three.js: theta = pi - (azimut + giro).
  const phi = Math.PI / 2 - altitude * DEG_TO_RAD;
  const theta = Math.PI - (position.azimuth + north) * DEG_TO_RAD;

  const sinPhi = Math.sin(phi);
  const direction: [number, number, number] = [
    sinPhi * Math.sin(theta),
    Math.cos(phi),
    sinPhi * Math.cos(theta),
  ];

  return { azimuth: position.azimuth, altitude, direction };
}

export function sunDirectionFor(params: {
  latitude: number;
  longitude: number;
  date: Date;
  northAngleDeg?: number;
}): [number, number, number] {
  const { direction } = sunPositionFor(params);
  return [direction[0], Math.max(0.02, direction[1]), direction[2]];
}
