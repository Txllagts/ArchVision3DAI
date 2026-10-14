import { describe, expect, it } from "vitest";
import { SCENE_SCHEMA_VERSION } from "@archvision/types";
import {
  METERS_PER_UNIT,
  MIN_WALL_LENGTH_M,
  assignOpeningsToWalls,
  buildOpeningCandidates,
  buildWallCommands,
  floorplanStatistics,
  metersPerUnit,
  planToWorld,
  type FloorplanAnalysis,
} from "./floorplan-import";

/**
 * Traduccion de la respuesta del servicio de planos.
 *
 * Lo que no se puede fallar: las unidades. Un plano en pixeles leido como
 * metros daba muros de miles de metros y una escena inutil; un CAD en
 * centimetros leido como metros, un edificio tres veces pequeno.
 */

function rasterAnalysis(points: Array<[number, number]>): FloorplanAnalysis {
  return {
    source: { kind: "raster", units: "pixels" },
    entities: [
      {
        type: "line",
        role: "wall_candidate",
        points: [points[0]!, points[1]!],
        closed: false,
        confidence: 1,
      },
    ],
  };
}

describe("unidades del plano", () => {
  it("reconoce las unidades declaradas por el CAD", () => {
    expect(metersPerUnit("meters")).toBe(1);
    expect(metersPerUnit("centimeters")).toBe(0.01);
    expect(metersPerUnit("millimeters")).toBe(0.001);
    expect(metersPerUnit("feet")).toBeCloseTo(0.3048);
    expect(metersPerUnit("inches")).toBeCloseTo(0.0254);
  });

  it("no inventa escala para unidades desconocidas", () => {
    expect(metersPerUnit("furlongs")).toBeNull();
    expect(metersPerUnit("")).toBeNull();
  });

  it("convierte pixeles con la escala aproximada de 100 px/m", () => {
    const analysis = rasterAnalysis([
      [0, 0],
      [500, 0],
    ]);
    const start = planToWorld([0, 0], analysis);
    const end = planToWorld([500, 0], analysis);

    // 500 px a 100 px/m son 5 m, no 500 m.
    expect(end.x - start.x).toBeCloseTo(5);
  });

  it("convierte unidades CAD a metros", () => {
    const analysis: FloorplanAnalysis = {
      source: { kind: "cad", units: "centimeters" },
      entities: [],
    };

    expect(planToWorld([250, 0], analysis)).toEqual({ x: 2.5, y: 0 });
  });
});

describe("colocacion sobre el plano calibrado", () => {
  const analysis = rasterAnalysis([
    [100, 100],
    [600, 100],
  ]);

  it("usa la escala, el giro y el desplazamiento del underlay", () => {
    const placed = planToWorld([600, 100], analysis, {
      pixelsPerMeter: 100,
      offset: { x: 10, y: -2 },
      rotationDeg: 90,
    });

    // A 100 px/m el punto cae a (6, 1); girando 90° ese vector pasa a (-1, 6)
    // y al sumarle el offset queda en (9, 4).
    expect(placed.x).toBeCloseTo(9);
    expect(placed.y).toBeCloseTo(4);
  });

  it("sin colocacion cae en la aproximacion del servicio", () => {
    const raw = planToWorld([600, 100], analysis);
    expect(raw).toEqual({ x: 6, y: 1 });
  });
});

