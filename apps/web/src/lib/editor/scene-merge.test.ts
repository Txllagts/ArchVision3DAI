import { describe, expect, it } from "vitest";
import { createDefaultScene } from "@archvision/shared";
import type { SceneDocument, Wall } from "@archvision/types";
import { mergeScenes, stableStringify } from "./scene-merge";

function wall(id: string, overrides: Partial<Wall> = {}): Wall {
  return {
    id,
    floorId: "flr_1",
    name: `Muro ${id}`,
    start: { x: 0, y: 0 },
    end: { x: 4, y: 0 },
    height: 2.7,
    thickness: 0.15,
    baseOffset: 0,
    visible: true,
    locked: false,
    ...overrides,
  };
}

function sceneWith(walls: Wall[]): SceneDocument {
  const scene = createDefaultScene();
  // ids estables: `createDefaultScene` genera ids aleatorios por llamada y
  // el merge los veria como entidades distintas en cada rama.
  return {
    ...scene,
    floors: [
      { id: "flr_1", name: "Planta baja", level: 0, elevation: 0, height: 2.7, visible: true, locked: false },
    ],
    walls,
    activeFloorId: "flr_1",
  };
}

describe("stableStringify", () => {
  it("ignora el orden de las claves", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it("distingue valores distintos", () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });

  it("trata undefined de forma estable", () => {
    expect(stableStringify(undefined)).toBe(stableStringify(undefined));
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });
});

describe("mergeScenes", () => {
  const base = sceneWith([wall("w1"), wall("w2")]);

  it("fusiona anadidos no solapados de las dos ramas", () => {
    const local = sceneWith([wall("w1"), wall("w2"), wall("w-local")]);
    const server = sceneWith([wall("w1"), wall("w2"), wall("w-server")]);

    const result = mergeScenes(base, local, server);

    expect(result.overlap).toBe(false);
    const ids = result.scene.walls.map((item) => item.id);
    expect(ids).toContain("w-local");
    expect(ids).toContain("w-server");
    expect(ids).toHaveLength(4);
  });

  it("fusiona modificaciones de distintos muros", () => {
    const local = sceneWith([wall("w1", { height: 3 }), wall("w2")]);
    const server = sceneWith([wall("w1"), wall("w2", { thickness: 0.3 })]);

    const result = mergeScenes(base, local, server);

    expect(result.overlap).toBe(false);
    expect(result.scene.walls.find((item) => item.id === "w1")?.height).toBe(3);
    expect(result.scene.walls.find((item) => item.id === "w2")?.thickness).toBe(0.3);
  });

  it("respeta el borrado de una rama cuando la otra no toco la entidad", () => {
    const local = sceneWith([wall("w1")]); // borro w2
    const server = sceneWith([wall("w1"), wall("w2"), wall("w3")]); // anadio w3

    const result = mergeScenes(base, local, server);

    expect(result.overlap).toBe(false);
    const ids = result.scene.walls.map((item) => item.id);
    expect(ids).toEqual(["w1", "w3"]);
  });

  it("reporta solape cuando la misma pared cambio en las dos ramas", () => {
    const local = sceneWith([wall("w1", { height: 3 }), wall("w2")]);
    const server = sceneWith([wall("w1", { height: 4 }), wall("w2")]);

    const result = mergeScenes(base, local, server);

    expect(result.overlap).toBe(true);
  });

  it("reporta solape cuando una rama modifica y la otra borra", () => {
    const local = sceneWith([wall("w1", { height: 3 }), wall("w2")]);
    const server = sceneWith([wall("w2")]); // borro w1

    const result = mergeScenes(base, local, server);

    expect(result.overlap).toBe(true);
  });

  it("fusiona los campos escalares sin solape", () => {
    const local: SceneDocument = {
      ...sceneWith([wall("w1"), wall("w2")]),
      displayUnit: "ft",
    };
    const server: SceneDocument = {
      ...sceneWith([wall("w1"), wall("w2")]),
      environment: { ...base.environment, groundColor: "#101010" },
    };

    const result = mergeScenes(base, local, server);

    expect(result.overlap).toBe(false);
    expect(result.scene.displayUnit).toBe("ft");
    expect(result.scene.environment.groundColor).toBe("#101010");
  });

  it("reporta solape cuando el mismo campo escalario cambio en las dos ramas", () => {
    const local: SceneDocument = { ...base, displayUnit: "ft" };
    const server: SceneDocument = { ...base, displayUnit: "cm" };

    const result = mergeScenes(base, local, server);

    expect(result.overlap).toBe(true);
  });
});
