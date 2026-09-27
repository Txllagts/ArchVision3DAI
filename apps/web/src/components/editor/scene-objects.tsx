"use client";

import { useMemo } from "react";
import { Edges } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { DoubleSide } from "three";
import {
  collectWallOpenings,
  columnGeometryKey,
  createColumnGeometry,
  createDoorLeafGeometry,
  createFrameGeometry,
  createGlassGeometry,
  createFloorGeometry,
  createRoofGeometry,
  createSlabGeometry,
  createStairGeometry,
  createWallGeometry,
  doorPlacement,
  geometryCache,
  roofGeometryKey,
  slabGeometryKey,
  stairGeometryKey,
  wallGeometryKey,
  wallTransform,
  windowPlacement,
} from "@archvision/geometry";
import { materialLibrary } from "@archvision/three-engine";
import {
  FURNITURE_FALLBACK,
  furnitureById,
  roofOutlineCenter,
} from "@archvision/shared";
import type {
  Column,
  Door,
  FurnitureInstance,
  Roof,
  Room,
  SceneDocument,
  Slab,
  Stair,
  Wall,
  WindowEntity,
} from "@archvision/types";

/**
 * Representacion visual de las entidades arquitectonicas.
 *
 * Cada componente deriva su geometria de los parametros de la entidad y la
 * memoiza en la cache compartida: mover la camara, seleccionar o cambiar un
 * material no reconstruye ninguna malla.
 */

const SELECTION_COLOR = "#22d3ee";
const HOVER_COLOR = "#7dd3fc";

interface PickHandlers {
  onPick: (id: string, additive: boolean) => void;
  onDragStart: (id: string, event: ThreeEvent<PointerEvent>) => void;
  onHover: (id: string | null) => void;
}

function pickProps(id: string, handlers: PickHandlers) {
  return {
    // El identificador viaja tambien en la malla porque soltar un material
    // desde la biblioteca es un evento de arrastre del DOM, ajeno al sistema
    // de eventos de React Three Fiber: alli hay que lanzar el rayo a mano y
    // deducir a que entidad pertenece el objeto tocado.
    userData: { entityId: id },
    onPointerDown: (event: ThreeEvent<PointerEvent>) => {
      if (event.nativeEvent.button !== 0) return;
      event.stopPropagation();
      handlers.onPick(id, event.nativeEvent.shiftKey);
      handlers.onDragStart(id, event);
    },
    onPointerOver: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      handlers.onHover(id);
    },
    onPointerOut: () => handlers.onHover(null),
  };
}

function Highlight({ selected, hovered }: { selected: boolean; hovered: boolean }) {
  if (!selected && !hovered) return null;
  return (
    <Edges
      scale={1.002}
      threshold={20}
      color={selected ? SELECTION_COLOR : HOVER_COLOR}
    />
  );
}

// --------------------------------------------------------------------------
// Pared con sus vanos
// --------------------------------------------------------------------------

