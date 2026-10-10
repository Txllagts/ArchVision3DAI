import { describe, expect, it } from "vitest";
import type { SceneDocument, Wall } from "@archvision/types";
import { createDemoHouseScene } from "@archvision/shared";
import { findWallAt, snapPoint } from "./snapping";
import { computeSceneBounds, poseForView } from "./views";
import { environmentPreset, sunDirectionFor } from "./environment";

const walls: Wall[] = [
  {
    id: "wall-1",
    floorId: "floor-1",
    name: "Sur",
    start: { x: 0, y: 0 },
    end: { x: 6, y: 0 },
    height: 2.6,
    thickness: 0.15,
    baseOffset: 0,
    visible: true,
    locked: false,
  },
];

describe("snapping", () => {
  it("captura el extremo de una pared cercana", () => {
    const result = snapPoint({ x: 5.94, y: 0.03 }, {
      walls,
      gridStep: 0.1,
      threshold: 0.25,
    });

    expect(result.kind).toBe("endpoint");
    expect(result.point).toEqual({ x: 6, y: 0 });
  });

  it("captura el punto medio antes que el eje de la pared", () => {
    const result = snapPoint({ x: 3.02, y: 0.04 }, {
      walls,
      gridStep: 0.1,
      threshold: 0.25,
    });

    expect(result.kind).toBe("midpoint");
    expect(result.point.x).toBeCloseTo(3, 6);
  });

  it("proyecta sobre el eje de la pared cuando no hay nodo cerca", () => {
    const result = snapPoint({ x: 1.5, y: 0.05 }, {
      walls,
      gridStep: 0.1,
      threshold: 0.25,
    });

    expect(result.kind).toBe("wall");
    expect(result.distanceAlong).toBeCloseTo(1.5, 6);
  });

  it("alinea con el punto de referencia en ortogonal", () => {
    const result = snapPoint({ x: 9.98, y: 4 }, {
      walls: [],
      gridStep: 0.1,
      threshold: 0.25,
      reference: { x: 10, y: 0 },
    });

    expect(result.kind).toBe("axis");
    expect(result.point.x).toBe(10);
  });

  it("cae en la cuadricula cuando no hay nada mas", () => {
    const result = snapPoint({ x: 2.34, y: 5.67 }, {
      walls: [],
      gridStep: 0.5,
      threshold: 0.1,
    });

    expect(result.kind).toBe("grid");
    expect(result.point).toEqual({ x: 2.5, y: 5.5 });
  });

  it("localiza la pared bajo el puntero con su offset", () => {
    const hit = findWallAt({ x: 4, y: 0.05 }, walls, 0.3);
    expect(hit?.wall.id).toBe("wall-1");
    expect(hit?.offset).toBeCloseTo(4, 6);

    expect(findWallAt({ x: 4, y: 3 }, walls, 0.3)).toBeNull();
  });
});

describe("encuadres", () => {
  it("calcula la caja envolvente de la casa demo", () => {
    const scene: SceneDocument = createDemoHouseScene();
    const bounds = computeSceneBounds(scene);

    // La casa mide 10 x 8 m, pero la caja envolvente incluye el alero de la
    // cubierta (0,6 m por lado) para que el encuadre no recorte los faldones.
    expect(bounds.size.x).toBeCloseTo(11.2, 3);
    expect(bounds.size.z).toBeCloseTo(9.2, 3);
    expect(bounds.max.y).toBeGreaterThan(2.7);
  });

  it("situa la vista superior sobre el centro del modelo", () => {
    const bounds = computeSceneBounds(createDemoHouseScene());
    const pose = poseForView("top", bounds);

    expect(pose.orthographic).toBe(true);
    expect(pose.position.y).toBeGreaterThan(bounds.max.y);
    expect(pose.target.x).toBeCloseTo(bounds.center.x, 6);
  });
});

describe("entorno", () => {
  it("devuelve un preset por cada cielo", () => {
    const preset = environmentPreset({
      sky: "sunset",
      northAngleDeg: 0,
      groundColor: "#333333",
      showGrid: true,
    });
    expect(preset.sunIntensity).toBeGreaterThan(0);
  });

  it("el sol esta mas alto al mediodia que al amanecer", () => {
    const noon = sunDirectionFor({
      latitude: 7.1,
      longitude: -73.1,
      date: new Date(2026, 5, 21, 12, 0),
    });
    const morning = sunDirectionFor({
      latitude: 7.1,
      longitude: -73.1,
      date: new Date(2026, 5, 21, 7, 0),
    });

    expect(noon[1]).toBeGreaterThan(morning[1]);
  });
});
