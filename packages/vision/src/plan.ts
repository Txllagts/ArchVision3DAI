import type { Vector2 } from "@archvision/types";
import { downscale, toGrayscale, type RgbaImage } from "./image";
import { binarize, inkRatio, otsuThreshold } from "./threshold";
import { removeSmallComponents } from "./components";
import {
  accumulate,
  dominantAngle,
  extractLines,
  DEFAULT_HOUGH,
  type HoughOptions,
} from "./hough";
import {
  mergeSegments,
  traceSegments,
  DEFAULT_TRACE,
  type PixelSegment,
  type TraceOptions,
} from "./segments";

/**
 * Deteccion de muros en un plano rasterizado.
 *
 * Es vision clasica y determinista, no un modelo entrenado: el mismo plano da
 * siempre el mismo resultado y no hace falta ningun servicio externo. Sirve
 * para adelantar el trabajo de calcado; el usuario revisa, corrige y acepta.
 * La deteccion basada en aprendizaje llega con el servicio de la fase 6 y
 * consumira esta misma interfaz.
 */

export interface DetectedWall {
  start: Vector2;
  end: Vector2;
  /** Grosor estimado en metros. */
  thickness: number;
  /** Longitud en metros. */
  length: number;
  /** Fiabilidad estimada, 0 a 1. */
  confidence: number;
}

export interface DetectOptions {
  /** Pixeles por metro, obtenidos de la calibracion del usuario. */
  pixelsPerMeter: number;
  /** Lado maximo al que se reduce la imagen antes de analizar. */
  maxSide?: number;
  /** Longitud minima de muro aceptada, en metros. */
  minWallLength?: number;
  /** Grosor maximo de muro considerado, en metros. */
  maxWallThickness?: number;
  /** Tolerancia para enderezar muros a los ejes dominantes, en grados. */
  axisToleranceDeg?: number;
  /** Distancia bajo la cual dos extremos se funden, en metros. */
  weldDistance?: number;
  hough?: Partial<HoughOptions>;
  trace?: Partial<TraceOptions>;
}

export interface DetectionReport {
  walls: DetectedWall[];
  /** Angulo dominante del dibujo en grados; util para avisar de un plano girado. */
  dominantAngleDeg: number;
  /** Proporcion de tinta tras limpiar; muy alta o muy baja indica mal origen. */
  inkRatio: number;
  /** Umbral de Otsu aplicado. */
  threshold: number;
  /** Rectas candidatas antes de convertirlas en tramos. */
  lineCount: number;
}

const DEG = 180 / Math.PI;

function angleOf(segment: PixelSegment): number {
  return Math.atan2(segment.y2 - segment.y1, segment.x2 - segment.x1);
}

/**
 * Endereza un tramo al eje dominante mas proximo.
 *
 * Un plano escaneado llega girado un grado o dos y con el trazo tembloroso.
 * Sin este ajuste, cada muro quedaria con una inclinacion propia y las
 * esquinas no cerrarian.
 */
function snapToAxes(
  segment: PixelSegment,
  baseAngle: number,
  toleranceRad: number,
): PixelSegment {
  const angle = angleOf(segment);

  for (let k = -2; k <= 2; k += 1) {
    const target = baseAngle + (k * Math.PI) / 2;
    let delta = angle - target;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;

    if (Math.abs(delta) > toleranceRad) continue;

    const midX = (segment.x1 + segment.x2) / 2;
    const midY = (segment.y1 + segment.y2) / 2;
    const half = segment.length / 2;
    const dx = Math.cos(target) * half;
    const dy = Math.sin(target) * half;

    return {
      ...segment,
      x1: midX - dx,
      y1: midY - dy,
      x2: midX + dx,
      y2: midY + dy,
    };
  }

  return segment;
}

/** Agrupa valores proximos y devuelve el representante de cada grupo. */
function clusterValues(values: readonly number[], tolerance: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const centers: number[] = [];

  let group: number[] = [];
  const close = () => {
    if (group.length === 0) return;
    centers.push(group.reduce((sum, value) => sum + value, 0) / group.length);
    group = [];
  };

  for (const value of sorted) {
    const last = group[group.length - 1];
    if (last !== undefined && value - last > tolerance) close();
    group.push(value);
  }
  close();

  return centers;
}

