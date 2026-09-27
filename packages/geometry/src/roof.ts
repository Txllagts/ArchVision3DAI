import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  BufferGeometryUtils,
} from "./three-utils";
import type { Roof, Vector2 } from "@archvision/types";
import { degToRad, roofOutlineCenter } from "@archvision/shared";
import { applyBoxUv } from "./uv";

/**
 * Cubiertas.
 *
 * Los tipos plano, una pendiente y dos aguas se resuelven con volumenes
 * inclinados; cuatro aguas se construye como poliedro sobre la caja envolvente
 * del contorno. Mansarda y personalizado se aproximan por ahora a dos aguas,
 * marcado como pendiente de desarrollo especifico.
 */

interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  width: number;
  depth: number;
  centerX: number;
  centerZ: number;
}

function boundsOf(outline: readonly Vector2[], overhang: number): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const point of outline) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.y);
    maxZ = Math.max(maxZ, point.y);
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = 1;
    minZ = 0;
    maxZ = 1;
  }

  minX -= overhang;
  maxX += overhang;
  minZ -= overhang;
  maxZ += overhang;

  return {
    minX,
    maxX,
    minZ,
    maxZ,
    width: maxX - minX,
    depth: maxZ - minZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
  };
}

function triangleGeometry(vertices: number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(vertices), 3),
  );
  // Las cajas de Three.js traen `uv`; sin este atributo la fusion con ellas
  // falla por incompatibilidad de atributos.
  geometry.setAttribute(
    "uv",
    new BufferAttribute(new Float32Array((vertices.length / 3) * 2), 2),
  );
  geometry.computeVertexNormals();
  return geometry;
}

function mergeAll(pieces: BufferGeometry[]): BufferGeometry {
  // mergeGeometries exige que todas las piezas compartan el mismo formato de
  // atributos: las cajas llegan indexadas y los triangulos no, asi que se
  // normalizan a no indexadas antes de fusionar.
  const normalized = pieces.map((piece) =>
    piece.index ? piece.toNonIndexed() : piece,
  );

  const merged = BufferGeometryUtils.mergeGeometries(normalized, false);

  for (const piece of normalized) piece.dispose();
  for (const piece of pieces) {
    if (!normalized.includes(piece)) piece.dispose();
  }

  if (!merged) return new BufferGeometry();
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  return merged;
}

/** Faldon inclinado como caja rotada alrededor del eje indicado. */
function slopePanel(
  runLength: number,
  spanLength: number,
  thickness: number,
  slopeRad: number,
): BufferGeometry {
  const panelLength = runLength / Math.cos(slopeRad);
  return new BoxGeometry(spanLength, thickness, panelLength);
}

/**
 * Geometria de cubierta en coordenadas de mundo (X-Z de la planta), con la
 * base a la altura 0; el consumidor la sube con la cota del nivel.
 */
