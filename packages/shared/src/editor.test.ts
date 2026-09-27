import { describe, expect, it } from "vitest";
import type { SceneCommand, SceneDocument } from "@archvision/types";
import { createDefaultScene } from "./scene-factory";
import { createDemoHouseScene } from "./demo-house";
import { CommandError, applyCommand, applyCommands } from "./command-reducer";
import { detectRoomPolygons, recomputeRooms } from "./rooms";
import { computeSceneMetrics } from "./metrics";

function sceneWithRoom(): SceneDocument {
  const scene = createDefaultScene();
  const floorId = scene.floors[0]!.id;

  const rectangle: SceneCommand[] = [
    { type: "CREATE_WALL", floorId, start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
    { type: "CREATE_WALL", floorId, start: { x: 5, y: 0 }, end: { x: 5, y: 4 } },
    { type: "CREATE_WALL", floorId, start: { x: 5, y: 4 }, end: { x: 0, y: 4 } },
    { type: "CREATE_WALL", floorId, start: { x: 0, y: 4 }, end: { x: 0, y: 0 } },
  ];

  return applyCommands(scene, rectangle);
}

describe("command-reducer", () => {
  it("crea paredes y rechaza las degeneradas", () => {
    const scene = createDefaultScene();
    const floorId = scene.floors[0]!.id;

    const next = applyCommand(scene, {
      type: "CREATE_WALL",
      floorId,
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
    });

    expect(next.walls).toHaveLength(1);
    expect(scene.walls).toHaveLength(0); // la escena original no se muta

    expect(() =>
      applyCommand(scene, {
        type: "CREATE_WALL",
        floorId,
        start: { x: 0, y: 0 },
        end: { x: 0.01, y: 0 },
      }),
    ).toThrow(CommandError);
  });

  it("coloca vanos dentro de la pared y hereda su nivel", () => {
    const scene = sceneWithRoom();
    const wall = scene.walls[0]!;

    const withWindow = applyCommand(scene, {
      type: "CREATE_WINDOW",
      wallId: wall.id,
      offset: 0.1,
      width: 1.5,
    });

    const window = withWindow.windows[0]!;
    expect(window.floorId).toBe(wall.floorId);
    // El offset se ajusta para que la ventana no se salga por el extremo.
    expect(window.offset).toBeCloseTo(0.75, 5);
  });

  it("rechaza una ventana mas alta que la pared", () => {
    const scene = sceneWithRoom();
    const wall = scene.walls[0]!;

    expect(() =>
      applyCommand(scene, {
        type: "CREATE_WINDOW",
        wallId: wall.id,
        offset: 2,
        height: 2.5,
        sillHeight: 1.5,
      }),
    ).toThrow(CommandError);
  });

  it("al borrar una pared elimina sus vanos", () => {
    const scene = sceneWithRoom();
    const wall = scene.walls[0]!;

    const withOpenings = applyCommands(scene, [
      { type: "CREATE_DOOR", wallId: wall.id, offset: 1 },
      { type: "CREATE_WINDOW", wallId: wall.id, offset: 3 },
    ]);
    expect(withOpenings.doors).toHaveLength(1);
    expect(withOpenings.windows).toHaveLength(1);

    const deleted = applyCommand(withOpenings, {
      type: "DELETE_OBJECTS",
      ids: [wall.id],
    });

    expect(deleted.walls).toHaveLength(3);
    expect(deleted.doors).toHaveLength(0);
    expect(deleted.windows).toHaveLength(0);
  });

  it("impide quedarse sin niveles", () => {
    const scene = sceneWithRoom();
    expect(() =>
      applyCommand(scene, {
        type: "DELETE_OBJECTS",
        ids: [scene.floors[0]!.id],
      }),
    ).toThrow(CommandError);
  });

  it("crea un nivel sobre el anterior", () => {
    const scene = createDefaultScene({ floorHeight: 2.6 });
    const next = applyCommand(scene, { type: "CREATE_FLOOR" });

    expect(next.floors).toHaveLength(2);
    expect(next.floors[1]!.elevation).toBeCloseTo(2.8, 5);
    expect(next.activeFloorId).toBe(next.floors[1]!.id);
  });

  it("asigna material a la cara indicada", () => {
    const scene = sceneWithRoom();
    const wall = scene.walls[0]!;

    const next = applyCommand(scene, {
      type: "ASSIGN_MATERIAL",
      targetIds: [wall.id],
      materialId: "mat_brick_red",
      face: "exterior",
    });

    const updated = next.walls.find((item) => item.id === wall.id)!;
    expect(updated.materialExteriorId).toBe("mat_brick_red");
    expect(updated.materialInteriorId).toBeUndefined();
  });

  it("mueve objetos en el plano", () => {
    const scene = sceneWithRoom();
    const wall = scene.walls[0]!;
    const column = {
      id: "column-move-test",
      floorId: wall.floorId,
      name: "Columna de prueba",
      position: { x: 2, y: 3 },
      shape: "rect" as const,
      width: 0.3,
      depth: 0.3,
      height: 2.6,
      rotationY: 0,
      visible: true,
      locked: false,
    };
    scene.columns.push(column);
    const roof = {
      id: "roof-move-test",
      floorId: wall.floorId,
      name: "Techo de prueba",
      kind: "flat" as const,
      outline: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 3 },
        { x: 0, y: 3 },
      ],
      slopeDeg: 0,
      baseHeight: 2.6,
      overhang: 0.5,
      thickness: 0.2,
      visible: true,
      locked: false,
    };
    scene.roofs.push(roof);

    const next = applyCommand(scene, {
      type: "TRANSFORM_OBJECTS",
      ids: [wall.id, column.id, roof.id],
      translate: { x: 1, y: 0, z: 2 },
    });

    const moved = next.walls.find((item) => item.id === wall.id)!;
    expect(moved.start).toEqual({ x: 1, y: 2 });
    expect(moved.end).toEqual({ x: 6, y: 2 });
    expect(next.columns[0]?.position).toEqual({ x: 3, y: 5 });
    expect(next.roofs[0]?.position).toEqual({ x: 1, y: 2 });
    expect(next.roofs[0]?.outline).toEqual(roof.outline);
  });

  it("rota paredes y cubiertas alrededor de su centro", () => {
    const scene = sceneWithRoom();
    const wall = scene.walls[0]!;
    const roof = {
      id: "roof-rotation-test",
      floorId: wall.floorId,
      name: "Cubierta de prueba",
      kind: "flat" as const,
      outline: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 2 },
      ],
      slopeDeg: 0,
      baseHeight: 2.6,
      overhang: 0,
      thickness: 0.2,
      visible: true,
      locked: false,
    };
    scene.roofs.push(roof);

    const rotatedWall = applyCommand(scene, {
      type: "TRANSFORM_OBJECTS",
      ids: [wall.id],
      rotateY: Math.PI / 2,
    });
    const rotatedRoof = applyCommand(scene, {
      type: "TRANSFORM_OBJECTS",
      ids: [roof.id],
      rotateY: Math.PI / 2,
    });

    expect(rotatedWall.walls[0]?.start.x).toBeCloseTo(2.5);
    expect(rotatedWall.walls[0]?.start.y).toBeCloseTo(2.5);
    expect(rotatedWall.walls[0]?.end.x).toBeCloseTo(2.5);
    expect(rotatedWall.walls[0]?.end.y).toBeCloseTo(-2.5);
    expect(rotatedRoof.roofs[0]?.outline).toEqual(roof.outline);
    expect(rotatedRoof.roofs[0]?.rotationY).toBeCloseTo(Math.PI / 2);
  });

  it("rota un grupo alrededor de un pivote comun", () => {
    const scene = createDefaultScene();
    const floorId = scene.floors[0]!.id;
    scene.columns.push(
      {
        id: "column-a",
        floorId,
        name: "Columna A",
        position: { x: 0.1, y: 0 },
        shape: "rect",
        width: 0.3,
        depth: 0.3,
        height: 2.6,
        rotationY: 0,
        visible: true,
        locked: false,
      },
      {
        id: "column-b",
        floorId,
        name: "Columna B",
        position: { x: 2.2, y: 0 },
        shape: "rect",
        width: 0.3,
        depth: 0.3,
        height: 2.6,
        rotationY: 0,
        visible: true,
        locked: false,
      },
    );

    const rotated = applyCommand(scene, {
      type: "TRANSFORM_OBJECTS",
      ids: ["column-a", "column-b"],
      rotateY: Math.PI / 2,
    });

    expect(rotated.columns[0]?.position.x).toBeCloseTo(1.15);
    expect(rotated.columns[0]?.position.y).toBeCloseTo(1.05);
    expect(rotated.columns[1]?.position.x).toBeCloseTo(1.15);
    expect(rotated.columns[1]?.position.y).toBeCloseTo(-1.05);
    expect(rotated.columns[0]?.rotationY).toBeCloseTo(Math.PI / 2);

    const fullTurn = applyCommand(scene, {
      type: "TRANSFORM_OBJECTS",
      ids: ["column-a", "column-b"],
      rotateY: Math.PI * 2,
    });
    expect(fullTurn.columns[0]?.position).toEqual(scene.columns[0]?.position);
  });

  it("no cambia escala ni inclinacion al girar un mueble", () => {
    const scene = createDefaultScene();
    const floorId = scene.floors[0]!.id;
    const furniture = {
      id: "furniture-rotation-test",
      floorId,
      name: "Mueble de prueba",
      catalogId: "sofa-3-seat",
      position: { x: 1, y: 0, z: 2 },
      rotation: { x: 0.1, y: 0.2, z: -0.1 },
      scale: { x: 1.2, y: 0.8, z: 1.1 },
      visible: true,
      locked: false,
    };
    scene.furniture.push(furniture);

    const rotated = applyCommand(scene, {
      type: "TRANSFORM_OBJECTS",
      ids: [furniture.id],
      rotateY: Math.PI / 3,
    });

    expect(rotated.furniture[0]?.scale).toEqual(furniture.scale);
    expect(rotated.furniture[0]?.rotation.x).toBe(furniture.rotation.x);
    expect(rotated.furniture[0]?.rotation.z).toBe(furniture.rotation.z);
    expect(rotated.furniture[0]?.rotation.y).toBeCloseTo(furniture.rotation.y + Math.PI / 3);
  });

  it("gira la pared anfitriona al rotar un vano", () => {
    const scene = sceneWithRoom();
    const wall = scene.walls[0]!;
    scene.doors.push({
      id: "door-rotation-test",
      wallId: wall.id,
      floorId: wall.floorId,
      name: "Puerta de prueba",
      kind: "single",
      offset: 2,
      width: 0.9,
      height: 2.05,
      openingDirection: "inward-left",
      visible: true,
      locked: false,
    });

    const rotated = applyCommand(scene, {
      type: "TRANSFORM_OBJECTS",
      ids: ["door-rotation-test"],
      rotateY: Math.PI / 2,
    });

    expect(rotated.walls[0]?.start.x).toBeCloseTo(2);
    expect(rotated.walls[0]?.start.y).toBeCloseTo(2);
    expect(rotated.doors[0]?.wallId).toBe(wall.id);
  });
});

