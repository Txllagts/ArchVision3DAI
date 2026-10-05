import { prisma } from "@archvision/database";
import { z } from "zod";
import { requireApiUser } from "@/lib/api/auth-guard";
import { consume } from "@/lib/api/rate-limit";
import { apiError, apiSuccess, withErrorHandling } from "@/lib/api/response";
import { getEnv } from "@/lib/env";
import { getProject } from "@/lib/projects/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const AI_SERVICE_TIMEOUT_MS = 3 * 60 * 1000;
const ACCEPTED_EXTENSIONS = new Set([
  ".pdf",
  ".dwg",
  ".dxf",
  ".png",
  ".webp",
  ".jpg",
  ".jpeg",
]);
const pointSchema = z.tuple([z.number().finite(), z.number().finite()]);
const floorplanResultSchema = z.object({
  format_version: z.string(),
  source: z.object({
    filename: z.string(),
    extension: z.enum(["pdf", "dwg", "dxf", "png", "webp", "jpg", "jpeg"]),
    kind: z.enum(["cad", "raster"]),
    coordinate_system: z.string(),
    units: z.string(),
    image_size: z
      .object({ width: z.number().int().positive(), height: z.number().int().positive() })
      .nullable(),
  }),
  bounds: z.object({
    min: pointSchema,
    max: pointSchema,
  }),
  statistics: z.object({
    entity_count: z.number().int().nonnegative(),
    wall_candidate_count: z.number().int().nonnegative(),
    door_candidate_count: z.number().int().nonnegative(),
    window_candidate_count: z.number().int().nonnegative(),
  }),
  entities: z
    .array(
      z.object({
        type: z.enum(["line", "polyline"]),
        role: z.enum([
          "wall_candidate",
          "door_candidate",
          "window_candidate",
          "geometry",
        ]),
        layer: z.string().nullable(),
        points: z.array(pointSchema).min(2).max(200_000),
        closed: z.boolean(),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(20_000),
  processing_seconds: z.number().nonnegative(),
  storage_path: z.string().min(1),
  result_url: z.string().url(),
  artifact_size_bytes: z.number().int().nonnegative(),
  model_storage_path: z.string().min(1),
  model_url: z.string().url(),
  model_size_bytes: z.number().int().positive(),
});

type FloorplanErrorCode =
  | "SERVICE_UNAVAILABLE"
  | "UPSTREAM_ERROR"
  | "UPSTREAM_TIMEOUT"
  | "BAD_REQUEST"
  | "PAYLOAD_TOO_LARGE";

class FloorplanProxyError extends Error {
  constructor(
    message: string,
    readonly code: FloorplanErrorCode,
  ) {
    super(message);
    this.name = "FloorplanProxyError";
  }
}

function responseError(status: number, detail?: string): FloorplanProxyError {
  if (status === 400 || status === 413 || status === 422) {
    return new FloorplanProxyError(
      detail ?? "El microservicio rechazó el plano. Verifica que el archivo sea válido.",
      status === 413 ? "PAYLOAD_TOO_LARGE" : "BAD_REQUEST",
    );
  }
  if (status === 401 || status === 403 || status === 503) {
    return new FloorplanProxyError(
      "El microservicio de planos no está disponible. Comprueba su configuración y el bucket privado models-3d.",
      "SERVICE_UNAVAILABLE",
    );
  }
  return new FloorplanProxyError(
    detail ??
      "No se pudo guardar el resultado del plano. Revisa las credenciales de Supabase Storage y el bucket models-3d.",
    "UPSTREAM_ERROR",
  );
}

async function markAnalysisFailed(analysisId: string, message: string) {
  await prisma.aIAnalysis.update({
    where: { id: analysisId },
    data: {
      status: "failed",
      stage: "failed",
      error: message.slice(0, 500),
      finishedAt: new Date(),
    },
  });
}

/** POST /api/projects/:id/ai/floorplan — proxy CAD/PDF/raster a FastAPI. */
export async function POST(request: Request, context: RouteContext) {
  return withErrorHandling("ai.floorplan", async () => {
    const user = await requireApiUser();
    if (!user) return apiError("UNAUTHORIZED", "Sesion no iniciada");

    const { id: projectId } = await context.params;
    const project = await getProject(user.id, projectId);
    if (!project) return apiError("NOT_FOUND", "Proyecto no encontrado");

    const rateLimit = consume(`ai-floorplan:${user.id}`, 3, 60_000);
    if (!rateLimit.allowed) {
      return apiError(
        "RATE_LIMITED",
        `Demasiados análisis seguidos. Reintenta en ${rateLimit.retryAfterSeconds} s.`,
      );
    }

    const env = getEnv();
    if (!env.AI_SERVICE_URL || !env.AI_SERVICE_TOKEN) {
      return apiError(
        "SERVICE_UNAVAILABLE",
        "Configura AI_SERVICE_URL y AI_SERVICE_TOKEN en el .env del servidor web.",
      );
    }

    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_UPLOAD_BYTES + 1024 * 1024) {
      return apiError("PAYLOAD_TOO_LARGE", "El archivo supera el límite de 20 MB.");
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return apiError("BAD_REQUEST", "Se esperaba multipart/form-data con un plano.");
    }

    const entry = form.get("file");
    if (!(entry instanceof File)) {
      return apiError("BAD_REQUEST", "Selecciona un archivo de plano.");
    }
    const filename = entry.name || "floorplan";
    const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
    if (!ACCEPTED_EXTENSIONS.has(extension)) {
      return apiError(
        "BAD_REQUEST",
        "Formato no admitido. Usa PDF, DWG, DXF, PNG, WebP o JPG.",
      );
    }
    if (entry.size === 0) {
      return apiError("BAD_REQUEST", "El archivo está vacío.");
    }
    if (entry.size > MAX_UPLOAD_BYTES) {
      return apiError("PAYLOAD_TOO_LARGE", "El archivo supera el límite de 20 MB.");
    }

    const analysis = await prisma.aIAnalysis.create({
      data: {
        projectId,
        kind: "analyze-floorplan",
        status: "running",
        progress: 0,
        stage: "uploading",
        startedAt: new Date(),
      },
      select: { id: true },
    });

    const upstreamForm = new FormData();
    upstreamForm.append("file", entry, filename);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_SERVICE_TIMEOUT_MS);

    try {
      let upstream: Response;
      try {
        upstream = await fetch(
          `${env.AI_SERVICE_URL.replace(/\/+$/, "")}/api/v1/floorplan/analyze`,
          {
            method: "POST",
            headers: { "X-AI-Service-Key": env.AI_SERVICE_TOKEN },
            body: upstreamForm,
            cache: "no-store",
            signal: controller.signal,
          },
        );
      } catch (error) {
        if (controller.signal.aborted) {
          throw new FloorplanProxyError(
            "El análisis del plano tardó demasiado. Comprueba el servicio ODA/CAD y vuelve a intentarlo.",
            "UPSTREAM_TIMEOUT",
          );
        }
        console.error("[api:ai.floorplan] no se pudo conectar con FastAPI", error);
        throw new FloorplanProxyError(
          "No se pudo conectar con el microservicio de IA. Verifica que esté activo en AI_SERVICE_URL.",
          "SERVICE_UNAVAILABLE",
        );
      }

      if (!upstream.ok) {
        let detail: string | undefined;
        try {
          const body: unknown = await upstream.json();
          if (
            typeof body === "object" &&
            body !== null &&
            "detail" in body &&
            typeof body.detail === "string"
          ) {
            detail = body.detail.slice(0, 500);
          }
        } catch {
          detail = undefined;
        }
        throw responseError(upstream.status, detail);
      }

      const responseBody: unknown = await upstream.json();
      const parsed = floorplanResultSchema.safeParse(responseBody);
      if (!parsed.success) {
        console.error(
          "[api:ai.floorplan] respuesta inesperada de FastAPI",
          parsed.error.issues,
        );
        throw new FloorplanProxyError(
          "El microservicio devolvió una estructura de geometría no válida.",
          "UPSTREAM_ERROR",
        );
      }

      const result = parsed.data;
      const finishedAt = new Date();
      await prisma.$transaction([
        prisma.aIAnalysis.update({
          where: { id: analysis.id },
          data: {
            status: "succeeded",
            progress: 100,
            stage: "complete",
            resultJson: JSON.stringify({
              formatVersion: result.format_version,
              source: result.source,
              bounds: result.bounds,
              statistics: result.statistics,
              storagePath: result.storage_path,
              artifactSizeBytes: result.artifact_size_bytes,
              modelStoragePath: result.model_storage_path,
              modelSizeBytes: result.model_size_bytes,
              processingSeconds: result.processing_seconds,
            }),
            finishedAt,
          },
        }),
        prisma.exportJob.create({
          data: {
            projectId,
            format: "json",
            status: "succeeded",
            storageKey: result.storage_path,
            sizeBytes: result.artifact_size_bytes,
            finishedAt,
          },
        }),
        prisma.exportJob.create({
          data: {
            projectId,
            format: "glb",
            status: "succeeded",
            storageKey: result.model_storage_path,
            sizeBytes: result.model_size_bytes,
            finishedAt,
          },
        }),
      ]);

      return apiSuccess(result);
    } catch (error) {
      const message =
        error instanceof FloorplanProxyError
          ? error.message
          : "No fue posible completar el análisis del plano.";
      await markAnalysisFailed(analysis.id, message);

      if (error instanceof FloorplanProxyError) {
        return apiError(error.code, error.message);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  });
}
