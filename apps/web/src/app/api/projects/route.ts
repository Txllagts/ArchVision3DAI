import { createProjectSchema, projectListQuerySchema } from "@archvision/validation";
import {
  apiError,
  apiSuccess,
  apiValidationError,
  readJsonBody,
  withErrorHandling,
} from "@/lib/api/response";
import { requireApiUser } from "@/lib/api/auth-guard";
import { currentEntitlement } from "@/lib/billing/service";
import { clientKey, consume } from "@/lib/api/rate-limit";
import {
  QuotaExceededError,
  createProject,
  createProjectWithFile,
  listProjects,
} from "@/lib/projects/service";
import { sniff } from "@/lib/storage/sniff";

/** GET /api/projects - listado paginado del usuario autenticado. */
export async function GET(request: Request) {
  return withErrorHandling("projects.list", async () => {
    const user = await requireApiUser();
    if (!user) return apiError("UNAUTHORIZED", "Sesion no iniciada");

    const url = new URL(request.url);
    const parsed = projectListQuerySchema.safeParse({
      search: url.searchParams.get("search") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      includeDeleted: url.searchParams.get("includeDeleted") ?? undefined,
    });
    if (!parsed.success) return apiValidationError(parsed.error);

    const result = await listProjects(user.id, parsed.data);
    return apiSuccess(result);
  });
}

/** POST /api/projects - crea un proyecto con su escena inicial. */
export async function POST(request: Request) {
  return withErrorHandling("projects.create", async () => {
    const user = await requireApiUser();
    if (!user) return apiError("UNAUTHORIZED", "Sesion no iniciada");

    const limit = consume(clientKey(request, "project-create"), 30, 60 * 1000);
    if (!limit.allowed) {
      return apiError("RATE_LIMITED", "Demasiadas creaciones seguidas");
    }

    const contentType = request.headers.get("content-type") ?? "";
    const isMultipart = contentType.includes("multipart/form-data");

    let parsedData: ReturnType<typeof createProjectSchema.safeParse>;
    let file: File | null = null;
    let fileKind: "floorplan" | "model" | null = null;
    let demo = false;

    if (isMultipart) {
      const formData = await request.formData();
      const fileEntry = formData.get("file");
      if (fileEntry instanceof File) {
        file = fileEntry;

        // Validate file type using sniff
        const arrayBuffer = await file.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);
        const sniffResult = sniff(data);

        if (!sniffResult) {
          return apiError("BAD_REQUEST", "Formato no reconocido. Se aceptan PNG, JPG, WebP, PDF, GLB y GLTF.");
        }

        // Determine kind from sniff result, with fallback to file extension
        const isModelMime = sniffResult.mime === "model/gltf-binary" || sniffResult.mime === "model/gltf+json";
        const isOctetStream = sniffResult.mime === "application/octet-stream";
        const hasModelExtension = file.name.toLowerCase().endsWith(".glb") || file.name.toLowerCase().endsWith(".gltf");

        if (isModelMime || (isOctetStream && hasModelExtension)) {
          fileKind = "model";
        } else {
          fileKind = "floorplan";
        }
      }

      // Parse other fields from form data
      const raw: Record<string, string> = {};
      for (const [key, value] of formData.entries()) {
        if (key !== "file") {
          raw[key] = String(value);
        }
      }
      parsedData = createProjectSchema.safeParse(raw);

      // Check for demo flag
      const demoEntry = formData.get("demo");
      demo = demoEntry ? Boolean(demoEntry) : false;
    } else {
      const body = await readJsonBody(request, 32 * 1024);
      parsedData = createProjectSchema.safeParse(body);
      demo = typeof body === "object" && body !== null && "demo" in body ? Boolean((body as { demo?: unknown }).demo) : false;
    }

    if (!parsedData.success) return apiValidationError(parsedData.error);

    try {
      const context = {
        userId: user.id,
        userName: user.name,
        plan: (await currentEntitlement(user.id)).plan,
      };

      let project;
      if (file && fileKind) {
        project = await createProjectWithFile(context, { ...parsedData.data, demo }, file, fileKind);
      } else {
        project = await createProject(context, { ...parsedData.data, demo });
      }

      return apiSuccess(project, 201);
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        return apiError("QUOTA_EXCEEDED", error.message);
      }
      throw error;
    }
  });
}
