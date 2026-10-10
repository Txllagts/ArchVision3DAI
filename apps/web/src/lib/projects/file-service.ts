import "server-only";
import { prisma } from "@archvision/database";
import { planLimits } from "@archvision/config";
import { buildStorageKey, checksumOf, storage } from "@/lib/storage";
import { sniff, type SniffResult } from "@/lib/storage/sniff";
import { QuotaExceededError } from "./service";

/**
 * Archivos de proyecto (planos, fotografias, texturas).
 *
 * Reglas que se aplican aqui y no en la interfaz:
 *  - el tipo se decide leyendo la cabecera del archivo, no lo que declare el
 *    cliente;
 *  - el tamano por archivo y el almacenamiento total se comprueban contra el
 *    plan del usuario;
 *  - toda consulta filtra por pertenencia al workspace.
 */

export class FileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileValidationError";
  }
}

export const FILE_KINDS = ["floorplan", "photo", "texture", "model", "render"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export interface ProjectFileSummary {
  id: string;
  kind: string;
  role: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  /** Ruta autenticada de descarga. Nunca la clave del almacenamiento. */
  url: string;
}

/** Tipos aceptados por cada uso. Un modelo GLB no debe colarse como plano. */
const ACCEPTED_BY_KIND: Record<FileKind, readonly SniffResult["mime"][]> = {
  floorplan: ["image/png", "image/jpeg", "image/webp", "application/pdf"],
  photo: ["image/png", "image/jpeg", "image/webp"],
  texture: ["image/png", "image/jpeg", "image/webp"],
  model: ["model/gltf-binary", "model/gltf+json", "application/octet-stream"],
  render: ["image/png", "image/jpeg"],
};

async function assertAccess(userId: string, projectId: string): Promise<boolean> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspace: { members: { some: { userId } } } },
    select: { id: true },
  });
  return project !== null;
}

function toSummary(file: {
  id: string;
  projectId: string;
  kind: string;
  role: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: Date;
}): ProjectFileSummary {
  return {
    id: file.id,
    kind: file.kind,
    role: file.role,
    originalName: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    width: file.width,
    height: file.height,
    createdAt: file.createdAt.toISOString(),
    url: `/api/projects/${file.projectId}/files/${file.id}/content`,
  };
}

export async function listProjectFiles(
  userId: string,
  projectId: string,
  kind?: FileKind,
): Promise<ProjectFileSummary[] | null> {
  if (!(await assertAccess(userId, projectId))) return null;

  const files = await prisma.projectFile.findMany({
    where: { projectId, ...(kind ? { kind } : {}) },
    orderBy: { createdAt: "desc" },
  });

  return files.map(toSummary);
}

/** Almacenamiento consumido por todos los proyectos del usuario. */
async function usedStorageBytes(userId: string): Promise<number> {
  const result = await prisma.projectFile.aggregate({
    where: { project: { workspace: { members: { some: { userId } } } } },
    _sum: { sizeBytes: true },
  });
  return result._sum.sizeBytes ?? 0;
}