describe("comandos de muro", () => {
  const floorId = "floor_1";

  it("emite un comando por segmento de polilinea", () => {
    const analysis: FloorplanAnalysis = {
      source: { kind: "cad", units: "meters" },
      entities: [
        {
          type: "polyline",
          role: "wall_candidate",
          points: [
            [0, 0],
            [4, 0],
            [4, 3],
          ],
          closed: false,
        },
      ],
    };

    const commands = buildWallCommands(analysis, floorId);

    expect(commands).toHaveLength(2);
    expect(commands[0]).toMatchObject({
      type: "CREATE_WALL",
      origin: "ai",
      floorId,
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
    });
    expect(commands[1]).toMatchObject({ start: { x: 4, y: 0 }, end: { x: 4, y: 3 } });
  });

  it("cierra el contorno de una polilinea cerrada", () => {
    const analysis: FloorplanAnalysis = {
      source: { kind: "cad", units: "meters" },
      entities: [
        {
          type: "polyline",
          role: "wall_candidate",
          points: [
            [0, 0],
            [4, 0],
            [4, 3],
            [0, 3],
          ],
          closed: true,
        },
      ],
    };

    // Cuatro puntos cerrados son cuatro muros, no tres.
    expect(buildWallCommands(analysis, floorId)).toHaveLength(4);
  });

  it("descarta los tramos demasiado cortos", () => {
    const analysis: FloorplanAnalysis = {
      source: { kind: "cad", units: "meters" },
      entities: [
        {
          type: "line",
          role: "wall_candidate",
          points: [
            [0, 0],
            [MIN_WALL_LENGTH_M / 2, 0],
          ],
        },
      ],
    };

    expect(buildWallCommands(analysis, floorId)).toHaveLength(0);
  });

  it("ignora las entidades que no son muros", () => {
    const analysis: FloorplanAnalysis = {
      source: { kind: "cad", units: "meters" },
      entities: [
        {
          type: "line",
          role: "geometry",
          points: [
            [0, 0],
            [9, 9],
          ],
        },
      ],
    };

    expect(buildWallCommands(analysis, floorId)).toHaveLength(0);
  });

  it("convierte pixeles usando la colocacion del plano", () => {
    const analysis = rasterAnalysis([
      [0, 0],
      [1000, 0],
    ]);

    const commands = buildWallCommands(analysis, floorId, {
      pixelsPerMeter: 200,
      offset: { x: 0, y: 0 },
      rotationDeg: 0,
    });

    // A 200 px/m, 1000 px son 5 m; sin colocacion serian 10 m.
    expect(commands).toHaveLength(1);
    expect(commands[0]?.end.x).toBeCloseTo(5);
  });
});

