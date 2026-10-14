import type { RoofKind, SceneDocument } from "@archvision/types";
import {
  buildColumn,
  buildDelete,
  buildFloor,
  buildFurniture,
  buildOpening,
  buildPaint,
  buildRename,
  buildRoof,
  buildRoom,
  buildWallHeight,
  matchFurniture,
  matchMaterial,
  type BuildResult,
} from "./builders";
import { normalize } from "./knowledge";
import type { AssistantContext } from "./types";

/**
 * Interpretacion de peticiones en lenguaje natural, sin modelo.
 *
 * Cubre las ordenes que se repiten a diario con reglas explicitas. Tiene tres
 * ventajas sobre delegar todo en un modelo: funciona sin clave de API,
 * responde al instante y su comportamiento se puede probar. Lo que no encaja
 * aqui es lo que merece un modelo de lenguaje.
 *
 * Este modulo solo extrae la intencion y las medidas; quien decide donde va
 * cada cosa es `builders.ts`.
 */

export interface IntentInput {
  text: string;
  scene: SceneDocument;
  context: AssistantContext;
}

/** Verbos que convierten una frase en una orden y no en una pregunta. */
const CREATE_VERB =
  /\b(crea|crear|creame|haz|hacer|hazme|anade|anadir|añade|añadir|agrega|agregar|pon|poner|ponme|coloca|colocar|dibuja|dibujar|levanta|mete|quiero|necesito|nueva|nuevo)\b/;

function toNumber(raw: string): number {
  return Number(raw.replace(",", "."));
}

/**
 * Extrae las medidas de la frase, en metros.
 *
 * Reconoce la unidad cuando se escribe ("80 cm") y asume metros cuando no,
 * salvo que el numero sea tan grande que solo tenga sentido en centimetros:
 * nadie pide un muro de 240 metros de alto, pero si de 240 cm.
 */
export function parseMeasures(text: string): number[] {
  const found: number[] = [];
  const pattern = /(\d+(?:[.,]\d+)?)\s*(cm|centimetros?|mm|milimetros?|m|metros?)?/g;

  for (const match of text.matchAll(pattern)) {
    const amount = toNumber(match[1] ?? "");
    if (!Number.isFinite(amount)) continue;

    const unit = match[2];
    if (unit?.startsWith("cm") || unit?.startsWith("centimetro")) {
      found.push(amount / 100);
    } else if (unit?.startsWith("mm") || unit?.startsWith("milimetro")) {
      found.push(amount / 1000);
    } else if (unit) {
      found.push(amount);
    } else {
      found.push(amount > 30 ? amount / 100 : amount);
    }
  }

  return found;
}

/** Reconoce "4x3", "4 por 3", "4 * 3". */
export function parseDimensions(text: string): { a: number; b: number } | null {
  const match = /(\d+(?:[.,]\d+)?)\s*(?:x|por|\*)\s*(\d+(?:[.,]\d+)?)/.exec(text);
  if (!match) return null;

  const a = toNumber(match[1] ?? "");
  const b = toNumber(match[2] ?? "");
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;

  return { a: a > 30 ? a / 100 : a, b: b > 30 ? b / 100 : b };
}

const ROOF_KINDS: { keywords: string[]; kind: RoofKind }[] = [
  { keywords: ["dos aguas", "a dos"], kind: "gable" },
  { keywords: ["cuatro aguas", "a cuatro", "limatesa"], kind: "hip" },
  { keywords: ["una agua", "un agua", "inclinada"], kind: "shed" },
  { keywords: ["plana", "terraza", "azotea"], kind: "flat" },
  { keywords: ["mansarda"], kind: "mansard" },
];

type Handler = (input: IntentInput, text: string) => BuildResult | null;

const room: Handler = (input, text) => {
  const isRoom =
    /\b(habitacion|habitación|cuarto|recinto|sala|dormitorio|alcoba|cocina|bano|baño|oficina|estudio|rectangulo|rectángulo)\b/.test(
      text,
    );
  if (!isRoom || !CREATE_VERB.test(text)) return null;

  const dims = parseDimensions(text);
  const measures = parseMeasures(text);
  const width = dims?.a ?? measures[0];
  const depth = dims?.b ?? measures[1] ?? width;

  return buildRoom(input.scene, input.context, { width, depth });
};

