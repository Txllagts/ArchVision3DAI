import "server-only";
// Los tipos de Prisma se reexportan desde @archvision/database para que la
// aplicacion no dependa directamente del cliente generado.
import { prisma, type Prisma, type Project } from "@archvision/database";
import {
  computeSceneMetrics,
  createDefaultScene,
  createDemoHouseScene,
  slugify,
} from "@archvision/shared";
import type {
  CreationMethod,
  ImportedModel,
  ProjectDetail,
  ProjectStatus,
  ProjectSummary,
  ProjectType,
  SceneDocument,
  UnitSystem,
} from "@archvision/types";
import { planLimits, withinLimit } from "@archvision/config";
import {
  ENTITY_NAME_MAX,
  type CreateProjectInput,
  type UpdateProjectInput,
} from "@archvision/validation";
import { storage, buildStorageKey, checksumOf } from "@/lib/storage";
import { sniff, type SniffResult } from "@/lib/storage/sniff";
import { FILE_KINDS, type FileKind, saveProjectFile } from "./file-service";

/**
 * Capa de servicio de proyectos.
 *
 * Toda consulta filtra por pertenencia al workspace: la separacion entre
 * usuarios se garantiza aqui y no en la interfaz. Las rutas de API y los
 * Server Components consumen exclusivamente estas funciones.
 */

export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaExceededError";
  }
}

/** Devuelve (creando si hace falta) el workspace personal del usuario. */
export async function ensurePersonalWorkspace(user: {
  id: string;
  name: string;
}): Promise<{ id: string; name: string }> {
  const existing = await prisma.workspaceMember.findFirst({
    where: { userId: user.id },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });

  if (existing) {
    return { id: existing.workspace.id, name: existing.workspace.name };
  }

  const baseName = `Espacio de ${user.name}`;
  // El slug debe ser unico globalmente: se sufija con parte del id de usuario.
  const slug = `${slugify(baseName)}-${user.id.slice(0, 8)}`;

  const workspace = await prisma.workspace.create({
    data: {
      name: baseName,
      slug,
      ownerId: user.id,
      members: { create: { userId: user.id, role: "OWNER" } },
    },
  });

  return { id: workspace.id, name: workspace.name };
}

/** Ids de los workspaces a los que pertenece el usuario. */
async function memberWorkspaceIds(userId: string): Promise<string[]> {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    select: { workspaceId: true },
  });
  return memberships.map((m) => m.workspaceId);
}

function toSummary(project: Project): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    type: project.type as ProjectType,
    units: project.units as UnitSystem,
    status: project.status as ProjectStatus,
    progress: project.progress,
    floorsCount: project.floorsCount,
    areaEstimate: project.areaEstimate,
    thumbnailUrl: project.thumbnailUrl,
    sizeBytes: project.sizeBytes,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function toDetail(project: Project): ProjectDetail {
  return {
    ...toSummary(project),
    workspaceId: project.workspaceId,
    ownerId: project.ownerId,
    location: project.location,
    floorHeight: project.floorHeight,
    creationMethod: project.creationMethod as CreationMethod,
  };
}

export interface ListProjectsOptions {
  search?: string;
  status?: ProjectStatus;
  limit?: number;
  cursor?: string;
  includeDeleted?: boolean;
}

export async function listProjects(
  userId: string,
  options: ListProjectsOptions = {},
): Promise<{ items: ProjectSummary[]; nextCursor: string | null }> {
  const workspaceIds = await memberWorkspaceIds(userId);
  if (workspaceIds.length === 0) return { items: [], nextCursor: null };

  const limit = options.limit ?? 20;

  const where: Prisma.ProjectWhereInput = {
    workspaceId: { in: workspaceIds },
    deletedAt: options.includeDeleted ? { not: null } : null,
    ...(options.status ? { status: options.status } : {}),
    ...(options.search
      ? { name: { contains: options.search } }
      : {}),
  };

  const rows = await prisma.project.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: page.map(toSummary),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/** Proyecto con verificacion de acceso. Devuelve null si no existe o no pertenece. */
export async function getProject(
  userId: string,
  projectId: string,
): Promise<ProjectDetail | null> {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      workspace: { members: { some: { userId } } },
    },
  });
  return project ? toDetail(project) : null;
}

