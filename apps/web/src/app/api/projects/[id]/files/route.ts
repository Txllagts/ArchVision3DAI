import { apiError, apiSuccess, withErrorHandling } from "@/lib/api/response";
import { requireApiUser } from "@/lib/api/auth-guard";
import { currentEntitlement } from "@/lib/billing/service";
import { consume } from "@/lib/api/rate-limit";
import { prisma } from "@archvision/database";
import { QuotaExceededError } from "@/lib/projects/service";
import {
  FILE_KINDS,
  FileValidationError,
  listProjectFiles,
  saveProjectFile,
  type FileKind,
} from "@/lib/projects/file-service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function parseKind(value: unknown): FileKind | null {
  return typeof value === "string" && (FILE_KINDS as readonly string[]).includes(value)
    ? (value as FileKind)
    : null;
}

/** GET /api/projects/:id/files?kind=floorplan */
export async function GET(request: Request, context: RouteContext) {
  return withErrorHandling("files.list", async () => {
    const user = await requireApiUser();
    if (!user) return apiError("UNAUTHORIZED", "Sesion no iniciada");

    const { id } = await context.params;
    const kind = parseKind(new URL(request.url).searchParams.get("kind"));

    const files = await listProjectFiles(user.id, id, kind ?? undefined);
    if (!files) return apiError("NOT_FOUND", "Proyecto no encontrado");

    return apiSuccess({ files });
  });
}

/**
 * POST /api/projects/:id/files
 *
 * Cuerpo `multipart/form-data` con `file` y `kind`. El tamano se comprueba dos
 * veces: contra la cabecera antes de leer y contra los bytes reales despues,
 * porque `Content-Length` lo pone el cliente.
 */
export async function POST(request: Request, context: RouteContext) {
  return withErrorHandling("files.upload", async () => {
    const user = await requireApiUser();
    if (!user) return apiError("UNAUTHORIZED", "Sesion no iniciada");

    // Subir archivos es caro en disco y en CPU: se limita por usuario.
    const limit = consume(`upload:${user.id}`, 30, 60_000);
    if (!limit.allowed) {
      return apiError(
        "RATE_LIMITED",
        `Demasiadas subidas seguidas. Reintenta en ${limit.retryAfterSeconds} s.`,
      );
    }

    const { id } = await context.params;

    const declared = Number(request.headers.get("content-length") ?? "0");
    const hardCap = 60 * 1024 * 1024;
    if (declared > hardCap) {
      return apiError("PAYLOAD_TOO_LARGE", "El archivo supera el limite del servidor");
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return apiError("BAD_REQUEST", "Se esperaba multipart/form-data");
    }

    const entry = form.get("file");
    if (!(entry instanceof File)) {
      return apiError("BAD_REQUEST", "Falta el campo 'file'");
    }

    const kind = parseKind(form.get("kind")) ?? "floorplan";
    const role = form.get("role");
    const clientKeyEntry = form.get("clientKey");
    const clientKey =
      typeof clientKeyEntry === "string" && clientKeyEntry.length > 0
        ? clientKeyEntry.slice(0, 64)
        : undefined;
    const data = new Uint8Array(await entry.arrayBuffer());

    try {
      const file = await saveProjectFile(user.id, id, {
        kind,
        role: typeof role === "string" && role.length > 0 ? role.slice(0, 40) : undefined,
        originalName: entry.name || "archivo",
        declaredMime: entry.type,
        data,
        plan: (await currentEntitlement(user.id)).plan,
        clientKey,
      });

      if (!file) return apiError("NOT_FOUND", "Proyecto no encontrado");

      // Revision actual de la escena: el cliente adopta el token tras cada
      // subida para que el siguiente guardado use la base mas reciente.
      const scene = await prisma.scene.findUnique({
        where: { projectId: id },
        select: { revision: true },
      });

      return apiSuccess(
        { file, ...(scene ? { revision: scene.revision } : {}) },
        201,
      );
    } catch (error) {
      if (error instanceof FileValidationError) {
        return apiError("BAD_REQUEST", error.message);
      }
      if (error instanceof QuotaExceededError) {
        return apiError("QUOTA_EXCEEDED", error.message);
      }
      throw error;
    }
  });
}
