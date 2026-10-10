import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createDefaultScene,
  migrateScene,
} from "@archvision/shared";
import type { SceneCommand, SceneDocument } from "@archvision/types";
import { sceneDocumentSchema, validateSceneReferences } from "@archvision/validation";
import { useEditorStore } from "./store";

function parseLikeServer(raw: unknown) {
  const migration = migrateScene(raw);
  const parsed = sceneDocumentSchema.safeParse(migration.scene);
  if (parsed.success) return parsed;
  return sceneDocumentSchema.safeParse(
    migrateScene(repairLike(migration.scene)).scene,
  );
}

function repairLike(raw: unknown): unknown {
  return raw;
}

describe("repro: persistencia de GLB importado", () => {
  it("escena con modelo importado valida tras guardar y recargar", () => {
    const base = createDefaultScene();
    const floorId = base.floors[0]!.id;
    const command: SceneCommand = {
      type: "CREATE_IMPORTED_MODEL",
      origin: "import",
      floorId,
      fileId: "cmfp00000000000000000abc",
      name: "silla.glb",
      url: "/api/projects/prj123/files/cmfp00000000000000000abc/content",
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };

    const next = applyCommand(base, command);
    const model = next.importedModels[0];
    console.log("MODELO CREADO:", JSON.stringify(model, null, 2));

    const serialized: SceneDocument = JSON.parse(JSON.stringify(next));
    const parsed = parseLikeServer(serialized);
    if (!parsed.success) {
      console.log(
        "FALLO VALIDACION:",
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      );
    }
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const problems = validateSceneReferences(parsed.data as SceneDocument);
      console.log("PROBLEMAS REFERENCIALES:", problems);
      expect(problems).toEqual([]);
      const persisted = (parsed.data as SceneDocument).importedModels;
      expect(persisted).toHaveLength(1);
      expect(persisted[0]?.url).toBe(
        "/api/projects/prj123/files/cmfp00000000000000000abc/content",
      );
      expect(persisted[0]?.source).toBe("import");
    }
  });

  it("reproduce el comando tal cual lo arma use-file-import", () => {
    // Floor id vacio: use-file-import usa activeFloorId ?? ""
    const base = createDefaultScene();
    const command: SceneCommand = {
      type: "CREATE_IMPORTED_MODEL",
      origin: "import",
      floorId: "",
      fileId: "cmfp00000000000000000abc",
      name: "silla.glb",
      url: "/api/projects/prj123/files/cmfp00000000000000000abc/content",
    };
    expect(() => applyCommand(base, command)).toThrow();
  });
});

describe("import de GLB sin planta activa", () => {
  function importPayload(floorId: string) {
    return {
      id: "file-x",
      fileId: "file-x",
      name: "silla.glb",
      url: "/api/projects/p1/files/file-x/content",
      floorId,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
      locked: false,
    };
  }

  it("addImportedModel con floorId vacio usa la primera planta de la escena", () => {
    const base = createDefaultScene();
    useEditorStore.setState({ scene: base, activeFloorId: undefined });

    useEditorStore.getState().addImportedModel(importPayload(""));

    const model = useEditorStore.getState().scene.importedModels[0];
    expect(model?.floorId).toBe(base.floors[0]?.id);
    expect(model?.source).toBe("import");
  });

  it("prefiere la planta activa cuando existe", () => {
    const base = createDefaultScene();
    const secondFloor = { ...base.floors[0]!, id: "floor-b", name: "Planta alta" };
    useEditorStore.setState({
      scene: { ...base, floors: [...base.floors, secondFloor] },
      activeFloorId: "floor-b",
    });

    useEditorStore.getState().addImportedModel(importPayload(""));

    const model = useEditorStore.getState().scene.importedModels[0];
    expect(model?.floorId).toBe("floor-b");
  });

  it("sin ninguna planta muestra error y no muta la escena", () => {
    const base = createDefaultScene();
    useEditorStore.setState({ scene: { ...base, floors: [] }, activeFloorId: undefined });

    useEditorStore.getState().addImportedModel(importPayload(""));

    expect(useEditorStore.getState().scene.importedModels).toHaveLength(0);
    expect(useEditorStore.getState().message?.kind).toBe("error");
  });
});

describe("formas que el servidor rechaza con 400", () => {
  function sceneWithModel() {
    const base = createDefaultScene();
    const command: SceneCommand = {
      type: "CREATE_IMPORTED_MODEL",
      origin: "import",
      floorId: base.floors[0]!.id,
      fileId: "cmfp00000000000000000abc",
      name: "silla.glb",
      url: "/api/projects/prj123/files/cmfp00000000000000000abc/content",
    };
    return applyCommand(base, command);
  }

  it("floorId vacio invalida el documento", () => {
    const raw = JSON.parse(JSON.stringify(sceneWithModel())) as SceneDocument;
    raw.importedModels[0]!.floorId = "";
    const result = sceneDocumentSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });

  it("source distinto de import invalida el documento", () => {
    const raw = JSON.parse(JSON.stringify(sceneWithModel())) as SceneDocument;
    (raw.importedModels[0] as { source: string }).source = "catalog";
    const result = sceneDocumentSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });

  it("nombre largo pasa el servidor porque repairSceneDocument lo recorta", () => {
    const raw = JSON.parse(JSON.stringify(sceneWithModel())) as SceneDocument;
    raw.importedModels[0]!.name = "x".repeat(150);
    const migration = migrateScene(raw);
    const parsed = sceneDocumentSchema.safeParse(migration.scene);
    expect(parsed.success).toBe(false);
    expect(
      parsed.success === false &&
        parsed.error.issues.some((issue) => issue.path.join(".") === "importedModels.0.name"),
    ).toBe(true);
  });
});
