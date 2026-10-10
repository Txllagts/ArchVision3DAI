import type { SceneDocument, Vector3 } from "@archvision/types";
import { getSelectableBounds } from "@archvision/shared";

/**
 * Encuadres de camara.
 *
 * Las vistas normalizadas se calculan a partir de la caja envolvente del
 * modelo, no de posiciones fijas: un apartamento y un edificio se encuadran
 * igual de bien.
 */

export type StandardView =
  | "perspective"
  | "top"
  | "front"
  | "back"
  | "left"
  | "right";

export interface CameraPose {
  position: Vector3;
  target: Vector3;
  orthographic: boolean;
}

export interface SceneBounds {
  min: Vector3;
  max: Vector3;
  center: Vector3;
  size: Vector3;
  radius: number;
}

const EMPTY_BOUNDS: SceneBounds = {
  min: { x: -5, y: 0, z: -5 },
  max: { x: 5, y: 3, z: 5 },
  center: { x: 0, y: 1.5, z: 0 },
  size: { x: 10, y: 3, z: 10 },
  radius: 8,
};

/** Caja envolvente aproximada del modelo, calculada sin tocar Three.js. */
export function computeSceneBounds(scene: SceneDocument): SceneBounds {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let maxY = 0;

  const include = (x: number, z: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  };

  for (const wall of scene.walls) {
    include(wall.start.x, wall.start.y);
    include(wall.end.x, wall.end.y);
    const floor = scene.floors.find((item) => item.id === wall.floorId);
    maxY = Math.max(maxY, (floor?.elevation ?? 0) + wall.baseOffset + wall.height);
  }

  for (const slab of scene.slabs) {
    for (const point of slab.outline) include(point.x, point.y);
  }

  for (const roof of scene.roofs) {
    const bounds = getSelectableBounds("roof", roof, scene);
    include(bounds.min.x, bounds.min.z);
    include(bounds.max.x, bounds.max.z);
    maxY = Math.max(maxY, bounds.max.y);
  }

  // Un proyecto puede ser solo un modelo importado: sin esto, el encuadre
  // inicial se quedaba en el mundo vacio y el GLB parecia no estar.
  for (const model of scene.importedModels) {
    if (!model.visible) continue;
    const bounds = getSelectableBounds("imported-model", model, scene);
    include(bounds.min.x, bounds.min.z);
    include(bounds.max.x, bounds.max.z);
    maxY = Math.max(maxY, bounds.max.y);
  }

  if (!Number.isFinite(minX)) return EMPTY_BOUNDS;

  const size = {
    x: Math.max(1, maxX - minX),
    y: Math.max(1, maxY),
    z: Math.max(1, maxZ - minZ),
  };

  return {
    min: { x: minX, y: 0, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    center: { x: (minX + maxX) / 2, y: maxY / 2, z: (minZ + maxZ) / 2 },
    size,
    radius: Math.hypot(size.x, size.y, size.z) / 2,
  };
}

/** Posicion y objetivo de camara para una vista normalizada. */
export function poseForView(view: StandardView, bounds: SceneBounds): CameraPose {
  const distance = Math.max(6, bounds.radius * 2.4);
  const center = bounds.center;

  switch (view) {
    case "top":
      return {
        position: { x: center.x, y: center.y + distance, z: center.z + 0.001 },
        target: center,
        orthographic: true,
      };
    case "front":
      return {
        position: { x: center.x, y: center.y, z: center.z - distance },
        target: center,
        orthographic: true,
      };
    case "back":
      return {
        position: { x: center.x, y: center.y, z: center.z + distance },
        target: center,
        orthographic: true,
      };
    case "left":
      return {
        position: { x: center.x - distance, y: center.y, z: center.z },
        target: center,
        orthographic: true,
      };
    case "right":
      return {
        position: { x: center.x + distance, y: center.y, z: center.z },
        target: center,
        orthographic: true,
      };
    case "perspective":
    default:
      return {
        position: {
          x: center.x + distance * 0.75,
          y: center.y + distance * 0.6,
          z: center.z - distance * 0.85,
        },
        target: center,
        orthographic: false,
      };
  }
}

/** Encuadre para centrar el modelo completo manteniendo la direccion actual. */
export function fitPose(bounds: SceneBounds, current: CameraPose): CameraPose {
  const direction = {
    x: current.position.x - current.target.x,
    y: current.position.y - current.target.y,
    z: current.position.z - current.target.z,
  };
  const length = Math.hypot(direction.x, direction.y, direction.z) || 1;
  const distance = Math.max(6, bounds.radius * 2.4);

  return {
    position: {
      x: bounds.center.x + (direction.x / length) * distance,
      y: bounds.center.y + (direction.y / length) * distance,
      z: bounds.center.z + (direction.z / length) * distance,
    },
    target: bounds.center,
    orthographic: current.orthographic,
  };
}
