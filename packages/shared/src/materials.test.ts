import { describe, expect, it } from "vitest";
import { SCENE_SCHEMA_VERSION, type SceneDocument } from "@archvision/types";
import { applyCommand, CommandError } from "./command-reducer";
import { createDefaultScene } from "./scene-factory";
import { MATERIAL_CATALOG, builtinMaterials } from "./material-catalog";
import { migrateScene } from "./scene-migrations";

function baseScene(): SceneDocument {
  return createDefaultScene({ floorsCount: 1 });
}

describe("catalogo de materiales", () => {
  it("no repite identificadores", () => {
    const ids = new Set(MATERIAL_CATALOG.map((material) => material.id));
    expect(ids.size).toBe(MATERIAL_CATALOG.length);
  });

  it("entrega definiciones sin campos ajenos al esquema", () => {
    for (const material of builtinMaterials()) {
      expect(material).not.toHaveProperty("usage");
      expect(material.builtin).toBe(true);
    }
  });
});

describe("migracion de escenas", () => {
  it("lleva una escena 1.0 a la version actual", () => {
    const legacy = {
      version: "1.0",
      materials: [{ id: "mat_x", name: "Antiguo", baseColor: "#ffffff" }],
    };

    const result = migrateScene(legacy);
    const scene = result.scene as {
      version: string;
      materials: Array<{ texture?: string; bump?: number }>;
    };

    expect(result.migrated).toBe(true);
    expect(result.from).toBe("1.0");
    expect(scene.version).toBe(SCENE_SCHEMA_VERSION);
    expect(scene.materials[0]?.texture).toBe("plain");
  });

  it("no toca una escena que ya esta en la version actual", () => {
    const current = { version: SCENE_SCHEMA_VERSION, materials: [] };
    const result = migrateScene(current);
    expect(result.migrated).toBe(false);
    expect(result.scene).toBe(current);
  });

  it("respeta la textura que el material ya declaraba", () => {
    const legacy = {
      version: "1.0",
      materials: [{ id: "mat_x", texture: "brick" }],
    };
    const scene = migrateScene(legacy).scene as {
      materials: Array<{ texture?: string }>;
    };
    expect(scene.materials[0]?.texture).toBe("brick");
  });
  it("deja pasar un documento de version desconocida para que lo rechace el validador", () => {
    const future = { version: "9.9" };

    const result = migrateScene(future);

    expect(result.migrated).toBe(false);
    expect(result.scene).toBe(future);
  });

  it("lleva una escena 1.2 a la version actual añadiendo los modelos importados", () => {
    const legacy = {
      version: "1.2",
      materials: [],
      walls: [],
      underlay: null,
    };

    const result = migrateScene(legacy);

    expect(result.migrated).toBe(true);
    expect(result.from).toBe("1.2");
    const scene = result.scene as {
      version: string;
      importedModels: unknown;
    };
    // Sin este paso, una escena guardada antes de los modelos importados se
    // quedaba en 1.2 y no superaba la validacion: el proyecto no abria.
    expect(scene.version).toBe(SCENE_SCHEMA_VERSION);
    expect(scene.importedModels).toEqual([]);
  });

  it("no toca los modelos importados que la escena ya traia", () => {
    const model = { id: "im_1", name: "silla.glb" };

    const scene = migrateScene({
      version: "1.2",
      importedModels: [model],
    }).scene as { importedModels: unknown[] };

    expect(scene.importedModels).toEqual([model]);
  });
});
describe("comandos de material", () => {
  it("crea un material propio con id generado", () => {
    const scene = baseScene();
    const next = applyCommand(scene, {
      type: "CREATE_MATERIAL",
      material: {
        name: "Mi pintura",
        category: "paint",
        baseColor: "#123456",
        roughness: 0.8,
        metalness: 0,
        opacity: 1,
      },
    });

    const created = next.materials[next.materials.length - 1];
    expect(next.materials).toHaveLength(scene.materials.length + 1);
    expect(created?.name).toBe("Mi pintura");
    expect(created?.builtin).toBe(false);
    expect(created?.id).toBeTruthy();
  });

  it("no permite editar ni borrar materiales del catalogo", () => {
    const scene = baseScene();
    expect(() =>
      applyCommand(scene, {
        type: "UPDATE_MATERIAL",
        materialId: "mat_brick_red",
        patch: { baseColor: "#000000" },
      }),
    ).toThrow(CommandError);

    expect(() =>
      applyCommand(scene, { type: "DELETE_MATERIAL", materialId: "mat_brick_red" }),
    ).toThrow(CommandError);
  });

  it("rechaza asignar un material inexistente", () => {
    const scene = baseScene();
    const wall = applyCommand(scene, {
      type: "CREATE_WALL",
      floorId: scene.floors[0]!.id,
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
    }).walls[0]!;

    expect(() =>
      applyCommand(scene, {
        type: "ASSIGN_MATERIAL",
        targetIds: [wall.id],
        materialId: "mat_inventado",
      }),
    ).toThrow(CommandError);
  });

  it("distingue la cara pintada de una pared", () => {
    let scene = baseScene();
    scene = applyCommand(scene, {
      type: "CREATE_WALL",
      floorId: scene.floors[0]!.id,
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
    });
    const wallId = scene.walls[0]!.id;

    const painted = applyCommand(scene, {
      type: "ASSIGN_MATERIAL",
      targetIds: [wallId],
      materialId: "mat_brick_red",
      face: "exterior",
    });

    const wall = painted.walls[0]!;
    expect(wall.materialExteriorId).toBe("mat_brick_red");
    expect(wall.materialInteriorId).toBe(scene.walls[0]!.materialInteriorId);
  });

  it("al borrar un material propio limpia las referencias", () => {
    let scene = baseScene();
    scene = applyCommand(scene, {
      type: "CREATE_MATERIAL",
      material: {
        id: "mat_propio",
        name: "Propio",
        category: "paint",
        baseColor: "#abcdef",
        roughness: 0.5,
        metalness: 0,
        opacity: 1,
      },
    });
    scene = applyCommand(scene, {
      type: "CREATE_WALL",
      floorId: scene.floors[0]!.id,
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
    });
    scene = applyCommand(scene, {
      type: "ASSIGN_MATERIAL",
      targetIds: [scene.walls[0]!.id],
      materialId: "mat_propio",
    });
    expect(scene.walls[0]?.materialExteriorId).toBe("mat_propio");

    scene = applyCommand(scene, { type: "DELETE_MATERIAL", materialId: "mat_propio" });

    expect(scene.materials.some((item) => item.id === "mat_propio")).toBe(false);
    expect(scene.walls[0]?.materialExteriorId).toBeUndefined();
    expect(scene.walls[0]?.materialInteriorId).toBeUndefined();
  });
});
