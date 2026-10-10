import type {
  Door,
  Room,
  SceneDocument,
  Vector2,
  Wall,
  WindowEntity,
} from "@archvision/types";
import { createId } from "./ids";
import { DEFAULTS } from "./defaults";
import { polygonArea, polygonPerimeter } from "./geometry2d";
import { createDefaultScene } from "./scene-factory";

/**
 * Casa demo precargada.
 *
 * Sirve para tres cosas: probar la plataforma sin subir nada, validar el
 * motor de geometria con un caso realista y dar contenido a las pruebas.
 * Dos plantas, cerramiento de 10 x 8 m, vanos, cubierta a dos aguas y
 * mobiliario basico.
 */

const FOOTPRINT: Vector2[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 8 },
  { x: 0, y: 8 },
];

const EXTERIOR_THICKNESS = 0.25;
const INTERIOR_THICKNESS = 0.12;
const WALL_HEIGHT = 2.7;
const SLAB_THICKNESS = 0.2;

interface WallSpec {
  start: Vector2;
  end: Vector2;
  name: string;
  exterior: boolean;
}

function makeWall(spec: WallSpec, floorId: string): Wall {
  return {
    id: createId(),
    floorId,
    name: spec.name,
    start: spec.start,
    end: spec.end,
    height: WALL_HEIGHT,
    thickness: spec.exterior ? EXTERIOR_THICKNESS : INTERIOR_THICKNESS,
    baseOffset: 0,
    materialInteriorId: "mat_plaster_white",
    materialExteriorId: spec.exterior ? "mat_brick_red" : "mat_plaster_white",
    visible: true,
    locked: false,
    source: "user",
  };
}

function makeRoom(
  name: string,
  polygon: Vector2[],
  floorId: string,
  wallIds: string[],
  floorMaterialId: string,
): Room {
  return {
    id: createId(),
    floorId,
    name,
    polygon,
    wallIds,
    area: polygonArea(polygon),
    perimeter: polygonPerimeter(polygon),
    floorMaterialId,
    ceilingMaterialId: "mat_plaster_white",
  };
}

function makeWindow(
  wallId: string,
  floorId: string,
  offset: number,
  name: string,
  width: number = DEFAULTS.window.width,
): WindowEntity {
  return {
    id: createId(),
    wallId,
    floorId,
    name,
    kind: "single",
    offset,
    width,
    height: DEFAULTS.window.height,
    sillHeight: DEFAULTS.window.sillHeight,
    frameThickness: DEFAULTS.window.frameThickness,
    materialId: "mat_glass_clear",
    visible: true,
    locked: false,
    source: "user",
  };
}

function makeDoor(
  wallId: string,
  floorId: string,
  offset: number,
  name: string,
): Door {
  return {
    id: createId(),
    wallId,
    floorId,
    name,
    kind: "single",
    offset,
    width: DEFAULTS.door.width,
    height: DEFAULTS.door.height,
    openingDirection: "inward-left",
    materialId: "mat_wood_oak",
    visible: true,
    locked: false,
    source: "user",
  };
}

