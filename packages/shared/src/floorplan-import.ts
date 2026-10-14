/**
 * Traduccion de la respuesta del microservicio de planos a entidades del editor.
 *
 * El servicio devuelve geometria cruda: segmentos con un rol (muro, puerta,
 * ventana) en las unidades del archivo de origen. El editor trabaja siempre en
 * metros y en el sistema de coordenadas del documento de escena, asi que aqui
 * vive la unica conversion entre ambos mundos.
 *
 * Dos casos, y son distintos:
 *
 *  - **CAD (DXF/DWG)**: los puntos vienen en las unidades declaradas del plano
 *    (`$INSUNITS`). Se convierten con la tabla de unidades.
 *  - **Raster (PNG/JPG/WebP/PDF)**: los puntos vienen en pixeles de la imagen.
 *    Si el usuario ya coloco el plano como `underlay`, la conversion es la
 *    misma que usa la planta (escala calibrada, giro y desplazamiento), de modo
 *    que los muros caen exactamente sobre la imagen. Sin plano colocado se
 *    recurre a la escala aproximada del servicio: 100 px/m.
 */

import type { CreateWallCommand, Vector2 } from "@archvision/types";
import { DEFAULTS } from "./defaults";

/** Metros por unidad de dibujo. Espejo de la tabla del servicio Python. */
export const METERS_PER_UNIT: Record<string, number> = {
  unitless: 1,
  inches: 0.0254,
  feet: 0.3048,
  millimeters: 0.001,
  centimeters: 0.01,
  meters: 1,
  microinches: 0.0000000254,
  mils: 0.000025,
  yards: 0.9144,
  decimeters: 0.1,
  decameters: 10,
  hectometers: 100,
  kilometers: 1000,
};

/**
 * Escala que el servicio asume para raster cuando no hay calibracion: 100
 * pixeles por metro. Es una aproximacion para que la extrusion 3D tenga
 * dimensiones creibles; el modelo debe calibrarse antes de darlo por exacto.
 */
export const RASTER_PIXELS_PER_METER = 100;

/** Longitud minima de un muro, en metros. Por debajo es ruido del dibujo. */
export const MIN_WALL_LENGTH_M = 0.1;

/** Techo de muros por analisis: evita lotes que bloqueen el editor. */
export const MAX_WALLS_PER_ANALYSIS = 4000;

export type FloorplanEntityRole =
  | "wall_candidate"
  | "door_candidate"
  | "window_candidate"
  | "geometry";

export interface FloorplanEntity {
  type: "line" | "polyline";
  role: FloorplanEntityRole;
  layer?: string | null;
  points: ReadonlyArray<readonly [number, number]>;
  closed?: boolean;
  confidence?: number;
}

export interface FloorplanSource {
  kind: "cad" | "raster";
  units: string;
}

/** Parte de la respuesta del servicio que necesita el editor. */
export interface FloorplanAnalysis {
  source: FloorplanSource;
  entities: readonly FloorplanEntity[];
}

/**
 * Colocacion del plano importado.
 *
 * Es el `underlay` de la escena: con el, los pixeles del analisis se convierten
 * al mundo con la misma formula que usa la vista de planta.
 */
export interface FloorplanPlacement {
  pixelsPerMeter: number;
  offset: Vector2;
  rotationDeg: number;
}

export interface FloorplanStatistics {
  entityCount: number;
  wallCandidates: number;
  doorCandidates: number;
  windowCandidates: number;
}

/** Metros por unidad del archivo, o null si la unidad no se reconoce. */
export function metersPerUnit(units: string): number | null {
  return METERS_PER_UNIT[units] ?? null;
}

/**
 * Convierte un punto del analisis a coordenadas del modelo, en metros.
 *
 * Con `placement` (plano colocado) el resultado queda alineado con la imagen
 * que ve el usuario, respetando su calibracion de escala.
 */