export async function countActiveProjects(userId: string): Promise<number> {
  const workspaceIds = await memberWorkspaceIds(userId);
  if (workspaceIds.length === 0) return 0;
  return prisma.project.count({
    where: { workspaceId: { in: workspaceIds }, deletedAt: null },
  });
}

export interface CreateProjectContext {
  userId: string;
  userName: string;
  plan: string;
}

export async function createProject(
  context: CreateProjectContext,
  input: CreateProjectInput & { demo?: boolean },
): Promise<ProjectDetail> {
  const limits = planLimits(context.plan);
  const current = await countActiveProjects(context.userId);
  if (!withinLimit(current + 1, limits.maxProjects)) {
    throw new QuotaExceededError(
      `Tu plan ${limits.label} permite ${limits.maxProjects} proyectos activos.`,
    );
  }

  const workspace = await ensurePersonalWorkspace({
    id: context.userId,
    name: context.userName,
  });

  const scene: SceneDocument = input.demo
    ? createDemoHouseScene()
    : createDefaultScene({
        displayUnit: input.units,
        floorHeight: input.floorHeight,
        floorsCount: input.floorsCount,
      });

  const metrics = computeSceneMetrics(scene);
  const dataJson = JSON.stringify(scene);

  const project = await prisma.project.create({
    data: {
      workspaceId: workspace.id,
      ownerId: context.userId,
      name: input.name,
      description: input.description?.trim() ? input.description : null,
      type: input.type,
      units: input.units,
      creationMethod: input.creationMethod,
      status: "draft",
      progress: input.creationMethod === "draw" || input.creationMethod === "empty" ? 100 : 0,
      location: input.location?.trim() ? input.location : null,
      floorsCount: scene.floors.length,
      areaEstimate:
        input.areaEstimate ??
        (metrics.usableArea > 0 ? Math.round(metrics.usableArea * 100) / 100 : null),
      floorHeight: input.floorHeight,
      sizeBytes: Buffer.byteLength(dataJson, "utf8"),
      scene: {
        create: { dataJson, schemaVersion: scene.version },
      },
    },
  });

  return toDetail(project);
}

export async function createProjectWithFile(
  context: CreateProjectContext,
  input: CreateProjectInput & { demo?: boolean },
  file: File,
  fileKind: "floorplan" | "model",
): Promise<ProjectDetail> {
  // Step 1: Create the project without the file
  const project = await createProject(context, input);

  // Step 2: Upload the file to the newly created project
  const fileData = new Uint8Array(await file.arrayBuffer());
  const savedFile = await saveProjectFile(context.userId, project.id, {
    kind: fileKind,
    originalName: file.name,
    declaredMime: file.type,
    data: fileData,
    plan: context.plan,
  });

  if (!savedFile) {
    throw new Error("No se pudo guardar el archivo");
  }

  // Step 3: Update the scene with the imported model or underlay
  const projectWithScene = await prisma.project.findUnique({
    where: { id: project.id },
    include: { scene: true },
  });

  if (!projectWithScene?.scene) {
    throw new Error("No se encontro la escena del proyecto");
  }

  const scene: SceneDocument = JSON.parse(projectWithScene.scene.dataJson);
  const activeFloorId = scene.floors[0]?.id ?? null;

  if (fileKind === "model" && activeFloorId) {
    const model: ImportedModel = {
      id: `model_${savedFile.id}`,
      floorId: activeFloorId,
      // El nombre del archivo se guarda recortado a 200 caracteres; el
      // documento de escena admite menos, y un nombre mas largo invalidaria
      // la escena entera al validarla antes de guardar.
      name: savedFile.originalName.trim().slice(0, ENTITY_NAME_MAX) || "Modelo importado",
      fileId: savedFile.id,
      url: `/api/projects/${project.id}/files/${savedFile.id}/content`,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
      locked: false,
      source: "import",
    };
    scene.importedModels = [...(scene.importedModels ?? []), model];
  }

  if (fileKind === "floorplan" && savedFile.width && savedFile.height && activeFloorId) {
    scene.underlay = {
      fileId: savedFile.id,
      pixelsPerMeter: 50,
      offset: { x: 0, y: 0 },
      rotationDeg: 0,
      opacity: 0.55,
      visible: true,
      width: savedFile.width,
      height: savedFile.height,
      floorId: activeFloorId,
    };
  }

  // Step 4: Save the updated scene
  const metrics = computeSceneMetrics(scene);
  const dataJson = JSON.stringify(scene);

  await prisma.project.update({
    where: { id: project.id },
    data: {
      scene: {
        update: { dataJson, schemaVersion: scene.version },
      },
      sizeBytes: Buffer.byteLength(dataJson, "utf8"),
      floorsCount: scene.floors.length,
      areaEstimate:
        input.areaEstimate ??
        (metrics.usableArea > 0 ? Math.round(metrics.usableArea * 100) / 100 : null),
    },
  });

  // Fetch the updated project to return complete details
  const updatedProject = await prisma.project.findUnique({
    where: { id: project.id },
  });

  if (!updatedProject) {
    throw new Error("No se pudo recuperar el proyecto actualizado");
  }

  return toDetail(updatedProject);
}

