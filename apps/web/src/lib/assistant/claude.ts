import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { SceneDocument } from "@archvision/types";
import {
  ASSISTANT_TOOLS,
  buildSceneDigest,
  buildSystemPrompt,
  executeTool,
  type AssistantContext,
  type AssistantMessage,
  type AssistantTurn,
} from "@archvision/assistant";
import { getEnv } from "@/lib/env";

/**
 * Proveedor basado en el modelo de lenguaje.
 *
 * Solo se usa cuando el motor local no encuentra respuesta. El modelo decide
 * QUE operacion hacer y con que medidas; los identificadores y las
 * coordenadas los pone el codigo del paquete `assistant`, de modo que una
 * alucinacion no puede producir geometria en un sitio arbitrario ni tocar una
 * entidad que el usuario no menciono.
 *
 * La respuesta de este modulo tiene exactamente la misma forma que la del
 * motor local: el resto de la aplicacion no distingue el origen.
 */

/** Cuantos mensajes previos viajan como contexto de la conversacion. */
const HISTORY_LIMIT = 12;
/** Suficiente para una explicacion larga y varias llamadas de herramienta. */
const MAX_TOKENS = 2048;

let client: Anthropic | null = null;

/** Cliente perezoso: no se construye si nadie usa el proveedor. */
function getClient(apiKey: string): Anthropic {
  if (!client) client = new Anthropic({ apiKey });
  return client;
}

/** true cuando el proveedor esta configurado y utilizable. */
export function isModelConfigured(): boolean {
  const env = getEnv();
  return env.ASSISTANT_PROVIDER === "claude" && Boolean(env.ANTHROPIC_API_KEY);
}

function toApiMessages(
  history: readonly AssistantMessage[],
  message: string,
): Anthropic.MessageParam[] {
  const recent = history.slice(-HISTORY_LIMIT).map((item) => ({
    role: item.role === "user" ? ("user" as const) : ("assistant" as const),
    content: item.text,
  }));

  // La API exige que la conversacion empiece por el usuario.
  while (recent.length > 0 && recent[0]?.role !== "user") recent.shift();

  return [...recent, { role: "user", content: message }];
}

export async function askClaude(params: {
  message: string;
  history: readonly AssistantMessage[];
  scene: SceneDocument;
  context: AssistantContext;
}): Promise<AssistantTurn | null> {
  const env = getEnv();
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const digest = buildSceneDigest(params.scene, params.context);

  // El campo `strict` todavia no esta en los tipos del SDK instalado. Se
  // construye la lista en una variable para que TypeScript no aplique la
  // comprobacion de propiedades sobrantes de los literales.
  const tools = ASSISTANT_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema as Anthropic.Tool.InputSchema,
    strict: true,
  }));

  const response = await getClient(apiKey).messages.create({
    model: env.ASSISTANT_MODEL,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(digest, params.scene),
    tools,
    messages: toApiMessages(params.history, params.message),
  });

  const texts: string[] = [];
  const actions: AssistantTurn["actions"] = [];
  const diagnostics: AssistantTurn["diagnostics"] = [];

  for (const block of response.content) {
    if (block.type === "text") {
      texts.push(block.text.trim());
      continue;
    }

    if (block.type !== "tool_use") continue;

    const outcome = executeTool(
      block.name,
      (block.input ?? {}) as Record<string, unknown>,
      params.scene,
      params.context,
    );
    // Herramienta inexistente: se ignora en vez de adivinar la intencion.
    if (!outcome) continue;

    if (outcome.result) {
      actions.push(...outcome.result.actions);
      // El texto del constructor describe medidas concretas; vale mas que la
      // parafrasis del modelo, asi que se conserva.
      if (outcome.result.actions.length === 0 || texts.length === 0) {
        texts.push(outcome.result.reply);
      }
    }
    if (outcome.diagnostics) diagnostics.push(...outcome.diagnostics);
    if (outcome.reply) texts.push(outcome.reply);
  }

  const reply = texts.filter(Boolean).join("\n\n").trim();
  if (reply.length === 0 && actions.length === 0) return null;

  return {
    reply: reply.length > 0 ? reply : "Preparado. Revisa la propuesta.",
    actions,
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
    followUps: [],
    source: "model",
  };
}