export function planToWorld(
  point: readonly [number, number],
  analysis: FloorplanAnalysis,
  placement?: FloorplanPlacement | null,
): Vector2 {
  if (
    analysis.source.kind === "raster" &&
    placement &&
    Number.isFinite(placement.pixelsPerMeter) &&
    placement.pixelsPerMeter > 0
  ) {
    return pixelToWorld(point, placement);
  }

  const declared = metersPerUnit(analysis.source.units);
  const factor =
    declared ??
    (analysis.source.kind === "raster" ? 1 / RASTER_PIXELS_PER_METER : 1);

  return { x: point[0] * factor, y: point[1] * factor };
}

/**
 * Pixel de imagen a mundo: la misma transformacion que aplica la planta.
 *
 *   mundo = offset + R(rotacion) · (pixel / pixelesPorMetro)
 */
export function pixelToWorld(
  pixel: readonly [number, number],
  placement: FloorplanPlacement,
): Vector2 {
  const scale = 1 / placement.pixelsPerMeter;
  const angle = (placement.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const x = pixel[0] * scale;
  const y = pixel[1] * scale;

  return {
    x: placement.offset.x + x * cos - y * sin,
    y: placement.offset.y + x * sin + y * cos,
  };
}

/**
 * Segmentos de una entidad, ya en coordenadas del modelo.
 *
 * Una polilina cerrada añade el tramo de cierre: un rectangulo dibujado como
 * polilina cerrada son cuatro muros, no tres.
 */
export function entitySegments(
  entity: FloorplanEntity,
  analysis: FloorplanAnalysis,
  placement?: FloorplanPlacement | null,
): Array<{ start: Vector2; end: Vector2 }> {
  const points = entity.points;
  if (points.length < 2) return [];

  const segments: Array<{ start: Vector2; end: Vector2 }> = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (!from || !to) continue;
    segments.push({
      start: planToWorld(from, analysis, placement),
      end: planToWorld(to, analysis, placement),
    });
  }

  if (entity.closed && points.length > 2) {
    const first = points[0];
    const last = points[points.length - 1];
    if (first && last) {
      segments.push({
        start: planToWorld(last, analysis, placement),
        end: planToWorld(first, analysis, placement),
      });
    }
  }

  return segments;
}

/** Recuento de candidatos por rol, para informar al usuario. */
export function floorplanStatistics(
  analysis: FloorplanAnalysis,
): FloorplanStatistics {
  const statistics: FloorplanStatistics = {
    entityCount: analysis.entities.length,
    wallCandidates: 0,
    doorCandidates: 0,
    windowCandidates: 0,
  };

  for (const entity of analysis.entities) {
    if (entity.role === "wall_candidate") statistics.wallCandidates += 1;
    else if (entity.role === "door_candidate") statistics.doorCandidates += 1;
    else if (entity.role === "window_candidate") statistics.windowCandidates += 1;
  }

  return statistics;
}

/**
 * Muros candidatos como comandos de creacion.
 *
 * Se emite un comando por segmento con `origin: "ai"`: el lote entero se puede
 * deshacer de una vez y queda registrado que el trazado no lo hizo el usuario.
 */
export function buildWallCommands(
  analysis: FloorplanAnalysis,
  floorId: string,
  placement?: FloorplanPlacement | null,
): CreateWallCommand[] {
  const commands: CreateWallCommand[] = [];

  for (const entity of analysis.entities) {
    if (entity.role !== "wall_candidate") continue;
    if (commands.length >= MAX_WALLS_PER_ANALYSIS) break;

    for (const segment of entitySegments(entity, analysis, placement)) {
      if (commands.length >= MAX_WALLS_PER_ANALYSIS) break;

      const length = Math.hypot(
        segment.end.x - segment.start.x,
        segment.end.y - segment.start.y,
      );
      if (length < MIN_WALL_LENGTH_M) continue;

      commands.push({
        type: "CREATE_WALL",
        origin: "ai",
        floorId,
        start: segment.start,
        end: segment.end,
        thickness: DEFAULTS.wall.thickness,
        height: DEFAULTS.wall.height,
      });
    }
  }

  return commands;
}

/** Apertura detectada, ya situada en el modelo. */
export interface FloorplanOpening {
  kind: "door" | "window";
  /** Punto medio de la apertura, en metros de modelo. */
  center: Vector2;
  /** Ancho en metros. */
  width: number;
  /** Longitud del trazo original, informativa. */
  rawLength?: number;
}