export async function updateProject(
  userId: string,
  projectId: string,
  input: UpdateProjectInput,
): Promise<ProjectDetail | null> {
  const owned = await getProject(userId, projectId);
  if (!owned) return null;

  const project = await prisma.project.update({
    where: { id: projectId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.units !== undefined ? { units: input.units } : {}),
      ...(input.location !== undefined ? { location: input.location } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.thumbnailUrl !== undefined ? { thumbnailUrl: input.thumbnailUrl } : {}),
    },
  });

  return toDetail(project);
}

/** Borrado logico: el proyecto pasa a la papelera. */
export async function softDeleteProject(
  userId: string,
  projectId: string,
): Promise<boolean> {
  const owned = await getProject(userId, projectId);
  if (!owned) return false;
  await prisma.project.update({
    where: { id: projectId },
    data: { deletedAt: new Date() },
  });
  return true;
}

export async function restoreProject(
  userId: string,
  projectId: string,
): Promise<boolean> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspace: { members: { some: { userId } } } },
  });
  if (!project) return false;
  await prisma.project.update({
    where: { id: projectId },
    data: { deletedAt: null },
  });
  return true;
}

/** Borrado definitivo, incluidos escena, archivos y versiones (cascade). */
export async function purgeProject(
  userId: string,
  projectId: string,
): Promise<boolean> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspace: { members: { some: { userId } } } },
    select: { id: true },
  });
  if (!project) return false;
  await prisma.project.delete({ where: { id: projectId } });
  return true;
}

export async function duplicateProject(
  userId: string,
  projectId: string,
): Promise<ProjectDetail | null> {
  const original = await prisma.project.findFirst({
    where: { id: projectId, workspace: { members: { some: { userId } } } },
    include: { scene: true },
  });
  if (!original) return null;

  const copy = await prisma.project.create({
    data: {
      workspaceId: original.workspaceId,
      ownerId: userId,
      name: `${original.name} (copia)`,
      description: original.description,
      type: original.type,
      units: original.units,
      creationMethod: original.creationMethod,
      status: original.status,
      progress: original.progress,
      location: original.location,
      floorsCount: original.floorsCount,
      areaEstimate: original.areaEstimate,
      floorHeight: original.floorHeight,
      sizeBytes: original.sizeBytes,
      scene: original.scene
        ? {
            create: {
              dataJson: original.scene.dataJson,
              schemaVersion: original.scene.schemaVersion,
            },
          }
        : undefined,
    },
  });

  return toDetail(copy);
}

/** Estadisticas del dashboard. */
export async function getWorkspaceStats(userId: string): Promise<{
  projects: number;
  trashed: number;
  storageBytes: number;
  processing: number;
}> {
  const workspaceIds = await memberWorkspaceIds(userId);
  if (workspaceIds.length === 0) {
    return { projects: 0, trashed: 0, storageBytes: 0, processing: 0 };
  }

  const [projects, trashed, processing, aggregate] = await Promise.all([
    prisma.project.count({
      where: { workspaceId: { in: workspaceIds }, deletedAt: null },
    }),
    prisma.project.count({
      where: { workspaceId: { in: workspaceIds }, deletedAt: { not: null } },
    }),
    prisma.project.count({
      where: {
        workspaceId: { in: workspaceIds },
        deletedAt: null,
        status: "processing",
      },
    }),
    prisma.project.aggregate({
      where: { workspaceId: { in: workspaceIds } },
      _sum: { sizeBytes: true },
    }),
  ]);

  return {
    projects,
    trashed,
    processing,
    storageBytes: aggregate._sum.sizeBytes ?? 0,
  };
}
