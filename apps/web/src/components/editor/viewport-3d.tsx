"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Grid, Html, OrbitControls } from "@react-three/drei";
import { RotateCw } from "lucide-react";
import {
  computeSceneBounds,
  environmentPreset,
  fitPose,
  findWallAt,
  poseForView,
  snapPoint,
  type CameraPose,
} from "@archvision/three-engine";
import { Camera, Mesh, MOUSE, Object3D, Vector2 as ThreeVector2 } from "three";
import {
  Box3,
  Frustum,
  Matrix4,
  Plane,
  Raycaster,
  Vector3 as ThreeVector3,
} from "three";
import type { Floor, ImportedModel, SceneDocument, Vector2 } from "@archvision/types";
import {
  getSelectionPivot,
  getSelectableBounds,
  getTransformTargetIds,
  type SelectableEntities,
  type SelectableEntityKind,
} from "@archvision/shared";
import { useEditorStore, type ToolId } from "@/lib/editor/store";
import { setActiveViewport } from "@/lib/3d/active-scene";
import { readRotationStepDegrees } from "@/lib/editor/rotation-preference";
import {
  ColumnObject,
  FurnitureObject,
  ImportedModelObject,
  RoofObject,
  RoomFloorObject,
  SlabObject,
  StairObject,
  WallObject,
} from "./scene-objects";

/**
 * Visor 3D.
 *
 * El lienzo solo dibuja: toda interaccion se traduce en comandos que van al
 * store. El plano de trabajo del nivel activo hace de superficie de trabajo
 * para dibujar paredes, colocar vanos y situar mobiliario.
 */

/**
 * Contrato minimo de los controles de orbita.
 * Se declara de forma estructural para no depender de los tipos internos de
 * los addons de Three.js.
 */
interface OrbitControlsLike {
  target: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void };
  update: () => void;
}

function CameraRig({ bounds }: { bounds: ReturnType<typeof computeSceneBounds> }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as OrbitControlsLike | null;
  const pendingView = useEditorStore((state) => state.pendingView);
  const requestView = useEditorStore((state) => state.requestView);

  // La escena llega despues del primer render (el documento se carga en un
  // efecto del contenedor, y los efectos de los hijos corren antes que los del
  // padre). Por eso se encuadra al montar y otra vez en cuanto aparece la
  // primera geometria: de lo contrario la camara quedaria apuntando al plano
  // de trabajo vacio.
  const hasGeometry = useEditorStore(
    (state) =>
      state.scene.walls.length +
        state.scene.slabs.length +
        state.scene.roofs.length +
        state.scene.importedModels.length >
      0,
  );

  const framed = useRef(false);

  // El encuadre inicial se aplica dentro del bucle de render: es el unico
  // punto donde la camara activa y los controles existen con seguridad,
  // independientemente del orden en que monten los componentes.
  useFrame(({ camera: activeCamera, controls: activeControls }) => {
    if (framed.current || !hasGeometry) return;
    framed.current = true;

    const pose = poseForView("perspective", bounds);
    activeCamera.position.set(pose.position.x, pose.position.y, pose.position.z);
    activeCamera.lookAt(pose.target.x, pose.target.y, pose.target.z);

    const orbit = activeControls as OrbitControlsLike | null;
    if (orbit) {
      orbit.target.set(pose.target.x, pose.target.y, pose.target.z);
      orbit.update();
    }
  });

  useEffect(() => {
    if (!pendingView) return;

    const current: CameraPose = {
      position: {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      },
      target: controls
        ? { x: controls.target.x, y: controls.target.y, z: controls.target.z }
        : bounds.center,
      orthographic: false,
    };

    const pose =
      pendingView === "fit" ? fitPose(bounds, current) : poseForView(pendingView, bounds);

    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);

    if (controls) {
      controls.target.set(pose.target.x, pose.target.y, pose.target.z);
      controls.update();
    }

    requestView(null);
  }, [pendingView, camera, controls, bounds, requestView]);

  return null;
}

/**
 * Resuelve el material soltado sobre el visor.
 *
 * El arrastre nativo del navegador no pasa por el sistema de eventos de React
 * Three Fiber, asi que el punto de caida llega por el estado y aqui se lanza
 * un rayo para averiguar sobre que entidad cayo.
 */
function MaterialDropTarget() {
  const { camera, gl, raycaster, scene: threeScene } = useThree();
  const pendingDrop = useEditorStore((state) => state.pendingDrop);
  const requestDrop = useEditorStore((state) => state.requestDrop);

  useEffect(() => {
    if (!pendingDrop) return;

    const rect = gl.domElement.getBoundingClientRect();
    const pointer = new ThreeVector2(
      ((pendingDrop.clientX - rect.left) / rect.width) * 2 - 1,
      -((pendingDrop.clientY - rect.top) / rect.height) * 2 + 1,
    );

    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(threeScene.children, true);

    // El primer impacto puede ser una arista de seleccion o el plano de
    // trabajo; se busca el primero que pertenezca a una entidad real.
    let entityId: string | undefined;
    for (const hit of hits) {
      let node: Object3D | null = hit.object;
      while (node && !entityId) {
        const candidate = node.userData?.entityId;
        if (typeof candidate === "string") entityId = candidate;
        node = node.parent;
      }
      if (entityId) break;
    }

    const store = useEditorStore.getState();
    if (entityId) {
      store.dispatch({
        type: "ASSIGN_MATERIAL",
        targetIds: [entityId],
        materialId: pendingDrop.materialId,
      });
    } else {
      store.setMessage({
        kind: "error",
        text: "Suelta el material sobre una superficie del modelo",
      });
    }

    requestDrop(null);
  }, [pendingDrop, camera, gl, raycaster, threeScene, requestDrop]);

  return null;
}

