import { prisma } from "@archvision/database";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { requireApiUser } from "@/lib/api/auth-guard";
import { consume } from "@/lib/api/rate-limit";
import { apiError, apiSuccess, withErrorHandling } from "@/lib/api/response";
import { getProject } from "@/lib/projects/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const AI_SERVICE_TIMEOUT_MS = 20 * 60 * 1000;
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXTENSION_BY_IMAGE_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const generatedModelSchema = z.object({
  model_url: z.string().url(),
  storage_path: z.string().min(1),
  format: z.literal("glb"),
  engine: z.enum(["triposr", "instantmesh"]).default("triposr"),
  processing_seconds: z.number().nonnegative(),
});

type ServiceErrorCode =
  | "SERVICE_UNAVAILABLE"
  | "UPSTREAM_ERROR"
  | "UPSTREAM_TIMEOUT"
  | "BAD_REQUEST"
  | "PAYLOAD_TOO_LARGE";

async function isInstantMeshAvailable(
  serviceUrl: string,
  serviceToken: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${serviceUrl.replace(/\/+$/, "")}/api/v1/capabilities`,
      {
        headers: { "X-AI-Service-Key": serviceToken },
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) return false;
    const payload: unknown = await response.json();
    return (
      typeof payload === "object" &&
      payload !== null &&
      "instantmesh_available" in payload &&
      payload.instantmesh_available === true
    );
  } catch {
    return false;
  }
}

class AIServiceError extends Error {
  constructor(
    message: string,
    readonly code: ServiceErrorCode,
  ) {
    super(message);
    this.name = "AIServiceError";
  }
}

function getUpstreamError(status: number, detail?: string): AIServiceError {
  if (detail && status >= 500) {
    return new AIServiceError(detail, status === 503 ? "SERVICE_UNAVAILABLE" : "UPSTREAM_ERROR");
  }
  if (status === 400 || status === 422) {
    return new AIServiceError(
      "El servicio no pudo procesar esta imagen. Prueba con un archivo JPG, PNG o WebP válido.",
      "BAD_REQUEST",
    );
  }
  if (status === 413) {
    return new AIServiceError(
      "La imagen supera el límite de 20 MB.",
      "PAYLOAD_TOO_LARGE",
    );
  }
  if (status === 401 || status === 403 || status === 503) {
    return new AIServiceError(
      "El microservicio de IA no está listo. Comprueba que esté iniciado y revisa su configuración y el bucket privado models-3d en Supabase.",
      "SERVICE_UNAVAILABLE",
    );
  }
  return new AIServiceError(
    "Falló la generación o la subida del modelo. Revisa que el bucket privado models-3d exista y que el microservicio tenga credenciales de Storage válidas.",
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

/** GET /api/projects/:id/ai/generate — informa si InstantMesh está listo. */
export async function GET(_request: Request, context: RouteContext) {
  return withErrorHandling("ai.generate.capabilities", async () => {
    const user = await requireApiUser();
    if (!user) return apiError("UNAUTHORIZED", "Sesion no iniciada");

    const { id: projectId } = await context.params;
    const project = await getProject(user.id, projectId);
    if (!project) return apiError("NOT_FOUND", "Proyecto no encontrado");

    const env = getEnv();
    let available = false;
    if (env.AI_SERVICE_URL && env.AI_SERVICE_TOKEN) {
      available = await isInstantMeshAvailable(
        env.AI_SERVICE_URL,
        env.AI_SERVICE_TOKEN,
      );
    }
    return apiSuccess({ instantMeshAvailable: available });
  });
}

/** POST /api/projects/:id/ai/generate — proxy autenticado a FastAPI. */
export async function POST(request: Request, context: RouteContext) {
  return withErrorHandling("ai.generate", async () => {
    const user = await requireApiUser();
    if (!user) return apiError("UNAUTHORIZED", "Sesion no iniciada");

    const { id: projectId } = await context.params;
    const project = await getProject(user.id, projectId);
    if (!project) return apiError("NOT_FOUND", "Proyecto no encontrado");

    const rateLimit = consume(`ai-generate:${user.id}`, 3, 60_000);
    if (!rateLimit.allowed) {
      return apiError(
        "RATE_LIMITED",
        `Demasiadas generaciones seguidas. Reintenta en ${rateLimit.retryAfterSeconds} s.`,
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
      return apiError("PAYLOAD_TOO_LARGE", "La imagen supera el límite de 20 MB.");
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return apiError("BAD_REQUEST", "Se esperaba una imagen en multipart/form-data.");
    }

    const entry = form.get("file");
    if (!(entry instanceof File)) {
      return apiError("BAD_REQUEST", "Selecciona una imagen para generar el modelo.");
    }
    if (!ACCEPTED_IMAGE_TYPES.has(entry.type)) {
      return apiError("BAD_REQUEST", "Formato no admitido. Usa JPG, PNG o WebP.");
    }
    if (entry.size === 0) {
      return apiError("BAD_REQUEST", "El archivo está vacío.");
    }
    if (entry.size > MAX_UPLOAD_BYTES) {
      return apiError("PAYLOAD_TOO_LARGE", "La imagen supera el límite de 20 MB.");
    }
    const requestedQuality = form.get("quality");
    if (
      requestedQuality !== null &&
      (typeof requestedQuality !== "string" ||
        (requestedQuality !== "standard" && requestedQuality !== "hq"))
    ) {
      return apiError("BAD_REQUEST", "El modo de calidad seleccionado no es válido.");
    }
    const quality: "standard" | "hq" =
      requestedQuality === "hq" ? "hq" : "standard";
    if (
      quality === "hq" &&
      !(await isInstantMeshAvailable(env.AI_SERVICE_URL, env.AI_SERVICE_TOKEN))
    ) {
      return apiError(
        "SERVICE_UNAVAILABLE",
        "Alta Calidad no está disponible porque InstantMesh no está configurado en el microservicio.",
      );
    }

    const analysis = await prisma.aIAnalysis.create({
      data: {
        projectId,
        kind: "reconstruct",
        status: "running",
        progress: 0,
        stage: "uploading",
        startedAt: new Date(),
      },
      select: { id: true },
    });

    const upstreamForm = new FormData();
    upstreamForm.append(
      "file",
      entry,
      `upload.${EXTENSION_BY_IMAGE_TYPE[entry.type]}`,
    );
    const serviceEndpoint =
      quality === "standard"
        ? "/api/v1/image-to-3d/generate"
        : "/api/v1/image-to-3d/generate-hq";
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      AI_SERVICE_TIMEOUT_MS,
    );

    try {
      let upstream: Response;
      try {
        upstream = await fetch(
          `${env.AI_SERVICE_URL.replace(/\/+$/, "")}${serviceEndpoint}`,
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
          throw new AIServiceError(
            "La generación tardó demasiado. Comprueba el estado del microservicio y vuelve a intentarlo.",
            "UPSTREAM_TIMEOUT",
          );
        }
        console.error("[api:ai.generate] no se pudo conectar con FastAPI", error);
        throw new AIServiceError(
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
            "detail" in body
          ) {
            const rawDetail = body.detail;
            if (typeof rawDetail === "string") {
              detail = rawDetail;
            } else if (
              typeof rawDetail === "object" &&
              rawDetail !== null &&
              "message" in rawDetail
            ) {
              const message =
                typeof rawDetail.message === "string" ? rawDetail.message : "";
              const reason =
                "reason" in rawDetail && typeof rawDetail.reason === "string"
                  ? rawDetail.reason
                  : "";
              detail = [message, reason].filter(Boolean).join(" ");
            }
          }
        } catch {
          // The generic status-specific message below is used for non-JSON errors.
        }
        throw getUpstreamError(upstream.status, detail?.slice(0, 1500));
      }

      const responseBody: unknown = await upstream.json();
      const parsed = generatedModelSchema.safeParse(responseBody);
      if (!parsed.success) {
        console.error(
          "[api:ai.generate] respuesta inesperada de FastAPI",
          parsed.error.issues,
        );
        throw new AIServiceError(
          "El microservicio devolvió una respuesta que la aplicación no pudo validar.",
          "UPSTREAM_ERROR",
        );
      }

      const finishedAt = new Date();
      await prisma.$transaction([
        prisma.aIAnalysis.update({
          where: { id: analysis.id },
          data: {
            status: "succeeded",
            progress: 100,
            stage: "complete",
            resultJson: JSON.stringify({
              format: parsed.data.format,
              engine: parsed.data.engine,
              storagePath: parsed.data.storage_path,
              processingSeconds: parsed.data.processing_seconds,
            }),
            finishedAt,
          },
        }),
        prisma.exportJob.create({
          data: {
            projectId,
            format: parsed.data.format,
            status: "succeeded",
            storageKey: parsed.data.storage_path,
            finishedAt,
          },
        }),
      ]);

      return apiSuccess({
        modelUrl: parsed.data.model_url,
        format: parsed.data.format,
        engine: parsed.data.engine,
        processingSeconds: parsed.data.processing_seconds,
      });
    } catch (error) {
      const message =
        error instanceof AIServiceError
          ? error.message
          : "No fue posible completar la generación del modelo.";
      await markAnalysisFailed(analysis.id, message);

      if (error instanceof AIServiceError) {
        return apiError(error.code, error.message);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  });
}
