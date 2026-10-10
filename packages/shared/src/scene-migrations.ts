import {
  SCENE_SCHEMA_HISTORY,
  SCENE_SCHEMA_VERSION,
  type AnySceneSchemaVersion,
} from "@archvision/types";

/**
 * Migracion de documentos de escena.
 *
 * Un proyecto guardado hace meses debe seguir abriendose despues de cambiar el
 * formato. La regla: el documento persistido nunca se reescribe en silencio al
 * leerlo; se migra en memoria, se valida, y solo se guarda cuando el usuario
 * edita algo. Cada paso es una funcion pura de un objeto plano a otro.
 *
 * Los migradores trabajan sobre `Record<string, unknown>` a proposito: reciben
 * datos que ya no encajan en los tipos actuales, de modo que tipar la entrada
 * con `SceneDocument` seria mentir.
 */

type PlainObject = Record<string, unknown>;

type Migration = (scene: PlainObject) => PlainObject;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 1.0 -> 1.1: los materiales admiten textura procedural.
 *
 * Los materiales antiguos son colores lisos, asi que basta con declararlo de
 * forma explicita en lugar de dejar el campo ausente: el editor distingue
 * "sin textura" de "todavia sin decidir".
 */
const migrate_1_0_to_1_1: Migration = (scene) => {
  const materials = Array.isArray(scene.materials) ? scene.materials : [];

  return {
    ...scene,
    version: "1.1",
    materials: materials.map((material) =>
      isPlainObject(material) ? { texture: "plain", bump: 0, ...material } : material,
    ),
  };
};

/**
 * 1.1 -> 1.2: la escena puede llevar un plano de referencia.
 *
 * El campo es opcional, asi que basta con declararlo vacio: ningun proyecto
 * anterior tenia plano importado.
 */
const migrate_1_1_to_1_2: Migration = (scene) => ({
  ...scene,
  version: "1.2",
  underlay: scene.underlay ?? null,
});

/**
 * 1.2 -> 1.3: la escena puede llevar modelos 3D importados.
 *
 * Sin este paso, cualquier proyecto guardado antes de la version 1.3 se
 * quedaria en 1.2 y fallaria la validacion: `importedModels` es obligatorio en
 * el esquema actual. El documento en disco no se toca; se migra en memoria.
 */
const migrate_1_2_to_1_3: Migration = (scene) => ({
  ...scene,
  version: "1.3",
  importedModels: Array.isArray(scene.importedModels) ? scene.importedModels : [],
});

/** Paso a paso: cada entrada lleva del formato indicado al siguiente. */
const MIGRATIONS: Record<string, Migration | undefined> = {
  "1.0": migrate_1_0_to_1_1,
  "1.1": migrate_1_1_to_1_2,
  "1.2": migrate_1_2_to_1_3,
};

export function isKnownSceneVersion(value: unknown): value is AnySceneSchemaVersion {
  return (
    typeof value === "string" &&
    (SCENE_SCHEMA_HISTORY as readonly string[]).includes(value)
  );
}

export interface SceneMigrationResult {
  scene: unknown;
  /** true si el documento venia de una version anterior. */
  migrated: boolean;
  from: string;
}

/**
 * Lleva un documento a la version actual aplicando los pasos intermedios.
 *
 * No valida: la validacion con Zod ocurre despues, sobre el resultado. Si la
 * version es desconocida (documento de una version futura o corrupto) se
 * devuelve tal cual y sera el validador quien lo rechace con un mensaje claro.
 */
export function migrateScene(raw: unknown): SceneMigrationResult {
  if (!isPlainObject(raw)) return { scene: raw, migrated: false, from: "desconocida" };

  const from = typeof raw.version === "string" ? raw.version : "desconocida";
  if (!isKnownSceneVersion(raw.version)) {
    return { scene: raw, migrated: false, from };
  }

  let current = raw;
  let guard = 0;

  while (current.version !== SCENE_SCHEMA_VERSION) {
    const step = MIGRATIONS[String(current.version)];
    if (!step) break;

    current = step(current);

    // Un migrador que no avanza la version colgaria el bucle; se corta antes.
    guard += 1;
    if (guard > SCENE_SCHEMA_HISTORY.length) break;
  }

  return { scene: current, migrated: current !== raw, from };
}
