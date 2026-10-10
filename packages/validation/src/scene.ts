import { z } from "zod";
import {
  DOOR_KINDS,
  LIGHT_KINDS,
  MATERIAL_CATEGORIES,
  OPENING_DIRECTIONS,
  ROOF_KINDS,
  SCENE_SCHEMA_VERSION,
  STAIR_KINDS,
  TEXTURE_PATTERNS,
  UNIT_SYSTEMS,
  WINDOW_KINDS,
  type SceneDocument,
} from "@archvision/types";

/**
 * Validacion del documento de escena.
 *
 * Es la frontera de confianza: cualquier escena que llegue desde el cliente,
 * un import o el servicio de IA se valida aqui antes de persistirse.
 */

// Limites defensivos: evitan payloads que revienten memoria o render.
export const SCENE_LIMITS = {
  maxFloors: 30,
  maxWalls: 5000,
  maxOpenings: 5000,
  maxFurniture: 5000,
  maxMaterials: 500,
  maxPolygonPoints: 512,
  maxCoordinate: 5000,
  maxDimension: 500,
} as const;

const coord = z
  .number()
  .finite()
  .min(-SCENE_LIMITS.maxCoordinate)
  .max(SCENE_LIMITS.maxCoordinate);

const dimension = z.number().finite().min(0).max(SCENE_LIMITS.maxDimension);
const angle = z.number().finite().min(-1000).max(1000);
const unitInterval = z.number().min(0).max(1);
const id = z.string().min(1).max(64);

/** Tope de nombre de entidad; los nombres de archivo se recortan a este limite. */
export const ENTITY_NAME_MAX = 120;

const entityName = z.string().trim().min(1).max(ENTITY_NAME_MAX);
const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Color hexadecimal invalido");
const storageKey = z.string().min(1).max(512);

export const vector2Schema = z.object({ x: coord, y: coord });
export const vector3Schema = z.object({ x: coord, y: coord, z: coord });
export const eulerSchema = z.object({ x: angle, y: angle, z: angle });

const sourceSchema = z.enum(["user", "ai", "import"]).optional();

export const floorSchema = z.object({
  id,
  name: entityName,
  level: z.number().int().min(-10).max(200),
  elevation: coord,
  height: dimension.min(0.5),
  visible: z.boolean(),
  locked: z.boolean(),
});

export const wallSchema = z.object({
  id,
  floorId: id,
  name: entityName,
  start: vector2Schema,
  end: vector2Schema,
  height: dimension.min(0.1),
  thickness: dimension.min(0.01).max(5),
  baseOffset: z.number().min(-50).max(50),
  materialInteriorId: id.optional(),
  materialExteriorId: id.optional(),
  visible: z.boolean(),
  locked: z.boolean(),
  source: sourceSchema,
  confidence: unitInterval.optional(),
});

export const doorSchema = z.object({
  id,
  wallId: id,
  floorId: id,
  name: entityName,
  kind: z.enum(DOOR_KINDS),
  offset: z.number().min(0).max(SCENE_LIMITS.maxCoordinate),
  width: dimension.min(0.1).max(20),
  height: dimension.min(0.1).max(20),
  openingDirection: z.enum(OPENING_DIRECTIONS),
  materialId: id.optional(),
  visible: z.boolean(),
  locked: z.boolean(),
  source: sourceSchema,
  confidence: unitInterval.optional(),
});

export const windowSchema = z.object({
  id,
  wallId: id,
  floorId: id,
  name: entityName,
  kind: z.enum(WINDOW_KINDS),
  offset: z.number().min(0).max(SCENE_LIMITS.maxCoordinate),
  width: dimension.min(0.1).max(30),
  height: dimension.min(0.1).max(20),
  sillHeight: z.number().min(0).max(20),
  frameThickness: dimension.max(1),
  materialId: id.optional(),
  visible: z.boolean(),
  locked: z.boolean(),
  source: sourceSchema,
  confidence: unitInterval.optional(),
});

export const openingSchema = z.object({
  id,
  wallId: id,
  floorId: id,
  name: entityName,
  offset: z.number().min(0).max(SCENE_LIMITS.maxCoordinate),
  width: dimension.min(0.1).max(30),
  height: dimension.min(0.1).max(20),
  sillHeight: z.number().min(0).max(20),
  visible: z.boolean(),
  locked: z.boolean(),
});

export const columnSchema = z.object({
  id,
  floorId: id,
  name: entityName,
  position: vector2Schema,
  shape: z.enum(["rect", "circle"]),
  width: dimension.min(0.02).max(10),
  depth: dimension.min(0.02).max(10),
  height: dimension.min(0.1).max(50),
  rotationY: angle,
  materialId: id.optional(),
  visible: z.boolean(),
  locked: z.boolean(),
});