describe("deteccion de habitaciones", () => {
  it("encuentra un recinto rectangular cerrado", () => {
    const scene = sceneWithRoom();
    const detected = detectRoomPolygons(scene.walls);

    expect(detected).toHaveLength(1);
    expect(detected[0]?.area).toBeCloseTo(20, 5);
    expect(detected[0]?.perimeter).toBeCloseTo(18, 5);
  });

  it("no genera habitaciones si el recinto esta abierto", () => {
    const scene = sceneWithRoom();
    const open = { ...scene, walls: scene.walls.slice(0, 3) };
    expect(detectRoomPolygons(open.walls)).toHaveLength(0);
  });

  it("conserva el nombre al recalcular tras mover una pared", () => {
    const scene = sceneWithRoom();
    const withRooms = { ...scene, rooms: recomputeRooms(scene) };
    const renamed = {
      ...withRooms,
      rooms: withRooms.rooms.map((room) => ({ ...room, name: "Sala principal" })),
    };

    const moved = applyCommand(renamed, {
      type: "UPDATE_WALL",
      wallId: renamed.walls[0]!.id,
      patch: { thickness: 0.2 },
    });

    const recomputed = recomputeRooms(moved);
    expect(recomputed).toHaveLength(1);
    expect(recomputed[0]?.name).toBe("Sala principal");
    expect(recomputed[0]?.id).toBe(renamed.rooms[0]?.id);
  });

  it("detecta las seis habitaciones de la casa demo", () => {
    const scene = createDemoHouseScene();
    const rooms = recomputeRooms(scene);
    expect(rooms.length).toBeGreaterThanOrEqual(5);
  });
});

describe("metricas", () => {
  it("descuenta los vanos de la superficie de paredes", () => {
    const scene = sceneWithRoom();
    const base = computeSceneMetrics(scene);

    const withWindow = applyCommand(scene, {
      type: "CREATE_WINDOW",
      wallId: scene.walls[0]!.id,
      offset: 2,
      width: 1.5,
      height: 1.2,
    });
    const after = computeSceneMetrics(withWindow);

    expect(base.wallSurface - after.wallSurface).toBeCloseTo(1.8, 5);
    expect(after.glazedSurface).toBeCloseTo(1.8, 5);
  });
});
