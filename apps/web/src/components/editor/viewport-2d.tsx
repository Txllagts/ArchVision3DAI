"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { MaterialDefinition, SceneDocument, Vector2, Wall } from "@archvision/types";
import {
  distance2,
  containsRect2D,
  formatArea,
  formatLength,
  getSelectableBounds,
  intersectsRect2D,
  polygonCentroid,
  type SelectableEntities,
  type SelectableEntityKind,
} from "@archvision/shared";
import { findWallAt, snapPoint } from "@archvision/three-engine";
import { useEditorStore } from "@/lib/editor/store";

/**
 * Editor 2D de plantas.
 *
 * Dibuja sobre SVG porque la planta es geometria vectorial pura: se obtiene
 * nitidez a cualquier zoom, seleccion por elemento y accesibilidad basica sin
 * mantener un bucle de render propio.
 *
 * Comparte entidades con el visor 3D: cualquier cambio aqui es un comando y se
 * refleja de inmediato en el modelo.
 */

interface ViewTransform {
  /** Centro del encuadre en coordenadas de mundo. */
  center: Vector2;
  /** Pixeles por metro. */
  scale: number;
}

type DragState =
  | { kind: "pan"; origin: Vector2; startCenter: Vector2 }
  | { kind: "node"; wallId: string; end: "start" | "end"; preview: Vector2 }
  | {
      kind: "wall";
      wallId: string;
      ids: string[];
      origin: Vector2;
      delta: Vector2;
    }
  | { kind: "marquee"; origin: Vector2; current: Vector2 }
  | null;

const MIN_SCALE = 4;
const MAX_SCALE = 320;