export const stairSchema = z.object({
  id,
  floorId: id,
  name: entityName,
  kind: z.enum(STAIR_KINDS),
  position: vector2Schema,
  rotationY: angle,
  totalRise: dimension.min(0.2).max(30),
  width: dimension.min(0.4).max(10),
  steps: z.number().int().min(2).max(100),
  tread: dimension.min(0.15).max(1),
  riser: dimension.min(0.08).max(0.35),
  hasLanding: z.boolean(),
  hasRailing: z.boolean(),
  materialId: id.optional(),
  visible: z.boolean(),
  locked: z.boolean(),
});

const outlineSchema = z
  .array(vector2Schema)
  .min(3)
  .max(SCENE_LIMITS.maxPolygonPoints);

export const roofSchema = z.object({
  id,
  floorId: id,
  name: entityName,
  kind: z.enum(ROOF_KINDS),
  outline: outlineSchema,
  slopeDeg: z.number().min(0).max(85),
  baseHeight: z.number().min(-50).max(200),
  overhang: dimension.max(10),
  thickness: dimension.min(0.01).max(3),
  materialId: id.optional(),
  visible: z.boolean(),
  locked: z.boolean(),
});

export const slabSchema = z.object({
  id,
  floorId: id,
  name: entityName,
  outline: outlineSchema,
  thickness: dimension.min(0.01).max(3),
  materialId: id.optional(),
  visible: z.boolean(),
  locked: z.boolean(),
});

export const roomSchema = z.object({
  id,
  floorId: id,
  name: entityName,
  polygon: outlineSchema,
  wallIds: z.array(id).max(SCENE_LIMITS.maxWalls),
  area: z.number().min(0).max(1_000_000),
  perimeter: z.number().min(0).max(1_000_000),
  floorMaterialId: id.optional(),
  ceilingMaterialId: id.optional(),
  color: hexColor.optional(),
});

export const furnitureSchema = z.object({
  id,
  floorId: id,
  name: entityName,
  catalogId: z.string().min(1).max(120),
  position: vector3Schema,
  rotation: eulerSchema,
  scale: z.object({
    x: z.number().min(0.001).max(100),
    y: z.number().min(0.001).max(100),
    z: z.number().min(0.001).max(100),
  }),
  materialOverrides: z.record(z.string().max(120), id).optional(),
  visible: z.boolean(),
  locked: z.boolean(),
});

/**
 * URL de descarga de un modelo importado.
 *
 * El editor persiste rutas relativas de la propia app
 * (`/api/projects/.../files/.../content`) para los archivos subidos, y URLs
 * absolutas para los modelos que aloja el servicio de IA. Ambos formatos son
 * validos: `z.string().url()` exigia esquema y rechazaba la ruta relativa,
 * con el resultado de que importar un GLB dejaba la escena entera invalida y
 * el guardado fallaba siempre.
 */
export const modelUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    (value) => value.startsWith("/") || /^https?:\/\/\S+$/.test(value),
    "URL de modelo invalida",
  );

export const importedModelSchema = z.object({
  id,
  floorId: id,
  name: entityName,
  fileId: id,
  url: modelUrlSchema,
  position: vector3Schema,
  rotation: eulerSchema,
  scale: z.object({
    x: z.number().min(0.001).max(100),
    y: z.number().min(0.001).max(100),
    z: z.number().min(0.001).max(100),
  }),
  visible: z.boolean(),
  locked: z.boolean(),
  source: z.literal("import"),
});

/**
 * Plano de referencia.
 */
export const underlaySchema = z.object({
  fileId: id,
  pixelsPerMeter: z.number().finite().min(0.1).max(20000),
  offset: vector2Schema,
  rotationDeg: z.number().min(-360).max(360),
  opacity: unitInterval,
  visible: z.boolean(),
  width: z.number().int().min(1).max(30000),
  height: z.number().int().min(1).max(30000),
  floorId: id.optional(),
});

export const materialSchema = z.object({
  id,
  name: entityName,
  category: z.enum(MATERIAL_CATEGORIES),
  baseColor: hexColor,
  roughness: unitInterval,
  metalness: unitInterval,
  opacity: unitInterval,
  texture: z.enum(TEXTURE_PATTERNS).optional(),
  bump: unitInterval.optional(),
  maps: z
    .object({
      baseColor: storageKey.optional(),
      normal: storageKey.optional(),
      roughness: storageKey.optional(),
      metalness: storageKey.optional(),
      displacement: storageKey.optional(),
      ao: storageKey.optional(),
    })
    .optional(),
  tiling: z
    .object({
      x: z.number().min(0.001).max(1000),
      y: z.number().min(0.001).max(1000),
    })
    .optional(),
  rotationDeg: z.number().min(-360).max(360).optional(),
  offset: z.object({ x: z.number(), y: z.number() }).optional(),
  builtin: z.boolean().optional(),
});

