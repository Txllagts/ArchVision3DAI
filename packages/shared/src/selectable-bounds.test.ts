import { describe, expect, it } from "vitest";
import { createEmptyScene } from "@archvision/types";
import {
  containsRect2D,
  getSelectableBounds,
  getTransformTargetIds,
  intersectsRect2D,
} from "./selectable-bounds";

describe("getSelectableBounds", () => {
  it("includes wall thickness and floor elevation in world coordinates", () => {
    const scene = createEmptyScene();
    scene.floors.push({
      id: "floor-1",
      name: "Floor 1",
      level: 0,
      elevation: 2,
      height: 3,
      visible: true,
      locked: false,
    });
    scene.walls.push({
      id: "wall-1",
      floorId: "floor-1",
      name: "Wall 1",
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
      height: 3,
      thickness: 0.2,
      baseOffset: 0.1,
      visible: true,
      locked: false,
    });
    const wall = scene.walls[0];
    if (!wall) throw new Error("Expected a test wall");

    const bounds = getSelectableBounds("wall", wall, scene);

    expect(bounds.min.y).toBeCloseTo(2 + wall.baseOffset);
    expect(bounds.max.y).toBeCloseTo(2 + wall.baseOffset + wall.height);
    expect(bounds.max.x - bounds.min.x).toBeCloseTo(4);
    expect(bounds.max.z - bounds.min.z).toBeCloseTo(wall.thickness);

    const opening = {
      id: "opening-1",
      wallId: wall.id,
      floorId: wall.floorId,
      name: "Opening 1",
      offset: 2,
      width: 1,
      height: 2,
      sillHeight: 0.2,
      visible: true,
      locked: false,
    };
    scene.openings.push(opening);

    const openingBounds = getSelectableBounds("opening", opening, scene);
    expect(openingBounds.min.x).toBeCloseTo(1.5);
    expect(openingBounds.max.x).toBeCloseTo(2.5);
    expect(openingBounds.min.y).toBeCloseTo(2 + wall.baseOffset + opening.sillHeight);
  });

  it("distinguishes contained objects from crossing objects", () => {
    const marquee = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const object = { minX: 2, minY: 2, maxX: 12, maxY: 4 };

    expect(containsRect2D(marquee, object)).toBe(false);
    expect(intersectsRect2D(marquee, object)).toBe(true);
  });

  it("includes roof overhang and slope in world bounds", () => {
    const scene = createEmptyScene();
    scene.floors.push({
      id: "floor-1",
      name: "Floor 1",
      level: 0,
      elevation: 2,
      height: 3,
      visible: true,
      locked: false,
    });
    const roof = {
      id: "roof-1",
      floorId: "floor-1",
      name: "Roof 1",
      kind: "gable" as const,
      outline: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 8 },
        { x: 0, y: 8 },
      ],
      slopeDeg: 30,
      baseHeight: 0.5,
      overhang: 0.5,
      thickness: 0.2,
      visible: true,
      locked: false,
    };

    const bounds = getSelectableBounds("roof", roof, scene);

    expect(bounds.min.x).toBeCloseTo(-0.5);
    expect(bounds.max.x).toBeCloseTo(10.5);
    expect(bounds.min.z).toBeCloseTo(-0.5);
    expect(bounds.max.z).toBeCloseTo(8.5);
    expect(bounds.max.y).toBeCloseTo(2 + 0.5 + 0.2 + 4.5 * Math.tan(Math.PI / 6));
  });

  it("usa las dimensiones reales del catalogo para el mobiliario", () => {
    const scene = createEmptyScene();
    scene.floors.push({
      id: "floor-1",
      name: "Floor 1",
      level: 0,
      elevation: 0,
      height: 3,
      visible: true,
      locked: false,
    });
    const sofa = {
      id: "sofa-1",
      floorId: "floor-1",
      name: "Sofa",
      catalogId: "sofa-3-seat",
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1.2, y: 1, z: 1.1 },
      visible: true,
      locked: false,
    };
    scene.furniture.push(sofa);

    // sofa-3-seat mide 2,1 x 0,9 en el catalogo; la instancia escala X y Z.
    const bounds = getSelectableBounds("furniture", sofa, scene);
    expect(bounds.max.x - bounds.min.x).toBeCloseTo(2.1 * 1.2);
    expect(bounds.max.z - bounds.min.z).toBeCloseTo(0.9 * 1.1);
  });
});

describe("getTransformTargetIds", () => {
  function sceneWithDoor() {
    const scene = createEmptyScene();
    scene.floors.push({
      id: "floor-1",
      name: "Floor 1",
      level: 0,
      elevation: 0,
      height: 3,
      visible: true,
      locked: false,
    });
    scene.walls.push({
      id: "wall-1",
      floorId: "floor-1",
      name: "Wall 1",
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
      height: 3,
      thickness: 0.2,
      baseOffset: 0,
      visible: true,
      locked: false,
    });
    scene.doors.push({
      id: "door-1",
      wallId: "wall-1",
      floorId: "floor-1",
      name: "Door 1",
      kind: "single",
      offset: 2,
      width: 0.9,
      height: 2.05,
      openingDirection: "inward-left",
      visible: true,
      locked: false,
    });
    return scene;
  }

  it("expande un vano seleccionado a su pared anfitriona", () => {
    const scene = sceneWithDoor();
    const targets = getTransformTargetIds(scene, ["door-1"]);
    expect(targets.has("door-1")).toBe(true);
    expect(targets.has("wall-1")).toBe(true);
  });

  it("no expande un vano bloqueado ni su muro bloqueado", () => {
    const scene = sceneWithDoor();
    scene.doors[0]!.locked = true;
    const targets = getTransformTargetIds(scene, ["door-1"]);
    expect(targets.has("door-1")).toBe(false);
    expect(targets.has("wall-1")).toBe(false);

    const scene2 = sceneWithDoor();
    scene2.walls[0]!.locked = true;
    const targets2 = getTransformTargetIds(scene2, ["door-1"]);
    expect(targets2.has("door-1")).toBe(true);
    expect(targets2.has("wall-1")).toBe(false);
  });
});