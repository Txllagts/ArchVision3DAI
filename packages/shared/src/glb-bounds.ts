/**
 * Caja de delimitacion de un modelo GLB/GLTF sin cargarlo en Three.js.
 *
 * La vista de planta dibuja SVG: no puede montar un visor WebGL solo para
 * saber cuanto ocupa un modelo. El contenedor GLB guarda la geometria en un
 * chunk JSON con los accesores, y el estandar de glTF obliga a que todo
 * accesor `POSITION` declare `min` y `max`. Leyendo ese chunk se obtiene la
 * caja real del modelo por el coste de parsear una cabecera, no de
 * rasterizar una escena.
 *
 * Limitacion conocida: no se aplican las transformaciones de nodo del grafo.
 * Los exportadores habituales las traen incorporadas en las mallas; cuando no
 * es asi, la caja queda en el espacio local del mesh.
 */

export interface GlbBounds {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
}

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"

/** Techo del chunk JSON que se parsea: por encima, se usa el tamaño por defecto. */
const MAX_JSON_CHUNK_BYTES = 8 * 1024 * 1024;

function boundsFromGltf(json: unknown): GlbBounds | null {
  if (typeof json !== "object" || json === null) return null;

  const document = json as {
    accessors?: unknown;
    meshes?: unknown;
  };
  if (!Array.isArray(document.accessors) || !Array.isArray(document.meshes)) {
    return null;
  }

  // Solo los accesores que alguna malla usa como POSITION describen geometria;
  // el resto (normales, uv, animaciones) no debe ensanchar la caja.
  const positionAccessors = new Set<number>();
  for (const mesh of document.meshes) {
    const primitives = (mesh as { primitives?: unknown }).primitives;
    if (!Array.isArray(primitives)) continue;
    for (const primitive of primitives) {
      const position = (primitive as { attributes?: { POSITION?: unknown } }).attributes
        ?.POSITION;
      if (typeof position === "number") positionAccessors.add(position);
    }
  }

  if (positionAccessors.size === 0) return null;

  const min = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const max = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];

  for (const index of positionAccessors) {
    const accessor = document.accessors[index] as
      | { min?: unknown; max?: unknown }
      | undefined;
    if (!accessor || !Array.isArray(accessor.min) || !Array.isArray(accessor.max)) {
      continue;
    }

    for (let axis = 0; axis < 3; axis += 1) {
      const low = accessor.min[axis];
      const high = accessor.max[axis];
      if (typeof low !== "number" || typeof high !== "number") continue;
      if (!Number.isFinite(low) || !Number.isFinite(high)) continue;
      const currentMin = min[axis] ?? Number.POSITIVE_INFINITY;
      const currentMax = max[axis] ?? Number.NEGATIVE_INFINITY;
      min[axis] = Math.min(currentMin, low);
      max[axis] = Math.max(currentMax, high);
    }
  }

  if (!Number.isFinite(min[0]) || !Number.isFinite(min[1]) || !Number.isFinite(min[2])) {
    return null;
  }

  return {
    min: { x: min[0] ?? 0, y: min[1] ?? 0, z: min[2] ?? 0 },
    max: { x: max[0] ?? 0, y: max[1] ?? 0, z: max[2] ?? 0 },
    size: {
      x: (max[0] ?? 0) - (min[0] ?? 0),
      y: (max[1] ?? 0) - (min[1] ?? 0),
      z: (max[2] ?? 0) - (min[2] ?? 0),
    },
  };
}

/**
 * Lee la caja de un GLB binario.
 *
 * Acepta un buffer parcial mientras contenga el chunk JSON completo: basta con
 * los primeros bytes del archivo, no con el modelo entero.
 */
export function readGlbBounds(data: Uint8Array): GlbBounds | null {
  if (data.byteLength < 20) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) return null;

  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== CHUNK_JSON) return null;
  if (!Number.isFinite(jsonLength) || jsonLength <= 0) return null;
  if (jsonLength > MAX_JSON_CHUNK_BYTES) return null;

  const end = 20 + jsonLength;
  if (end > data.byteLength) return null;

  try {
    const json = JSON.parse(
      new TextDecoder("utf-8").decode(data.subarray(20, end)),
    ) as unknown;
    return boundsFromGltf(json);
  } catch {
    return null;
  }
}

/** Lee la caja de un GLTF (JSON puro, sin chunk binario). */
export function readGltfBounds(data: Uint8Array): GlbBounds | null {
  try {
    const json = JSON.parse(
      new TextDecoder("utf-8").decode(data),
    ) as unknown;
    return boundsFromGltf(json);
  } catch {
    return null;
  }
}

/**
 * Caja por URL, cacheada.
 *
 * El calculo es asincrono (hay que descargar la cabecera) pero la planta
 * necesita el resultado de forma sincrona en cada render. La cache resuelve
 * el choque: quien carga el modelo publica el resultado y el siguiente render
 * ya lo ve; hasta entonces se usa el tamaño por defecto.
 */

/** Tamaño supuesto cuando aún no se conoce la caja real, en metros. */
export const DEFAULT_IMPORTED_MODEL_SIZE = 2;

const boundsCache = new Map<string, GlbBounds | null>();
const inFlight = new Map<string, Promise<GlbBounds | null>>();

/** Caja ya conocida, o null si todavia no se ha calculado. */
export function cachedGlbBounds(url: string): GlbBounds | null {
  return boundsCache.get(url) ?? null;
}

/** Publica una caja calculada fuera (por ejemplo, desde los bytes subidos). */
export function rememberGlbBounds(url: string, bounds: GlbBounds | null): void {
  boundsCache.set(url, bounds);
}

/** Descarga la cabecera del modelo y calcula su caja. Nunca lanza. */
export async function loadGlbBounds(url: string): Promise<GlbBounds | null> {
  const cached = boundsCache.get(url);
  if (cached !== undefined) return cached;

  const pending = inFlight.get(url);
  if (pending) return pending;

  const task = (async () => {
    try {
      const response = await fetch(url, { credentials: "same-origin" });
      if (!response.ok) return null;
      const buffer = await response.arrayBuffer();
      const data = new Uint8Array(buffer);
      const bounds =
        readGlbBounds(data) ??
        // Un .gltf servido como texto tambien es valido.
        (data.byteLength > 0 && data[0] === 0x7b ? readGltfBounds(data) : null);
      boundsCache.set(url, bounds);
      return bounds;
    } catch {
      boundsCache.set(url, null);
      return null;
    } finally {
      inFlight.delete(url);
    }
  })();

  inFlight.set(url, task);
  return task;
}

/**
 * Tamaño en metros de un modelo importado.
 *
 * Usa la caja real en cuanto esta disponible y el tamaño por defecto mientras
 * tanto, para que la seleccion y la planta nunca dependan de que una descarga
 * haya terminado.
 */
export function importedModelSize(
  url: string,
  scale: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const bounds = cachedGlbBounds(url);
  if (!bounds) {
    return {
      x: DEFAULT_IMPORTED_MODEL_SIZE * Math.abs(scale.x || 1),
      y: DEFAULT_IMPORTED_MODEL_SIZE * Math.abs(scale.y || 1),
      z: DEFAULT_IMPORTED_MODEL_SIZE * Math.abs(scale.z || 1),
    };
  }

  return {
    x: Math.abs(bounds.size.x * scale.x),
    y: Math.abs(bounds.size.y * scale.y),
    z: Math.abs(bounds.size.z * scale.z),
  };
}