const opening: Handler = (input, text) => {
  const isDoor = /\bpuerta/.test(text);
  const isWindow = /\bventana/.test(text);
  if ((!isDoor && !isWindow) || !CREATE_VERB.test(text)) return null;

  const dims = parseDimensions(text);
  const measures = parseMeasures(text);

  return buildOpening(input.scene, input.context, {
    kind: isDoor ? "door" : "window",
    width: dims?.a ?? measures[0],
    height: dims?.b ?? measures[1],
  });
};

const roof: Handler = (input, text) => {
  if (!/\b(techo|cubierta|tejado)\b/.test(text) || !CREATE_VERB.test(text)) return null;

  const match = ROOF_KINDS.find((option) =>
    option.keywords.some((keyword) => text.includes(keyword)),
  );
  const slope = parseMeasures(text).find((value) => value >= 5 && value <= 60);

  return buildRoof(input.scene, input.context, {
    kind: match?.kind ?? "gable",
    slopeDeg: slope,
  });
};

const floor: Handler = (input, text) => {
  if (!/\b(nivel|planta|piso)\b/.test(text) || !CREATE_VERB.test(text)) return null;
  // "planta baja" y "en planta" hablan del nivel existente, no de crear otro.
  if (/\ben planta\b/.test(text)) return null;

  const height = parseMeasures(text).find((value) => value >= 2 && value <= 6);
  return buildFloor({ height });
};

const column: Handler = (input, text) => {
  if (!/\b(columna|pilar)\b/.test(text) || !CREATE_VERB.test(text)) return null;

  const side = parseMeasures(text).find((value) => value >= 0.1 && value <= 2);
  return buildColumn(input.scene, input.context, {
    round: /\bredonda|circular|cilindrica\b/.test(text),
    side,
  });
};

const furniture: Handler = (input, text) => {
  if (!CREATE_VERB.test(text)) return null;
  if (!matchFurniture(text)) return null;

  return buildFurniture(input.scene, input.context, { query: text });
};

const paint: Handler = (input, text) => {
  if (!/\b(pinta|pintar|aplica|aplicar|cambia|cambiar|pon|poner)\b/.test(text)) return null;
  if (!matchMaterial(input.scene.materials, text)) return null;

  const face = /\binterior|dentro\b/.test(text)
    ? "interior"
    : /\bexterior|fachada|fuera\b/.test(text)
      ? "exterior"
      : undefined;

  return buildPaint(input.scene, input.context, { material: text, face });
};

const height: Handler = (input, text) => {
  if (!/\baltura|alto\b/.test(text)) return null;
  if (!/\b(cambia|cambiar|sube|subir|baja|bajar|pon|poner|ajusta|ajustar|deja)\b/.test(text)) {
    return null;
  }

  const value = parseMeasures(text)[0];
  if (value === undefined) {
    return {
      reply:
        'Dime a que altura quieres los muros, en metros. Por ejemplo: "sube la altura a 2,70".',
      actions: [],
    };
  }

  return buildWallHeight(input.scene, input.context, { height: value });
};

const remove: Handler = (input, text) => {
  if (!/\b(borra|borrar|elimina|eliminar|quita|quitar|suprime)\b/.test(text)) return null;
  return buildDelete(input.context);
};

const rename: Handler = (input, text) => {
  if (!/\b(renombra|renombrar|llama|nombra)\b/.test(text)) return null;

  const match = /(?:renombra\w*|llama\w*|nombra\w*)\s+(?:a\s+|como\s+)?["“']?([^"”']{2,40})["”']?$/.exec(
    input.text.trim(),
  );
  const name = match?.[1]?.trim();
  if (!name) {
    return { reply: "Dime con que nombre lo dejo.", actions: [] };
  }

  return buildRename(input.context, { name });
};

/** Orden de evaluacion: de la intencion mas concreta a la mas generica. */
const HANDLERS: Handler[] = [
  room,
  opening,
  roof,
  floor,
  column,
  furniture,
  paint,
  height,
  remove,
  rename,
];

/** Intenta resolver la peticion con reglas. Devuelve null si no encaja. */
export function matchIntent(input: IntentInput): BuildResult | null {
  const text = normalize(input.text);

  for (const handler of HANDLERS) {
    const result = handler(input, text);
    if (result) return result;
  }

  return null;
}
