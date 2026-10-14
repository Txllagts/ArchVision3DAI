import { apiError, apiSuccess, withErrorHandling } from "@/lib/api/response";
import { requireApiUser } from "@/lib/api/auth-guard";
import { getProject } from "@/lib/projects/service";
import { z } from "zod";
import {
  buildOpeningCandidates,
  buildWallCommands,
  floorplanStatistics,
  metersPerUnit,
} from "@archvision/shared";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const pointSchema = z.tuple([z.number().finite(), z.number().finite()]);

const floorplanEntitySchema = z.object({
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
});

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
  entities: z.array(floorplanEntitySchema).max(20_000),
  processing_seconds: z.number().nonnegative(),
  storage_path: z.string().min(1),
  result_url: z.string().url(),
  artifact_size_bytes: z.number().int().nonnegative(),
  model_storage_path: z.string().min(1),
  model_url: z.string().url(),
  model_size_bytes: z.number().int().positive(),
});

/**
 * Colocacion del plano en la escena, tal y como la tiene el cliente.
 *
 * Llega solo cuando el analisis se hizo sobre el mismo archivo que el `underlay`
 * visible: es lo que permite situar los muros sobre la imagen con la escala que
 * calibró el usuario en lugar de con la aproximacion del servicio.
 */
const placementSchema = z.object({
  pixelsPerMeter: z.number().finite().positive().max(10_000),
  offset: z.object({ x: z.number().finite(), y: z.number().finite() }),
  rotationDeg: z.number().finite().min(-360).max(360),
});

const requestSchema = z.object({
  analysisId: z.string().min(1).optional(),
  result: floorplanResultSchema.optional(),
  /** Nivel activo del editor; si falta, se usa el de la escena guardada. */
  activeFloorId: z.string().min(1).optional(),
  underlay: placementSchema.optional(),
});

type FloorplanResult = z.infer<typeof floorplanResultSchema>;

/**
 * POST /api/projects/:id/ai/floorplan/apply — convierte el analisis IA en
 * comandos de creacion.
 *
 * El punto delicado son las unidades: el servicio devuelve pixeles para raster
 * y unidades de dibujo para CAD. Tratar todo como metros daba muros de miles
 * de metros (un plano de 2000 px se convertia en un muro de 2000 m). La
 * conversion es explicita y, cuando el cliente manda la colocacion del plano,
 * los muros caen adentro de la imagen calibrada.
 *
 * Las aperturas se devuelven situadas pero sin muro asignado: el id del muro lo
 * genera el reductor del cliente, y solo entonces se puede colocar el vano.
 */
export async function POST(request: Request, context: RouteContext) {
  return withErrorHandling("ai.floorplan.apply", async () => {
    const user = await requireApiUser();
    if (!user) return apiError("UNAUTHORIZED", "Sesion no iniciada");

    const { id: projectId } = await context.params;

    // Fetch project with scene data to get activeFloorId and floors
    const { prisma } = await import("@archvision/database");
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        workspace: { members: { some: { userId: user.id } } },
      },
      include: { scene: true },
    });
    if (!project) return apiError("NOT_FOUND", "Proyecto no encontrado");

    let body: z.infer<typeof requestSchema>;
    try {
      body = requestSchema.parse(await request.json());
    } catch {
      return apiError("BAD_REQUEST", "JSON invalido");
    }

    if (!body.analysisId && !body.result) {
      return apiError("BAD_REQUEST", "Se requiere analysisId o result");
    }

    let result: FloorplanResult | null = body.result ?? null;

    if (body.analysisId) {
      // Fetch analysis from DB
      const analysis = await prisma.aIAnalysis.findFirst({
        where: { id: body.analysisId, projectId },
        select: { resultJson: true, status: true },
      });
      if (!analysis) return apiError("NOT_FOUND", "Analisis no encontrado");
      if (analysis.status !== "succeeded") {
        return apiError("BAD_REQUEST", "El analisis no ha finalizado correctamente");
      }
      const rawResult = analysis.resultJson;
      if (typeof rawResult !== "string" || rawResult.length === 0) {
        return apiError("BAD_REQUEST", "El analisis no guardo geometria");
      }
      const parsed = floorplanResultSchema.safeParse(JSON.parse(rawResult));
      if (!parsed.success) return apiError("BAD_REQUEST", "Resultado de analisis invalido");
      result = parsed.data;
    }

    if (!result) return apiError("BAD_REQUEST", "No hay resultado de analisis para aplicar");

    // Get active floor from scene
    let scene: { activeFloorId: string | null; floors: Array<{ id: string }> } | null = null;
    if (project.scene?.dataJson) {
      try {
        scene = JSON.parse(project.scene.dataJson);
      } catch {
        scene = null;
      }
    }
    // El cliente manda su nivel activo: es el que ve en pantalla, y puede no
    // coincidir con el ultimo guardado en el servidor.
    const activeFloorId =
      body.activeFloorId ?? scene?.activeFloorId ?? scene?.floors[0]?.id;
    if (!activeFloorId) {
      return apiError("BAD_REQUEST", "El proyecto no tiene un nivel activo");
    }
    if (scene && !scene.floors.some((floor) => floor.id === activeFloorId)) {
      return apiError("BAD_REQUEST", "El nivel activo no pertenece al proyecto");
    }

    const analysis = {
      source: { kind: result.source.kind, units: result.source.units },
      entities: result.entities,
    };

    // Un CAD sin unidades declaradas no se puede pasar a metros: el servicio
    // tampoco lo extrusiona. Es mejor decirlo que inventar una escala.
    if (analysis.source.kind === "cad" && metersPerUnit(analysis.source.units) === null) {
      return apiError(
        "BAD_REQUEST",
        "El CAD no declara unidades ($INSUNITS). Configura metros, centimetros, milimetros, pies o pulgadas y vuelve a exportarlo.",
      );
    }

    const wallCommands = buildWallCommands(
      analysis,
      activeFloorId,
      body.underlay ?? null,
    );

    const openingCandidates = buildOpeningCandidates(analysis, body.underlay ?? null);

    if (wallCommands.length === 0) {
      const statistics = floorplanStatistics(analysis);
      return apiSuccess({
        commands: [],
        wallsCreated: 0,
        openings: [],
        statistics,
        message:
          statistics.wallCandidates === 0
            ? "No se detectaron muros en el analisis"
            : "Los muros detectados eran demasiado cortos para crear entidades",
      });
    }

    return apiSuccess({
      commands: wallCommands,
      wallsCreated: wallCommands.length,
      openings: openingCandidates,
      statistics: floorplanStatistics(analysis),
      /** true cuando los muros se situaron sobre el plano calibrado. */
      alignedToPlan: Boolean(body.underlay) && analysis.source.kind === "raster",
      message: `Se generaron ${wallCommands.length} comandos de muro desde el analisis IA`,
    });
  });
}
