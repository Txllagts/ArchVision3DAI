import Drawing, { type Unit } from "dxf-writer";
import {
  distance2,
  direction2,
  formatArea,
  formatLength,
  fromMeters,
  polygonCentroid,
  radToDeg,
} from "@archvision/shared";
import type {
  Door,
  Opening,
  SceneDocument,
  Vector2,
  Wall,
  WindowEntity,
} from "@archvision/types";
import type { ExportOptions, ExportUnit } from "./types";

/**
 * Exportador DXF de la planta 2D (esquema parametrico del proyecto).
 *
 * - Las coordenadas del esquema estan en metros: se escalan a la unidad
 *   elegida y `$INSUNITS` declara esa misma unidad (`Drawing.setUnits`).
 * - Salida ASCII R2000 (`$ACADVER = AC1015`) con `$DWGCODEPAGE = ANSI_1252`,
 *   y bytes codificados en Windows-1252 para que las tildes y la ene
 *   sobrevivan en AutoCAD y LibreCAD.
 * - No existen entidades de cota ni de texto en el esquema: las cotas se
 *   derivan de cada pared y los textos de los nombres/areas de las
 *   habitaciones, al momento de exportar.
 */

export const DXF_LAYERS = {
  walls: "CAPA_MUROS",
  openings: "CAPA_PUERTAS_VENTANAS",
  dimensions: "CAPA_COTAS",
  texts: "CAPA_TEXTOS",
} as const;

const DXF_UNIT_NAMES: Record<ExportUnit, Unit> = {
  m: "Meters",
  cm: "Centimeters",
  mm: "Millimeters",
};

const TEXT_HEIGHT = 0.16; // metros
const ROOM_TEXT_HEIGHT = 0.24; // metros
const DIMENSION_GAP = 0.45; // metros desde el eje de la pared
const DIMENSION_OVERSHOOT = 0.08; // metros mas alla de la linea de cota

/**
 * `Drawing.header` tipa sus valores como `[number, number]`, pero en runtime
 * acepta texto (p. ej. `AC1015` o `ANSI_1252`); se ensancha el tipo aqui.
 */
function headerText(code: number, value: string): Parameters<Drawing["header"]>[1] {
  return [[code, value]] as unknown as Parameters<Drawing["header"]>[1];
}

interface WallFrame {
  start: Vector2;
  dir: Vector2;
  normal: Vector2;
  length: number;
  half: number;
}

export function exportDxf(scene: SceneDocument, options: ExportOptions): Blob {
  const drawing = new Drawing();

  drawing.setUnits(DXF_UNIT_NAMES[options.unit]);
  // R2000: LWPOLYLINE, marcas de subclase y colores "true" compatibles; los
  // bytes de texto se escriben ademas en la codepage declarada.
  drawing.header("ACADVER", headerText(1, "AC1015"));
  drawing.header("DWGCODEPAGE", headerText(3, "ANSI_1252"));

  drawing
    .addLayer(DXF_LAYERS.walls, Drawing.ACI.WHITE, "CONTINUOUS")
    .addLayer(DXF_LAYERS.openings, Drawing.ACI.RED, "CONTINUOUS")
    .addLayer(DXF_LAYERS.dimensions, Drawing.ACI.GREEN, "CONTINUOUS")
    .addLayer(DXF_LAYERS.texts, Drawing.ACI.BLUE, "CONTINUOUS");

  const scale = fromMeters(1, options.unit);
  const floors = new Set(
    scene.floors.filter((floor) => floor.visible).map((floor) => floor.id),
  );
  const walls = scene.walls.filter(
    (wall) => wall.visible && floors.has(wall.floorId),
  );
  const wallById = new Map(walls.map((wall) => [wall.id, wall]));

  drawing.setActiveLayer(DXF_LAYERS.walls);
  for (const wall of walls) drawWallOutline(drawing, wall, scale);

  drawing.setActiveLayer(DXF_LAYERS.openings);
  for (const door of scene.doors) {
    const wall = door.visible ? wallById.get(door.wallId) : undefined;
    if (wall) drawDoor(drawing, wall, door, scale);
  }
  for (const windowEntity of scene.windows) {
    const wall = windowEntity.visible
      ? wallById.get(windowEntity.wallId)
      : undefined;
    if (wall) drawWindow(drawing, wall, windowEntity, scale);
  }
  for (const opening of scene.openings) {
    const wall = opening.visible ? wallById.get(opening.wallId) : undefined;
    if (wall) drawGenericOpening(drawing, wall, opening, scale);
  }

  drawing.setActiveLayer(DXF_LAYERS.dimensions);
  for (const wall of walls) drawWallDimension(drawing, wall, options, scale);

  drawing.setActiveLayer(DXF_LAYERS.texts);
  for (const room of scene.rooms) {
    if (!floors.has(room.floorId) || room.polygon.length < 3) continue;
    const center = polygonCentroid(room.polygon);
    text(drawing, center, ROOM_TEXT_HEIGHT, 0, room.name, scale);
    text(
      drawing,
      { x: center.x, y: center.y - 0.32 },
      TEXT_HEIGHT,
      0,
      formatArea(room.area, options.unit),
      scale,
    );
  }

  return new Blob([encodeDxfBytes(drawing.toDxfString())], {
    type: "image/vnd.dxf",
  });
}