export function WallObject({
  wall,
  scene,
  elevation,
  selection,
  hoveredId,
  handlers,
}: {
  wall: Wall;
  scene: SceneDocument;
  elevation: number;
  selection: Set<string>;
  hoveredId: string | null;
  handlers: PickHandlers;
}) {
  const openings = useMemo(
    () => collectWallOpenings(wall.id, scene.doors, scene.windows, scene.openings),
    [wall.id, scene.doors, scene.windows, scene.openings],
  );

  const geometry = useMemo(
    () =>
      geometryCache.get(wallGeometryKey(wall, openings), () =>
        createWallGeometry(wall, openings),
      ),
    [wall, openings],
  );

  const transform = wallTransform(wall, elevation);
  const material = materialLibrary.resolveById(
    wall.materialExteriorId ?? wall.materialInteriorId,
    scene.materials,
  );

  const doors = scene.doors.filter((door) => door.wallId === wall.id);
  const windows = scene.windows.filter((window) => window.wallId === wall.id);
  const genericOpenings = scene.openings.filter((opening) => opening.wallId === wall.id);

  if (!wall.visible) return null;

  return (
    <group position={transform.position} rotation={[0, transform.rotationY, 0]}>
      <mesh
        geometry={geometry}
        material={material}
        castShadow
        receiveShadow
        {...pickProps(wall.id, handlers)}
      >
        <Highlight
          selected={selection.has(wall.id)}
          hovered={hoveredId === wall.id}
        />
      </mesh>

      {doors.map((door) => (
        <DoorObject
          key={door.id}
          door={door}
          wall={wall}
          scene={scene}
          selection={selection}
          hoveredId={hoveredId}
          handlers={handlers}
        />
      ))}

      {windows.map((window) => (
        <WindowObject
          key={window.id}
          window={window}
          wall={wall}
          scene={scene}
          selection={selection}
          hoveredId={hoveredId}
          handlers={handlers}
        />
      ))}

      {genericOpenings.map((opening) => (
        <mesh
          key={opening.id}
          position={[opening.offset, opening.sillHeight + opening.height / 2, 0]}
          {...pickProps(opening.id, handlers)}
        >
          <boxGeometry args={[opening.width, opening.height, wall.thickness]} />
          <meshBasicMaterial transparent opacity={0} colorWrite={false} depthWrite={false} />
          <Highlight
            selected={selection.has(opening.id)}
            hovered={hoveredId === opening.id}
          />
        </mesh>
      ))}
    </group>
  );
}

function DoorObject({
  door,
  wall,
  scene,
  selection,
  hoveredId,
  handlers,
}: {
  door: Door;
  wall: Wall;
  scene: SceneDocument;
  selection: Set<string>;
  hoveredId: string | null;
  handlers: PickHandlers;
}) {
  const placement = doorPlacement(door);
  const frame = useMemo(
    () =>
      geometryCache.get(
        `door-frame:${door.id}:${door.width}:${door.height}:${wall.thickness}`,
        () => createFrameGeometry(door.width, door.height, wall.thickness, 0.06),
      ),
    [door.id, door.width, door.height, wall.thickness],
  );
  const leaf = useMemo(
    () =>
      geometryCache.get(`door-leaf:${door.id}:${door.width}:${door.height}`, () =>
        createDoorLeafGeometry(door.width, door.height),
      ),
    [door.id, door.width, door.height],
  );

  if (!door.visible) return null;

  const frameMaterial = materialLibrary.resolveById(door.materialId, scene.materials);
  const leafMaterial = materialLibrary.resolveById(
    door.kind === "glass" ? "mat_glass_clear" : door.materialId,
    scene.materials,
  );

  return (
    <group position={placement.position} {...pickProps(door.id, handlers)}>
      <mesh geometry={frame} material={frameMaterial} castShadow>
        <Highlight
          selected={selection.has(door.id)}
          hovered={hoveredId === door.id}
        />
      </mesh>
      <mesh geometry={leaf} material={leafMaterial} position={[0, -0.02, 0]} castShadow />
    </group>
  );
}

function WindowObject({
  window,
  wall,
  scene,
  selection,
  hoveredId,
  handlers,
}: {
  window: WindowEntity;
  wall: Wall;
  scene: SceneDocument;
  selection: Set<string>;
  hoveredId: string | null;
  handlers: PickHandlers;
}) {
  const placement = windowPlacement(window);
  const frame = useMemo(
    () =>
      geometryCache.get(
        `win-frame:${window.id}:${window.width}:${window.height}:${wall.thickness}`,
        () =>
          createFrameGeometry(
            window.width,
            window.height,
            wall.thickness,
            window.frameThickness || 0.05,
          ),
      ),
    [window.id, window.width, window.height, window.frameThickness, wall.thickness],
  );
  const glass = useMemo(
    () =>
      geometryCache.get(`win-glass:${window.id}:${window.width}:${window.height}`, () =>
        createGlassGeometry(window.width, window.height, window.frameThickness || 0.05),
      ),
    [window.id, window.width, window.height, window.frameThickness],
  );

  if (!window.visible) return null;

  const frameMaterial = materialLibrary.resolveById("mat_plaster_white", scene.materials);
  const glassMaterial = materialLibrary.resolveById(
    window.materialId ?? "mat_glass_clear",
    scene.materials,
  );

  return (
    <group position={placement.position} {...pickProps(window.id, handlers)}>
      <mesh geometry={frame} material={frameMaterial} castShadow>
        <Highlight
          selected={selection.has(window.id)}
          hovered={hoveredId === window.id}
        />
      </mesh>
      <mesh geometry={glass} material={glassMaterial} />
    </group>
  );
}