function boundsOfScene(scene: SceneDocument): { min: Vector2; max: Vector2 } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const include = (point: Vector2) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  };

  for (const wall of scene.walls) {
    include(wall.start);
    include(wall.end);
  }
  for (const slab of scene.slabs) for (const point of slab.outline) include(point);

  if (!Number.isFinite(minX)) {
    return { min: { x: -5, y: -5 }, max: { x: 5, y: 5 } };
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

export function Viewport2D() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [view, setView] = useState<ViewTransform>({
    center: { x: 0, y: 0 },
    scale: 40,
  });
  const [cursor, setCursor] = useState<Vector2 | null>(null);
  const [drawStart, setDrawStart] = useState<Vector2 | null>(null);
  const [drag, setDrag] = useState<DragState>(null);
  const fitted = useRef(false);

  const scene = useEditorStore((state) => state.scene);
  const projectId = useEditorStore((state) => state.projectId);
  const units = useEditorStore((state) => state.units);
  const tool = useEditorStore((state) => state.tool);
  const selectionList = useEditorStore((state) => state.selection);
  const hoveredId = useEditorStore((state) => state.hoveredId);
  const snapEnabled = useEditorStore((state) => state.snapEnabled);
  const gridStep = useEditorStore((state) => state.gridStep);
  const activeFloorId = useEditorStore((state) => state.activeFloorId);
  const furnitureCatalogId = useEditorStore((state) => state.furnitureCatalogId);
  const measure = useEditorStore((state) => state.measure);
  const dispatch = useEditorStore((state) => state.dispatch);
  const select = useEditorStore((state) => state.select);
  const paintMaterial = useEditorStore((state) => state.paintMaterial);
  const setHovered = useEditorStore((state) => state.setHovered);
  const clearSelection = useEditorStore((state) => state.clearSelection);
  const setMeasure = useEditorStore((state) => state.setMeasure);
  const underlay = useEditorStore((state) => state.scene.underlay ?? null);
  const calibration = useEditorStore((state) => state.calibration);
  const setCalibration = useEditorStore((state) => state.setCalibration);
  const proposal = useEditorStore((state) => state.proposal);
  const toggleProposal = useEditorStore((state) => state.toggleProposal);

  const selection = useMemo(() => new Set(selectionList), [selectionList]);
  const activeFloor =
    scene.floors.find((floor) => floor.id === activeFloorId) ?? scene.floors[0] ?? null;

  const walls = useMemo(
    () => scene.walls.filter((wall) => wall.floorId === activeFloor?.id),
    [scene.walls, activeFloor?.id],
  );
  const rooms = useMemo(
    () => scene.rooms.filter((room) => room.floorId === activeFloor?.id),
    [scene.rooms, activeFloor?.id],
  );
  const columns = useMemo(
    () => scene.columns.filter((column) => column.floorId === activeFloor?.id),
    [scene.columns, activeFloor?.id],
  );
  const furniture = useMemo(
    () => scene.furniture.filter((item) => item.floorId === activeFloor?.id),
    [scene.furniture, activeFloor?.id],
  );

  // --- Encaje al contenedor -------------------------------------------------
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setSize({
        width: Math.max(1, entry.contentRect.width),
        height: Math.max(1, entry.contentRect.height),
      });
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fitView = useCallback(() => {
    const bounds = boundsOfScene(scene);
    const width = Math.max(1, bounds.max.x - bounds.min.x);
    const height = Math.max(1, bounds.max.y - bounds.min.y);
    const scale = Math.min(
      (size.width * 0.85) / width,
      (size.height * 0.85) / height,
    );

    setView({
      center: {
        x: (bounds.min.x + bounds.max.x) / 2,
        y: (bounds.min.y + bounds.max.y) / 2,
      },
      scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)),
    });
  }, [scene, size.height, size.width]);

  useEffect(() => {
    if (fitted.current) return;
    if (scene.floors.length === 0) return;
    fitted.current = true;
    fitView();
  }, [fitView, scene.floors.length]);

  // --- Conversiones ---------------------------------------------------------
  const toScreen = useCallback(
    (point: Vector2): [number, number] => [
      (point.x - view.center.x) * view.scale + size.width / 2,
      (point.y - view.center.y) * view.scale + size.height / 2,
    ],
    [size.height, size.width, view.center.x, view.center.y, view.scale],
  );

  const toWorld = useCallback(
    (clientX: number, clientY: number): Vector2 => {
      const rect = containerRef.current?.getBoundingClientRect();
      const x = clientX - (rect?.left ?? 0);
      const y = clientY - (rect?.top ?? 0);
      return {
        x: (x - size.width / 2) / view.scale + view.center.x,
        y: (y - size.height / 2) / view.scale + view.center.y,
      };
    },
    [size.height, size.width, view.center.x, view.center.y, view.scale],
  );

  const applySnap = useCallback(
    (point: Vector2): Vector2 => {
      if (!snapEnabled) return point;
      return snapPoint(point, {
        walls,
        gridStep,
        // Umbral constante en pantalla: 10 px traducidos a metros.
        threshold: 10 / view.scale,
        reference: drawStart,
      }).point;
    },
    [snapEnabled, walls, gridStep, view.scale, drawStart],
  );

  // --- Interaccion ----------------------------------------------------------
  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!activeFloor) return;
      const raw = toWorld(event.clientX, event.clientY);

      // Boton central o secundario: encuadre, o herramienta pan.
      if (tool === "pan" || event.button === 1 || event.button === 2 || event.altKey) {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDrag({ kind: "pan", origin: raw, startCenter: view.center });
        return;
      }

      const point = applySnap(raw);

      switch (tool) {
        case "wall": {
          if (!drawStart) {
            setDrawStart(point);
            return;
          }
          const ok = dispatch({
            type: "CREATE_WALL",
            floorId: activeFloor.id,
            start: drawStart,
            end: point,
          });
          setDrawStart(ok ? point : null);
          return;
        }
        case "door":
        case "window": {
          const hit = findWallAt(raw, walls, 20 / view.scale);
          if (!hit) {
            useEditorStore
              .getState()
              .setMessage({ kind: "error", text: "Haz clic sobre una pared" });
            return;
          }
          dispatch(
            tool === "door"
              ? { type: "CREATE_DOOR", wallId: hit.wall.id, offset: hit.offset }
              : { type: "CREATE_WINDOW", wallId: hit.wall.id, offset: hit.offset },
          );
          return;
        }
        case "calibrate": {
          // Sin ajuste: la escala se mide sobre el plano, no sobre la rejilla
          // del modelo, que todavia no significa nada.
          const current = useEditorStore.getState().calibration;
          if (!current.start || current.end) {
            setCalibration({ start: raw, end: null });
          } else {
            setCalibration({ start: current.start, end: raw });
          }
          return;
        }
        case "column":
          dispatch({ type: "CREATE_COLUMN", floorId: activeFloor.id, position: point });
          return;
        case "stair":
          dispatch({
            type: "CREATE_STAIR",
            floorId: activeFloor.id,
            kind: "straight",
            position: point,
          });
          return;
        case "furniture":
          dispatch({
            type: "ADD_FURNITURE",
            floorId: activeFloor.id,
            catalogId: furnitureCatalogId,
            position: { x: point.x, y: 0, z: point.y },
          });
          return;
        case "measure": {
          if (!measure.start || measure.end) setMeasure({ start: point, end: null });
          else setMeasure({ start: measure.start, end: point });
          return;
        }
        default: {
          if (tool === "select") {
            const target = event.target;
            const isBackground =
              target === event.currentTarget ||
              (target instanceof SVGRectElement &&
                target.dataset.marqueeBackground === "true");
            if (!isBackground) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            setDrag({ kind: "marquee", origin: raw, current: raw });
            return;
          }
          if (tool === "paint") return;
          // El fondo conserva el gesto de seleccion por ventana incluso sin objetos debajo.
          clearSelection();
        }
      }
    },
    [
      activeFloor,
      applySnap,
      clearSelection,
      dispatch,
      drawStart,
      furnitureCatalogId,
      measure.end,
      measure.start,
      paintMaterial,
      setCalibration,
      setMeasure,
      toWorld,
      tool,
      view.center,
      view.scale,
      walls,
    ],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const raw = toWorld(event.clientX, event.clientY);
      setCursor(applySnap(raw));

      if (!drag) return;

      if (drag.kind === "pan") {
        setView((current) => ({
          ...current,
          center: {
            x: drag.startCenter.x - (raw.x - drag.origin.x),
            y: drag.startCenter.y - (raw.y - drag.origin.y),
          },
        }));
        return;
      }

      if (drag.kind === "node") {
        setDrag({ ...drag, preview: applySnap(raw) });
        return;
      }

      if (drag.kind === "wall") {
        setDrag({
          ...drag,
          delta: { x: raw.x - drag.origin.x, y: raw.y - drag.origin.y },
        });
        return;
      }

      if (drag.kind === "marquee") {
        setDrag({ ...drag, current: raw });
      }
    },
    [applySnap, drag, toWorld],
  );

  const handlePointerUp = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag) return;

    if (drag.kind === "node") {
      dispatch({
        type: "UPDATE_WALL",
        wallId: drag.wallId,
        patch: drag.end === "start" ? { start: drag.preview } : { end: drag.preview },
      });
    }

    if (drag.kind === "wall" && (drag.delta.x !== 0 || drag.delta.y !== 0)) {
      dispatch({
        type: "TRANSFORM_OBJECTS",
        ids: drag.ids,
        translate: { x: drag.delta.x, y: 0, z: drag.delta.y },
      });
    }

    if (drag.kind === "marquee") {
      const current = toWorld(event.clientX, event.clientY);
      const marquee = {
        minX: Math.min(drag.origin.x, current.x),
        minY: Math.min(drag.origin.y, current.y),
        maxX: Math.max(drag.origin.x, current.x),
        maxY: Math.max(drag.origin.y, current.y),
      };
      const crossing = current.x < drag.origin.x;
      const ids: string[] = [];
      const collect = <Kind extends SelectableEntityKind>(
        kind: Kind,
        entities: readonly SelectableEntities[Kind][],
      ) => {
        for (const entity of entities) {
          if (
            entity.floorId !== activeFloor?.id ||
            ("visible" in entity && !entity.visible)
          ) {
            continue;
          }
          const bounds = getSelectableBounds(kind, entity, scene);
          const objectRect = {
            minX: bounds.min.x,
            minY: bounds.min.z,
            maxX: bounds.max.x,
            maxY: bounds.max.z,
          };
          const matches = crossing
            ? intersectsRect2D(objectRect, marquee)
            : containsRect2D(marquee, objectRect);
          if (matches) {
            ids.push(entity.id);
          }
        }
      };
      collect("wall", walls);
      collect("door", scene.doors);
      collect("window", scene.windows);
      collect("opening", scene.openings);
      collect("column", columns);
      collect("room", rooms);
      collect("furniture", furniture);
      select(ids, event.shiftKey);
    }

    setDrag(null);
  }, [activeFloor?.id, columns, dispatch, drag, furniture, rooms, scene, select, toWorld, walls]);

  const handleWheel = useCallback(
    (event: ReactWheelEvent<SVGSVGElement>) => {
      const pointer = toWorld(event.clientX, event.clientY);
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));

      // Zoom hacia el puntero: el punto bajo el cursor no se mueve.
      setView({
        scale,
        center: {
          x: pointer.x - (pointer.x - view.center.x) * (view.scale / scale),
          y: pointer.y - (pointer.y - view.center.y) * (view.scale / scale),
        },
      });
    },
    [toWorld, view.center.x, view.center.y, view.scale],
  );

  useEffect(() => {
    setDrawStart(null);
  }, [tool, activeFloorId]);

  // --- Dibujo ---------------------------------------------------------------
  const gridSize = view.scale >= 25 ? 1 : 5;
  const originScreen = toScreen({ x: 0, y: 0 });

  const wallPosition = (wall: Wall): { start: Vector2; end: Vector2 } => {
    if (drag?.kind === "node" && drag.wallId === wall.id) {
      return drag.end === "start"
        ? { start: drag.preview, end: wall.end }
        : { start: wall.start, end: drag.preview };
    }
    if (drag?.kind === "wall" && drag.ids.includes(wall.id)) {
      return {
        start: { x: wall.start.x + drag.delta.x, y: wall.start.y + drag.delta.y },
        end: { x: wall.end.x + drag.delta.x, y: wall.end.y + drag.delta.y },
      };
    }
    return { start: wall.start, end: wall.end };
  };

  const openingMarkers = useMemo(() => {
    const markers: Array<{
      id: string;
      wallId: string;
      kind: "door" | "window" | "opening";
      center: Vector2;
      angle: number;
      width: number;
      thickness: number;
    }> = [];

    const push = (
      id: string,
      kind: "door" | "window" | "opening",
      wall: Wall,
      offset: number,
      width: number,
    ) => {
      const length = distance2(wall.start, wall.end) || 1;
      const t = Math.min(1, Math.max(0, offset / length));
      markers.push({
        id,
        wallId: wall.id,
        kind,
        center: {
          x: wall.start.x + (wall.end.x - wall.start.x) * t,
          y: wall.start.y + (wall.end.y - wall.start.y) * t,
        },
        angle:
          (Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x) * 180) /
          Math.PI,
        width,
        thickness: wall.thickness,
      });
    };

    for (const door of scene.doors) {
      const wall = walls.find((item) => item.id === door.wallId);
      if (wall) push(door.id, "door", wall, door.offset, door.width);
    }
    for (const window of scene.windows) {
      const wall = walls.find((item) => item.id === window.wallId);
      if (wall) push(window.id, "window", wall, window.offset, window.width);
    }
    for (const opening of scene.openings) {
      const wall = walls.find((item) => item.id === opening.wallId);
      if (wall) push(opening.id, "opening", wall, opening.offset, opening.width);
    }

    return markers;
  }, [scene.doors, scene.openings, scene.windows, walls]);

  return (
    <div
      ref={containerRef}
      className="relative size-full overflow-hidden bg-[#0d1117]"
      onContextMenu={(event) => event.preventDefault()}
    >
      <svg
        width={size.width}
        height={size.height}
        className="absolute inset-0 touch-none"
        style={{
          cursor:
            tool === "pan"
              ? drag?.kind === "pan"
                ? "grabbing"
                : "grab"
              : tool === "select"
              ? "default"
              : "crosshair",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
        role="application"
        aria-label="Editor de planta"
      >
        <defs>
          <pattern
            id="plan-grid"
            width={gridSize * view.scale}
            height={gridSize * view.scale}
            patternUnits="userSpaceOnUse"
            x={originScreen[0]}
            y={originScreen[1]}
          >
            <path
              d={`M ${gridSize * view.scale} 0 L 0 0 0 ${gridSize * view.scale}`}
              fill="none"
              stroke="#1c2530"
              strokeWidth={1}
            />
          </pattern>
        </defs>

        <rect
          width={size.width}
          height={size.height}
          fill="url(#plan-grid)"
          data-marquee-background="true"
        />

        {/*
          Plano importado.

          Va antes que todo lo demas para que quede debajo: es una referencia
          para calcar, no parte del modelo. Se coloca con una transformacion
          afin en lugar de recalcular puntos, asi el navegador lo escala y gira
          en la GPU y el desplazamiento sigue siendo fluido con planos grandes.
        */}
        {underlay && underlay.visible && projectId ? (
          <g
            transform={`translate(${toScreen(underlay.offset).join(",")}) rotate(${
              underlay.rotationDeg
            }) scale(${view.scale / underlay.pixelsPerMeter})`}
            opacity={underlay.opacity}
            pointerEvents="none"
          >
            <image
              href={`/api/projects/${projectId}/files/${underlay.fileId}/content`}
              width={underlay.width}
              height={underlay.height}
              preserveAspectRatio="none"
            />
          </g>
        ) : null}

        {/* Ejes de origen */}
        <line
          x1={0}
          y1={originScreen[1]}
          x2={size.width}
          y2={originScreen[1]}
          stroke="#2b3949"
          strokeWidth={1}
        />
        <line
          x1={originScreen[0]}
          y1={0}
          x2={originScreen[0]}
          y2={size.height}
          stroke="#2b3949"
          strokeWidth={1}
        />

        {/* Habitaciones */}
        {rooms.map((room) => {
          const points = room.polygon
            .map((point) => toScreen(point).join(","))
            .join(" ");
          const centroid = toScreen(polygonCentroid(room.polygon));
          const isSelected = selection.has(room.id);

          // Resolucion del color de suelo: si hay material asignado se usa su
          // baseColor con opacidad reducida para mantener legible la planta.
          const floorMaterial: MaterialDefinition | undefined = room.floorMaterialId
            ? scene.materials.find((m) => m.id === room.floorMaterialId)
            : undefined;

          let fillColor: string;
          if (isSelected) {
            fillColor = "rgba(34,211,238,0.22)";
          } else if (floorMaterial) {
            // Convierte #rrggbb a rgba con opacidad 0.55 para que el material
            // sea visible pero sin ocultar la cuadricula.
            const hex = floorMaterial.baseColor.replace("#", "");
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            fillColor = `rgba(${r},${g},${b},0.55)`;
          } else {
            fillColor = "rgba(125,211,252,0.07)";
          }

          const strokeColor = isSelected
            ? "rgba(34,211,238,0.7)"
            : floorMaterial
            ? "rgba(255,255,255,0.18)"
            : "rgba(125,211,252,0.25)";

          return (
            <g key={room.id}>
              <polygon
                points={points}
                fill={fillColor}
                stroke={strokeColor}
                strokeWidth={isSelected ? 1.5 : 1}
                style={{
                  cursor:
                    tool === "select"
                      ? "pointer"
                      : tool === "paint"
                      ? "crosshair"
                      : "default",
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  if (tool === "paint") {
                    event.stopPropagation();
                    paintMaterial(room.id);
                    return;
                  }
                  if (tool !== "select") return;
                  event.stopPropagation();
                  select([room.id], event.shiftKey);
                }}
              />
              {view.scale > 14 ? (
                <text
                  x={centroid[0]}
                  y={centroid[1]}
                  textAnchor="middle"
                  className="pointer-events-none select-none"
                  fill={floorMaterial ? "#ffffff" : "#9fb3c8"}
                  fontSize={11}
                >
                  <tspan x={centroid[0]} dy="-2">
                    {room.name}
                  </tspan>
                  <tspan
                    x={centroid[0]}
                    dy="14"
                    fill={floorMaterial ? "rgba(255,255,255,0.7)" : "#6b7f93"}
                    fontSize={10}
                  >
                    {formatArea(room.area, units)}
                  </tspan>
                  {floorMaterial ? (
                    <tspan
                      x={centroid[0]}
                      dy="12"
                      fill="rgba(255,255,255,0.55)"
                      fontSize={9}
                    >
                      {floorMaterial.name}
                    </tspan>
                  ) : null}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* Paredes */}
        {walls.map((wall) => {
          const position = wallPosition(wall);
          const [x1, y1] = toScreen(position.start);
          const [x2, y2] = toScreen(position.end);
          const isSelected = selection.has(wall.id);
          const isHovered = hoveredId === wall.id;

          return (
            <g key={wall.id}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={isSelected ? "#22d3ee" : isHovered ? "#7dd3fc" : "#c3cbd6"}
                strokeWidth={Math.max(2, wall.thickness * view.scale)}
                strokeLinecap="butt"
                style={{ cursor: tool === "select" ? "move" : "crosshair" }}
                onPointerEnter={() => setHovered(wall.id)}
                onPointerLeave={() => setHovered(null)}
                onPointerDown={(event) => {
                  if (tool === "paint" && event.button === 0) {
                    event.stopPropagation();
                    paintMaterial(wall.id);
                    return;
                  }
                  if (tool !== "select" || event.button !== 0) return;
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const wasSelected = selection.has(wall.id);
                  const ids = wasSelected && selectionList.length > 1
                    ? [...selectionList]
                    : [wall.id];
                  if (!wasSelected || event.shiftKey) select([wall.id], event.shiftKey);
                  const raw = toWorld(event.clientX, event.clientY);
                  setDrag({
                    kind: "wall",
                    wallId: wall.id,
                    ids,
                    origin: raw,
                    delta: { x: 0, y: 0 },
                  });
                }}
              />

              {/* Nodos arrastrables */}
              {tool === "select" && (isSelected || isHovered)
                ? (["start", "end"] as const).map((end) => {
                    const [cx, cy] = toScreen(position[end]);
                    return (
                      <circle
                        key={end}
                        cx={cx}
                        cy={cy}
                        r={5}
                        fill="#0b1620"
                        stroke="#22d3ee"
                        strokeWidth={1.5}
                        style={{ cursor: "grab" }}
                        onPointerDown={(event) => {
                          if (event.button !== 0) return;
                          event.stopPropagation();
                          setDrag({
                            kind: "node",
                            wallId: wall.id,
                            end,
                            preview: position[end],
                          });
                        }}
                      />
                    );
                  })
                : null}

              {isSelected && view.scale > 12 ? (
                <text
                  x={(x1 + x2) / 2}
                  y={(y1 + y2) / 2 - 8}
                  textAnchor="middle"
                  fill="#22d3ee"
                  fontSize={11}
                  className="pointer-events-none select-none"
                >
                  {formatLength(distance2(position.start, position.end), units)}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* Vanos */}
        {openingMarkers.map((marker) => {
          const [baseX, baseY] = toScreen(marker.center);
          const offset =
            drag?.kind === "wall" &&
            (drag.ids.includes(marker.id) || drag.ids.includes(marker.wallId))
              ? { x: drag.delta.x * view.scale, y: drag.delta.y * view.scale }
              : { x: 0, y: 0 };
          const cx = baseX + offset.x;
          const cy = baseY + offset.y;
          const width = Math.max(4, marker.width * view.scale);
          const thickness = Math.max(3, marker.thickness * view.scale);
          const isSelected = selection.has(marker.id);

          return (
            <rect
              key={marker.id}
              x={cx - width / 2}
              y={cy - thickness / 2}
              width={width}
              height={thickness}
              transform={`rotate(${marker.angle} ${cx} ${cy})`}
              fill={
                isSelected
                  ? "#22d3ee"
                  : marker.kind === "door"
                    ? "#f0b26b"
                    : marker.kind === "window"
                      ? "#8fd3e8"
                      : "#b8a98a"
              }
              stroke="#0d1117"
              strokeWidth={1}
              style={{ cursor: tool === "select" ? "pointer" : "default" }}
              onPointerDown={(event) => {
                if (tool !== "select" || event.button !== 0) return;
                event.stopPropagation();
                select([marker.id], event.shiftKey);
              }}
            />
          );
        })}

        {/* Columnas */}
        {columns.map((column) => {
          const [baseX, baseY] = toScreen(column.position);
          const offset =
            drag?.kind === "wall" && drag.ids.includes(column.id)
              ? { x: drag.delta.x * view.scale, y: drag.delta.y * view.scale }
              : { x: 0, y: 0 };
          const cx = baseX + offset.x;
          const cy = baseY + offset.y;
          const width = Math.max(4, column.width * view.scale);
          const depth = Math.max(4, column.depth * view.scale);
          return (
            <rect
              key={column.id}
              x={cx - width / 2}
              y={cy - depth / 2}
              width={width}
              height={depth}
              fill={selection.has(column.id) ? "#22d3ee" : "#9aa4b1"}
              style={{ cursor: tool === "select" ? "pointer" : "default" }}
              onPointerDown={(event) => {
                if (tool !== "select" || event.button !== 0) return;
                event.stopPropagation();
                select([column.id], event.shiftKey);
              }}
            />
          );
        })}

        {/* Mobiliario */}
        {furniture.map((item) => {
          const [baseX, baseY] = toScreen({ x: item.position.x, y: item.position.z });
          const offset =
            drag?.kind === "wall" && drag.ids.includes(item.id)
              ? { x: drag.delta.x * view.scale, y: drag.delta.y * view.scale }
              : { x: 0, y: 0 };
          const cx = baseX + offset.x;
          const cy = baseY + offset.y;
          const size = Math.max(6, 0.6 * view.scale);
          return (
            <rect
              key={item.id}
              x={cx - size / 2}
              y={cy - size / 2}
              width={size}
              height={size}
              rx={2}
              fill={selection.has(item.id) ? "#22d3ee" : "#5f6b7a"}
              opacity={0.85}
              style={{ cursor: tool === "select" ? "pointer" : "default" }}
              onPointerDown={(event) => {
                if (tool !== "select" || event.button !== 0) return;
                event.stopPropagation();
                select([item.id], event.shiftKey);
              }}
            />
          );
        })}

        {/* Seleccion por ventana */}
        {drag?.kind === "marquee" ? (() => {
          const start = toScreen(drag.origin);
          const end = toScreen(drag.current);
          return (
            <rect
              x={Math.min(start[0], end[0])}
              y={Math.min(start[1], end[1])}
              width={Math.abs(end[0] - start[0])}
              height={Math.abs(end[1] - start[1])}
              fill="rgba(34,211,238,0.12)"
              stroke="#22d3ee"
              strokeDasharray="5 3"
              pointerEvents="none"
            />
          );
        })() : null}

        {/* Pared en curso */}
        {tool === "wall" && drawStart && cursor ? (
          <g className="pointer-events-none">
            <line
              x1={toScreen(drawStart)[0]}
              y1={toScreen(drawStart)[1]}
              x2={toScreen(cursor)[0]}
              y2={toScreen(cursor)[1]}
              stroke="#22d3ee"
              strokeWidth={2}
              strokeDasharray="6 4"
            />
            <text
              x={(toScreen(drawStart)[0] + toScreen(cursor)[0]) / 2}
              y={(toScreen(drawStart)[1] + toScreen(cursor)[1]) / 2 - 8}
              textAnchor="middle"
              fill="#22d3ee"
              fontSize={12}
            >
              {formatLength(distance2(drawStart, cursor), units)}
            </text>
          </g>
        ) : null}

        {/*
          Muros propuestos por la deteccion.

          Se dibujan en ambar y con trazo discontinuo para que no se confundan
          con el modelo: todavia no existen. Un clic alterna si se aceptan.
        */}
        {proposal
          ? proposal.map((wall, index) => {
              const [x1, y1] = toScreen(wall.start);
              const [x2, y2] = toScreen(wall.end);
              return (
                <line
                  key={`proposal-${index}-${wall.start.x}-${wall.start.y}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={wall.accepted ? "#22d3ee" : "#f59e0b"}
                  strokeOpacity={wall.accepted ? 0.9 : 0.5}
                  strokeWidth={Math.max(2, wall.thickness * view.scale)}
                  strokeDasharray={wall.accepted ? undefined : "8 5"}
                  style={{ cursor: "pointer" }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    toggleProposal(index);
                  }}
                />
              );
            })
          : null}

        {/* Calibracion de escala */}
        {calibration.start ? (
          <g className="pointer-events-none">
            <line
              x1={toScreen(calibration.start)[0]}
              y1={toScreen(calibration.start)[1]}
              x2={toScreen(calibration.end ?? cursor ?? calibration.start)[0]}
              y2={toScreen(calibration.end ?? cursor ?? calibration.start)[1]}
              stroke="#f59e0b"
              strokeWidth={2}
            />
            {[calibration.start, calibration.end].map((point, index) =>
              point ? (
                <circle
                  key={`calibration-${index}`}
                  cx={toScreen(point)[0]}
                  cy={toScreen(point)[1]}
                  r={4}
                  fill="#f59e0b"
                />
              ) : null,
            )}
          </g>
        ) : null}

        {/* Medicion */}
        {measure.start ? (
          <g className="pointer-events-none">
            <line
              x1={toScreen(measure.start)[0]}
              y1={toScreen(measure.start)[1]}
              x2={toScreen(measure.end ?? cursor ?? measure.start)[0]}
              y2={toScreen(measure.end ?? cursor ?? measure.start)[1]}
              stroke="#f0b26b"
              strokeWidth={1.5}
            />
            <text
              x={toScreen(measure.end ?? cursor ?? measure.start)[0]}
              y={toScreen(measure.end ?? cursor ?? measure.start)[1] - 10}
              textAnchor="middle"
              fill="#f0b26b"
              fontSize={12}
            >
              {formatLength(
                distance2(measure.start, measure.end ?? cursor ?? measure.start),
                units,
              )}
            </text>
          </g>
        ) : null}

        {/* Cursor con ajuste */}
        {cursor && tool !== "select" ? (
          <circle
            cx={toScreen(cursor)[0]}
            cy={toScreen(cursor)[1]}
            r={4}
            fill="none"
            stroke="#22d3ee"
            strokeWidth={1.5}
            className="pointer-events-none"
          />
        ) : null}
      </svg>

      {/* Indicadores del encuadre */}
      <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-3 rounded border border-line bg-surface/85 px-2 py-1 font-mono text-[10px] text-ink-subtle">
        <span>{activeFloor?.name ?? "Sin nivel"}</span>
        <span>{view.scale.toFixed(0)} px/m</span>
        {cursor ? (
          <span>
            x {cursor.x.toFixed(2)} · y {cursor.y.toFixed(2)}
          </span>
        ) : null}
      </div>

      <button
        type="button"
        onClick={fitView}
        className="absolute bottom-2 right-2 rounded border border-line bg-surface/85 px-2 py-1 text-[10px] text-ink-muted hover:text-ink"
      >
        Centrar planta
      </button>
    </div>
  );
}