function buildRoofGeometry(roof: Roof): BufferGeometry {
  const bounds = boundsOf(roof.outline, roof.overhang);
  const slope = degToRad(Math.max(0, Math.min(85, roof.slopeDeg)));
  const thickness = Math.max(0.02, roof.thickness);
  const kind = roof.kind;

  if (kind === "flat" || slope === 0) {
    const slab = new BoxGeometry(bounds.width, thickness, bounds.depth);
    slab.translate(bounds.centerX, thickness / 2, bounds.centerZ);
    slab.computeBoundingBox();
    return slab;
  }

  if (kind === "shed") {
    const rise = bounds.depth * Math.tan(slope);
    const panel = slopePanel(bounds.depth, bounds.width, thickness, slope);
    panel.rotateX(-slope);
    panel.translate(bounds.centerX, rise / 2 + thickness / 2, bounds.centerZ);
    panel.computeBoundingBox();
    return panel;
  }

  if (kind === "hip") {
    // Cuatro faldones: cumbrera centrada sobre el lado largo, retranqueada
    // media anchura del lado corto.
    const ridgeAlongX = bounds.width >= bounds.depth;
    const halfShort = (ridgeAlongX ? bounds.depth : bounds.width) / 2;
    const rise = halfShort * Math.tan(slope);

    const { minX, maxX, minZ, maxZ, centerX, centerZ } = bounds;
    const ridgeStart = ridgeAlongX
      ? [minX + halfShort, rise, centerZ]
      : [centerX, rise, minZ + halfShort];
    const ridgeEnd = ridgeAlongX
      ? [maxX - halfShort, rise, centerZ]
      : [centerX, rise, maxZ - halfShort];

    const c0 = [minX, 0, minZ];
    const c1 = [maxX, 0, minZ];
    const c2 = [maxX, 0, maxZ];
    const c3 = [minX, 0, maxZ];
    const r0 = ridgeStart;
    const r1 = ridgeEnd;

    const faces: number[] = [];
    const push = (...points: number[][]) => {
      for (const point of points) faces.push(point[0]!, point[1]!, point[2]!);
    };

    if (ridgeAlongX) {
      // Faldones largos (norte y sur) y hastiales inclinados (este y oeste).
      push(c0, c1, r1);
      push(c0, r1, r0);
      push(c2, c3, r0);
      push(c2, r0, r1);
      push(c1, c2, r1);
      push(c3, c0, r0);
    } else {
      push(c0, c1, r0);
      push(c1, r1, r0);
      push(c2, c3, r1);
      push(c3, r0, r1);
      push(c1, c2, r1);
      push(c3, c0, r0);
    }

    const geometry = triangleGeometry(faces);
    geometry.computeBoundingBox();
    return geometry;
  }

  // gable, mansard y custom comparten por ahora la solucion a dos aguas.
  const ridgeAlongX = bounds.width >= bounds.depth;
  const run = (ridgeAlongX ? bounds.depth : bounds.width) / 2;
  const span = ridgeAlongX ? bounds.width : bounds.depth;
  const rise = run * Math.tan(slope);

  const pieces: BufferGeometry[] = [];

  for (const sign of [-1, 1]) {
    const panel = slopePanel(run, span, thickness, slope);
    if (ridgeAlongX) {
      panel.rotateX(sign * slope);
      panel.translate(
        bounds.centerX,
        rise / 2 + thickness / 2,
        bounds.centerZ + (sign * run) / 2,
      );
    } else {
      panel.rotateY(Math.PI / 2);
      panel.rotateZ(sign * slope);
      panel.translate(
        bounds.centerX + (sign * run) / 2,
        rise / 2 + thickness / 2,
        bounds.centerZ,
      );
    }
    pieces.push(panel);
  }

  // Hastiales triangulares que cierran los extremos.
  const gableThickness = 0.12;
  for (const sign of [-1, 1]) {
    const triangle = ridgeAlongX
      ? [
          bounds.centerX + (sign * span) / 2, 0, bounds.centerZ - run,
          bounds.centerX + (sign * span) / 2, 0, bounds.centerZ + run,
          bounds.centerX + (sign * span) / 2, rise, bounds.centerZ,
        ]
      : [
          bounds.centerX - run, 0, bounds.centerZ + (sign * span) / 2,
          bounds.centerX + run, 0, bounds.centerZ + (sign * span) / 2,
          bounds.centerX, rise, bounds.centerZ + (sign * span) / 2,
        ];
    const gable = triangleGeometry(triangle);
    gable.translate(
      ridgeAlongX ? -sign * gableThickness : 0,
      0,
      ridgeAlongX ? 0 : -sign * gableThickness,
    );
    pieces.push(gable);
  }

  return mergeAll(pieces);
}

/**
 * Geometria de cubierta con coordenadas de textura.
 *
 * La forma se arma con varias ramas segun el tipo, cada una con su propio
 * retorno; envolverlas garantiza que ninguna se escape sin UV y que anadir un
 * tipo nuevo no obligue a recordar este paso.
 */
export function createRoofGeometry(roof: Roof): BufferGeometry {
  const geometry = buildRoofGeometry(roof);
  const center = roofOutlineCenter(roof);
  geometry.translate(-center.x, 0, -center.y);
  applyBoxUv(geometry);
  return geometry;
}

export function roofGeometryKey(roof: Roof): string {
  const outline = roof.outline
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(";");
  return [
    roof.id,
    roof.kind,
    roof.slopeDeg.toFixed(2),
    roof.overhang.toFixed(2),
    roof.thickness.toFixed(2),
    outline,
  ].join("#");
}