/**
 * Publica el visor (escena, camara y renderer) fuera de React: el modulo de
 * exportacion clona la escena para los formatos de malla y lee el canvas
 * para la captura PNG; no hay otra forma de alcanzarlo desde el store.
 */
function ActiveSceneHandle() {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    setActiveViewport({ scene, camera, gl });
    return () => setActiveViewport(null);
  }, [scene, camera, gl]);

  return null;
}

function SceneLights({ scene }: { scene: SceneDocument }) {
  const preset = environmentPreset(scene.environment);
  const [dx, dy, dz] = preset.sunDirection;
  const distance = 40;

  return (
    <>
      <hemisphereLight
        args={[preset.skyColor, preset.groundColor, preset.ambientIntensity]}
      />
      <directionalLight
        position={[dx * distance, dy * distance, dz * distance]}
        intensity={preset.sunIntensity}
        color={preset.sunColor}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
        shadow-camera-far={160}
      />
      <color attach="background" args={[preset.skyColor]} />
    </>
  );
}

interface WorkPlaneProps {
  elevation: number;
  tool: ToolId;
  onPoint: (point: Vector2, event: ThreeEvent<PointerEvent>) => void;
  onMove: (point: Vector2) => void;
  onMarqueeStart: (point: Vector2) => void;
  onMarqueeMove: (point: Vector2) => void;
  onMarqueeEnd: (point: Vector2, additive: boolean) => void;
}

/** Plano de trabajo invisible: convierte el puntero en coordenadas de planta. */
function WorkPlane({
  elevation,
  tool,
  onPoint,
  onMove,
  onMarqueeStart,
  onMarqueeMove,
  onMarqueeEnd,
}: WorkPlaneProps) {
  const planeRef = useRef<Mesh>(null);
  const controls = useThree((state) => state.controls) as OrbitControlsLike | null;

  useFrame(({ camera }) => {
    const plane = planeRef.current;
    if (!plane) return;
    const target = controls?.target ?? camera.position;
    plane.position.set(target.x, elevation, target.z);
  });

  return (
    <mesh
      ref={planeRef}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
      onPointerMove={(event) => {
        onMove({ x: event.point.x, y: event.point.z });
        onMarqueeMove({ x: event.nativeEvent.clientX, y: event.nativeEvent.clientY });
      }}
      onPointerUp={(event) => {
        onMarqueeEnd(
          { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY },
          event.nativeEvent.shiftKey,
        );
      }}
      onPointerDown={(event) => {
        if (tool === "pan") return;
        if (tool === "select" && event.nativeEvent.button !== 0) return;
        event.stopPropagation();
        if (tool === "select") {
          const target = event.target as unknown as {
            setPointerCapture: (pointerId: number) => void;
          };
          target.setPointerCapture(event.pointerId);
          onMarqueeStart({ x: event.nativeEvent.clientX, y: event.nativeEvent.clientY });
          return;
        }
        // El pincel sobre el vacio no hace nada.
        if (tool === "paint") {
          return;
        }
        onPoint({ x: event.point.x, y: event.point.z }, event);
      }}
    >
      <planeGeometry args={[100_000, 100_000]} />
      <meshStandardMaterial color="#20242c" roughness={1} metalness={0} />
    </mesh>
  );
}