/** Ancho maximo creible de una apertura, en metros. */
const MAX_OPENING_WIDTH_M = 3;

/**
 * Aperturas candidatas (puertas y ventanas) situadas en el modelo.
 *
 * Solo el CAD las declara de forma explicita, en capas `DOOR`/`PUERTA` y
 * `WINDOW`/`VENTANA`; en raster el servicio no infiere huecos.
 */
export function buildOpeningCandidates(
  analysis: FloorplanAnalysis,
  placement?: FloorplanPlacement | null,
): FloorplanOpening[] {
  const openings: FloorplanOpening[] = [];

  for (const entity of analysis.entities) {
    const kind =
      entity.role === "door_candidate"
        ? "door"
        : entity.role === "window_candidate"
          ? "window"
          : null;
    if (!kind) continue;

    for (const segment of entitySegments(entity, analysis, placement)) {
      const length = Math.hypot(
        segment.end.x - segment.start.x,
        segment.end.y - segment.start.y,
      );
      if (length < MIN_WALL_LENGTH_M) continue;

      openings.push({
        kind,
        center: {
          x: (segment.start.x + segment.end.x) / 2,
          y: (segment.start.y + segment.end.y) / 2,
        },
        width: Math.min(MAX_OPENING_WIDTH_M, Math.max(length, DEFAULTS.door.width)),
        rawLength: length,
      });
    }
  }

  return openings;
}

export interface OpeningAssignment {
  /** Indice de la apertura dentro de la lista de candidatas. */
  openingIndex: number;
  /** Indice del muro dentro de la lista de muros dada. */
  wallIndex: number;
  /** Distancia desde el inicio del muro hasta el eje de la apertura. */
  offset: number;
}

/** Distancia de un punto a un segmento, con su proyeccion sobre el segmento. */
function projectOnSegment(
  point: Vector2,
  start: Vector2,
  end: Vector2,
): { distance: number; offset: number; length: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) {
    return {
      distance: Math.hypot(point.x - start.x, point.y - start.y),
      offset: 0,
      length,
    };
  }

  const raw =
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / (length * length);
  const clamped = Math.min(1, Math.max(0, raw));
  const closest = { x: start.x + dx * clamped, y: start.y + dy * clamped };

  return {
    distance: Math.hypot(point.x - closest.x, point.y - closest.y),
    offset: clamped * length,
    length,
  };
}

/**
 * Asocia cada apertura al muro que la contiene.
 *
 * La apertura es un hueco en un muro: se busca el muro mas cercano que sea
 * paralelo y lo bastante ancho para albergarla. Las que no encajen se
 * descartan en silencio; es preferible perder una puerta que colocar una
 * puerta en mitad de una habitacion.
 */
export function assignOpeningsToWalls(
  walls: ReadonlyArray<{ start: Vector2; end: Vector2 }>,
  openings: readonly FloorplanOpening[],
): OpeningAssignment[] {
  const assignments: OpeningAssignment[] = [];

  for (let openingIndex = 0; openingIndex < openings.length; openingIndex += 1) {
    const opening = openings[openingIndex];
    if (!opening) continue;

    let best: { wallIndex: number; offset: number; penalty: number } | null = null;

    for (let wallIndex = 0; wallIndex < walls.length; wallIndex += 1) {
      const wall = walls[wallIndex];
      if (!wall) continue;

      const projection = projectOnSegment(opening.center, wall.start, wall.end);
      if (projection.length < opening.width) continue;

      // La apertura debe caer sobre el muro, no cruzarlo: se admite un
      // desplazamiento del orden del grosor del muro.
      const tolerance = Math.max(0.3, DEFAULTS.wall.thickness * 2);
      if (projection.distance > tolerance) continue;

      const penalty = projection.distance;
      if (!best || penalty < best.penalty) {
        best = { wallIndex, offset: projection.offset, penalty };
      }
    }

    if (best) {
      assignments.push({
        openingIndex,
        wallIndex: best.wallIndex,
        offset: best.offset,
      });
    }
  }

  return assignments;
}
