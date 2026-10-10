import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMPORTED_MODEL_SIZE,
  cachedGlbBounds,
  importedModelSize,
  readGlbBounds,
  readGltfBounds,
  rememberGlbBounds,
} from "./glb-bounds";

/** Construye un GLB minimo valido con el JSON que se le pase. */
function buildGlb(json: unknown, withBinChunk = false): Uint8Array {
  const jsonText = JSON.stringify(json);
  const jsonBytes = new TextEncoder().encode(jsonText);
  const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;

  const binLength = withBinChunk ? 8 : 0;
  const total = 12 + 8 + jsonBytes.length + jsonPadding + binLength;

  const data = new Uint8Array(total);
  const view = new DataView(data.buffer);

  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);

  view.setUint32(12, jsonBytes.length + jsonPadding, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  data.set(jsonBytes, 20);
  for (let index = 0; index < jsonPadding; index += 1) data[20 + jsonBytes.length + index] = 0x20;

  if (withBinChunk) {
    const offset = 20 + jsonBytes.length + jsonPadding;
    view.setUint32(offset, 0, true); // chunk BIN vacio
    view.setUint32(offset + 4, 0x004e4942, true);
  }

  return data;
}

const gltf = {
  asset: { version: "2.0" },
  accessors: [
    { componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [2, 1, 3] },
    // Este accesor tiene min/max enormes, pero ninguna malla lo usa como
    // POSITION: no debe ensanchar la caja.
    { componentType: 5126, count: 3, type: "VEC3", min: [-99, -99, -99], max: [99, 99, 99] },
  ],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 } }] }],
};

describe("caja de un GLB", () => {
  it("lee el tamaño real del modelo", () => {
    const bounds = readGlbBounds(buildGlb(gltf));

    expect(bounds).not.toBeNull();
    expect(bounds?.min).toEqual({ x: 0, y: 0, z: 0 });
    expect(bounds?.max).toEqual({ x: 2, y: 1, z: 3 });
    expect(bounds?.size).toEqual({ x: 2, y: 1, z: 3 });
  });

  it("ignora los accesores que no son POSITION", () => {
    const bounds = readGlbBounds(buildGlb(gltf, true));
    expect(bounds?.size.x).toBe(2);
    expect(bounds?.size.z).toBe(3);
  });

  it("acepta un buffer parcial mientras contenga el chunk JSON", () => {
    const full = buildGlb(gltf, true);
    const view = new DataView(full.buffer, full.byteOffset, full.byteLength);
    const jsonLength = view.getUint32(12, true);

    // Se recorta justo al final del chunk JSON: falta el chunk BIN.
    const partial = full.subarray(0, 20 + jsonLength);
    expect(partial.byteLength).toBeLessThan(full.byteLength);

    const bounds = readGlbBounds(partial);

    expect(bounds?.size).toEqual({ x: 2, y: 1, z: 3 });
  });

  it("devuelve null si el chunk JSON no está completo", () => {
    const full = buildGlb(gltf);
    expect(readGlbBounds(full.subarray(0, 30))).toBeNull();
  });

  it("devuelve null con datos que no son GLB", () => {
    expect(readGlbBounds(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
    expect(readGlbBounds(new Uint8Array(0))).toBeNull();
  });

  it("devuelve null si el JSON no declara mallas", () => {
    expect(readGlbBounds(buildGlb({ asset: { version: "2.0" }, accessors: [] }))).toBeNull();
  });

  it("tambien lee un GLTF en JSON puro", () => {
    const data = new TextEncoder().encode(JSON.stringify(gltf));
    expect(readGltfBounds(data)?.size).toEqual({ x: 2, y: 1, z: 3 });
  });
});

describe("tamaño de un modelo importado", () => {
  const url = "/api/projects/p/files/f/content";

  it("usa el tamaño por defecto hasta que se conoce la caja", () => {
    rememberGlbBounds(`${url}-sin-caja`, null);
    const size = importedModelSize(`${url}-sin-caja`, { x: 1, y: 1, z: 1 });

    expect(size).toEqual({
      x: DEFAULT_IMPORTED_MODEL_SIZE,
      y: DEFAULT_IMPORTED_MODEL_SIZE,
      z: DEFAULT_IMPORTED_MODEL_SIZE,
    });
  });

  it("aplica la escala de la entidad a la caja real", () => {
    rememberGlbBounds(url, {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 2, y: 1, z: 3 },
      size: { x: 2, y: 1, z: 3 },
    });

    expect(cachedGlbBounds(url)?.size.z).toBe(3);
    expect(importedModelSize(url, { x: 2, y: 1, z: 0.5 })).toEqual({
      x: 4,
      y: 1,
      z: 1.5,
    });
  });
});