function FloorContent({
  floor,
  scene,
  selection,
  hoveredId,
  handlers,
  transformPreview,
}: {
  floor: Floor;
  scene: SceneDocument;
  selection: Set<string>;
  hoveredId: string | null;
  handlers: {
    onPick: (id: string, additive: boolean) => void;
    onDragStart: (id: string, event: ThreeEvent<PointerEvent>) => void;
    onHover: (id: string | null) => void;
  };
  transformPreview: TransformPreview | null;
}) {
  if (!floor.visible) return null;

  return (
    <group>
      {scene.rooms
        .filter((room) => room.floorId === floor.id)
        .map((room) => (
          <RoomFloorObject
            key={room.id}
            room={room}
            scene={scene}
            elevation={floor.elevation}
            selection={selection}
            hoveredId={hoveredId}
            handlers={handlers}
          />
        ))}

      {scene.slabs
        .filter((slab) => slab.floorId === floor.id)
        .map((slab) => (
          <PreviewTransform key={slab.id} id={slab.id} preview={transformPreview}>
            <SlabObject
              slab={slab}
              scene={scene}
              elevation={floor.elevation}
              selection={selection}
              hoveredId={hoveredId}
              handlers={handlers}
            />
          </PreviewTransform>
        ))}

      {scene.walls
        .filter((wall) => wall.floorId === floor.id)
        .map((wall) => (
          <PreviewTransform key={wall.id} id={wall.id} preview={transformPreview}>
            <WallObject
              wall={wall}
              scene={scene}
              elevation={floor.elevation}
              selection={selection}
              hoveredId={hoveredId}
              handlers={handlers}
            />
          </PreviewTransform>
        ))}

      {scene.columns
        .filter((column) => column.floorId === floor.id)
        .map((column) => (
          <PreviewTransform key={column.id} id={column.id} preview={transformPreview}>
            <ColumnObject
              column={column}
              scene={scene}
              elevation={floor.elevation}
              selection={selection}
              hoveredId={hoveredId}
              handlers={handlers}
            />
          </PreviewTransform>
        ))}

      {scene.stairs
        .filter((stair) => stair.floorId === floor.id)
        .map((stair) => (
          <PreviewTransform key={stair.id} id={stair.id} preview={transformPreview}>
            <StairObject
              stair={stair}
              scene={scene}
              elevation={floor.elevation}
              selection={selection}
              hoveredId={hoveredId}
              handlers={handlers}
            />
          </PreviewTransform>
        ))}

      {scene.roofs
        .filter((roof) => roof.floorId === floor.id)
        .map((roof) => (
          <PreviewTransform key={roof.id} id={roof.id} preview={transformPreview}>
            <RoofObject
              roof={roof}
              scene={scene}
              elevation={floor.elevation}
              selection={selection}
              hoveredId={hoveredId}
              handlers={handlers}
            />
          </PreviewTransform>
        ))}

      {scene.furniture
        .filter((item) => item.floorId === floor.id)
        .map((item) => (
          <PreviewTransform key={item.id} id={item.id} preview={transformPreview}>
            <FurnitureObject
              item={item}
              elevation={floor.elevation}
              selection={selection}
              hoveredId={hoveredId}
              handlers={handlers}
            />
          </PreviewTransform>
        ))}

      {scene.importedModels
        .filter((model) => model.floorId === floor.id)
        .map((model) => (
          <PreviewTransform key={model.id} id={model.id} preview={transformPreview}>
            <ImportedModelObject
              model={model}
              elevation={floor.elevation}
              selection={selection}
              hoveredId={hoveredId}
              handlers={handlers}
            />
          </PreviewTransform>
        ))}
    </group>
  );
}

/** Pared en construccion: previsualizacion translucida entre dos puntos. */
function WallPreview({
  start,
  end,
  height,
  thickness,
  elevation,
}: {
  start: Vector2;
  end: Vector2;
  height: number;
  thickness: number;
  elevation: number;
}) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.01) return null;

  return (
    <mesh
      position={[
        start.x + dx / 2,
        elevation + height / 2,
        start.y + dy / 2,
      ]}
      rotation={[0, -Math.atan2(dy, dx), 0]}
    >
      <boxGeometry args={[length, height, thickness]} />
      <meshStandardMaterial color="#22d3ee" transparent opacity={0.35} />
    </mesh>
  );
}

function frustumForRect(
  rect: { minX: number; minY: number; maxX: number; maxY: number },
  camera: Camera,
  viewport: DOMRect,
) : Frustum {
  const left = (rect.minX / viewport.width) * 2 - 1;
  const right = (rect.maxX / viewport.width) * 2 - 1;
  const top = 1 - (rect.minY / viewport.height) * 2;
  const bottom = 1 - (rect.maxY / viewport.height) * 2;
  const crop = new Matrix4().set(
    2 / (right - left), 0, 0, -(right + left) / (right - left),
    0, 2 / (top - bottom), 0, -(top + bottom) / (top - bottom),
    0, 0, 1, 0,
    0, 0, 0, 1,
  );
  camera.updateMatrixWorld();
  const projectionView = crop
    .multiply(camera.projectionMatrix)
    .multiply(camera.matrixWorldInverse);
  return new Frustum().setFromProjectionMatrix(projectionView);
}

function boundsContainedInRect(
  bounds: ReturnType<typeof getSelectableBounds>,
  rect: { minX: number; minY: number; maxX: number; maxY: number },
  camera: Camera,
  viewport: DOMRect,
): boolean {
  camera.updateMatrixWorld();
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const point = new ThreeVector3(x, y, z).project(camera);
        if (point.z < -1 || point.z > 1) return false;
        const screenX = ((point.x + 1) / 2) * viewport.width;
        const screenY = ((1 - point.y) / 2) * viewport.height;
        if (
          screenX < rect.minX ||
          screenX > rect.maxX ||
          screenY < rect.minY ||
          screenY > rect.maxY
        ) {
          return false;
        }
      }
    }
  }
  return true;
}