export const lightSchema = z.object({
  id,
  floorId: id.optional(),
  name: entityName,
  kind: z.enum(LIGHT_KINDS),
  position: vector3Schema,
  target: vector3Schema.optional(),
  intensity: z.number().min(0).max(1000),
  color: hexColor,
  temperature: z.number().min(1000).max(20000).optional(),
  castShadow: z.boolean(),
  visible: z.boolean(),
  locked: z.boolean(),
});

export const cameraPresetSchema = z.object({
  id,
  name: entityName,
  position: vector3Schema,
  target: vector3Schema,
  fov: z.number().min(5).max(140),
  mode: z.enum(["perspective", "orthographic"]),
});

export const environmentSchema = z.object({
  sky: z.enum(["clear", "cloudy", "sunset", "night", "studio"]),
  northAngleDeg: z.number().min(-360).max(360),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  sunDate: z.string().max(40).optional(),
  sunTime: z.string().max(10).optional(),
  groundColor: hexColor,
  showGrid: z.boolean(),
});

export const sceneDocumentSchema = z.object({
  version: z.literal(SCENE_SCHEMA_VERSION),
  displayUnit: z.enum(UNIT_SYSTEMS),
  floors: z.array(floorSchema).max(SCENE_LIMITS.maxFloors),
  walls: z.array(wallSchema).max(SCENE_LIMITS.maxWalls),
  doors: z.array(doorSchema).max(SCENE_LIMITS.maxOpenings),
  windows: z.array(windowSchema).max(SCENE_LIMITS.maxOpenings),
  openings: z.array(openingSchema).max(SCENE_LIMITS.maxOpenings),
  columns: z.array(columnSchema).max(SCENE_LIMITS.maxWalls),
  stairs: z.array(stairSchema).max(200),
  roofs: z.array(roofSchema).max(200),
  slabs: z.array(slabSchema).max(500),
  rooms: z.array(roomSchema).max(500),
  furniture: z.array(furnitureSchema).max(SCENE_LIMITS.maxFurniture),
  importedModels: z.array(importedModelSchema).max(SCENE_LIMITS.maxFurniture),
  materials: z.array(materialSchema).max(SCENE_LIMITS.maxMaterials),
  underlay: underlaySchema.nullish(),
  lights: z.array(lightSchema).max(500),
  cameras: z.array(cameraPresetSchema).max(100),
  environment: environmentSchema,
  activeFloorId: id.nullable(),
});

/**
 * Verifica integridad referencial: los vanos apuntan a paredes existentes y
 * cada objeto pertenece a un nivel existente. Devuelve la lista de problemas.
 */
export function validateSceneReferences(scene: SceneDocument): string[] {
  const problems: string[] = [];
  const floorIds = new Set(scene.floors.map((f) => f.id));
  const wallIds = new Set(scene.walls.map((w) => w.id));
  const materialIds = new Set(scene.materials.map((m) => m.id));

  const requireFloor = (kind: string, itemId: string, floorId: string) => {
    if (!floorIds.has(floorId)) {
      problems.push(`${kind} ${itemId} referencia un nivel inexistente ${floorId}`);
    }
  };

  for (const wall of scene.walls) requireFloor("Pared", wall.id, wall.floorId);
  for (const item of [...scene.doors, ...scene.windows, ...scene.openings]) {
    requireFloor("Vano", item.id, item.floorId);
    if (!wallIds.has(item.wallId)) {
      problems.push(`Vano ${item.id} referencia una pared inexistente ${item.wallId}`);
    }
  }
  for (const material of [
    ...scene.walls.flatMap((w) => [w.materialInteriorId, w.materialExteriorId]),
    ...scene.rooms.flatMap((r) => [r.floorMaterialId, r.ceilingMaterialId]),
  ]) {
    if (material && !materialIds.has(material)) {
      problems.push(`Material inexistente ${material}`);
    }
  }
  if (scene.activeFloorId && !floorIds.has(scene.activeFloorId)) {
    problems.push("activeFloorId no corresponde a ningun nivel");
  }
  return problems;
}

export type SceneDocumentInput = z.infer<typeof sceneDocumentSchema>;

// Comprobacion en tiempo de compilacion: el esquema y el tipo no pueden
// divergir sin romper el build.
type SchemaMatchesType = SceneDocumentInput extends SceneDocument ? true : never;
export const SCENE_SCHEMA_MATCHES_TYPE: SchemaMatchesType = true;