// --------------------------------------------------------------------------
// Losas, cubiertas, escaleras, columnas y mobiliario
// --------------------------------------------------------------------------

export function SlabObject({
  slab,
  scene,
  elevation,
  selection,
  hoveredId,
  handlers,
}: {
  slab: Slab;
  scene: SceneDocument;
  elevation: number;
  selection: Set<string>;
  hoveredId: string | null;
  handlers: PickHandlers;
}) {
  const geometry = useMemo(
    () => geometryCache.get(slabGeometryKey(slab), () => createSlabGeometry(slab)),
    [slab],
  );

  if (!slab.visible) return null;

  return (
    <mesh
      geometry={geometry}
      material={materialLibrary.resolveById(slab.materialId, scene.materials)}
      position={[0, elevation - slab.thickness, 0]}
      receiveShadow
      {...pickProps(slab.id, handlers)}
    >
      <Highlight selected={selection.has(slab.id)} hovered={hoveredId === slab.id} />
    </mesh>
  );
}

// --------------------------------------------------------------------------
// Suelo de habitacion
// --------------------------------------------------------------------------

/**
 * Malla plana que representa el suelo de una habitacion detectada.
 *
 * Es una capa fina (2 mm) encima del nivel del piso para que sea visible
 * sin competir con la losa estructural. Permite recibir materiales tanto
 * por drag-drop como con el pincel en el visor 3D.
 */
export function RoomFloorObject({
  room,
  scene,
  elevation,
  selection,
  hoveredId,
  handlers,
}: {
  room: Room;
  scene: SceneDocument;
  elevation: number;
  selection: Set<string>;
  hoveredId: string | null;
  handlers: PickHandlers;
}) {
  const FLOOR_THICKNESS = 0.002;
  const polygonKey = room.polygon
    .map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)
    .join(";");

  const geometry = useMemo(
    () =>
      geometryCache.get(
        `room-floor:${room.id}:${polygonKey}`,
        () => createFloorGeometry(room.polygon, FLOOR_THICKNESS),
      ),
    // El poligono cambia cuando se rehacen las habitaciones
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room.id, polygonKey],
  );

  const material = materialLibrary.resolveById(room.floorMaterialId, scene.materials);
  const isSelected = selection.has(room.id);
  const isHovered = hoveredId === room.id;

  // Si no hay material asignado, se muestra transparente (invisible a la vista)
  // para mantener la malla en el grafo de Three.js y permitir que el raycaster
  // la detecte al arrastrar y soltar materiales (drag & drop) o usar el pincel.
  return (
    <mesh
      geometry={geometry}
      material={room.floorMaterialId ? material : undefined}
      position={[0, elevation + 0.001, 0]}
      receiveShadow
      {...pickProps(room.id, handlers)}
    >
      {!room.floorMaterialId ? (
        <meshStandardMaterial
          color={isSelected ? "#22d3ee" : isHovered ? "#7dd3fc" : "#000000"}
          transparent
          opacity={isSelected ? 0.25 : isHovered ? 0.15 : 0}
          depthWrite={false}
          roughness={1}
          metalness={0}
        />
      ) : null}
      <Highlight selected={isSelected} hovered={isHovered} />
    </mesh>
  );
}

