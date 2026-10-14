import "server-only";

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
 * Proveedor del asistente basado en Ollama (modelos locales como qwen2.5:7b).
 *
 * Utiliza la API de chat nativa de Ollama (/api/chat) que soporta la definición
 * de herramientas (function calling / tool use).
 */

const HISTORY_LIMIT = 12;

interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OllamaToolCall {
  function?: {
    name?: string;
    arguments?: Record<string, unknown> | string;
  };
}

interface OllamaChatResponse {
  message?: {
    role: string;
    content?: string;
    tool_calls?: OllamaToolCall[];
  };
}

export function isOllamaConfigured(): boolean {
  const env = getEnv();
  return env.ASSISTANT_PROVIDER === "ollama" && Boolean(env.OLLAMA_BASE_URL);
}

export async function askOllama(params: {
  message: string;
  history: readonly AssistantMessage[];
  scene: SceneDocument;
  context: AssistantContext;
}): Promise<AssistantTurn | null> {
  const env = getEnv();
  const baseUrl = env.OLLAMA_BASE_URL.replace(/\/+$/, "");

  const digest = buildSceneDigest(params.scene, params.context);
  const systemPrompt = buildSystemPrompt(digest, params.scene);

  const historyMessages: OllamaMessage[] = params.history
    .slice(-HISTORY_LIMIT)
    .map((item) => ({
      role: item.role === "user" ? ("user" as const) : ("assistant" as const),
      content: item.text,
    }));

  const messages: OllamaMessage[] = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
    { role: "user", content: params.message },
  ];

  const tools = ASSISTANT_TOOLS.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.ASSISTANT_MODEL,
      messages,
      tools,
      stream: false,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama HTTP Error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as OllamaChatResponse;
  const assistantMsg = data.message;
  if (!assistantMsg) return null;

  const texts: string[] = [];
  const actions: AssistantTurn["actions"] = [];
  const diagnostics: AssistantTurn["diagnostics"] = [];

  if (assistantMsg.content && assistantMsg.content.trim().length > 0) {
    texts.push(assistantMsg.content.trim());
  }

  if (Array.isArray(assistantMsg.tool_calls)) {
    for (const toolCall of assistantMsg.tool_calls) {
      const toolName = toolCall.function?.name;
      if (!toolName) continue;

      const rawArgs = toolCall.function?.arguments;
      let input: Record<string, unknown> = {};
      if (typeof rawArgs === "string") {
        try {
          input = JSON.parse(rawArgs);
        } catch {
          input = {};
        }
      } else if (rawArgs && typeof rawArgs === "object") {
        input = rawArgs as Record<string, unknown>;
      }

      const outcome = executeTool(
        toolName,
        input,
        params.scene,
        params.context,
      );

      if (!outcome) continue;

      if (outcome.result) {
        actions.push(...outcome.result.actions);
        if (outcome.result.actions.length === 0 || texts.length === 0) {
          texts.push(outcome.result.reply);
        }
      }
      if (outcome.diagnostics) diagnostics.push(...outcome.diagnostics);
      if (outcome.reply) texts.push(outcome.reply);
    }
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