// --------------------------------------------------------------------------
// Paredes
// --------------------------------------------------------------------------

function frameOf(wall: Wall): WallFrame {
  const length = distance2(wall.start, wall.end);
  const dir = length > 0 ? direction2(wall.start, wall.end) : { x: 1, y: 0 };
  return {
    start: wall.start,
    dir,
    normal: { x: -dir.y, y: dir.x },
    length,
    half: wall.thickness / 2,
  };
}

function pointAt(frame: WallFrame, t: number, lateral = 0): Vector2 {
  return {
    x: frame.start.x + frame.dir.x * t + frame.normal.x * lateral,
    y: frame.start.y + frame.dir.y * t + frame.normal.y * lateral,
  };
}

/** Contorno cerrado del prisma de la pared (vista en planta). */
function drawWallOutline(drawing: Drawing, wall: Wall, scale: number): void {
  const frame = frameOf(wall);
  if (frame.length <= 0) return;
  polyline(
    drawing,
    [
      pointAt(frame, 0, frame.half),
      pointAt(frame, frame.length, frame.half),
      pointAt(frame, frame.length, -frame.half),
      pointAt(frame, 0, -frame.half),
    ],
    true,
    scale,
  );
}

// --------------------------------------------------------------------------
// Vano: puertas, ventanas y huecos
// --------------------------------------------------------------------------

function openingRange(
  frame: WallFrame,
  offset: number,
  width: number,
): { t0: number; t1: number } {
  const t0 = clamp(offset - width / 2, 0, frame.length);
  const t1 = clamp(offset + width / 2, 0, frame.length);
  return { t0, t1 };
}

