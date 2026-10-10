import type {
  CameraPreset,
  Column,
  Door,
  Floor,
  FurnitureInstance,
  ImportedModel,
  LightEntity,
  MaterialDefinition,
  Opening,
  Roof,
  Room,
  Slab,
  Stair,
  Wall,
  WindowEntity,
} from "./entities";
import type { EntityId, Vector2 } from "./primitives";

/**
 * Documento de escena versionado.
 *
 * Es el unico formato persistido (columna Scene.dataJson) y el unico
 * intercambiado entre editor 2D, editor 3D, IA y exportadores.
 * Cualquier cambio de forma exige subir SCENE_SCHEMA_VERSION y anadir un
 * migrador en `migrateScene`.
 */
export const SCENE_SCHEMA_VERSION = "1.3" as const;

export type SceneSchemaVersion = typeof SCENE_SCHEMA_VERSION;

/**
 * Historial de versiones publicadas, de la mas antigua a la actual.
 *
 * 1.0 — formato inicial.
 * 1.1 — materiales con textura procedural (`texture`, `bump`).
 * 1.2 — plano de referencia importado (`underlay`).
 * 1.3 — modelos 3D importados (`importedModels`).
 */
export const SCENE_SCHEMA_HISTORY = ["1.0", "1.1", "1.2", "1.3"] as const;
export type AnySceneSchemaVersion = (typeof SCENE_SCHEMA_HISTORY)[number];

export interface SceneEnvironment {
  /** Preset de cielo/HDRI. */
  sky: "clear" | "cloudy" | "sunset" | "night" | "studio";
  /** Rotacion norte en grados: 0 = -Z apunta al norte. */
  northAngleDeg: number;
  /** Latitud/longitud para simulacion solar (opcional). */
  latitude?: number;
  longitude?: number;
  /** Fecha ISO y hora local para el estudio de sombras. */
  sunDate?: string;
  sunTime?: string;
  groundColor: string;
  showGrid: boolean;
}

/**
 * Plano importado que se calca por debajo del dibujo.
 *
 * Vive en el documento y no en el estado de la interfaz porque forma parte del
 * proyecto: al reabrirlo, el plano debe seguir colocado y a escala. Solo se
 * guarda la referencia al archivo, nunca la imagen.
 */
export interface PlanUnderlay {
  /** Identificador del `ProjectFile` con la imagen. */
  fileId: EntityId;
  /** Escala: pixeles de la imagen original por metro real. */
  pixelsPerMeter: number;
  /** Posicion en metros del pixel (0,0) de la imagen. */
  offset: Vector2;
  /** Giro del plano en grados, para enderezar un escaneado torcido. */
  rotationDeg: number;
  /** Opacidad de 0 a 1. */
  opacity: number;
  visible: boolean;
  /** Dimensiones de la imagen en pixeles. */
  width: number;
  height: number;
  /** Nivel al que pertenece; si falta, se muestra en todos. */
  floorId?: EntityId;
}

export interface SceneMetrics {
  /** Area construida total en m2 (suma de losas). */
  builtArea: number;
  /** Area util total de habitaciones en m2. */
  usableArea: number;
  wallSurface: number;
  floorSurface: number;
  roofSurface: number;
  glazedSurface: number;
  volume: number;
  roomCount: number;
  doorCount: number;
  windowCount: number;
}

export interface SceneDocument {
  version: SceneSchemaVersion;
  /** Unidad de VISUALIZACION preferida. Los datos siguen en metros. */
  displayUnit: "m" | "cm" | "mm" | "ft" | "in";
  floors: Floor[];
  walls: Wall[];
  doors: Door[];
  windows: WindowEntity[];
  openings: Opening[];
  columns: Column[];
  stairs: Stair[];
  roofs: Roof[];
  slabs: Slab[];
  rooms: Room[];
  furniture: FurnitureInstance[];
  importedModels: ImportedModel[];
  materials: MaterialDefinition[];
  lights: LightEntity[];
  cameras: CameraPreset[];
  environment: SceneEnvironment;
  /** Nivel activo en el editor. */
  activeFloorId: EntityId | null;
  /** Plano de referencia importado, si lo hay. */
  underlay?: PlanUnderlay | null;
}

export const DEFAULT_ENVIRONMENT: SceneEnvironment = {
  sky: "clear",
  northAngleDeg: 0,
  groundColor: "#3f4a3c",
  showGrid: true,
};

/** Escena vacia valida (sin niveles). Usar `createDefaultScene` para una util. */
export function createEmptyScene(): SceneDocument {
  return {
    version: SCENE_SCHEMA_VERSION,
    displayUnit: "m",
    floors: [],
    walls: [],
    doors: [],
    windows: [],
    openings: [],
    columns: [],
    stairs: [],
    roofs: [],
    slabs: [],
    rooms: [],
    furniture: [],
    importedModels: [],
    materials: [],
    lights: [],
    cameras: [],
    environment: { ...DEFAULT_ENVIRONMENT },
    activeFloorId: null,
  };
}
