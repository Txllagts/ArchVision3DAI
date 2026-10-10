import type { EntityId, Euler3, HexColor, Vector2, Vector3 } from "./primitives";

/**
 * Entidades arquitectonicas parametricas.
 *
 * Estas entidades son la FUENTE DE VERDAD del modelo. La geometria de
 * Three.js se genera a partir de ellas y nunca se persiste.
 */

export const SCENE_OBJECT_TYPES = [
  "wall",
  "door",
  "window",
  "opening",
  "column",
  "stair",
  "roof",
  "slab",
  "room",
  "furniture",
  "light",
  "terrain",
  "annotation",
  "imported-model",
] as const;

export type SceneObjectType = (typeof SCENE_OBJECT_TYPES)[number];

/** Contrato base de cualquier objeto de la escena. */
export interface SceneObject {
  id: EntityId;
  type: SceneObjectType;
  name: string;
  /** Nivel (planta) al que pertenece el objeto. */
  floorId: EntityId;
  position: Vector3;
  rotation: Euler3;
  visible: boolean;
  locked: boolean;
  /** Origen del objeto: creado por el usuario o propuesto por IA. */
  source?: "user" | "ai" | "import";
  /** Confianza [0..1] cuando source === "ai". */
  confidence?: number;
}

// --------------------------------------------------------------------------
// Nivel / planta
// --------------------------------------------------------------------------

export interface Floor {
  id: EntityId;
  name: string;
  /** Indice ordinal: -1 = sotano, 0 = planta baja, 1 = primer piso... */
  level: number;
  /** Cota del nivel de piso terminado, en metros. */
  elevation: number;
  /** Altura libre por defecto para paredes de este nivel, en metros. */
  height: number;
  visible: boolean;
  locked: boolean;
}

// --------------------------------------------------------------------------
// Pared
// --------------------------------------------------------------------------

export interface Wall {
  id: EntityId;
  floorId: EntityId;
  name: string;
  /** Punto inicial del eje de la pared, plano XZ, en metros. */
  start: Vector2;
  /** Punto final del eje de la pared. */
  end: Vector2;
  /** Altura de la pared en metros. */
  height: number;
  /** Grosor total, repartido a ambos lados del eje. */
  thickness: number;
  /** Desplazamiento vertical respecto a la cota del nivel. */
  baseOffset: number;
  materialInteriorId?: EntityId;
  materialExteriorId?: EntityId;
  visible: boolean;
  locked: boolean;
  source?: "user" | "ai" | "import";
  confidence?: number;
}

// --------------------------------------------------------------------------
// Vanos: puerta, ventana, abertura generica
// --------------------------------------------------------------------------

export const DOOR_KINDS = [
  "single",
  "double",
  "sliding",
  "glass",
  "pivot",
  "arch",
] as const;
export type DoorKind = (typeof DOOR_KINDS)[number];

export const OPENING_DIRECTIONS = [
  "inward-left",
  "inward-right",
  "outward-left",
  "outward-right",
  "sliding",
] as const;
export type OpeningDirection = (typeof OPENING_DIRECTIONS)[number];

export interface Door {
  id: EntityId;
  wallId: EntityId;
  floorId: EntityId;
  name: string;
  kind: DoorKind;
  /** Distancia en metros desde `wall.start` hasta el centro del vano. */
  offset: number;
  width: number;
  height: number;
  openingDirection: OpeningDirection;
  materialId?: EntityId;
  visible: boolean;
  locked: boolean;
  source?: "user" | "ai" | "import";
  confidence?: number;
}

export const WINDOW_KINDS = [
  "single",
  "double",
  "sliding",
  "panoramic",
  "arch",
  "custom",
] as const;
export type WindowKind = (typeof WINDOW_KINDS)[number];

export interface WindowEntity {
  id: EntityId;
  wallId: EntityId;
  floorId: EntityId;
  name: string;
  kind: WindowKind;
  /** Distancia en metros desde `wall.start` hasta el centro del vano. */
  offset: number;
  width: number;
  height: number;
  /** Altura del antepecho medida desde el piso del nivel. */
  sillHeight: number;
  /** Grosor del marco. */
  frameThickness: number;
  materialId?: EntityId;
  visible: boolean;
  locked: boolean;
  source?: "user" | "ai" | "import";
  confidence?: number;
}

/** Vano sin carpinteria (pasos, nichos). */
export interface Opening {
  id: EntityId;
  wallId: EntityId;
  floorId: EntityId;
  name: string;
  offset: number;
  width: number;
  height: number;
  sillHeight: number;
  visible: boolean;
  locked: boolean;
}

// --------------------------------------------------------------------------
// Columna
// --------------------------------------------------------------------------

export interface Column {
  id: EntityId;
  floorId: EntityId;
  name: string;
  /** Posicion del centro en el plano XZ. */
  position: Vector2;
  shape: "rect" | "circle";
  width: number;
  depth: number;
  height: number;
  rotationY: number;
  materialId?: EntityId;
  visible: boolean;
  locked: boolean;
}

// --------------------------------------------------------------------------
// Escalera
// --------------------------------------------------------------------------

export const STAIR_KINDS = ["straight", "l-shape", "u-shape", "spiral"] as const;
export type StairKind = (typeof STAIR_KINDS)[number];

export interface Stair {
  id: EntityId;
  floorId: EntityId;
  name: string;
  kind: StairKind;
  position: Vector2;
  rotationY: number;
  /** Altura total a salvar, en metros. */
  totalRise: number;
  width: number;
  steps: number;
  /** Huella (profundidad del escalon). */
  tread: number;
  /** Contrahuella (altura del escalon). Derivada de totalRise/steps. */
  riser: number;
  hasLanding: boolean;
  hasRailing: boolean;
  materialId?: EntityId;
  visible: boolean;
  locked: boolean;
}