function drawDoor(drawing: Drawing, wall: Wall, door: Door, scale: number): void {
  const frame = frameOf(wall);
  const { t0, t1 } = openingRange(frame, door.offset, door.width);
  const width = t1 - t0;
  if (width <= 0.001) return;

  // Jambas: dos cortes a traves del espesor de la pared.
  line(drawing, pointAt(frame, t0, frame.half), pointAt(frame, t0, -frame.half), scale);
  line(drawing, pointAt(frame, t1, frame.half), pointAt(frame, t1, -frame.half), scale);

  if (door.kind === "sliding") {
    // Hojas deslizantes: dos tramos escalonados paralelos al eje.
    const middle = (t0 + t1) / 2;
    const inner = frame.half * 0.4;
    line(drawing, pointAt(frame, t0, inner), pointAt(frame, middle, inner), scale);
    line(drawing, pointAt(frame, middle, -inner), pointAt(frame, t1, -inner), scale);
    return;
  }

  if (door.kind === "arch") {
    const middle = pointAt(frame, (t0 + t1) / 2);
    const a = pointAt(frame, t0);
    const b = pointAt(frame, t1);
    arc(
      drawing,
      middle,
      width / 2,
      angleDegrees(sub(a, middle)),
      angleDegrees(sub(b, middle)),
      scale,
    );
    return;
  }

  const swing = door.openingDirection.startsWith("outward") ? -1 : 1;
  const leafDirection: Vector2 = {
    x: frame.normal.x * swing,
    y: frame.normal.y * swing,
  };

  if (door.kind === "double") {
    const leaf = width / 2;
    drawSwing(drawing, pointAt(frame, t0), frame.dir, leafDirection, leaf, scale);
    drawSwing(
      drawing,
      pointAt(frame, t1),
      { x: -frame.dir.x, y: -frame.dir.y },
      leafDirection,
      leaf,
      scale,
    );
    return;
  }

  // single, pivot, glass: una hoja desde la bisagra elegida.
  const hingeAtStart = !door.openingDirection.endsWith("right");
  const hinge = pointAt(frame, hingeAtStart ? t0 : t1);
  const closedDirection = hingeAtStart
    ? frame.dir
    : { x: -frame.dir.x, y: -frame.dir.y };
  drawSwing(drawing, hinge, closedDirection, leafDirection, width, scale);
}

/** Hoja abierta 90 grados mas su arco de barrido. */
function drawSwing(
  drawing: Drawing,
  hinge: Vector2,
  closedDirection: Vector2,
  leafDirection: Vector2,
  leafLength: number,
  scale: number,
): void {
  const tip = {
    x: hinge.x + leafDirection.x * leafLength,
    y: hinge.y + leafDirection.y * leafLength,
  };
  line(drawing, hinge, tip, scale);
  arc(
    drawing,
    hinge,
    leafLength,
    angleDegrees(leafDirection),
    angleDegrees(closedDirection),
    scale,
  );
}

/** Ventana: marco recto a lo largo del espesor mas la linea del hueco. */
function drawWindow(
  drawing: Drawing,
  wall: Wall,
  window: WindowEntity,
  scale: number,
): void {
  const frame = frameOf(wall);
  const { t0, t1 } = openingRange(frame, window.offset, window.width);
  if (t1 - t0 <= 0.001) return;
  polyline(
    drawing,
    [
      pointAt(frame, t0, frame.half),
      pointAt(frame, t1, frame.half),
      pointAt(frame, t1, -frame.half),
      pointAt(frame, t0, -frame.half),
    ],
    true,
    scale,
  );
  line(drawing, pointAt(frame, t0), pointAt(frame, t1), scale);
}

/** Vano sin carpinteria: solo el contorno del hueco. */
function drawGenericOpening(
  drawing: Drawing,
  wall: Wall,
  opening: Opening,
  scale: number,
): void {
  const frame = frameOf(wall);
  const { t0, t1 } = openingRange(frame, opening.offset, opening.width);
  if (t1 - t0 <= 0.001) return;
  polyline(
    drawing,
    [
      pointAt(frame, t0, frame.half),
      pointAt(frame, t1, frame.half),
      pointAt(frame, t1, -frame.half),
      pointAt(frame, t0, -frame.half),
    ],
    true,
    scale,
  );
}

// --------------------------------------------------------------------------
// Cotas (derivadas de cada pared)
// --------------------------------------------------------------------------