export async function saveProjectFile(
  userId: string,
  projectId: string,
  input: {
    kind: FileKind;
    role?: string;
    originalName: string;
    declaredMime: string;
    data: Uint8Array;
    plan: string;
    /** Clave de idempotencia del cliente: un reintento devuelve el archivo ya subido. */
    clientKey?: string;
  },
): Promise<ProjectFileSummary | null> {
  if (!(await assertAccess(userId, projectId))) return null;

  // Reintento de la misma subida: si la primera llego al servidor pero la
  // respuesta se perdio, el cliente reenvia la misma clientKey y aqui se
  // devuelve el archivo existente en lugar de duplicar bytes.
  const clientKey =
    input.clientKey && input.clientKey.length > 0 && input.clientKey.length <= 64
      ? input.clientKey
      : undefined;
  if (clientKey) {
    const replay = await prisma.projectFile.findFirst({
      where: {
        projectId,
        clientKey,
        storageKey: { not: "" },
        createdAt: { gte: new Date(Date.now() - 10 * 60_000) },
      },
      orderBy: { createdAt: "desc" },
    });
    if (replay) return toSummary(replay);
  }

  const limits = planLimits(input.plan);

  if (input.data.byteLength === 0) {
    throw new FileValidationError("El archivo esta vacio");
  }
  if (input.data.byteLength > limits.maxUploadBytes) {
    throw new QuotaExceededError(
      `Tu plan ${limits.label} admite archivos de hasta ${Math.round(
        limits.maxUploadBytes / (1024 * 1024),
      )} MB.`,
    );
  }

  const used = await usedStorageBytes(userId);
  if (used + input.data.byteLength > limits.maxStorageBytes) {
    throw new QuotaExceededError(
      `Has agotado el almacenamiento del plan ${limits.label}. Elimina archivos para continuar.`,
    );
  }

  const detected = sniff(input.data);
  if (!detected) {
    throw new FileValidationError(
      "Formato no reconocido. Se aceptan PNG, JPG, WebP, PDF, GLB y GLTF.",
    );
  }

  const accepted = ACCEPTED_BY_KIND[input.kind];
  if (!accepted.includes(detected.mime)) {
    throw new FileValidationError(
      `Un archivo ${detected.mime} no sirve como ${input.kind}.`,
    );
  }

  // El tipo declarado debe coincidir con el real: si no, o hay un error del
  // cliente o alguien esta intentando colar otra cosa.
  // Para modelos 3D (GLB/GLTF) permitimos MIME genérico application/octet-stream
  // que los navegadores suelen enviar al re-subir archivos descargados.
  const declaredMime = input.declaredMime;
  const isModelKind = input.kind === "model";
  const isOctetStream = declaredMime === "application/octet-stream";
  const isValidModelMime = detected.mime === "model/gltf-binary" || detected.mime === "model/gltf+json";

  if (declaredMime && declaredMime !== detected.mime) {
    if (!(isModelKind && isOctetStream && isValidModelMime)) {
      throw new FileValidationError(
        "El contenido del archivo no corresponde con su tipo declarado.",
      );
    }
  }

  const created = await prisma.projectFile.create({
    data: {
      projectId,
      kind: input.kind,
      role: input.role ?? null,
      // El nombre original es texto del usuario: se guarda recortado y se
      // muestra siempre como texto, nunca se usa para construir rutas.
      originalName: input.originalName.slice(0, 200),
      mimeType: detected.mime,
      sizeBytes: input.data.byteLength,
      storageKey: "",
      width: detected.width,
      height: detected.height,
      checksum: checksumOf(input.data),
      clientKey: clientKey ?? null,
    },
  });

  const storageKey = buildStorageKey(projectId, created.id, detected.extension);

  try {
    await storage().put(storageKey, input.data);
  } catch (error) {
    // Sin bytes en disco la fila no sirve de nada: se deshace para no dejar
    // referencias rotas.
    await prisma.projectFile.delete({ where: { id: created.id } });
    throw error;
  }

  const file = await prisma.projectFile.update({
    where: { id: created.id },
    data: { storageKey },
  });

  return toSummary(file);
}

export async function readProjectFile(
  userId: string,
  projectId: string,
  fileId: string,
): Promise<{ data: Buffer; mimeType: string; originalName: string } | null> {
  if (!(await assertAccess(userId, projectId))) return null;

  const file = await prisma.projectFile.findFirst({ where: { id: fileId, projectId } });
  if (!file || !file.storageKey) return null;

  const data = await storage().get(file.storageKey);
  return { data, mimeType: file.mimeType, originalName: file.originalName };
}

export async function deleteProjectFile(
  userId: string,
  projectId: string,
  fileId: string,
): Promise<boolean> {
  if (!(await assertAccess(userId, projectId))) return false;

  const file = await prisma.projectFile.findFirst({ where: { id: fileId, projectId } });
  if (!file) return false;

  await prisma.projectFile.delete({ where: { id: file.id } });

  // El objeto se borra despues de la fila: si falla el borrado fisico queda un
  // huerfano recuperable, mientras que al reves quedaria una referencia rota.
  if (file.storageKey) {
    try {
      await storage().remove(file.storageKey);
    } catch (error) {
      console.error("[files] no se pudo borrar el objeto", file.storageKey, error);
    }
  }

  return true;
}