// --------------------------------------------------------------------------
// Techo
// --------------------------------------------------------------------------

export const ROOF_KINDS = [
  "flat",
  "shed",
  "gable",
  "hip",
  "mansard",
  "custom",
] as const;
export type RoofKind = (typeof ROOF_KINDS)[number];

export interface Roof {
  id: EntityId;
  floorId: EntityId;
  name: string;
  kind: RoofKind;
  /** Contorno en planta (XZ), en metros. */
  outline: Vector2[];
  /** Desplazamiento en planta respecto al centro del contorno original. */
  position?: Vector2;
  /** Orientacion alrededor del eje vertical, en radianes. */
  rotationY?: number;
  /** Pendiente en grados. */
  slopeDeg: number;
  /** Cota de arranque respecto al nivel. */
  baseHeight: number;
  /** Vuelo del alero. */
  overhang: number;
  thickness: number;
  materialId?: EntityId;
  visible: boolean;
  locked: boolean;
}

// --------------------------------------------------------------------------
// Losa / piso
// --------------------------------------------------------------------------

export interface Slab {
  id: EntityId;
  floorId: EntityId;
  name: string;
  outline: Vector2[];
  thickness: number;
  materialId?: EntityId;
  visible: boolean;
  locked: boolean;
}

// --------------------------------------------------------------------------
// Habitacion (detectada a partir de ciclos cerrados de paredes)
// --------------------------------------------------------------------------

export interface Room {
  id: EntityId;
  floorId: EntityId;
  name: string;
  /** Poligono cerrado en XZ que delimita el area util. */
  polygon: Vector2[];
  /** Paredes que forman el contorno. */
  wallIds: EntityId[];
  /** Area en m2, calculada. */
  area: number;
  /** Perimetro en m, calculado. */
  perimeter: number;
  floorMaterialId?: EntityId;
  ceilingMaterialId?: EntityId;
  color?: HexColor;
}

// --------------------------------------------------------------------------
// Mobiliario
// --------------------------------------------------------------------------

export interface FurnitureInstance {
  id: EntityId;
  floorId: EntityId;
  name: string;
  /** Referencia al catalogo de modelos. */
  catalogId: string;
  position: Vector3;
  rotation: Euler3;
  scale: Vector3;
  materialOverrides?: Record<string, EntityId>;
  visible: boolean;
  locked: boolean;
}

// --------------------------------------------------------------------------
// Modelo 3D importado (GLB/GLTF)
// --------------------------------------------------------------------------

export interface ImportedModel {
  id: EntityId;
  floorId: EntityId;
  name: string;
  /** Identificador del ProjectFile con el modelo GLB/GLTF. */
  fileId: EntityId;
  /** URL de descarga del modelo. */
  url: string;
  position: Vector3;
  rotation: Euler3;
  scale: Vector3;
  visible: boolean;
  locked: boolean;
  source: "import";
}

// --------------------------------------------------------------------------
// Materiales
// --------------------------------------------------------------------------

export const MATERIAL_CATEGORIES = [
  "brick",
  "concrete",
  "wood",
  "glass",
  "metal",
  "ceramic",
  "stone",
  "paint",
  "plaster",
  "marble",
  "roof-tile",
] as const;
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number];

/**
 * Patrones de textura generados por procedimiento en el cliente.
 *
 * Se guarda solo el nombre del patron: la imagen se sintetiza al vuelo, de
 * modo que la escena sigue siendo un documento de texto ligero y no depende
 * de ningun archivo externo ni de una CDN.
 */
export const TEXTURE_PATTERNS = [
  "plain",
  "brick",
  "block",
  "stone",
  "concrete",
  "stucco",
  "wood-planks",
  "wood-parquet",
  "ceramic-tile",
  "marble",
  "roof-shingle",
  "roof-metal",
  "grass",
  "gravel",
  "fabric",
  "brushed-metal",
] as const;
export type TexturePattern = (typeof TEXTURE_PATTERNS)[number];

/** Material PBR serializable. Las texturas se referencian por storageKey. */
export interface MaterialDefinition {
  id: EntityId;
  name: string;
  category: MaterialCategory;
  baseColor: HexColor;
  roughness: number;
  metalness: number;
  opacity: number;
  /** Textura procedural. Ausente o "plain" significa color liso. */
  texture?: TexturePattern;
  /** Intensidad del relieve derivado de la textura, 0 a 1. */
  bump?: number;
  maps?: {
    baseColor?: string;
    normal?: string;
    roughness?: string;
    metalness?: string;
    displacement?: string;
    ao?: string;
  };
  /** Repeticion de textura en metros por tile. */
  tiling?: { x: number; y: number };
  rotationDeg?: number;
  offset?: { x: number; y: number };
  /** true para materiales del catalogo global (no editables por el usuario). */
  builtin?: boolean;
}

// --------------------------------------------------------------------------
// Luces y camaras
// --------------------------------------------------------------------------

export const LIGHT_KINDS = ["sun", "ambient", "point", "spot", "area"] as const;
export type LightKind = (typeof LIGHT_KINDS)[number];

export interface LightEntity {
  id: EntityId;
  floorId?: EntityId;
  name: string;
  kind: LightKind;
  position: Vector3;
  target?: Vector3;
  intensity: number;
  color: HexColor;
  /** Temperatura de color en Kelvin (informativa para el usuario). */
  temperature?: number;
  castShadow: boolean;
  visible: boolean;
  locked: boolean;
}

export interface CameraPreset {
  id: EntityId;
  name: string;
  position: Vector3;
  target: Vector3;
  fov: number;
  mode: "perspective" | "orthographic";
}