function nearest(values: readonly number[], value: number, tolerance: number): number | null {
  let best: number | null = null;
  let bestDistance = tolerance;

  for (const candidate of values) {
    const distance = Math.abs(candidate - value);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return best;
}

/**
 * Cierra las esquinas del conjunto de muros.
 *
 * Fundir extremos por proximidad, sin mas, tuerce los muros: dos esquinas
 * detectadas con 15 cm de diferencia acaban inclinando un muro de ocho metros.
 * En su lugar se trabaja en el sistema girado del dibujo y se hacen tres
 * cosas: agrupar las coordenadas de los ejes para que los muros colineales
 * compartan valor exacto, y despues alargar cada extremo hasta el muro
 * perpendicular mas cercano. El resultado son esquinas que cierran de verdad,
 * que es lo que la deteccion de habitaciones necesita.
 */
function alignWalls(
  walls: readonly DetectedWall[],
  baseAngle: number,
  tolerance: number,
): DetectedWall[] {
  const cos = Math.cos(-baseAngle);
  const sin = Math.sin(-baseAngle);
  const toFrame = (point: Vector2): Vector2 => ({
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  });
  const fromFrame = (point: Vector2): Vector2 => ({
    x: point.x * cos + point.y * sin,
    y: -point.x * sin + point.y * cos,
  });

  interface Framed {
    wall: DetectedWall;
    start: Vector2;
    end: Vector2;
    horizontal: boolean;
  }

  const framed: Framed[] = walls.map((wall) => {
    const start = toFrame(wall.start);
    const end = toFrame(wall.end);
    return {
      wall,
      start,
      end,
      horizontal: Math.abs(end.x - start.x) >= Math.abs(end.y - start.y),
    };
  });

  const rows = clusterValues(
    framed.filter((item) => item.horizontal).map((item) => (item.start.y + item.end.y) / 2),
    tolerance,
  );
  const columns = clusterValues(
    framed.filter((item) => !item.horizontal).map((item) => (item.start.x + item.end.x) / 2),
    tolerance,
  );

  for (const item of framed) {
    if (item.horizontal) {
      const y = nearest(rows, (item.start.y + item.end.y) / 2, tolerance);
      if (y !== null) {
        item.start.y = y;
        item.end.y = y;
      }
    } else {
      const x = nearest(columns, (item.start.x + item.end.x) / 2, tolerance);
      if (x !== null) {
        item.start.x = x;
        item.end.x = x;
      }
    }
  }

  // Alargar hasta el eje perpendicular: es lo que convierte cuatro tramos
  // sueltos en un rectangulo cerrado.
  for (const item of framed) {
    if (item.horizontal) {
      for (const point of [item.start, item.end]) {
        const x = nearest(columns, point.x, tolerance);
        if (x !== null) point.x = x;
      }
    } else {
      for (const point of [item.start, item.end]) {
        const y = nearest(rows, point.y, tolerance);
        if (y !== null) point.y = y;
      }
    }
  }

  // Dos maximos del acumulador pueden describir el mismo muro y uno quedar
  // contenido en el otro; solo se nota despues de alinear, cuando ambos
  // comparten eje exacto. Sin esta pasada aparecerian muros duplicados.
  const groups = new Map<string, Framed[]>();
  for (const item of framed) {
    const axis = item.horizontal ? item.start.y : item.start.x;
    const key = `${item.horizontal ? "h" : "v"}:${axis.toFixed(4)}`;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  interface Span {
    item: Framed;
    min: number;
    max: number;
  }

  const deduped: Framed[] = [];

  for (const group of groups.values()) {
    const along = (item: Framed, point: Vector2) => (item.horizontal ? point.x : point.y);
    const ordered = group
      .map((item) => {
        const a = along(item, item.start);
        const b = along(item, item.end);
        return { item, min: Math.min(a, b), max: Math.max(a, b) };
      })
      .sort((left, right) => left.min - right.min);

    const first = ordered[0];
    if (!first) continue;

    const flush = (span: Span) => {
      const { item, min, max } = span;
      if (item.horizontal) {
        item.start = { x: min, y: item.start.y };
        item.end = { x: max, y: item.end.y };
      } else {
        item.start = { x: item.start.x, y: min };
        item.end = { x: item.end.x, y: max };
      }
      deduped.push(item);
    };

    let current: Span = first;

    for (let i = 1; i < ordered.length; i += 1) {
      const next = ordered[i];
      if (!next) continue;

      // Solo se fusiona lo que se solapa. Dos tramos que apenas se tocan
      // pueden ser muros distintos separados por un vano.
      if (next.min < current.max) {
        const keepNext = next.max - next.min > current.max - current.min;
        current = {
          item: keepNext ? next.item : current.item,
          min: Math.min(current.min, next.min),
          max: Math.max(current.max, next.max),
        };
        continue;
      }

      flush(current);
      current = next;
    }

    flush(current);
  }

  return deduped.map((item) => {
    const start = fromFrame(item.start);
    const end = fromFrame(item.end);
    return {
      ...item.wall,
      start,
      end,
      length: Math.hypot(end.x - start.x, end.y - start.y),
    };
  });
}

/** Detecta los muros de un plano ya calibrado. */
export function detectWalls(image: RgbaImage, options: DetectOptions): DetectionReport {
  if (!(options.pixelsPerMeter > 0)) {
    throw new Error("La deteccion necesita una calibracion valida (pixeles por metro)");
  }

  const maxSide = options.maxSide ?? 1200;
  const minWallLength = options.minWallLength ?? 0.5;
  const maxWallThickness = options.maxWallThickness ?? 0.6;
  const axisTolerance = (options.axisToleranceDeg ?? 6) / DEG;
  const weldDistance = options.weldDistance ?? 0.25;

  const gray = toGrayscale(image);
  const reduced = downscale(gray, maxSide);
  // La calibracion venia en pixeles del original; tras reducir hay que
  // reescalarla o todas las medidas saldrian mal.
  const pixelsPerMeter = options.pixelsPerMeter * reduced.scale;

  const threshold = otsuThreshold(reduced.image);
  const raw = binarize(reduced.image, threshold);

  // Un muro mide como minimo medio metro; todo lo que no llegue a esa
  // extension es cota, texto o mobiliario dibujado.
  const minSpan = Math.max(6, Math.round(minWallLength * pixelsPerMeter * 0.6));
  const mask = removeSmallComponents(raw, minSpan);

  const houghOptions: HoughOptions = {
    ...DEFAULT_HOUGH,
    minVotes: Math.max(20, Math.round(minWallLength * pixelsPerMeter)),
    rhoSuppression: Math.max(4, Math.round(maxWallThickness * pixelsPerMeter)),
    ...options.hough,
  };

  const accumulator = accumulate(mask, houghOptions.angleSteps);
  const baseAngle = dominantAngle(accumulator);

  // Solo se aceptan rectas alineadas con las dos direcciones dominantes: en un
  // plano de arquitectura lo demas suele ser mobiliario, sombreado o cotas
  // diagonales.
  const lines = extractLines(accumulator, houghOptions, (theta) => {
    for (let k = -2; k <= 2; k += 1) {
      const target = baseAngle + (k * Math.PI) / 2;
      if (Math.abs(theta - target) <= axisTolerance) return true;
    }
    return false;
  });

  const traceOptions: TraceOptions = {
    ...DEFAULT_TRACE,
    band: Math.max(3, Math.round((maxWallThickness * pixelsPerMeter) / 2)),
    maxGap: Math.max(3, Math.round(0.12 * pixelsPerMeter)),
    minLength: Math.max(8, Math.round(minWallLength * pixelsPerMeter)),
    ...options.trace,
  };

  const traced: PixelSegment[] = [];
  for (const line of lines) {
    for (const segment of traceSegments(mask, line, traceOptions)) {
      traced.push(snapToAxes(segment, baseAngle, axisTolerance));
    }
  }

  const merged = mergeSegments(traced, traceOptions.band * 2);

  const walls: DetectedWall[] = merged
    .map((segment) => {
      const thickness = segment.thickness / pixelsPerMeter;
      return {
        start: { x: segment.x1 / pixelsPerMeter, y: segment.y1 / pixelsPerMeter },
        end: { x: segment.x2 / pixelsPerMeter, y: segment.y2 / pixelsPerMeter },
        thickness: Math.min(maxWallThickness, Math.max(0.05, thickness)),
        length: segment.length / pixelsPerMeter,
        // La cobertura es la mejor senal disponible: un tramo con tinta
        // continua es casi seguro un muro, uno con huecos puede ser una linea
        // de cota o un mueble alineado por casualidad.
        confidence: Math.min(1, Math.max(0.1, segment.coverage * 0.9 + 0.1)),
      };
    })
    .filter((wall) => wall.length >= minWallLength);

  return {
    walls: alignWalls(walls, baseAngle, weldDistance).filter(
      (wall) => wall.length >= minWallLength,
    ),
    dominantAngleDeg: baseAngle * DEG,
    inkRatio: inkRatio(mask),
    threshold,
    lineCount: lines.length,
  };
}

/**
 * Escala a partir de una medida conocida del plano.
 *
 * El usuario traza una linea sobre una cota y escribe cuanto mide en la
 * realidad. Es el unico dato que la imagen no puede aportar por si sola.
 */
export function pixelsPerMeterFrom(
  a: Vector2,
  b: Vector2,
  realLengthMeters: number,
): number {
  const pixels = Math.hypot(b.x - a.x, b.y - a.y);
  if (pixels <= 0) throw new Error("Los dos puntos de calibracion coinciden");
  if (realLengthMeters <= 0) throw new Error("La medida real debe ser mayor que cero");
  return pixels / realLengthMeters;
}

/**
 * Conecta con el servicio de IA local (FastAPI Python / YOLOv11 + OpenCV)
 * para realizar una deteccion acelerada por GPU de muros y vanos.
 */
export async function detectWallsRemote(
  imageUrl: string,
  options: { serviceUrl?: string; pixelsPerMeter?: number } = {},
): Promise<DetectionReport> {
  const serviceUrl = options.serviceUrl ?? "http://localhost:8001";
  const pixelsPerMeter = options.pixelsPerMeter ?? 50;

  const response = await fetch(imageUrl);
  const blob = await response.blob();

  const formData = new FormData();
  formData.append("file", blob, "floorplan.png");
  formData.append("pixels_per_meter", pixelsPerMeter.toString());

  const apiRes = await fetch(`${serviceUrl}/analyze-floorplan`, {
    method: "POST",
    body: formData,
  });

  if (!apiRes.ok) {
    throw new Error(`Servicio IA devolvio error: ${apiRes.statusText}`);
  }

  const data = (await apiRes.json()) as {
    walls: DetectedWall[];
    dominant_angle_deg: number;
  };

  return {
    walls: data.walls,
    dominantAngleDeg: data.dominant_angle_deg,
    inkRatio: 0.5,
    threshold: 128,
    lineCount: data.walls.length,
  };
}

