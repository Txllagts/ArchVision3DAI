import { describe, expect, it } from "vitest";
import type { Roof, Slab, Stair, Wall } from "@archvision/types";
import {
  clampOpening,
  collectWallOpenings,
  createWallGeometry,
  wallGeometryKey,
  wallLength,
  wallTransform,
} from "./wall";
import { createSlabGeometry } from "./slab";
import { createRoofGeometry } from "./roof";
import { createStairGeometry } from "./stair";

const wall: Wall = {
  id: "wall-1",
  floorId: "floor-1",
  name: "Fachada sur",
  start: { x: 0, y: 0 },
  end: { x: 6, y: 0 },
  height: 2.7,
  thickness: 0.2,
  baseOffset: 0,
  visible: true,
  locked: false,
};

describe("wall", () => {
  it("calcula longitud y transformacion", () => {
    expect(wallLength(wall)).toBeCloseTo(6, 10);

    const transform = wallTransform(wall, 3);
    expect(transform.position).toEqual([0, 3, 0]);
    expect(transform.rotationY).toBeCloseTo(0, 10);
  });

  it("orienta la pared segun su direccion en planta", () => {
    // Una pared hacia +y del plano apunta hacia +z del mundo: rotacion -90.
    const transform = wallTransform(
      { ...wall, end: { x: 0, y: 6 } },
      0,
    );
    expect(transform.rotationY).toBeCloseTo(-Math.PI / 2, 10);
  });

  it("recorta vanos a los limites de la pared", () => {
    const inside = clampOpening(
      { id: "w", offset: 3, width: 1.2, height: 1.2, sillHeight: 0.9 },
      6,
      2.7,
    );
    expect(inside).not.toBeNull();
    expect(inside?.u0).toBeCloseTo(2.4, 10);
    expect(inside?.u1).toBeCloseTo(3.6, 10);

    const outside = clampOpening(
      { id: "w", offset: 0, width: 1.2, height: 1.2, sillHeight: 0.9 },
      6,
      2.7,
    );
    // El vano queda fuera por la izquierda: se descarta en lugar de deformarse.
    expect(outside?.u0).toBeCloseTo(0.01, 10);
  });

  it("descarta vanos mas altos que la pared", () => {
    const result = clampOpening(
      { id: "w", offset: 3, width: 1, height: 1, sillHeight: 2.7 },
      6,
      2.7,
    );
    expect(result).toBeNull();
  });

  it("genera geometria con y sin vanos", () => {
    const solid = createWallGeometry(wall);
    const withHole = createWallGeometry(wall, [
      { id: "win-1", offset: 3, width: 1.5, height: 1.2, sillHeight: 0.9 },
    ]);

    const solidVertices = solid.getAttribute("position").count;
    const holeVertices = withHole.getAttribute("position").count;

    // Un hueco anade caras: la malla con vano tiene mas vertices.
    expect(holeVertices).toBeGreaterThan(solidVertices);

    solid.dispose();
    withHole.dispose();
  });

  it("agrupa los vanos que pertenecen a la pared", () => {
    const openings = collectWallOpenings(
      "wall-1",
      [
        {
          id: "door-1",
          wallId: "wall-1",
          floorId: "floor-1",
          name: "Puerta",
          kind: "single",
          offset: 1,
          width: 0.9,
          height: 2.05,
          openingDirection: "inward-left",
          visible: true,
          locked: false,
        },
      ],
      [
        {
          id: "win-1",
          wallId: "wall-2",
          floorId: "floor-1",
          name: "Ventana ajena",
          kind: "single",
          offset: 1,
          width: 1.2,
          height: 1.2,
          sillHeight: 0.9,
          frameThickness: 0.05,
          visible: true,
          locked: false,
        },
      ],
    );

    expect(openings).toHaveLength(1);
    expect(openings[0]?.sillHeight).toBe(0);
  });

  it("la clave de geometria ignora cambios que no afectan a la forma", () => {
    const key = wallGeometryKey(wall, []);
    const sameShape = wallGeometryKey(
      { ...wall, name: "Otro nombre", materialInteriorId: "mat_brick_red" },
      [],
    );
    const otherShape = wallGeometryKey({ ...wall, height: 3 }, []);

    expect(sameShape).toBe(key);
    expect(otherShape).not.toBe(key);
  });
});

describe("slab", () => {
  it("genera una losa horizontal con el espesor hacia arriba", () => {
    const slab: Slab = {
      id: "slab-1",
      floorId: "floor-1",
      name: "Losa",
      outline: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 3 },
        { x: 0, y: 3 },
      ],
      thickness: 0.2,
      visible: true,
      locked: false,
    };

    const geometry = createSlabGeometry(slab);
    const box = geometry.boundingBox;

    expect(box).not.toBeNull();
    expect(box?.min.y).toBeCloseTo(0, 5);
    expect(box?.max.y).toBeCloseTo(0.2, 5);
    // La coordenada `y` del plano se conserva como `z` del mundo, sin espejar.
    expect(box?.max.z).toBeCloseTo(3, 5);
    expect(box?.max.x).toBeCloseTo(4, 5);

    geometry.dispose();
  });
});

