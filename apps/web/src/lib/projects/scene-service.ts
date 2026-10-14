import "server-only";
import { prisma } from "@archvision/database";
import {
  computeSceneMetrics,
  createDefaultScene,
  migrateScene,
  syncCatalogMaterials,
} from "@archvision/shared";
import type { SceneDocument } from "@archvision/types";
import { planLimits } from "@archvision/config";
import {
  ENTITY_NAME_MAX,
  sceneDocumentSchema,
  validateSceneReferences,
} from "@archvision/validation";

/**
 * Persistencia del documento de escena.
 *
 * REGLA: solo entra JSON validado. Se rechaza cualquier escena con
 * referencias rotas para que el editor nunca cargue un modelo inconsistente.
 */

export class SceneConflictError extends Error {
  constructor(public readonly currentRevision: number) {
    super("La escena fue modificada por otra sesion");
    this.name = "SceneConflictError";
  }
}

export class SceneValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super("Escena invalida");
    this.name = "SceneValidationError";
  }
}

async function assertAccess(userId: string, projectId: string): Promise<boolean> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspace: { members: { some: { userId } } } },
    select: { id: true },
  });
  return project !== null;
}

const NAMED_COLLECTIONS = [
  "floors",
  "walls",
  "doors",
  "windows",
  "openings",
  "columns",
  "stairs",
  "roofs",
  "slabs",
  "rooms",
  "furniture",
  "materials",
  "lights",
  "cameras",
  "importedModels",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Repara lo que el validador rechaza pero aun tiene arreglo seguro.
 *
 * Un documento con un nombre de entidad mas largo que el tope del esquema, o
 * con la URL de un modelo importado ausente o no descargable, no debe dejar al
 * proyecto sin abrir ni al editor en "Error al guardar" para siempre: se
 * recortan los nombres y se deriva la URL del modelo a partir de su `fileId`.
 * Si tras la reparacion el documento sigue siendo invalido, rechaza el
 * validador: aqui no se inventa geometria ni se tocan referencias.
 */
function repairSceneDocument(raw: unknown, projectId: string): unknown {
  if (!isPlainObject(raw)) return raw;

  const scene: Record<string, unknown> = { ...raw };

  for (const key of NAMED_COLLECTIONS) {
    const list = scene[key];
    if (!Array.isArray(list)) continue;
    scene[key] = list.map((entity) => {
      if (!isPlainObject(entity)) return entity;
      const name = entity.name;
      if (typeof name !== "string") return entity;
      const trimmed = name.trim();
      if (trimmed === name && trimmed.length <= ENTITY_NAME_MAX) return entity;
      return { ...entity, name: trimmed.slice(0, ENTITY_NAME_MAX) || "Sin nombre" };
    });
  }

  if (Array.isArray(scene.importedModels)) {
    scene.importedModels = scene.importedModels.map((model) => {
      if (!isPlainObject(model)) return model;
      const url = model.url;
      const usable =
        typeof url === "string" && (url.startsWith("/") || /^https?:\/\/\S+$/.test(url));
      if (usable) return model;
      const fileId = model.fileId;
      if (typeof fileId !== "string" || fileId.length === 0) return model;
      return { ...model, url: `/api/projects/${projectId}/files/${fileId}/content` };
    });
  }

  return scene;
}

/**
 * Migra y valida; si el documento no valida, reintenta una vez tras
 * `repairSceneDocument`. Asi guardar y abrir curan documentos con un nodo
 * indefinido en lugar de dejar al editor bloqueado en error.
 */
function parseSceneDocument(raw: unknown, projectId: string) {
  const migration = migrateScene(raw);
  const parsed = sceneDocumentSchema.safeParse(migration.scene);
  if (parsed.success) return parsed;
  return sceneDocumentSchema.safeParse(
    migrateScene(repairSceneDocument(migration.scene, projectId)).scene,
  );
}

export async function loadScene(
  userId: string,
  projectId: string,
): Promise<{ scene: SceneDocument; revision: number } | null> {
  if (!(await assertAccess(userId, projectId))) return null;

  const record = await prisma.scene.findUnique({ where: { projectId } });
  if (!record) {
    // Proyecto sin escena (migracion o creacion parcial): se repara al vuelo.
    const scene = createDefaultScene();
    const created = await prisma.scene.create({
      data: {
        projectId,
        dataJson: JSON.stringify(scene),
        schemaVersion: scene.version,
      },
    });
    return { scene, revision: created.revision };
  }

  // Un proyecto guardado con un formato anterior se migra en memoria antes de
  // validar. No se reescribe la fila: la version en disco se actualiza cuando
  // el usuario edita, de modo que abrir un proyecto nunca modifica nada.
  let raw: unknown;
  try {
    raw = JSON.parse(record.dataJson);
  } catch {
    // JSON corrupto: se sirve una escena valida en memoria para que el
    // editor arranque; el siguiente guardado reescribe el documento.
    return { scene: createDefaultScene(), revision: record.revision };
  }

  const parsed = parseSceneDocument(raw, projectId);
  if (!parsed.success) {
    throw new SceneValidationError(
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }

  const scene = parsed.data as SceneDocument;

  // El catalogo de materiales pertenece a la aplicacion: si mejoro desde la
  // ultima vez que se abrio el proyecto, la mejora se aplica al vuelo.
  const synced = syncCatalogMaterials(scene.materials);

  return {
    scene: synced.changed ? { ...scene, materials: synced.materials } : scene,
    revision: record.revision,
  };
}

export async function saveScene(
  userId: string,
  projectId: string,
  input: { scene: unknown; expectedRevision?: number },
): Promise<{ revision: number } | null> {
  if (!(await assertAccess(userId, projectId))) return null;

  // Tambien al escribir: un cliente con la pestana abierta desde antes de un
  // despliegue, o una importacion, pueden mandar un formato anterior. Si el
  // documento no valida, se repara una vez (nombres recortados, URL del
  // modelo derivada de su fileId) antes de rechazarlo: guardar nunca debe
  // dejar al editor atrapado en "Error al guardar".
  const parsed = parseSceneDocument(input.scene, projectId);
  if (!parsed.success) {
    throw new SceneValidationError(
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }

  const scene = parsed.data as SceneDocument;
  const problems = validateSceneReferences(scene);
  if (problems.length > 0) throw new SceneValidationError(problems);

  const dataJson = JSON.stringify(scene);
  const metrics = computeSceneMetrics(scene);
  const sizeBytes = Buffer.byteLength(dataJson, "utf8");

  const projectStats = {
    sizeBytes,
    floorsCount: scene.floors.length,
    areaEstimate:
      metrics.usableArea > 0
        ? Math.round(metrics.usableArea * 100) / 100
        : undefined,
  };

  // Comprobacion y escritura atomicas: el WHERE lleva la revision esperada,
  // de modo que dos PUT concurrentes con la misma base nunca pueden aplicar
  // ambos (last-write-wins silencioso). count = 0 significa conflicto o fila
  // aun inexistente; en el segundo caso se crea, como siempre.
  try {
    return await prisma.$transaction(async (tx) => {
      if (input.expectedRevision !== undefined) {
        const updated = await tx.scene.updateMany({
          where: { projectId, revision: input.expectedRevision },
          data: {
            dataJson,
            schemaVersion: scene.version,
            revision: { increment: 1 },
          },
        });

        if (updated.count === 1) {
          await tx.project.update({
            where: { id: projectId },
            data: projectStats,
          });
          return { revision: input.expectedRevision + 1 };
        }

        const current = await tx.scene.findUnique({
          where: { projectId },
          select: { revision: true },
        });
        if (current) throw new SceneConflictError(current.revision);
      }

      const saved = await tx.scene.upsert({
        where: { projectId },
        create: { projectId, dataJson, schemaVersion: scene.version },
        update: {
          dataJson,
          schemaVersion: scene.version,
          revision: { increment: 1 },
        },
      });
      await tx.project.update({
        where: { id: projectId },
        data: projectStats,
      });
      return { revision: saved.revision };
    });
  } catch (error) {
    // Carrera de creacion: dos clientes guardando a la vez un proyecto sin
    // fila de escena. El perdedor recibe el unico indice violado y aqui se
    // traduce al mismo 409 que el resto de conflictos.
    if (
      input.expectedRevision !== undefined &&
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "P2002"
    ) {
      const current = await prisma.scene.findUnique({
        where: { projectId },
        select: { revision: true },
      });
      if (current) throw new SceneConflictError(current.revision);
    }
    throw error;
  }
}

// --------------------------------------------------------------------------
// Versiones (snapshots)
// --------------------------------------------------------------------------

export async function listVersions(userId: string, projectId: string) {
  if (!(await assertAccess(userId, projectId))) return null;
  const versions = await prisma.projectVersion.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: { id: true, label: true, createdAt: true, createdById: true },
  });
  return versions.map((v) => ({
    id: v.id,
    label: v.label,
    createdAt: v.createdAt.toISOString(),
    createdById: v.createdById,
  }));
}

export async function createVersion(
  userId: string,
  projectId: string,
  label: string,
  plan: string,
): Promise<{ id: string } | null> {
  if (!(await assertAccess(userId, projectId))) return null;

  const scene = await prisma.scene.findUnique({ where: { projectId } });
  if (!scene) return null;

  const limits = planLimits(plan);
  if (limits.maxVersionsPerProject >= 0) {
    const count = await prisma.projectVersion.count({ where: { projectId } });
    if (count >= limits.maxVersionsPerProject) {
      // Politica: se conserva el historial mas reciente.
      const oldest = await prisma.projectVersion.findFirst({
        where: { projectId },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (oldest) {
        await prisma.projectVersion.delete({ where: { id: oldest.id } });
      }
    }
  }

  const created = await prisma.projectVersion.create({
    data: {
      projectId,
      label,
      dataJson: scene.dataJson,
      createdById: userId,
    },
    select: { id: true },
  });

  return created;
}

export async function restoreVersion(
  userId: string,
  projectId: string,
  versionId: string,
): Promise<{ revision: number } | null> {
  if (!(await assertAccess(userId, projectId))) return null;

  const version = await prisma.projectVersion.findFirst({
    where: { id: versionId, projectId },
  });
  if (!version) return null;

  const saved = await prisma.scene.update({
    where: { projectId },
    data: { dataJson: version.dataJson, revision: { increment: 1 } },
  });

  return { revision: saved.revision };
}