function drawWallDimension(
  drawing: Drawing,
  wall: Wall,
  options: ExportOptions,
  scale: number,
): void {
  const frame = frameOf(wall);
  if (frame.length < 0.05) return;

  const offset = frame.half + DIMENSION_GAP;
  const start = pointAt(frame, 0, offset);
  const end = pointAt(frame, frame.length, offset);

  // Lineas de extension desde la cara de la pared hasta pasada la cota.
  line(drawing, pointAt(frame, 0, frame.half), pointAt(frame, 0, offset + DIMENSION_OVERSHOOT), scale);
  line(
    drawing,
    pointAt(frame, frame.length, frame.half),
    pointAt(frame, frame.length, offset + DIMENSION_OVERSHOOT),
    scale,
  );
  line(drawing, start, end, scale);

  // Marcas de corte a 45 grados.
  const tick = 0.07;
  const slash = normalize({
    x: frame.dir.x + frame.normal.x,
    y: frame.dir.y + frame.normal.y,
  });
  for (const anchor of [start, end]) {
    line(
      drawing,
      { x: anchor.x - slash.x * tick, y: anchor.y - slash.y * tick },
      { x: anchor.x + slash.x * tick, y: anchor.y + slash.y * tick },
      scale,
    );
  }

  const label = pointAt(frame, frame.length / 2, offset + DIMENSION_OVERSHOOT + 0.06);
  let rotation = radToDeg(Math.atan2(frame.dir.y, frame.dir.x));
  if (rotation > 90) rotation -= 180;
  if (rotation <= -90) rotation += 180;

  text(
    drawing,
    label,
    TEXT_HEIGHT,
    rotation,
    formatLength(frame.length, options.unit),
    scale,
  );
}

// --------------------------------------------------------------------------
// Primitivas de dibujo (coordenadas en metros -> unidad de salida)
// --------------------------------------------------------------------------

function line(drawing: Drawing, a: Vector2, b: Vector2, scale: number): void {
  drawing.drawLine(a.x * scale, a.y * scale, b.x * scale, b.y * scale);
}

function polyline(
  drawing: Drawing,
  points: Vector2[],
  closed: boolean,
  scale: number,
): void {
  drawing.drawPolyline(
    points.map((point) => [point.x * scale, point.y * scale] as [number, number]),
    closed,
  );
}

function text(
  drawing: Drawing,
  at: Vector2,
  heightMeters: number,
  rotation: number,
  value: string,
  scale: number,
): void {
  drawing.drawText(
    at.x * scale,
    at.y * scale,
    heightMeters * scale,
    rotation,
    value,
    "center",
    "middle",
  );
}

/** Arco siempre en el sentido antihorario corto (<= 180 grados). */
function arc(
  drawing: Drawing,
  center: Vector2,
  radiusMeters: number,
  startDegrees: number,
  endDegrees: number,
  scale: number,
): void {
  const delta = (((endDegrees - startDegrees) % 360) + 360) % 360;
  const [start, end] = delta <= 180 ? [startDegrees, endDegrees] : [endDegrees, startDegrees];
  drawing.drawArc(
    center.x * scale,
    center.y * scale,
    radiusMeters * scale,
    start,
    end,
  );
}

// --------------------------------------------------------------------------
// Utilidades
// --------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function sub(a: Vector2, b: Vector2): Vector2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function normalize(v: Vector2): Vector2 {
  const length = Math.hypot(v.x, v.y);
  return length > 0 ? { x: v.x / length, y: v.y / length } : { x: 1, y: 0 };
}

function angleDegrees(v: Vector2): number {
  return radToDeg(Math.atan2(v.y, v.x));
}

/**
 * Codepage Windows-1252: la declara `$DWGCODEPAGE` y aqui se materializan los
 * bytes. Cubre ASCII, Latin-1 (todas las tildes y la ene del espanol) y los
 * signos tipograficos frecuentes (guiones, comillas, puntos suspensivos).
 * Cualquier otro codigo fuera de rango se degrada a `?`.
 */
function encodeDxfBytes(value: string): Uint8Array<ArrayBuffer> {
  const high = CP1252_HIGH;
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x7f || (code >= 0xa0 && code <= 0xff)) {
      bytes[i] = code;
      continue;
    }
    bytes[i] = high[code] ?? 0x3f;
  }
  return bytes;
}

const CP1252_HIGH: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};