export function RoofObject({
  roof,
  scene,
  elevation,
  selection,
  hoveredId,
  handlers,
}: {
  roof: Roof;
  scene: SceneDocument;
  elevation: number;
  selection: Set<string>;
  hoveredId: string | null;
  handlers: PickHandlers;
}) {
  const geometry = useMemo(
    () => geometryCache.get(roofGeometryKey(roof), () => createRoofGeometry(roof)),
    [roof],
  );

  if (!roof.visible) return null;

  const center = roofOutlineCenter(roof);
  const position: [number, number, number] = [
    center.x + (roof.position?.x ?? 0),
    elevation + roof.baseHeight,
    center.y + (roof.position?.y ?? 0),
  ];
  const rotation: [number, number, number] = [0, roof.rotationY ?? 0, 0];

  return (
    <>
      <mesh
        geometry={geometry}
        material={materialLibrary.resolveById(roof.materialId, scene.materials)}
        position={position}
        rotation={rotation}
        castShadow
        receiveShadow
        {...pickProps(roof.id, handlers)}
      >
        <Highlight selected={selection.has(roof.id)} hovered={hoveredId === roof.id} />
      </mesh>
      <mesh
        geometry={geometry}
        position={position}
        rotation={rotation}
        {...pickProps(roof.id, handlers)}
      >
        <meshBasicMaterial
          side={DoubleSide}
          transparent
          opacity={0}
          colorWrite={false}
          depthWrite={false}
        />
      </mesh>
    </>
  );
}

export function StairObject({
  stair,
  scene,
  elevation,
  selection,
  hoveredId,
  handlers,
}: {
  stair: Stair;
  scene: SceneDocument;
  elevation: number;
  selection: Set<string>;
  hoveredId: string | null;
  handlers: PickHandlers;
}) {
  const geometry = useMemo(
    () => geometryCache.get(stairGeometryKey(stair), () => createStairGeometry(stair)),
    [stair],
  );

  if (!stair.visible) return null;

  return (
    <mesh
      geometry={geometry}
      material={materialLibrary.resolveById(stair.materialId, scene.materials)}
      position={[stair.position.x, elevation, stair.position.y]}
      rotation={[0, stair.rotationY, 0]}
      castShadow
      receiveShadow
      {...pickProps(stair.id, handlers)}
    >
      <Highlight selected={selection.has(stair.id)} hovered={hoveredId === stair.id} />
    </mesh>
  );
}

export function ColumnObject({
  column,
  scene,
  elevation,
  selection,
  hoveredId,
  handlers,
}: {
  column: Column;
  scene: SceneDocument;
  elevation: number;
  selection: Set<string>;
  hoveredId: string | null;
  handlers: PickHandlers;
}) {
  const geometry = useMemo(
    () =>
      geometryCache.get(columnGeometryKey(column), () => createColumnGeometry(column)),
    [column],
  );

  if (!column.visible) return null;

  return (
    <mesh
      geometry={geometry}
      material={materialLibrary.resolveById(column.materialId, scene.materials)}
      position={[column.position.x, elevation, column.position.y]}
      rotation={[0, column.rotationY, 0]}
      castShadow
      receiveShadow
      {...pickProps(column.id, handlers)}
    >
      <Highlight
        selected={selection.has(column.id)}
        hovered={hoveredId === column.id}
      />
    </mesh>
  );
}

/**
 * Mobiliario.
 *
 * Hasta que existan modelos GLB (fase 4) se representa con la caja de las
 * dimensiones reales del catalogo, suficiente para estudiar la distribucion.
 */
export function FurnitureObject({
  item,
  elevation,
  selection,
  hoveredId,
  handlers,
}: {
  item: FurnitureInstance;
  elevation: number;
  selection: Set<string>;
  hoveredId: string | null;
  handlers: PickHandlers;
}) {
  const catalog = furnitureById(item.catalogId) ?? FURNITURE_FALLBACK;

  if (!item.visible) return null;

  return (
    <mesh
      position={[
        item.position.x,
        elevation + item.position.y + (catalog.size.y * item.scale.y) / 2,
        item.position.z,
      ]}
      rotation={[item.rotation.x, item.rotation.y, item.rotation.z]}
      castShadow
      receiveShadow
      {...pickProps(item.id, handlers)}
    >
      <boxGeometry
        args={[
          catalog.size.x * item.scale.x,
          catalog.size.y * item.scale.y,
          catalog.size.z * item.scale.z,
        ]}
      />
      <meshStandardMaterial color={catalog.color} roughness={0.7} metalness={0.05} />
      <Highlight selected={selection.has(item.id)} hovered={hoveredId === item.id} />
    </mesh>
  );
}
