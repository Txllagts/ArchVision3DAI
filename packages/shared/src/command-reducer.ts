import type {
  Column,
  Door,
  Floor,
  FurnitureInstance,
  Opening,
  Roof,
  SceneCommand,
  SceneDocument,
  Slab,
  Stair,
  Vector2,
  Wall,
  WindowEntity,
} from "@archvision/types";
import { createId } from "./ids";
import { DEFAULTS, suggestedSteps } from "./defaults";
import { distance2 } from "./geometry2d";
import { recomputeRooms } from "./rooms";
import {
  getSelectionPivot,
  getTransformTargetIds,
  roofOutlineCenter,
} from "./selectable-bounds";

/**
 * Reductor de comandos.
 *
 * Unica via de mutacion del documento de escena. Es una funcion pura: recibe
 * la escena y un comando ya validado y devuelve una escena nueva. El historial
 * de deshacer vive en el store y no necesita conocer la semantica de cada
 * comando.
 *
 * Las colecciones se copian de forma superficial solo cuando cambian, de modo
 * que React puede comparar por referencia y volver a renderizar lo minimo.
 */

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandError";
  }
}

function requireWall(scene: SceneDocument, wallId: string): Wall {
  const wall = scene.walls.find((item) => item.id === wallId);
  if (!wall) throw new CommandError(`La pared ${wallId} no existe`);
  return wall;
}

function requireFloor(scene: SceneDocument, floorId: string): Floor {
  const floor = scene.floors.find((item) => item.id === floorId);
  if (!floor) throw new CommandError(`El nivel ${floorId} no existe`);
  return floor;
}

function nextName(prefix: string, count: number): string {
  return `${prefix} ${count + 1}`;
}

/** Contorno rectangular que envuelve las paredes de un nivel. */
export function floorOutline(scene: SceneDocument, floorId: string): Vector2[] {
  const walls = scene.walls.filter((wall) => wall.floorId === floorId);
  if (walls.length === 0) {
    return [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 6 },
      { x: 0, y: 6 },
    ];
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const wall of walls) {
    for (const point of [wall.start, wall.end]) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
  }

  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