describe("roof", () => {
  const base: Omit<Roof, "kind"> = {
    id: "roof-1",
    floorId: "floor-1",
    name: "Cubierta",
    outline: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 8 },
      { x: 0, y: 8 },
    ],
    slopeDeg: 28,
    baseHeight: 2.7,
    overhang: 0.6,
    thickness: 0.2,
    visible: true,
    locked: false,
  };

  it("genera geometria valida para cada tipo", () => {
    for (const kind of ["flat", "shed", "gable", "hip", "mansard"] as const) {
      const geometry = createRoofGeometry({ ...base, kind });
      const position = geometry.getAttribute("position");

      // Una fusion fallida devolveria una geometria sin vertices.
      expect(position, `tipo ${kind}`).toBeDefined();
      expect(position.count, `tipo ${kind}`).toBeGreaterThan(0);

      geometry.dispose();
    }
  });

  it("la cubierta a dos aguas se eleva con la pendiente", () => {
    const flat = createRoofGeometry({ ...base, kind: "flat" });
    const gable = createRoofGeometry({ ...base, kind: "gable" });
    const rotatedGable = createRoofGeometry({
      ...base,
      kind: "gable",
      rotationY: Math.PI / 2,
    });

    flat.computeBoundingBox();
    gable.computeBoundingBox();
    rotatedGable.computeBoundingBox();

    expect(gable.boundingBox!.max.y).toBeGreaterThan(flat.boundingBox!.max.y);
    // La geometria se centra para poder girar sin recalcular su huella.
    expect(gable.boundingBox!.min.x).toBeCloseTo(-5.6, 3);
    expect(gable.boundingBox!.max.x).toBeCloseTo(5.6, 3);
    expect(rotatedGable.boundingBox!.min.x).toBeCloseTo(gable.boundingBox!.min.x, 3);
    expect(rotatedGable.boundingBox!.max.x).toBeCloseTo(gable.boundingBox!.max.x, 3);

    flat.dispose();
    gable.dispose();
    rotatedGable.dispose();
  });
});

describe("stair", () => {
  it("genera una escalera recta que alcanza la altura pedida", () => {
    const stair: Stair = {
      id: "stair-1",
      floorId: "floor-1",
      name: "Escalera",
      kind: "straight",
      position: { x: 0, y: 0 },
      rotationY: 0,
      totalRise: 2.9,
      width: 1,
      steps: 16,
      tread: 0.28,
      riser: 2.9 / 16,
      hasLanding: false,
      hasRailing: true,
      visible: true,
      locked: false,
    };

    const geometry = createStairGeometry(stair);
    expect(geometry.boundingBox?.max.y).toBeCloseTo(2.9, 3);
    geometry.dispose();
  });
});

describe("coordenadas de textura", () => {
  /**
   * Las texturas se configuran con la repeticion en metros, asi que las UV
   * deben estar en metros tambien. Una pared de 6 m debe recorrer 6 unidades
   * de textura, no 1.
   */
  it("proyecta las UV de la pared en metros", () => {
    const geometry = createWallGeometry(wall, []);
    const uv = geometry.getAttribute("uv");
    expect(uv).toBeTruthy();

    let maxU = Number.NEGATIVE_INFINITY;
    let maxV = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < uv!.count; i += 1) {
      maxU = Math.max(maxU, Math.abs(uv!.getX(i)));
      maxV = Math.max(maxV, Math.abs(uv!.getY(i)));
    }

    expect(maxU).toBeCloseTo(wallLength(wall), 3);
    expect(maxV).toBeCloseTo(wall.height, 3);
    geometry.dispose();
  });

  it("da UV a todas las cubiertas", () => {
    const base: Omit<Roof, "kind"> = {
      id: "roof-uv",
      floorId: "floor-1",
      name: "Cubierta",
      outline: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 8 },
        { x: 0, y: 8 },
      ],
      slopeDeg: 28,
      baseHeight: 2.7,
      overhang: 0.6,
      thickness: 0.2,
      visible: true,
      locked: false,
    };

    for (const kind of ["flat", "shed", "gable", "hip", "mansard"] as const) {
      const geometry = createRoofGeometry({ ...base, kind });
      const uv = geometry.getAttribute("uv");
      expect(uv, kind).toBeTruthy();
      expect(uv!.count).toBe(geometry.getAttribute("position").count);
      geometry.dispose();
    }
  });
});
