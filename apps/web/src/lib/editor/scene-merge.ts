import type { SceneDocument } from "@archvision/types";

/**
 * Fusion de escenas por tres vias (base, local, servidor) para resolver un
 * conflicto de version sin perder datos.
 *
 * Reglas:
 *  - cada coleccion se combina entidad a entidad por `id`: lo modificado en
 *    una sola de las dos ramas se toma tal cual; lo modificado en las dos
 *    sobre el mismo id es solape y va a dialogo;
 *  - `rooms` es derivado (se recalcula al aplicar la fusion) y no participa;
 *  - ningun solape se resuelve en silencio: se reporta y el llamador decide.
 */

/** Serializacion estable: mismas claves ordenadas, comparable con ===. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return '"__undefined__"';
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? '"__unknown__"';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

interface Identified {
  id: string;
}

const COLLECTION_KEYS = [
  "floors",
  "walls",
  "doors",
  "windows",
  "openings",
  "columns",
  "stairs",
  "roofs",
  "slabs",
  "furniture",
  "importedModels",
  "materials",
  "lights",
  "cameras",
] as const;

const SCALAR_KEYS = ["version", "displayUnit", "environment", "activeFloorId", "underlay"] as const;

export interface SceneMergeResult {
  /** Escena fusionada. Solo tiene sentido cuando `overlap` es false. */
  scene: SceneDocument;
  /** true si alguna entidad o campo cambio en las dos ramas a la vez. */
  overlap: boolean;
}

function byId<T extends Identified>(list: readonly T[]): Map<string, T> {
  return new Map(list.map((item) => [item.id, item]));
}

function mergeCollection<T extends Identified>(
  base: readonly T[],
  local: readonly T[],
  server: readonly T[],
): { items: T[]; overlap: boolean } {
  const baseMap = byId(base);
  const localMap = byId(local);
  const serverMap = byId(server);

  const order: string[] = [];
  const seen = new Set<string>();
  for (const list of [server, local, base]) {
    for (const item of list) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        order.push(item.id);
      }
    }
  }

  const items: T[] = [];
  let overlap = false;

  for (const id of order) {
    const b = baseMap.get(id);
    const l = localMap.get(id);
    const s = serverMap.get(id);

    if (l && s) {
      const localJson = stableStringify(l);
      const serverJson = stableStringify(s);
      if (localJson === serverJson) {
        items.push(l);
      } else if (b && localJson === stableStringify(b)) {
        items.push(s);
      } else if (b && serverJson === stableStringify(b)) {
        items.push(l);
      } else {
        overlap = true;
        items.push(l);
      }
      continue;
    }

    if (l && !s) {
      if (!b) {
        items.push(l); // anadido solo local
      } else if (stableStringify(l) === stableStringify(b)) {
        continue; // borrado en servidor, local no lo toco
      } else {
        overlap = true; // local lo modifico, servidor lo borro
        items.push(l);
      }
      continue;
    }

    if (!l && s) {
      if (!b) {
        items.push(s); // anadido solo en servidor
      } else if (stableStringify(s) === stableStringify(b)) {
        continue; // borrado en local, servidor no lo toco
      } else {
        overlap = true; // servidor lo modifico, local lo borro
        items.push(s);
      }
      continue;
    }
    // en base pero en ninguna de las dos: borrado en ambos
  }

  return { items, overlap };
}

function pickScalar<T>(base: T, local: T, server: T): { value: T; overlap: boolean } {
  const localJson = stableStringify(local);
  const serverJson = stableStringify(server);
  if (localJson === serverJson) return { value: local, overlap: false };
  const baseJson = stableStringify(base);
  if (localJson === baseJson) return { value: server, overlap: false };
  if (serverJson === baseJson) return { value: local, overlap: false };
  return { value: local, overlap: true };
}

/**
 * Fusiona los cambios no solapados de `local` y `server` sobre la ultima
 * escena comun `base`. Si algo cambio en las dos ramas, `overlap` queda en
 * true y el llamador no debe sobrescribir nada sin consultar al usuario.
 */
export function mergeScenes(
  base: SceneDocument,
  local: SceneDocument,
  server: SceneDocument,
): SceneMergeResult {
  let overlap = false;
  const result = { ...local } as unknown as Record<string, unknown>;

  for (const key of COLLECTION_KEYS) {
    const merged = mergeCollection(
      (base[key] ?? []) as readonly Identified[],
      (local[key] ?? []) as readonly Identified[],
      (server[key] ?? []) as readonly Identified[],
    );
    if (merged.overlap) overlap = true;
    result[key] = merged.items;
  }

  for (const key of SCALAR_KEYS) {
    const picked = pickScalar(
      base[key] as unknown,
      local[key] as unknown,
      server[key] as unknown,
    );
    if (picked.overlap) overlap = true;
    if (picked.value === undefined) delete result[key];
    else result[key] = picked.value;
  }

  // `rooms` es derivado de los muros: se recalcula al aplicar la fusion.
  result.rooms = local.rooms;

  return { scene: result as unknown as SceneDocument, overlap };
}