export function applyCommand(
  scene: SceneDocument,
  command: SceneCommand,
): SceneDocument {
  const origin = command.origin ?? "user";

  switch (command.type) {
    case "CREATE_WALL": {
      const floor = requireFloor(scene, command.floorId);
      const length = distance2(command.start, command.end);
      if (length < 0.05) {
        throw new CommandError("La pared es demasiado corta");
      }

      const wall: Wall = {
        id: createId(),
        floorId: floor.id,
        name: nextName("Pared", scene.walls.length),
        start: { ...command.start },
        end: { ...command.end },
        height: command.height ?? floor.height ?? DEFAULTS.wall.height,
        thickness: command.thickness ?? DEFAULTS.wall.thickness,
        baseOffset: 0,
        visible: true,
        locked: false,
        source: origin === "ai" ? "ai" : "user",
      };

      return { ...scene, walls: [...scene.walls, wall] };
    }

    case "UPDATE_WALL": {
      const wall = requireWall(scene, command.wallId);
      const updated: Wall = { ...wall, ...command.patch };

      if (distance2(updated.start, updated.end) < 0.05) {
        throw new CommandError("La pared quedaria demasiado corta");
      }

      return {
        ...scene,
        walls: scene.walls.map((item) => (item.id === wall.id ? updated : item)),
      };
    }

    case "CREATE_DOOR": {
      const wall = requireWall(scene, command.wallId);
      const width = command.width ?? DEFAULTS.door.width;
      const height = command.height ?? DEFAULTS.door.height;
      const length = distance2(wall.start, wall.end);

      if (height > wall.height) {
        throw new CommandError("La puerta no cabe en la altura de la pared");
      }

      const door: Door = {
        id: createId(),
        wallId: wall.id,
        floorId: wall.floorId,
        name: nextName("Puerta", scene.doors.length),
        kind: command.kind ?? "single",
        offset: Math.min(Math.max(command.offset, width / 2), length - width / 2),
        width,
        height,
        openingDirection: "inward-left",
        materialId: "mat_wood_oak",
        visible: true,
        locked: false,
        source: origin === "ai" ? "ai" : "user",
      };

      return { ...scene, doors: [...scene.doors, door] };
    }

    case "CREATE_WINDOW": {
      const wall = requireWall(scene, command.wallId);
      const width = command.width ?? DEFAULTS.window.width;
      const height = command.height ?? DEFAULTS.window.height;
      const sillHeight = command.sillHeight ?? DEFAULTS.window.sillHeight;
      const length = distance2(wall.start, wall.end);

      if (sillHeight + height > wall.height) {
        throw new CommandError("La ventana no cabe en la altura de la pared");
      }

      const window: WindowEntity = {
        id: createId(),
        wallId: wall.id,
        floorId: wall.floorId,
        name: nextName("Ventana", scene.windows.length),
        kind: command.kind ?? "single",
        offset: Math.min(Math.max(command.offset, width / 2), length - width / 2),
        width,
        height,
        sillHeight,
        frameThickness: DEFAULTS.window.frameThickness,
        materialId: "mat_glass_clear",
        visible: true,
        locked: false,
        source: origin === "ai" ? "ai" : "user",
      };

      return { ...scene, windows: [...scene.windows, window] };
    }

    case "UPDATE_OPENING": {
      const { openingId, kindOf, patch } = command;

      if (kindOf === "door") {
        const exists = scene.doors.some((item) => item.id === openingId);
        if (!exists) throw new CommandError("La puerta no existe");
        return {
          ...scene,
          doors: scene.doors.map((item) =>
            item.id === openingId ? { ...item, ...patch } : item,
          ),
        };
      }

      if (kindOf === "window") {
        const exists = scene.windows.some((item) => item.id === openingId);
        if (!exists) throw new CommandError("La ventana no existe");
        return {
          ...scene,
          windows: scene.windows.map((item) =>
            item.id === openingId ? { ...item, ...patch } : item,
          ),
        };
      }

      const exists = scene.openings.some((item) => item.id === openingId);
      if (!exists) throw new CommandError("El vano no existe");
      return {
        ...scene,
        openings: scene.openings.map((item) =>
          item.id === openingId ? { ...item, ...patch } : item,
        ),
      };
    }

    case "CREATE_FLOOR": {
      const last = [...scene.floors].sort((a, b) => a.level - b.level).at(-1);
      const height = command.height ?? last?.height ?? DEFAULTS.floor.height;
      const level = (last?.level ?? -1) + 1;

      const floor: Floor = {
        id: createId(),
        name: command.name ?? (level === 0 ? "Planta baja" : `Piso ${level + 1}`),
        level,
        elevation: last
          ? last.elevation + last.height + DEFAULTS.floor.slabThickness
          : 0,
        height,
        visible: true,
        locked: false,
      };

      return {
        ...scene,
        floors: [...scene.floors, floor],
        activeFloorId: floor.id,
      };
    }

    case "CREATE_ROOF": {
      const floor = requireFloor(scene, command.floorId);
      const roof: Roof = {
        id: createId(),
        floorId: floor.id,
        name: nextName("Cubierta", scene.roofs.length),
        kind: command.kind,
        outline: floorOutline(scene, floor.id),
        position: { x: 0, y: 0 },
        rotationY: 0,
        slopeDeg:
          command.slopeDeg ?? (command.kind === "flat" ? 2 : DEFAULTS.roof.slopeDeg),
        baseHeight: floor.height,
        overhang: command.overhang ?? DEFAULTS.roof.overhang,
        thickness: DEFAULTS.roof.thickness,
        materialId: "mat_roof_tile",
        visible: true,
        locked: false,
      };

      return { ...scene, roofs: [...scene.roofs, roof] };
    }

    case "UPDATE_ROOF": {
      const roof = scene.roofs.find((item) => item.id === command.roofId);
      if (!roof) throw new CommandError("La cubierta no existe");

      return {
        ...scene,
        roofs: scene.roofs.map((item) =>
          item.id === roof.id ? { ...item, ...command.patch } : item,
        ),
      };
    }

    case "CREATE_COLUMN": {
      const floor = requireFloor(scene, command.floorId);
      const width = command.width ?? DEFAULTS.column.width;

      const column: Column = {
        id: createId(),
        floorId: floor.id,
        name: nextName("Columna", scene.columns.length),
        position: { ...command.position },
        shape: command.shape ?? "rect",
        width,
        depth: command.depth ?? width,
        height: command.height ?? floor.height,
        rotationY: 0,
        materialId: "mat_concrete",
        visible: true,
        locked: false,
      };

      return { ...scene, columns: [...scene.columns, column] };
    }

    case "CREATE_STAIR": {
      const floor = requireFloor(scene, command.floorId);
      const totalRise =
        command.totalRise ?? floor.height + DEFAULTS.floor.slabThickness;
      const steps = suggestedSteps(totalRise);

      const stair: Stair = {
        id: createId(),
        floorId: floor.id,
        name: nextName("Escalera", scene.stairs.length),
        kind: command.kind,
        position: { ...command.position },
        rotationY: 0,
        totalRise,
        width: command.width ?? DEFAULTS.stair.width,
        steps,
        tread: DEFAULTS.stair.tread,
        riser: totalRise / steps,
        hasLanding: command.kind === "l-shape" || command.kind === "u-shape",
        hasRailing: true,
        materialId: "mat_wood_oak",
        visible: true,
        locked: false,
      };

      return { ...scene, stairs: [...scene.stairs, stair] };
    }

    case "ADD_FURNITURE": {
      const floor = requireFloor(scene, command.floorId);
      const item: FurnitureInstance = {
        id: createId(),
        floorId: floor.id,
        name: command.catalogId,
        catalogId: command.catalogId,
        position: { ...command.position },
        rotation: { x: 0, y: command.rotationY ?? 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        visible: true,
        locked: false,
      };

      return { ...scene, furniture: [...scene.furniture, item] };
    }

    case "ASSIGN_MATERIAL": {
      const targets = new Set(command.targetIds);
      const face = command.face ?? "both";
      const materialId = command.materialId;

      if (!scene.materials.some((material) => material.id === materialId)) {
        throw new CommandError(`El material ${materialId} no existe en la escena`);
      }

      // El techo de una habitacion es una cara distinta del suelo, y las caras
      // de pared no se tocan cuando se pinta un techo.
      if (face === "ceiling") {
        return {
          ...scene,
          rooms: scene.rooms.map((room) =>
            targets.has(room.id) ? { ...room, ceilingMaterialId: materialId } : room,
          ),
        };
      }

      return {
        ...scene,
        walls: scene.walls.map((wall) =>
          targets.has(wall.id)
            ? {
                ...wall,
                materialInteriorId:
                  face === "exterior" ? wall.materialInteriorId : materialId,
                materialExteriorId:
                  face === "interior" ? wall.materialExteriorId : materialId,
              }
            : wall,
        ),
        slabs: scene.slabs.map((slab) =>
          targets.has(slab.id) ? { ...slab, materialId } : slab,
        ),
        roofs: scene.roofs.map((roof) =>
          targets.has(roof.id) ? { ...roof, materialId } : roof,
        ),
        doors: scene.doors.map((door) =>
          targets.has(door.id) ? { ...door, materialId } : door,
        ),
        windows: scene.windows.map((window) =>
          targets.has(window.id) ? { ...window, materialId } : window,
        ),
        columns: scene.columns.map((column) =>
          targets.has(column.id) ? { ...column, materialId } : column,
        ),
        stairs: scene.stairs.map((stair) =>
          targets.has(stair.id) ? { ...stair, materialId } : stair,
        ),
        rooms: scene.rooms.map((room) =>
          targets.has(room.id) ? { ...room, floorMaterialId: materialId } : room,
        ),
        // El mobiliario no tiene un material unico sino sustituciones por
        // pieza; `base` es la que usa el visor para el cuerpo del objeto.
        furniture: scene.furniture.map((item) =>
          targets.has(item.id)
            ? { ...item, materialOverrides: { ...item.materialOverrides, base: materialId } }
            : item,
        ),
      };
    }

    case "CREATE_MATERIAL": {
      const material = {
        ...command.material,
        id: command.material.id ?? createId(),
        builtin: false,
      };

      if (scene.materials.some((item) => item.id === material.id)) {
        throw new CommandError(`Ya existe un material con el id ${material.id}`);
      }

      return { ...scene, materials: [...scene.materials, material] };
    }

    case "UPDATE_MATERIAL": {
      const existing = scene.materials.find((item) => item.id === command.materialId);
      if (!existing) {
        throw new CommandError(`El material ${command.materialId} no existe`);
      }
      // Los materiales de catalogo son compartidos: editarlos aqui cambiaria
      // el significado de un id que aparece en otros proyectos.
      if (existing.builtin) {
        throw new CommandError(
          "Los materiales del catalogo no se editan; duplicalo para modificarlo",
        );
      }

      return {
        ...scene,
        materials: scene.materials.map((item) =>
          item.id === command.materialId ? { ...item, ...command.patch } : item,
        ),
      };
    }

    case "DELETE_MATERIAL": {
      const existing = scene.materials.find((item) => item.id === command.materialId);
      if (!existing) {
        throw new CommandError(`El material ${command.materialId} no existe`);
      }
      if (existing.builtin) {
        throw new CommandError("Los materiales del catalogo no se pueden eliminar");
      }

      // Se limpian las referencias para no dejar la escena apuntando a un
      // material inexistente: el validador la rechazaria al guardar.
      const clear = (value: string | undefined) =>
        value === command.materialId ? undefined : value;

      return {
        ...scene,
        materials: scene.materials.filter((item) => item.id !== command.materialId),
        walls: scene.walls.map((wall) => ({
          ...wall,
          materialInteriorId: clear(wall.materialInteriorId),
          materialExteriorId: clear(wall.materialExteriorId),
        })),
        slabs: scene.slabs.map((slab) => ({ ...slab, materialId: clear(slab.materialId) })),
        roofs: scene.roofs.map((roof) => ({ ...roof, materialId: clear(roof.materialId) })),
        doors: scene.doors.map((door) => ({ ...door, materialId: clear(door.materialId) })),
        windows: scene.windows.map((window) => ({
          ...window,
          materialId: clear(window.materialId),
        })),
        columns: scene.columns.map((column) => ({
          ...column,
          materialId: clear(column.materialId),
        })),
        stairs: scene.stairs.map((stair) => ({
          ...stair,
          materialId: clear(stair.materialId),
        })),
        rooms: scene.rooms.map((room) => ({
          ...room,
          floorMaterialId: clear(room.floorMaterialId),
          ceilingMaterialId: clear(room.ceilingMaterialId),
        })),
      };
    }

    case "SET_UNDERLAY":
      return { ...scene, underlay: command.underlay };

    case "TRANSFORM_OBJECTS": {
      const targets = getTransformTargetIds(scene, command.ids);
      const move = command.translate ?? { x: 0, y: 0, z: 0 };
      const requestedRotation = command.rotateY ?? 0;
      const fullTurn = Math.PI * 2;
      const fullTurns = Math.round(requestedRotation / fullTurn);
      const rotate = Math.abs(requestedRotation - fullTurns * fullTurn) < 1e-10
        ? 0
        : requestedRotation;
      if (
        rotate === 0 &&
        move.x === 0 &&
        move.y === 0 &&
        move.z === 0 &&
        !command.scale
      ) {
        return scene;
      }

      const selectionPivot = getSelectionPivot(scene, command.ids);
      const pivot = selectionPivot
        ? { x: selectionPivot.x, y: selectionPivot.z }
        : { x: 0, y: 0 };
      const cosine = Math.cos(rotate);
      const sine = Math.sin(rotate);

      const rotatePoint = (point: Vector2): Vector2 => {
        const x = point.x - pivot.x;
        const y = point.y - pivot.y;
        return {
          x: pivot.x + cosine * x + sine * y + move.x,
          y: pivot.y - sine * x + cosine * y + move.z,
        };
      };

      const wallTargets = new Set(
        scene.walls.filter((wall) => targets.has(wall.id)).map((wall) => wall.id),
      );

      const transformed: SceneDocument = {
        ...scene,
        walls: scene.walls.map((wall) =>
          wallTargets.has(wall.id) && !wall.locked
            ? { ...wall, start: rotatePoint(wall.start), end: rotatePoint(wall.end) }
            : wall,
        ),
        columns: scene.columns.map((column) =>
          targets.has(column.id) && !column.locked
            ? {
                ...column,
                position: rotatePoint(column.position),
                rotationY: column.rotationY + rotate,
              }
            : column,
        ),
        stairs: scene.stairs.map((stair) =>
          targets.has(stair.id) && !stair.locked
            ? {
                ...stair,
                position: rotatePoint(stair.position),
                rotationY: stair.rotationY + rotate,
              }
            : stair,
        ),
        roofs: scene.roofs.map((roof) =>
          targets.has(roof.id) && !roof.locked
            ? (() => {
                const center = roofOutlineCenter(roof);
                const currentCenter = {
                  x: center.x + (roof.position?.x ?? 0),
                  y: center.y + (roof.position?.y ?? 0),
                };
                const nextCenter = rotatePoint(currentCenter);
                return {
                  ...roof,
                  position: {
                    x: nextCenter.x - center.x,
                    y: nextCenter.y - center.y,
                  },
                  rotationY: (roof.rotationY ?? 0) + rotate,
                };
              })()
            : roof,
        ),
        slabs: scene.slabs.map((slab) =>
          targets.has(slab.id) && !slab.locked
            ? { ...slab, outline: slab.outline.map(rotatePoint) }
            : slab,
        ),
        furniture: scene.furniture.map((item) =>
          targets.has(item.id) && !item.locked
            ? {
                ...item,
                position: {
                  x: rotatePoint({ x: item.position.x, y: item.position.z }).x,
                  y: item.position.y + move.y,
                  z: rotatePoint({ x: item.position.x, y: item.position.z }).y,
                },
                rotation: { ...item.rotation, y: item.rotation.y + rotate },
                scale: command.scale ? { ...command.scale } : item.scale,
              }
            : item,
        ),
      };
      return wallTargets.size > 0
        ? { ...transformed, rooms: recomputeRooms(transformed) }
        : transformed;
    }

    case "DELETE_OBJECTS": {
      const targets = new Set(command.ids);
      // Al borrar una pared desaparecen sus vanos; al borrar un nivel,
      // desaparece todo lo que contiene.
      const deletedFloors = new Set(
        scene.floors.filter((floor) => targets.has(floor.id)).map((f) => f.id),
      );
      const deletedWalls = new Set(
        scene.walls
          .filter((wall) => targets.has(wall.id) || deletedFloors.has(wall.floorId))
          .map((wall) => wall.id),
      );

      const keepByFloor = <T extends { id: string; floorId: string }>(items: T[]) =>
        items.filter(
          (item) => !targets.has(item.id) && !deletedFloors.has(item.floorId),
        );

      const keepOpening = <T extends { id: string; floorId: string; wallId: string }>(
        items: T[],
      ) =>
        items.filter(
          (item) =>
            !targets.has(item.id) &&
            !deletedWalls.has(item.wallId) &&
            !deletedFloors.has(item.floorId),
        );

      const floors = scene.floors.filter((floor) => !targets.has(floor.id));
      if (floors.length === 0) {
        throw new CommandError("El proyecto debe conservar al menos un nivel");
      }

      const activeFloorId =
        scene.activeFloorId && deletedFloors.has(scene.activeFloorId)
          ? (floors[0]?.id ?? null)
          : scene.activeFloorId;

      return {
        ...scene,
        floors,
        walls: scene.walls.filter((wall) => !deletedWalls.has(wall.id)),
        doors: keepOpening(scene.doors as Array<Door>),
        windows: keepOpening(scene.windows as Array<WindowEntity>),
        openings: keepOpening(scene.openings as Array<Opening>),
        columns: keepByFloor(scene.columns as Array<Column>),
        stairs: keepByFloor(scene.stairs as Array<Stair>),
        roofs: keepByFloor(scene.roofs as Array<Roof>),
        slabs: keepByFloor(scene.slabs as Array<Slab>),
        rooms: keepByFloor(scene.rooms),
        furniture: keepByFloor(scene.furniture as Array<FurnitureInstance>),
        activeFloorId,
      };
    }

    case "SET_VISIBILITY":
    case "SET_LOCK": {
      const targets = new Set(command.ids);
      const patch =
        command.type === "SET_VISIBILITY"
          ? { visible: command.visible }
          : { locked: command.locked };

      const mapItems = <T extends { id: string }>(items: T[]): T[] =>
        items.map((item) => (targets.has(item.id) ? { ...item, ...patch } : item));

      return {
        ...scene,
        floors: mapItems(scene.floors),
        walls: mapItems(scene.walls),
        doors: mapItems(scene.doors),
        windows: mapItems(scene.windows),
        openings: mapItems(scene.openings),
        columns: mapItems(scene.columns),
        stairs: mapItems(scene.stairs),
        roofs: mapItems(scene.roofs),
        slabs: mapItems(scene.slabs),
        furniture: mapItems(scene.furniture),
        lights: mapItems(scene.lights),
      };
    }

    case "RENAME_OBJECT": {
      const rename = <T extends { id: string; name: string }>(items: T[]): T[] =>
        items.map((item) =>
          item.id === command.id ? { ...item, name: command.name } : item,
        );

      return {
        ...scene,
        floors: rename(scene.floors),
        walls: rename(scene.walls),
        doors: rename(scene.doors),
        windows: rename(scene.windows),
        openings: rename(scene.openings),
        columns: rename(scene.columns),
        stairs: rename(scene.stairs),
        roofs: rename(scene.roofs),
        slabs: rename(scene.slabs),
        rooms: rename(scene.rooms),
        furniture: rename(scene.furniture),
        lights: rename(scene.lights),
      };
    }

    default: {
      // El discriminante cubre todos los casos; esta rama solo protege ante
      // comandos de una version futura.
      const exhaustive: never = command;
      throw new CommandError(
        `Comando no soportado: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}

/** Aplica varios comandos en orden, deteniendose en el primero invalido. */
export function applyCommands(
  scene: SceneDocument,
  commands: readonly SceneCommand[],
): SceneDocument {
  return commands.reduce((current, command) => applyCommand(current, command), scene);
}
