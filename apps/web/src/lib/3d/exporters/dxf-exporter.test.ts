import { describe, expect, it } from "vitest";
import { createEmptyScene, type SceneDocument } from "@archvision/types";
import { DXF_LAYERS, exportDxf } from "./dxf-exporter";
import type { ExportOptions } from "./types";

function options(overrides: Partial<ExportOptions> = {}): ExportOptions {
  return {
    format: "dxf",
    unit: "m",
    includeFurniture: false,
    includeMaterials: false,
    ...overrides,
  };
}

/**
 * Planta minima: una pared visible de 3,75 m con puerta y ventana, una
 * habitacion "Baño" y una pared de un nivel invisible que no debe exportarse.
 */
function buildScene(): SceneDocument {
  const scene = createEmptyScene();

  scene.floors.push(
    {
      id: "floor-1",
      name: "Planta baja",
      level: 0,
      elevation: 0,
      height: 2.6,
      visible: true,
      locked: false,
    },
    {
      id: "floor-2",
      name: "Planta alta",
      level: 1,
      elevation: 3,
      height: 2.6,
      visible: false,
      locked: false,
    },
  );

  scene.walls.push(
    {
      id: "wall-1",
      floorId: "floor-1",
      name: "Muro norte",
      start: { x: 0, y: 0 },
      end: { x: 3.75, y: 0 },
      height: 2.6,
      thickness: 0.2,
      baseOffset: 0,
      visible: true,
      locked: false,
    },
    {
      id: "wall-hidden",
      floorId: "floor-2",
      name: "Muro oculto",
      start: { x: 0, y: 0 },
      end: { x: 7.31, y: 0 },
      height: 2.6,
      thickness: 0.2,
      baseOffset: 0,
      visible: true,
      locked: false,
    },
  );

  scene.doors.push({
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
  });

  scene.windows.push({
    id: "window-1",
    wallId: "wall-1",
    floorId: "floor-1",
    name: "Ventana",
    kind: "single",
    offset: 3,
    width: 1.2,
    height: 1.2,
    sillHeight: 0.95,
    frameThickness: 0.05,
    visible: true,
    locked: false,
  });

  scene.rooms.push({
    id: "room-1",
    floorId: "floor-1",
    name: "Baño",
    polygon: [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ],
    wallIds: ["wall-1"],
    area: 4,
    perimeter: 8,
  });

  return scene;
}

async function dxfLines(opts: ExportOptions): Promise<string[]> {
  const blob = exportDxf(buildScene(), opts);
  return (await blob.text()).split("\n");
}

function layerColor(lines: string[], layer: string): string | undefined {
  const index = lines.indexOf(layer);
  if (index < 0) return undefined;
  expect(lines[index + 1]).toBe("62");
  return lines[index + 2];
}

function headerValue(lines: string[], variable: string): string | undefined {
  const index = lines.indexOf(`$${variable}`);
  if (index < 0) return undefined;
  expect(lines[index + 1]).toBe("70");
  return lines[index + 2];
}

function containsBytes(haystack: Uint8Array, needle: number[]): boolean {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

describe("exportDxf", () => {
  it("crea las cuatro capas con colores ACI distintos", async () => {
    const lines = await dxfLines(options());

    expect(layerColor(lines, DXF_LAYERS.walls)).toBe("7");
    expect(layerColor(lines, DXF_LAYERS.openings)).toBe("1");
    expect(layerColor(lines, DXF_LAYERS.dimensions)).toBe("3");
    expect(layerColor(lines, DXF_LAYERS.texts)).toBe("5");

    // Cada capa ademas se usa en al menos una entidad (ademas de su definicion).
    for (const layer of Object.values(DXF_LAYERS)) {
      const uses = lines.filter((line) => line === layer);
      expect(uses.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("declara formato R2000 y la unidad de dibujo en $INSUNITS", async () => {
    const meters = await dxfLines(options({ unit: "m" }));
    expect(meters).toContain("AC1015");
    expect(headerValue(meters, "INSUNITS")).toBe("6");

    const centimeters = await dxfLines(options({ unit: "cm" }));
    expect(headerValue(centimeters, "INSUNITS")).toBe("5");

    const millimeters = await dxfLines(options({ unit: "mm" }));
    expect(headerValue(millimeters, "INSUNITS")).toBe("4");
  });

  it("dibuja muros, vanos, cotas y textos como entidades", async () => {
    const lines = await dxfLines(options());

    expect(lines).toContain("LWPOLYLINE"); // contorno de muro y marco de ventana
    expect(lines).toContain("ARC"); // barrido de la puerta
    expect(lines).toContain("LINE"); // jambas, cota y marcas
    expect(lines).toContain("TEXT"); // valor de cota y habitacion

    // La pared invisible de un nivel no visible no se exporta.
    expect(lines).not.toContain("7.31");
  });

  it("escala las coordenadas de metros a la unidad elegida", async () => {
    const meters = await dxfLines(options({ unit: "m" }));
    expect(meters).toContain("3.75");

    const centimeters = await dxfLines(options({ unit: "cm" }));
    const scaled = centimeters.find(
      (line) => line.startsWith("375") && line.includes("."),
    );
    expect(scaled).toBeDefined();
  });

  it("escribe los acentos en la codepage ANSI_1252 declarada, no en UTF-8", async () => {
    const blob = exportDxf(buildScene(), options());
    const bytes = new Uint8Array(await blob.arrayBuffer());

    // "Baño" en Windows-1252: 42 61 F1 6F.
    expect(containsBytes(bytes, [0x42, 0x61, 0xf1, 0x6f])).toBe(true);
    // "4.00 m²" en Windows-1252: ... 6D B2.
    expect(containsBytes(bytes, [0x34, 0x2e, 0x30, 0x30, 0x20, 0x6d, 0xb2])).toBe(true);
    // Ningun byte de secuencia UTF-8 multibyte (0xC3/0xC2) aparece en el archivo.
    expect(containsBytes(bytes, [0xc3])).toBe(false);
    expect(containsBytes(bytes, [0xc2])).toBe(false);
  });
});