interface RotationGesture {
  pointerId: number;
  previousAngle: number;
  totalAngle: number;
  snappedAngle: number;
  stepRadians: number;
  ids: string[];
  pivot: { x: number; y: number; z: number };
}

interface MoveGesture {
  pointerId: number;
  ids: string[];
  pivot: { x: number; y: number; z: number };
  origin: Vector2;
  delta: Vector2;
  startClient: Vector2;
}

interface TransformPreview {
  pivot: { x: number; y: number; z: number };
  angle: number;
  translation?: Vector2;
  targetIds: ReadonlySet<string>;
}

function PreviewTransform({
  id,
  preview,
  children,
}: {
  id: string;
  preview: TransformPreview | null;
  children: ReactNode;
}) {
  if (
    !preview ||
    !preview.targetIds.has(id) ||
    (preview.angle === 0 && !preview.translation)
  ) {
    return <>{children}</>;
  }
  const { x, y, z } = preview.pivot;
  return (
    <group
      position={[
        x + (preview.translation?.x ?? 0),
        y,
        z + (preview.translation?.y ?? 0),
      ]}
      rotation={[0, preview.angle, 0]}
    >
      <group position={[-x, -y, -z]}>{children}</group>
    </group>
  );
}

function worldPointOnHorizontalPlane(
  clientX: number,
  clientY: number,
  elevation: number,
  camera: Camera,
  canvas: HTMLCanvasElement,
): Vector2 | null {
  const rect = canvas.getBoundingClientRect();
  const ndc = new ThreeVector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  const raycaster = new Raycaster();
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.ray.intersectPlane(
    new Plane(new ThreeVector3(0, 1, 0), -elevation),
    new ThreeVector3(),
  );
  return hit ? { x: hit.x, y: hit.z } : null;
}

function screenAngleAroundPivot(
  clientX: number,
  clientY: number,
  pivot: { x: number; y: number; z: number },
  camera: Camera,
  canvas: HTMLCanvasElement,
): number {
  camera.updateMatrixWorld();
  const rect = canvas.getBoundingClientRect();
  const projected = new ThreeVector3(pivot.x, pivot.y, pivot.z).project(camera);
  const centerX = rect.left + ((projected.x + 1) / 2) * rect.width;
  const centerY = rect.top + ((1 - projected.y) / 2) * rect.height;
  return Math.atan2(clientY - centerY, clientX - centerX);
}

