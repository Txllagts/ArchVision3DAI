import type {
  Column,
  Door,
  FurnitureInstance,
  ImportedModel,
  Opening,
  Room,
  Roof,
  SceneDocument,
  Slab,
  Stair,
  Wall,
  WindowEntity,
} from "@archvision/types";
import { FURNITURE_FALLBACK, furnitureById } from "./furniture-catalog";
import { importedModelSize } from "./glb-bounds";

export interface WorldBounds {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

export interface BoundsRect2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function intersectsRect2D(first: BoundsRect2D, second: BoundsRect2D): boolean {
  return (
    first.minX <= second.maxX &&
    first.maxX >= second.minX &&
    first.minY <= second.maxY &&
    first.maxY >= second.minY
  );
}

export function containsRect2D(container: BoundsRect2D, candidate: BoundsRect2D): boolean {
  return (
    container.minX <= candidate.minX &&
    container.minY <= candidate.minY &&
    container.maxX >= candidate.maxX &&
    container.maxY >= candidate.maxY
  );
}

export interface SelectableEntities {
  wall: Wall;
  door: Door;
  window: WindowEntity;
  opening: Opening;
  column: Column;
  stair: Stair;
  roof: Roof;
  slab: Slab;
  room: Room;
  furniture: FurnitureInstance;
  "imported-model": ImportedModel;
}

export type SelectableEntityKind = keyof SelectableEntities;

type BoundsResolverMap = {
  [Kind in SelectableEntityKind]: (
    entity: SelectableEntities[Kind],
    scene: SceneDocument,
  ) => WorldBounds;
};

function elevationOf(scene: SceneDocument, floorId: string): number {
  return scene.floors.find((floor) => floor.id === floorId)?.elevation ?? 0;
}

function rectangularBounds(
  center: { x: number; y: number; z: number },
  size: { x: number; y: number; z: number },
  rotationY = 0,
): WorldBounds {
  const cosine = Math.abs(Math.cos(rotationY));
  const sine = Math.abs(Math.sin(rotationY));
  const halfX = (cosine * size.x + sine * size.z) / 2;
  const halfZ = (sine * size.x + cosine * size.z) / 2;
  const halfY = size.y / 2;

  return {
    min: { x: center.x - halfX, y: center.y - halfY, z: center.z - halfZ },
    max: { x: center.x + halfX, y: center.y + halfY, z: center.z + halfZ },
  };
}

function polygonBounds(
  points: readonly { x: number; y: number }[],
  minY: number,
  maxY: number,
): WorldBounds {
  if (points.length === 0) {
    return { min: { x: 0, y: minY, z: 0 }, max: { x: 0, y: maxY, z: 0 } };
  }
  const xs = points.map((point) => point.x);
  const zs = points.map((point) => point.y);
  return {
    min: { x: Math.min(...xs), y: minY, z: Math.min(...zs) },
    max: { x: Math.max(...xs), y: maxY, z: Math.max(...zs) },
  };
}

function wallBounds(wall: Wall, scene: SceneDocument): WorldBounds {
  const dx = wall.end.x - wall.start.x;
  const dz = wall.end.y - wall.start.y;
  const length = Math.hypot(dx, dz);
  return rectangularBounds(
    {
      x: (wall.start.x + wall.end.x) / 2,
      y: elevationOf(scene, wall.floorId) + wall.baseOffset + wall.height / 2,
      z: (wall.start.y + wall.end.y) / 2,
    },
    { x: length, y: wall.height, z: wall.thickness },
    -Math.atan2(dz, dx),
  );
}

function openingBounds(
  entity: Door | WindowEntity | Opening,
  scene: SceneDocument,
  sillHeight: number,
): WorldBounds {
  const wall = scene.walls.find((item) => item.id === entity.wallId);
  if (!wall) {
    return rectangularBounds({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  }

  const dx = wall.end.x - wall.start.x;
  const dz = wall.end.y - wall.start.y;
  const length = Math.hypot(dx, dz) || 1;
  const directionX = dx / length;
  const directionZ = dz / length;
  const centerX = wall.start.x + directionX * entity.offset;
  const centerZ = wall.start.y + directionZ * entity.offset;
  const floorElevation = elevationOf(scene, entity.floorId) + wall.baseOffset;

  return rectangularBounds(
    {
      x: centerX,
      y: floorElevation + sillHeight + entity.height / 2,
      z: centerZ,
    },
    { x: entity.width, y: entity.height, z: wall.thickness },
    -Math.atan2(dz, dx),
  );
}

/** Centro estable del contorno de techo; no cambia al rotarlo. */
export function roofOutlineCenter(roof: Roof): { x: number; y: number } {
  if (roof.outline.length === 0) return { x: 0.5, y: 0.5 };
  const xs = roof.outline.map((point) => point.x);
  const ys = roof.outline.map((point) => point.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

function roofBounds(roof: Roof, scene: SceneDocument): WorldBounds {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const point of roof.outline) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.y);
    maxZ = Math.max(maxZ, point.y);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = 0;
    minZ = 0;
    maxZ = 0;
  }

  const width = maxX - minX + roof.overhang * 2;
  const depth = maxZ - minZ + roof.overhang * 2;
  const slope = (Math.max(0, Math.min(85, roof.slopeDeg)) * Math.PI) / 180;
  const run = roof.kind === "flat" ? 0 : roof.kind === "shed" ? depth : Math.min(width, depth) / 2;
  const elevation = elevationOf(scene, roof.floorId) + roof.baseHeight;
  const center = roofOutlineCenter(roof);
  const centerX = center.x + (roof.position?.x ?? 0);
  const centerZ = center.y + (roof.position?.y ?? 0);
  const halfX =
    (Math.abs(Math.cos(roof.rotationY ?? 0)) * width +
      Math.abs(Math.sin(roof.rotationY ?? 0)) * depth) /
    2;
  const halfZ =
    (Math.abs(Math.sin(roof.rotationY ?? 0)) * width +
      Math.abs(Math.cos(roof.rotationY ?? 0)) * depth) /
    2;

  return {
    min: { x: centerX - halfX, y: elevation, z: centerZ - halfZ },
    max: {
      x: centerX + halfX,
      y: elevation + roof.thickness + run * Math.tan(slope),
      z: centerZ + halfZ,
    },
  };
}

const boundsByKind: BoundsResolverMap = {
  wall: wallBounds,
  door: (door, scene) => openingBounds(door, scene, 0),
  window: (window, scene) => openingBounds(window, scene, window.sillHeight),
  opening: (opening, scene) => openingBounds(opening, scene, opening.sillHeight),
  column: (column, scene) => {
    const floorElevation = elevationOf(scene, column.floorId);
    return rectangularBounds(
      { x: column.position.x, y: floorElevation + column.height / 2, z: column.position.y },
      { x: column.width, y: column.height, z: column.depth },
      column.rotationY,
    );
  },
  stair: (stair, scene) => {
    const depth = Math.max(stair.tread * stair.steps, stair.width);
    return rectangularBounds(
      {
        x: stair.position.x,
        y: elevationOf(scene, stair.floorId) + stair.totalRise / 2,
        z: stair.position.y,
      },
      { x: stair.width, y: stair.totalRise, z: depth },
      stair.rotationY,
    );
  },
  roof: roofBounds,
  slab: (slab, scene) => {
    const elevation = elevationOf(scene, slab.floorId);
    return polygonBounds(slab.outline, elevation - slab.thickness, elevation);
  },
  room: (room, scene) => {
    const elevation = elevationOf(scene, room.floorId);
    return polygonBounds(room.polygon, elevation - 0.01, elevation + 0.01);
  },
  furniture: (item, scene) => {
    const catalog = furnitureById(item.catalogId) ?? FURNITURE_FALLBACK;
    const size = {
      x: catalog.size.x * item.scale.x,
      y: catalog.size.y * item.scale.y,
      z: catalog.size.z * item.scale.z,
    };
    return rectangularBounds(
      {
        x: item.position.x,
        y: elevationOf(scene, item.floorId) + item.position.y + size.y / 2,
        z: item.position.z,
      },
      size,
      item.rotation.y,
    );
  },
  "imported-model": (model, scene) => {
    // La caja real se lee de la cabecera del GLB (cacheada); hasta que ese
    // calculo termina se usa un cubo por defecto, para que la seleccion por
    // ventana funcione desde el primer render.
    const size = importedModelSize(model.url, model.scale);
    return rectangularBounds(
      {
        x: model.position.x,
        y: elevationOf(scene, model.floorId) + model.position.y + size.y / 2,
        z: model.position.z,
      },
      size,
      model.rotation.y,
    );
  },
};

/** Bounds mundiales compartidos por los marquees 2D y 3D. */
export function getSelectableBounds<Kind extends SelectableEntityKind>(
  kind: Kind,
  entity: SelectableEntities[Kind],
  scene: SceneDocument,
): WorldBounds {
  const resolver = boundsByKind[kind] as (
    value: SelectableEntities[Kind],
    document: SceneDocument,
  ) => WorldBounds;
  return resolver(entity, scene);
}

/** Centro medio de los bounds de una selección, compartido por herramientas y reducer. */
export function getSelectionPivot(
  scene: SceneDocument,
  ids: readonly string[],
): { x: number; y: number; z: number } | null {
  const targets = new Set(ids);
  const centers: Array<{ x: number; y: number; z: number }> = [];
  const collect = <Kind extends SelectableEntityKind>(
    kind: Kind,
    entities: readonly SelectableEntities[Kind][],
  ) => {
    for (const entity of entities) {
      if (!targets.has(entity.id) || ("locked" in entity && entity.locked)) continue;
      const bounds = getSelectableBounds(kind, entity, scene);
      centers.push({
        x: (bounds.min.x + bounds.max.x) / 2,
        y: (bounds.min.y + bounds.max.y) / 2,
        z: (bounds.min.z + bounds.max.z) / 2,
      });
    }
  };

  collect("wall", scene.walls);
  collect("door", scene.doors);
  collect("window", scene.windows);
  collect("opening", scene.openings);
  collect("column", scene.columns);
  collect("stair", scene.stairs);
  collect("roof", scene.roofs);
  collect("slab", scene.slabs);
  collect("room", scene.rooms);
  collect("furniture", scene.furniture);
  collect("imported-model", scene.importedModels);

  if (centers.length === 0) return null;
  const sum = centers.reduce(
    (result, center) => ({
      x: result.x + center.x,
      y: result.y + center.y,
      z: result.z + center.z,
    }),
    { x: 0, y: 0, z: 0 },
  );
  return {
    x: sum.x / centers.length,
    y: sum.y / centers.length,
    z: sum.z / centers.length,
  };
}

/** Expande selección a los objetos anfitriones que deben transformarse con ella. */
export function getTransformTargetIds(
  scene: SceneDocument,
  ids: readonly string[],
): Set<string> {
  const lockedIds = new Set(
    [
      ...scene.walls,
      ...scene.doors,
      ...scene.windows,
      ...scene.openings,
      ...scene.columns,
      ...scene.stairs,
      ...scene.roofs,
      ...scene.slabs,
      ...scene.furniture,
      ...scene.importedModels,
    ]
      .filter((entity) => entity.locked)
      .map((entity) => entity.id),
  );
  const targets = new Set(ids.filter((id) => !lockedIds.has(id)));
  for (const opening of [...scene.doors, ...scene.windows, ...scene.openings]) {
    if (targets.has(opening.id) && !lockedIds.has(opening.wallId)) {
      targets.add(opening.wallId);
    }
  }
  for (const room of scene.rooms) {
    if (targets.has(room.id)) {
      room.wallIds.forEach((wallId) => {
        if (!lockedIds.has(wallId)) targets.add(wallId);
      });
    }
  }
  return targets;
}