describe("aperturas", () => {
  const analysis: FloorplanAnalysis = {
    source: { kind: "cad", units: "meters" },
    entities: [
      {
        type: "line",
        role: "wall_candidate",
        points: [
          [0, 0],
          [5, 0],
        ],
      },
      {
        type: "line",
        role: "door_candidate",
        points: [
          [2, 0],
          [2.9, 0],
        ],
      },
      {
        type: "line",
        role: "window_candidate",
        points: [
          [3, 0],
          [4.2, 0],
        ],
      },
    ],
  };

  it("cuenta los candidatos por rol", () => {
    expect(floorplanStatistics(analysis)).toEqual({
      entityCount: 3,
      wallCandidates: 1,
      doorCandidates: 1,
      windowCandidates: 1,
    });
  });

  it("sitúa puertas y ventanas sobre su muro", () => {
    const walls = buildWallCommands(analysis, "floor_1");
    const openings = buildOpeningCandidates(analysis);

    expect(openings).toHaveLength(2);
    expect(openings[0]).toMatchObject({ kind: "door", center: { x: 2.45, y: 0 } });
    expect(openings[0]?.width).toBeCloseTo(0.9);

    const assignments = assignOpeningsToWalls(walls, openings);

    expect(assignments).toHaveLength(2);
    expect(walls[assignments[0]!.wallIndex]?.end.x).toBe(5);
    expect(assignments[0]!.offset).toBeCloseTo(2.45);
    expect(assignments[1]!.offset).toBeCloseTo(3.6);
  });

  it("descarta aperturas que no tocan ningun muro", () => {
    const openings = buildOpeningCandidates({
      source: { kind: "cad", units: "meters" },
      entities: [
        {
          type: "line",
          role: "door_candidate",
          points: [
            [0, 4],
            [0.9, 4],
          ],
        },
      ],
    });

    const walls = [
      { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
    ];

    expect(assignOpeningsToWalls(walls, openings)).toHaveLength(0);
  });

  it("no coloca una apertura mas ancha que el muro", () => {
    const openings = buildOpeningCandidates({
      source: { kind: "cad", units: "meters" },
      entities: [
        {
          type: "line",
          role: "door_candidate",
          points: [
            [0, 0],
            [3.4, 0],
          ],
        },
      ],
    });

    // El ancho se acota a 3 m, pero el muro solo mide 2.5: no cabe.
    expect(openings[0]?.width).toBe(3);
    expect(
      assignOpeningsToWalls([{ start: { x: 0, y: 0 }, end: { x: 2.5, y: 0 } }], openings),
    ).toHaveLength(0);
  });

  it("devuelve el recuento del analisis para informar al usuario", () => {
    expect(floorplanStatistics({ source: { kind: "raster", units: "pixels" }, entities: [] })).toEqual({
      entityCount: 0,
      wallCandidates: 0,
      doorCandidates: 0,
      windowCandidates: 0,
    });
  });
});

describe("tabla de unidades", () => {
  it("coincide con la del servicio Python", () => {
    expect(METERS_PER_UNIT.millimeters).toBe(0.001);
    expect(METERS_PER_UNIT.kilometers).toBe(1000);
    expect(Object.keys(METERS_PER_UNIT).length).toBeGreaterThanOrEqual(11);
  });
});

describe("version del esquema", () => {
  it("los muros se crean con la altura por defecto del proyecto", () => {
    const analysis: FloorplanAnalysis = {
      source: { kind: "cad", units: "meters" },
      entities: [
        {
          type: "line",
          role: "wall_candidate",
          points: [
            [0, 0],
            [3, 0],
          ],
        },
      ],
    };

    const [command] = buildWallCommands(analysis, "floor_1");
    expect(command?.height).toBeCloseTo(2.6);
    expect(command?.thickness).toBeCloseTo(0.15);
    expect(SCENE_SCHEMA_VERSION).toBe("1.3");
  });
});

describe("salida real del servicio", () => {
  // Salida literal de `analyze_floorplan` (apps/ai-service) sobre un PNG de
  // 1000x800 px con un rectangulo de muros. Si el servicio cambia de contrato,
  // esta prueba falla antes que el editor.
  const real: FloorplanAnalysis = {
    source: {
      kind: "raster",
      units: "pixels",
    },
    entities: [
      { type: "line", role: "wall_candidate", points: [[101, 700], [901, 700]], closed: false },
      { type: "line", role: "wall_candidate", points: [[101, 100], [101, 700]], closed: false },
      { type: "line", role: "wall_candidate", points: [[901, 101], [901, 700]], closed: false },
      { type: "line", role: "wall_candidate", points: [[101, 101], [901, 101]], closed: false },
    ],
  };

  it("convierte el rectangulo a cuatro muros de 8 x 6 m sin plano colocado", () => {
    const commands = buildWallCommands(real, "floor_1");

    expect(commands).toHaveLength(4);

    const lengths = commands
      .map((command) => Math.hypot(command.end.x - command.start.x, command.end.y - command.start.y))
      .sort((a, b) => a - b);

    // 800 px y 600 px a 100 px/m.
    expect(lengths[0]).toBeCloseTo(6, 1);
    expect(lengths[3]).toBeCloseTo(8, 1);
  });

  it("los situa dentro de la imagen cuando el plano esta calibrado a 50 px/m", () => {
    const commands = buildWallCommands(real, "floor_1", {
      pixelsPerMeter: 50,
      offset: { x: 0, y: 0 },
      rotationDeg: 0,
    });

    const lengths = commands
      .map((command) => Math.hypot(command.end.x - command.start.x, command.end.y - command.start.y))
      .sort((a, b) => a - b);

    // La misma imagen, el doble de metros: el plano mide 20 x 16 m.
    expect(lengths[0]).toBeCloseTo(12, 1);
    expect(lengths[3]).toBeCloseTo(16, 1);
  });
});