function SceneContent() {
  const { camera, gl } = useThree();
  const controls = useThree((state) => state.controls) as OrbitControlsLike | null;
  const scene = useEditorStore((state) => state.scene);
  const selectionList = useEditorStore((state) => state.selection);
  const hoveredId = useEditorStore((state) => state.hoveredId);
  const tool = useEditorStore((state) => state.tool);
  const snapEnabled = useEditorStore((state) => state.snapEnabled);
  const gridStep = useEditorStore((state) => state.gridStep);
  const showGrid = useEditorStore((state) => state.showGrid);
  const activeFloorId = useEditorStore((state) => state.activeFloorId);
  const furnitureCatalogId = useEditorStore((state) => state.furnitureCatalogId);
  const dispatch = useEditorStore((state) => state.dispatch);
  const select = useEditorStore((state) => state.select);
  const setHovered = useEditorStore((state) => state.setHovered);

  const [drawStart, setDrawStart] = useState<Vector2 | null>(null);
  const [cursor, setCursor] = useState<Vector2 | null>(null);
  const [marquee, setMarquee] = useState<{
    origin: Vector2;
    current: Vector2;
  } | null>(null);
  const [rotationGesture, setRotationGesture] = useState<RotationGesture | null>(null);
  const [moveGesture, setMoveGesture] = useState<MoveGesture | null>(null);
  const moveGestureRef = useRef<MoveGesture | null>(null);

  const selection = useMemo(() => new Set(selectionList), [selectionList]);
  const rotationPivot = useMemo(
    () => getSelectionPivot(scene, selectionList),
    [scene, selectionList],
  );
  const transformPreview = useMemo<TransformPreview | null>(() => {
    if (moveGesture) {
      return {
        pivot: moveGesture.pivot,
        angle: 0,
        translation: moveGesture.delta,
        targetIds: getTransformTargetIds(scene, moveGesture.ids),
      };
    }
    if (rotationGesture) {
      return {
        pivot: rotationGesture.pivot,
        angle: rotationGesture.snappedAngle,
        targetIds: getTransformTargetIds(scene, rotationGesture.ids),
      };
    }
    return null;
  }, [moveGesture, rotationGesture, scene]);
  const bounds = useMemo(() => computeSceneBounds(scene), [scene]);

  const activeFloor =
    scene.floors.find((floor) => floor.id === activeFloorId) ?? scene.floors[0] ?? null;
  const elevation = activeFloor?.elevation ?? 0;

  const floorWalls = useMemo(
    () => scene.walls.filter((wall) => wall.floorId === activeFloor?.id),
    [scene.walls, activeFloor?.id],
  );

  const applySnap = useCallback(
    (point: Vector2): Vector2 => {
      if (!snapEnabled) return point;
      return snapPoint(point, {
        walls: floorWalls,
        gridStep,
        threshold: 0.25,
        reference: drawStart,
      }).point;
    },
    [snapEnabled, floorWalls, gridStep, drawStart],
  );

  const handlers = useMemo(
    () => ({
      onPick: (id: string, additive: boolean) => {
        if (tool === "pan") return;
        // Con el pincel activo, hacer clic pinta en vez de seleccionar: es la
        // misma accion que el usuario espera de un bote de pintura.
        if (tool === "paint") {
          useEditorStore.getState().paintMaterial(id);
          return;
        }
        const current = useEditorStore.getState().selection;
        if (!additive && current.length > 1 && current.includes(id)) return;
        select([id], additive);
      },
      onDragStart: (id: string, event: ThreeEvent<PointerEvent>) => {
        if (tool !== "select" || event.nativeEvent.button !== 0) return;
        const selectedIds = useEditorStore.getState().selection;
        const ids = selectedIds.includes(id) ? [...selectedIds] : [id];
        const transformTargets = getTransformTargetIds(scene, ids);
        const pivot = getSelectionPivot(scene, ids);
        if (!pivot || transformTargets.size === 0) return;
        const origin = worldPointOnHorizontalPlane(
          event.nativeEvent.clientX,
          event.nativeEvent.clientY,
          pivot.y,
          camera,
          gl.domElement,
        );
        if (!origin) return;
        event.nativeEvent.preventDefault();
        const gesture: MoveGesture = {
          pointerId: event.pointerId,
          ids,
          pivot,
          origin,
          delta: { x: 0, y: 0 },
          startClient: {
            x: event.nativeEvent.clientX,
            y: event.nativeEvent.clientY,
          },
        };
        moveGestureRef.current = gesture;
        setMoveGesture(gesture);
      },
      onHover: (id: string | null) => {
        if (tool === "pan") return;
        setHovered(id);
        gl.domElement.style.cursor =
          moveGesture ? "grabbing" : tool === "select" && id ? "grab" : "";
      },
    }),
    [camera, gl, moveGesture, scene, select, setHovered, tool],
  );

  useEffect(() => {
    const dom = gl.domElement;
    if (tool === "pan") {
      dom.style.cursor = "grab";
      const onDown = () => {
        dom.style.cursor = "grabbing";
      };
      const onUp = () => {
        dom.style.cursor = "grab";
      };
      dom.addEventListener("pointerdown", onDown);
      window.addEventListener("pointerup", onUp);
      return () => {
        dom.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointerup", onUp);
        dom.style.cursor = "";
      };
    }

    dom.style.cursor = tool === "select" ? "default" : "crosshair";
    return () => {
      dom.style.cursor = "";
    };
  }, [gl, tool]);

  const handlePoint = useCallback(
    (raw: Vector2) => {
      if (!activeFloor) return;
      const point = applySnap(raw);

      switch (tool) {
        case "wall": {
          if (!drawStart) {
            setDrawStart(point);
            return;
          }
          const created = dispatch({
            type: "CREATE_WALL",
            floorId: activeFloor.id,
            start: drawStart,
            end: point,
          });
          // Encadena tramos: el final de una pared es el inicio de la siguiente.
          setDrawStart(created ? point : null);
          return;
        }
        case "door":
        case "window": {
          const hit = findWallAt(raw, floorWalls, 0.6);
          if (!hit) {
            useEditorStore
              .getState()
              .setMessage({ kind: "error", text: "Acerca el puntero a una pared" });
            return;
          }
          dispatch(
            tool === "door"
              ? { type: "CREATE_DOOR", wallId: hit.wall.id, offset: hit.offset }
              : { type: "CREATE_WINDOW", wallId: hit.wall.id, offset: hit.offset },
          );
          return;
        }
        case "column": {
          dispatch({
            type: "CREATE_COLUMN",
            floorId: activeFloor.id,
            position: point,
          });
          return;
        }
        case "stair": {
          dispatch({
            type: "CREATE_STAIR",
            floorId: activeFloor.id,
            kind: "straight",
            position: point,
          });
          return;
        }
        case "furniture": {
          dispatch({
            type: "ADD_FURNITURE",
            floorId: activeFloor.id,
            catalogId: furnitureCatalogId,
            position: { x: point.x, y: 0, z: point.y },
          });
          return;
        }
        case "measure": {
          const measure = useEditorStore.getState().measure;
          if (!measure.start || measure.end) {
            useEditorStore.getState().setMeasure({ start: point, end: null });
          } else {
            useEditorStore.getState().setMeasure({ start: measure.start, end: point });
          }
          return;
        }
        default:
          return;
      }
    },
    [activeFloor, applySnap, dispatch, drawStart, floorWalls, furnitureCatalogId, tool],
  );

  const toCanvasPoint = useCallback(
    (point: Vector2): Vector2 => {
      const rect = gl.domElement.getBoundingClientRect();
      return { x: point.x - rect.left, y: point.y - rect.top };
    },
    [gl],
  );

  const handleMarqueeStart = useCallback(
    (point: Vector2) => {
      const origin = toCanvasPoint(point);
      setMarquee({ origin, current: origin });
    },
    [toCanvasPoint],
  );

  const handleMarqueeMove = useCallback(
    (point: Vector2) => {
      const current = toCanvasPoint(point);
      setMarquee((drag) => (drag ? { ...drag, current } : null));
    },
    [toCanvasPoint],
  );

  const handleMarqueeEnd = useCallback(
    (point: Vector2, additive: boolean) => {
      if (!marquee) {
        setMarquee(null);
        return;
      }
      const current = toCanvasPoint(point);
      const rect = {
        minX: Math.min(marquee.origin.x, current.x),
        minY: Math.min(marquee.origin.y, current.y),
        maxX: Math.max(marquee.origin.x, current.x),
        maxY: Math.max(marquee.origin.y, current.y),
      };
      if (rect.maxX - rect.minX < 2 || rect.maxY - rect.minY < 2) {
        select([], additive);
        setMarquee(null);
        return;
      }
      const viewport = gl.domElement.getBoundingClientRect();
      const crossing = current.x < marquee.origin.x;
      const frustum = crossing ? frustumForRect(rect, camera, viewport) : null;
      const visibleFloorIds = new Set(
        scene.floors.filter((floor) => floor.visible).map((floor) => floor.id),
      );
      const ids: string[] = [];
      const collect = <Kind extends SelectableEntityKind>(
        kind: Kind,
        entities: readonly SelectableEntities[Kind][],
      ) => {
        for (const entity of entities) {
          if (
            !visibleFloorIds.has(entity.floorId) ||
            ("visible" in entity && !entity.visible)
          ) {
            continue;
          }
          const bounds = getSelectableBounds(kind, entity, scene);
          const box = new Box3(
            new ThreeVector3(bounds.min.x, bounds.min.y, bounds.min.z),
            new ThreeVector3(bounds.max.x, bounds.max.y, bounds.max.z),
          );
          const matches = crossing
            ? frustum?.intersectsBox(box) ?? false
            : boundsContainedInRect(bounds, rect, camera, viewport);
          if (matches) ids.push(entity.id);
        }
      };
      collect("wall", scene.walls);
      collect("door", scene.doors);
      collect("window", scene.windows);
      collect("opening", scene.openings);
      collect("column", scene.columns);
      collect("stair", scene.stairs);
      collect("roof", scene.roofs);
      collect("slab", scene.slabs);
      collect("furniture", scene.furniture);
      collect("imported-model", scene.importedModels);
      select(ids, additive);
      setMarquee(null);
    },
    [camera, gl, marquee, scene, select, toCanvasPoint],
  );

  const handleRotationPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || !rotationPivot || selectionList.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      const stepRadians = (readRotationStepDegrees() * Math.PI) / 180;
      setRotationGesture({
        pointerId: event.pointerId,
        previousAngle: screenAngleAroundPivot(
          event.clientX,
          event.clientY,
          rotationPivot,
          camera,
          gl.domElement,
        ),
        totalAngle: 0,
        snappedAngle: 0,
        stepRadians,
        ids: [...selectionList],
        pivot: rotationPivot,
      });
    },
    [camera, gl, rotationPivot, selectionList],
  );

  const handleRotationPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!rotationGesture || event.pointerId !== rotationGesture.pointerId) return;
      const currentAngle = screenAngleAroundPivot(
        event.clientX,
        event.clientY,
        rotationGesture.pivot,
        camera,
        gl.domElement,
      );
      const angleDelta = Math.atan2(
        Math.sin(currentAngle - rotationGesture.previousAngle),
        Math.cos(currentAngle - rotationGesture.previousAngle),
      );
      const totalAngle = rotationGesture.totalAngle + angleDelta;
      const snappedAngle = event.shiftKey
        ? -Math.round(totalAngle / rotationGesture.stepRadians) * rotationGesture.stepRadians
        : -totalAngle;
      setRotationGesture({
        ...rotationGesture,
        previousAngle: currentAngle,
        totalAngle,
        snappedAngle,
      });
    },
    [camera, gl, rotationGesture],
  );

  const handleRotationPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!rotationGesture || event.pointerId !== rotationGesture.pointerId) return;
      const releaseAngle = screenAngleAroundPivot(
        event.clientX,
        event.clientY,
        rotationGesture.pivot,
        camera,
        gl.domElement,
      );
      const finalDelta = Math.atan2(
        Math.sin(releaseAngle - rotationGesture.previousAngle),
        Math.cos(releaseAngle - rotationGesture.previousAngle),
      );
      const totalAngle = rotationGesture.totalAngle + finalDelta;
      const snappedAngle = event.shiftKey
        ? -Math.round(totalAngle / rotationGesture.stepRadians) * rotationGesture.stepRadians
        : -totalAngle;
      if (Math.abs(snappedAngle) > 1e-9) {
        dispatch({
          type: "TRANSFORM_OBJECTS",
          ids: rotationGesture.ids,
          rotateY: snappedAngle,
        });
      }
      setRotationGesture(null);
    },
    [camera, dispatch, gl, rotationGesture],
  );

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const gesture = moveGestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      const point = worldPointOnHorizontalPlane(
        event.clientX,
        event.clientY,
        gesture.pivot.y,
        camera,
        gl.domElement,
      );
      if (!point) return;
      const nextGesture = {
        ...gesture,
        delta: {
          x: point.x - gesture.origin.x,
          y: point.y - gesture.origin.y,
        },
      };
      moveGestureRef.current = nextGesture;
      setMoveGesture(nextGesture);
      gl.domElement.style.cursor = "grabbing";
    };

    const finishMove = (event: PointerEvent) => {
      const gesture = moveGestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      const point = worldPointOnHorizontalPlane(
        event.clientX,
        event.clientY,
        gesture.pivot.y,
        camera,
        gl.domElement,
      );
      const delta = point
        ? { x: point.x - gesture.origin.x, y: point.y - gesture.origin.y }
        : gesture.delta;
      const pixelDistance = Math.hypot(
        event.clientX - gesture.startClient.x,
        event.clientY - gesture.startClient.y,
      );
      if (pixelDistance >= 3 && (Math.abs(delta.x) > 1e-6 || Math.abs(delta.y) > 1e-6)) {
        dispatch({
          type: "TRANSFORM_OBJECTS",
          ids: gesture.ids,
          translate: { x: delta.x, y: 0, z: delta.y },
        });
      }
      moveGestureRef.current = null;
      setMoveGesture(null);
      gl.domElement.style.cursor = tool === "select" ? "default" : "crosshair";
    };

    const cancelMove = (event: PointerEvent) => {
      const gesture = moveGestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      moveGestureRef.current = null;
      setMoveGesture(null);
      gl.domElement.style.cursor = tool === "select" ? "default" : "crosshair";
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishMove);
    window.addEventListener("pointercancel", cancelMove);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishMove);
      window.removeEventListener("pointercancel", cancelMove);
    };
  }, [camera, dispatch, gl, tool]);

  // Al cambiar de herramienta se abandona el trazado en curso.
  useEffect(() => {
    setDrawStart(null);
    setMarquee(null);
    setRotationGesture(null);
    moveGestureRef.current = null;
    setMoveGesture(null);
  }, [tool, activeFloorId]);

  return (
    <>
      <SceneLights scene={scene} />
      <CameraRig bounds={bounds} />
      <MaterialDropTarget />

      {showGrid ? (
        <Grid
          position={[0, elevation + 0.002, 0]}
          args={[200, 200]}
          cellSize={1}
          cellThickness={0.6}
          cellColor="#2b3440"
          sectionSize={5}
          sectionThickness={1}
          sectionColor="#3d4a5a"
          fadeDistance={90}
          fadeStrength={1}
          infiniteGrid
          followCamera={false}
        />
      ) : null}

      <WorkPlane
        elevation={elevation - 0.01}
        tool={tool}
        onPoint={handlePoint}
        onMove={(point) => setCursor(applySnap(point))}
        onMarqueeStart={handleMarqueeStart}
        onMarqueeMove={handleMarqueeMove}
        onMarqueeEnd={handleMarqueeEnd}
      />

      {tool === "select" && rotationPivot ? (
        <group position={[rotationPivot.x, rotationPivot.y, rotationPivot.z]}>
          <Html center pointerEvents="none">
            <div
              style={{
                position: "absolute",
                left: -32,
                top: -104,
                width: 64,
                height: 64,
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  border: "1px solid rgba(34, 211, 238, 0.7)",
                  borderRadius: "50%",
                  pointerEvents: "none",
                }}
              />
              <button
                type="button"
                aria-label="Arrastrar para girar la seleccion"
                title="Arrastra para girar libremente; mantén Shift para ajustar al incremento"
                onPointerDown={handleRotationPointerDown}
                onPointerMove={handleRotationPointerMove}
                onPointerUp={handleRotationPointerUp}
                onPointerCancel={() => setRotationGesture(null)}
                style={{
                  position: "absolute",
                  left: 16,
                  top: 16,
                  width: 32,
                  height: 32,
                  display: "grid",
                  placeItems: "center",
                  border: "1px solid #22d3ee",
                  borderRadius: "50%",
                  background: "#101923",
                  color: "#67e8f9",
                  cursor: rotationGesture ? "grabbing" : "grab",
                  pointerEvents: "auto",
                  touchAction: "none",
                  transform: `rotate(${(rotationGesture?.totalAngle ?? 0) * (180 / Math.PI)}deg) translateY(-29px) rotate(${-(rotationGesture?.totalAngle ?? 0) * (180 / Math.PI)}deg)`,
                }}
              >
                <RotateCw size={16} aria-hidden />
              </button>
              {rotationGesture ? (
                <span
                  style={{
                    position: "absolute",
                    left: 70,
                    top: 25,
                    minWidth: 42,
                    color: "#e6fbff",
                    font: "12px ui-monospace, monospace",
                    pointerEvents: "none",
                    textShadow: "0 1px 3px #000",
                  }}
                >
                  {(rotationGesture.snappedAngle * (180 / Math.PI)).toFixed(1)}°
                </span>
              ) : null}
            </div>
          </Html>
        </group>
      ) : null}

      {marquee ? (
        <group
          position={
            controls
              ? [controls.target.x, controls.target.y, controls.target.z]
              : [0, 0, 0]
          }
        >
          <Html fullscreen pointerEvents="none">
            <div
              style={{
                position: "absolute",
                left: Math.min(marquee.origin.x, marquee.current.x),
                top: Math.min(marquee.origin.y, marquee.current.y),
                width: Math.abs(marquee.current.x - marquee.origin.x),
                height: Math.abs(marquee.current.y - marquee.origin.y),
                border: "1px solid #22d3ee",
                background: "rgba(34, 211, 238, 0.12)",
                pointerEvents: "none",
              }}
            />
          </Html>
        </group>
      ) : null}

      {scene.floors.map((floor) => (
        <FloorContent
          key={floor.id}
          floor={floor}
          scene={scene}
          selection={selection}
          hoveredId={hoveredId}
          handlers={handlers}
          transformPreview={transformPreview}
        />
      ))}

      {tool === "wall" && drawStart && cursor ? (
        <WallPreview
          start={drawStart}
          end={cursor}
          height={activeFloor?.height ?? 2.6}
          thickness={0.15}
          elevation={elevation}
        />
      ) : null}
    </>
  );
}