/** Construye el SceneDocument completo de la casa demo. */
export function createDemoHouseScene(): SceneDocument {
  const scene = createDefaultScene({ floorsCount: 2, floorHeight: WALL_HEIGHT + SLAB_THICKNESS });

  const ground = scene.floors[0];
  const upper = scene.floors[1];
  if (!ground || !upper) return scene;

  ground.name = "Planta baja";
  upper.name = "Segundo piso";

  // --- Cerramiento perimetral, repetido en ambas plantas -------------------
  const perimeterSpecs = (): WallSpec[] => [
    { start: FOOTPRINT[0]!, end: FOOTPRINT[1]!, name: "Fachada sur", exterior: true },
    { start: FOOTPRINT[1]!, end: FOOTPRINT[2]!, name: "Fachada este", exterior: true },
    { start: FOOTPRINT[2]!, end: FOOTPRINT[3]!, name: "Fachada norte", exterior: true },
    { start: FOOTPRINT[3]!, end: FOOTPRINT[0]!, name: "Fachada oeste", exterior: true },
  ];

  const groundWalls = perimeterSpecs().map((spec) => makeWall(spec, ground.id));
  const upperWalls = perimeterSpecs().map((spec) => makeWall(spec, upper.id));

  // --- Tabiqueria de planta baja ------------------------------------------
  const groundPartitions = [
    makeWall(
      { start: { x: 6, y: 0 }, end: { x: 6, y: 5 }, name: "Tabique cocina", exterior: false },
      ground.id,
    ),
    makeWall(
      { start: { x: 0, y: 5 }, end: { x: 10, y: 5 }, name: "Tabique zona noche", exterior: false },
      ground.id,
    ),
  ];

  // --- Tabiqueria de segundo piso -----------------------------------------
  const upperPartitions = [
    makeWall(
      { start: { x: 5, y: 0 }, end: { x: 5, y: 8 }, name: "Tabique dormitorios", exterior: false },
      upper.id,
    ),
    makeWall(
      { start: { x: 5, y: 4 }, end: { x: 10, y: 4 }, name: "Tabique bano", exterior: false },
      upper.id,
    ),
  ];

  scene.walls = [...groundWalls, ...groundPartitions, ...upperWalls, ...upperPartitions];

  const [southG, eastG, northG, westG] = groundWalls;
  const [southU, eastU, northU, westU] = upperWalls;
  if (!southG || !eastG || !northG || !westG) return scene;
  if (!southU || !eastU || !northU || !westU) return scene;

  // --- Vanos ---------------------------------------------------------------
  scene.doors = [
    makeDoor(southG.id, ground.id, 2.0, "Puerta principal"),
    makeDoor(groundPartitions[0]!.id, ground.id, 3.5, "Puerta cocina"),
    makeDoor(groundPartitions[1]!.id, ground.id, 2.5, "Puerta dormitorio"),
    makeDoor(upperPartitions[0]!.id, upper.id, 2.0, "Puerta dormitorio principal"),
    makeDoor(upperPartitions[1]!.id, upper.id, 2.5, "Puerta bano"),
  ];

  scene.windows = [
    makeWindow(southG.id, ground.id, 5.0, "Ventana sala", 1.8),
    makeWindow(southG.id, ground.id, 8.0, "Ventana cocina"),
    makeWindow(eastG.id, ground.id, 2.5, "Ventana comedor"),
    makeWindow(northG.id, ground.id, 3.0, "Ventana dormitorio 1", 1.5),
    makeWindow(westG.id, ground.id, 4.0, "Ventana pasillo"),
    makeWindow(southU.id, upper.id, 2.5, "Ventana dormitorio principal", 1.8),
    makeWindow(southU.id, upper.id, 7.5, "Ventana estudio"),
    makeWindow(northU.id, upper.id, 3.0, "Ventana dormitorio 2", 1.5),
    makeWindow(eastU.id, upper.id, 5.5, "Ventana bano", 0.8),
    makeWindow(westU.id, upper.id, 4.0, "Ventana escalera"),
  ];

  // --- Losas ---------------------------------------------------------------
  scene.slabs = [
    {
      id: createId(),
      floorId: ground.id,
      name: "Losa planta baja",
      outline: FOOTPRINT,
      thickness: SLAB_THICKNESS,
      materialId: "mat_ceramic_floor",
      visible: true,
      locked: false,
    },
    {
      id: createId(),
      floorId: upper.id,
      name: "Losa segundo piso",
      outline: FOOTPRINT,
      thickness: SLAB_THICKNESS,
      materialId: "mat_wood_oak",
      visible: true,
      locked: false,
    },
  ];

  // --- Habitaciones --------------------------------------------------------
  scene.rooms = [
    makeRoom(
      "Sala",
      [
        { x: 0, y: 0 },
        { x: 6, y: 0 },
        { x: 6, y: 5 },
        { x: 0, y: 5 },
      ],
      ground.id,
      [southG.id, westG.id, groundPartitions[0]!.id, groundPartitions[1]!.id],
      "mat_ceramic_floor",
    ),
    makeRoom(
      "Cocina",
      [
        { x: 6, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 },
        { x: 6, y: 5 },
      ],
      ground.id,
      [southG.id, eastG.id, groundPartitions[0]!.id, groundPartitions[1]!.id],
      "mat_ceramic_floor",
    ),
    makeRoom(
      "Dormitorio 1",
      [
        { x: 0, y: 5 },
        { x: 10, y: 5 },
        { x: 10, y: 8 },
        { x: 0, y: 8 },
      ],
      ground.id,
      [northG.id, eastG.id, westG.id, groundPartitions[1]!.id],
      "mat_wood_oak",
    ),
    makeRoom(
      "Dormitorio principal",
      [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 8 },
        { x: 0, y: 8 },
      ],
      upper.id,
      [southU.id, westU.id, northU.id, upperPartitions[0]!.id],
      "mat_wood_oak",
    ),
    makeRoom(
      "Estudio",
      [
        { x: 5, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 4 },
        { x: 5, y: 4 },
      ],
      upper.id,
      [southU.id, eastU.id, upperPartitions[0]!.id, upperPartitions[1]!.id],
      "mat_wood_oak",
    ),
    makeRoom(
      "Bano",
      [
        { x: 5, y: 4 },
        { x: 10, y: 4 },
        { x: 10, y: 8 },
        { x: 5, y: 8 },
      ],
      upper.id,
      [northU.id, eastU.id, upperPartitions[0]!.id, upperPartitions[1]!.id],
      "mat_ceramic_floor",
    ),
  ];

  // --- Escalera ------------------------------------------------------------
  scene.stairs = [
    {
      id: createId(),
      floorId: ground.id,
      name: "Escalera principal",
      kind: "straight",
      position: { x: 0.8, y: 0.6 },
      rotationY: 0,
      totalRise: WALL_HEIGHT + SLAB_THICKNESS,
      width: 0.9,
      steps: 15,
      tread: 0.26,
      riser: (WALL_HEIGHT + SLAB_THICKNESS) / 15,
      hasLanding: false,
      hasRailing: true,
      materialId: "mat_wood_oak",
      visible: true,
      locked: false,
    },
  ];

  // --- Cubierta ------------------------------------------------------------
  scene.roofs = [
    {
      id: createId(),
      floorId: upper.id,
      name: "Cubierta a dos aguas",
      kind: "gable",
      outline: FOOTPRINT,
      slopeDeg: 28,
      baseHeight: WALL_HEIGHT,
      overhang: 0.6,
      thickness: 0.2,
      materialId: "mat_roof_tile",
      visible: true,
      locked: false,
    },
  ];

  // --- Mobiliario ----------------------------------------------------------
  const furnish = (
    catalogId: string,
    name: string,
    floorId: string,
    x: number,
    z: number,
    rotationY = 0,
  ) => ({
    id: createId(),
    floorId,
    name,
    catalogId,
    position: { x, y: 0, z },
    rotation: { x: 0, y: rotationY, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    locked: false,
  });

  scene.furniture = [
    furnish("sofa-3-seat", "Sofa 3 puestos", ground.id, 2.4, 1.4),
    furnish("coffee-table", "Mesa de centro", ground.id, 2.4, 2.6),
    furnish("dining-table-6", "Comedor 6 puestos", ground.id, 4.6, 3.8, Math.PI / 2),
    furnish("kitchen-counter", "Meson de cocina", ground.id, 8.4, 1.2),
    furnish("bed-double", "Cama doble", ground.id, 5.0, 6.6),
    furnish("bed-queen", "Cama queen", upper.id, 2.4, 2.0),
    furnish("wardrobe", "Closet", upper.id, 0.6, 6.0),
    furnish("desk", "Escritorio", upper.id, 7.5, 1.2, Math.PI),
  ];

  // --- Camaras guardadas ---------------------------------------------------
  scene.cameras = [
    {
      id: createId(),
      name: "Fachada",
      position: { x: 5, y: 3.5, z: -12 },
      target: { x: 5, y: 1.5, z: 4 },
      fov: 50,
      mode: "perspective",
    },
    {
      id: createId(),
      name: "Vista aerea",
      position: { x: 16, y: 16, z: -14 },
      target: { x: 5, y: 0, z: 4 },
      fov: 45,
      mode: "perspective",
    },
  ];

  scene.environment.sky = "clear";
  scene.activeFloorId = ground.id;

  return scene;
}
