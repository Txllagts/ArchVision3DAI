import type { EntityId, Vector2, Vector3 } from "./primitives";
import type { PlanUnderlay } from "./scene";
import type {
  DoorKind,
  MaterialDefinition,
  RoofKind,
  StairKind,
  WindowKind,
} from "./entities";

/**
 * Modelo de acciones del editor.
 *
 * TODA mutacion de la escena pasa por un comando. Ventajas:
 *  - undo/redo uniforme;
 *  - validacion Zod en un unico punto;
 *  - el asistente de IA produce comandos, nunca escribe en la base de datos.
 */

export interface CommandBase {
  /** Identificador del comando emitido (trazabilidad y deduplicacion). */
  id?: string;
  /** Quien lo origino. */
  origin?: "user" | "ai" | "import" | "system";
}

export interface CreateWallCommand extends CommandBase {
  type: "CREATE_WALL";
  floorId: EntityId;
  start: Vector2;
  end: Vector2;
  height?: number;
  thickness?: number;
}

export interface UpdateWallCommand extends CommandBase {
  type: "UPDATE_WALL";
  wallId: EntityId;
  patch: Partial<{
    start: Vector2;
    end: Vector2;
    height: number;
    thickness: number;
    materialInteriorId: EntityId;
    materialExteriorId: EntityId;
    name: string;
  }>;
}

export interface CreateDoorCommand extends CommandBase {
  type: "CREATE_DOOR";
  wallId: EntityId;
  offset: number;
  width?: number;
  height?: number;
  kind?: DoorKind;
}

export interface CreateWindowCommand extends CommandBase {
  type: "CREATE_WINDOW";
  wallId: EntityId;
  offset: number;
  width?: number;
  height?: number;
  sillHeight?: number;
  kind?: WindowKind;
}

export interface UpdateOpeningCommand extends CommandBase {
  type: "UPDATE_OPENING";
  openingId: EntityId;
  kindOf: "door" | "window" | "opening";
  patch: Partial<{
    offset: number;
    width: number;
    height: number;
    sillHeight: number;
    wallId: EntityId;
  }>;
}

export interface CreateFloorCommand extends CommandBase {
  type: "CREATE_FLOOR";
  name?: string;
  height?: number;
}

export interface CreateRoofCommand extends CommandBase {
  type: "CREATE_ROOF";
  floorId: EntityId;
  kind: RoofKind;
  slopeDeg?: number;
  overhang?: number;
}

export interface UpdateRoofCommand extends CommandBase {
  type: "UPDATE_ROOF";
  roofId: EntityId;
  patch: Partial<{
    kind: RoofKind;
    slopeDeg: number;
    overhang: number;
    thickness: number;
    baseHeight: number;
  }>;
}

export interface CreateColumnCommand extends CommandBase {
  type: "CREATE_COLUMN";
  floorId: EntityId;
  position: Vector2;
  shape?: "rect" | "circle";
  width?: number;
  depth?: number;
  height?: number;
}

export interface CreateStairCommand extends CommandBase {
  type: "CREATE_STAIR";
  floorId: EntityId;
  kind: StairKind;
  position: Vector2;
  totalRise?: number;
  width?: number;
}

export interface AddFurnitureCommand extends CommandBase {
  type: "ADD_FURNITURE";
  floorId: EntityId;
  catalogId: string;
  position: Vector3;
  rotationY?: number;
}

export interface CreateImportedModelCommand extends CommandBase {
  type: "CREATE_IMPORTED_MODEL";
  floorId: EntityId;
  fileId: EntityId;
  name: string;
  url: string;
  position?: Vector3;
  rotation?: Vector3;
  scale?: Vector3;
}

export interface UpdateImportedModelCommand extends CommandBase {
  type: "UPDATE_IMPORTED_MODEL";
  modelId: EntityId;
  patch: Partial<{
    position: Vector3;
    rotation: Vector3;
    scale: Vector3;
    name: string;
    visible: boolean;
    locked: boolean;
  }>;
}

export interface AssignMaterialCommand extends CommandBase {
  type: "ASSIGN_MATERIAL";
  targetIds: EntityId[];
  materialId: EntityId;
  /** Cara afectada en paredes; en habitaciones distingue suelo de techo. */
  face?: "interior" | "exterior" | "both" | "floor" | "ceiling";
}

/**
 * Alta de un material propio del proyecto.
 *
 * Los materiales del catalogo llegan con la escena; este comando cubre los que
 * crea el usuario a partir de uno existente o desde cero.
 */
export interface CreateMaterialCommand extends CommandBase {
  type: "CREATE_MATERIAL";
  material: Omit<MaterialDefinition, "id" | "builtin"> & { id?: EntityId };
}

export interface UpdateMaterialCommand extends CommandBase {
  type: "UPDATE_MATERIAL";
  materialId: EntityId;
  patch: Partial<
    Pick<
      MaterialDefinition,
      | "name"
      | "category"
      | "baseColor"
      | "roughness"
      | "metalness"
      | "opacity"
      | "texture"
      | "bump"
      | "tiling"
      | "rotationDeg"
      | "offset"
    >
  >;
}

export interface DeleteMaterialCommand extends CommandBase {
  type: "DELETE_MATERIAL";
  materialId: EntityId;
}

/**
 * Coloca, ajusta o quita el plano de referencia.
 *
 * Un solo comando para las tres cosas: el plano es uno por escena, y pasar por
 * el reductor hace que colocarlo entre en el historial de deshacer como
 * cualquier otro cambio.
 */
export interface SetUnderlayCommand extends CommandBase {
  type: "SET_UNDERLAY";
  /** `null` retira el plano. */
  underlay: PlanUnderlay | null;
}

export interface TransformObjectsCommand extends CommandBase {
  type: "TRANSFORM_OBJECTS";
  ids: EntityId[];
  translate?: Vector3;
  rotateY?: number;
  scale?: Vector3;
}

export interface DeleteObjectsCommand extends CommandBase {
  type: "DELETE_OBJECTS";
  ids: EntityId[];
}

export interface SetVisibilityCommand extends CommandBase {
  type: "SET_VISIBILITY";
  ids: EntityId[];
  visible: boolean;
}

export interface SetLockCommand extends CommandBase {
  type: "SET_LOCK";
  ids: EntityId[];
  locked: boolean;
}

export interface RenameObjectCommand extends CommandBase {
  type: "RENAME_OBJECT";
  id: EntityId;
  name: string;
}

export type SceneCommand =
  | CreateWallCommand
  | UpdateWallCommand
  | CreateDoorCommand
  | CreateWindowCommand
  | UpdateOpeningCommand
  | CreateFloorCommand
  | CreateRoofCommand
  | UpdateRoofCommand
  | CreateColumnCommand
  | CreateStairCommand
  | AddFurnitureCommand
  | CreateImportedModelCommand
  | UpdateImportedModelCommand
  | AssignMaterialCommand
  | CreateMaterialCommand
  | UpdateMaterialCommand
  | DeleteMaterialCommand
  | SetUnderlayCommand
  | TransformObjectsCommand
  | DeleteObjectsCommand
  | SetVisibilityCommand
  | SetLockCommand
  | RenameObjectCommand;

export type SceneCommandType = SceneCommand["type"];