export function Viewport3D() {
  const tool = useEditorStore((state) => state.tool);
  const [contextLost, setContextLost] = useState(false);
  // Cambiar esta clave reconstruye el lienzo desde cero cuando el usuario pide
  // reintentar tras una perdida de contexto.
  const [canvasKey, setCanvasKey] = useState(0);

  return (
    <>
      {contextLost ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-[#0d1117]/95 px-6 text-center">
          <div>
            <p className="text-sm text-ink">Se perdio el contexto de WebGL</p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-ink-muted">
              El navegador libero la memoria de la GPU. Tus cambios estan
              guardados; reintenta para reconstruir el visor.
            </p>
            <button
              type="button"
              onClick={() => {
                setContextLost(false);
                setCanvasKey((key) => key + 1);
              }}
              className="mt-4 rounded-md border border-line-strong px-3 py-1.5 text-xs text-ink hover:bg-surface-2"
            >
              Reintentar
            </button>
          </div>
        </div>
      ) : null}

    <div
      className="absolute inset-0"
      onContextMenu={(event) => event.preventDefault()}
      onDragOver={(event) => {
        // Sin `preventDefault` el navegador rechaza la caida y nunca llega el
        // evento `drop`.
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        event.preventDefault();
        const materialId =
          event.dataTransfer.getData("application/x-archvision-material") ||
          useEditorStore.getState().activeMaterialId;
        if (!materialId) return;
        useEditorStore.getState().requestDrop({
          clientX: event.clientX,
          clientY: event.clientY,
          materialId,
        });
      }}
    >
    <Canvas
      key={canvasKey}
      shadows
      dpr={[1, 2]}
      // Camara unica gestionada por R3F. Montar camaras adicionales con
      // `makeDefault` deja momentos en los que `state.camera` apunta a una
      // camara que ya no es la activa, y los encuadres se aplican a la
      // equivocada. Las vistas ortogonales exactas se resuelven en el plano 2D.
      camera={{ position: [14, 12, -16], fov: 50, near: 0.05, far: 2000 }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      onCreated={({ gl }) => {
        // La perdida de contexto ocurre cuando el navegador recupera memoria de
        // GPU (muchas pestanas abiertas, recargas en caliente, portatiles con
        // grafica integrada). Se avisa y se permite reconstruir el lienzo en
        // lugar de dejar un visor negro sin explicacion.
        const canvas = gl.domElement;
        canvas.addEventListener("webglcontextlost", (event) => {
          event.preventDefault();
          setContextLost(true);
        });
        canvas.addEventListener("webglcontextrestored", () => {
          setContextLost(false);
        });
      }}
      // `absolute inset-0` fija el lienzo al contenedor recortado: sin esto el
      // canvas puede arrastrar el tamano de su padre en cada redimension.
      className="absolute inset-0"
      style={{ position: "absolute", inset: 0 }}
    >
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.12}
        enablePan={tool !== "select"}
        mouseButtons={{
          LEFT: tool === "pan" ? MOUSE.ROTATE : undefined,
          MIDDLE: MOUSE.PAN,
          RIGHT: tool === "pan" ? MOUSE.PAN : MOUSE.ROTATE,
        }}
        maxPolarAngle={tool === "pan" ? Math.PI - 0.05 : Math.PI / 2.02}
        minPolarAngle={0.01}
        minDistance={1}
        maxDistance={400}
      />
      <ActiveSceneHandle />
      <SceneContent />
    </Canvas>
    </div>
    </>
  );
}
