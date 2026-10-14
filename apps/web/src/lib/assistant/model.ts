import "server-only";

import type { SceneDocument } from "@archvision/types";
import type {
  AssistantContext,
  AssistantMessage,
  AssistantTurn,
} from "@archvision/assistant";
import { getEnv } from "@/lib/env";
import { askClaude } from "./claude";
import { askOllama } from "./ollama";

/**
 * Dispatcher central de modelos de lenguaje del asistente.
 *
 * Soporta proveedores `claude` y `ollama` (ej. qwen2.5:7b).
 */

export function isModelConfigured(): boolean {
  const env = getEnv();
  if (env.ASSISTANT_PROVIDER === "claude") {
    return Boolean(env.ANTHROPIC_API_KEY);
  }
  if (env.ASSISTANT_PROVIDER === "ollama") {
    return Boolean(env.OLLAMA_BASE_URL);
  }
  return false;
}

export async function askModel(params: {
  message: string;
  history: readonly AssistantMessage[];
  scene: SceneDocument;
  context: AssistantContext;
}): Promise<AssistantTurn | null> {
  const env = getEnv();

  if (env.ASSISTANT_PROVIDER === "ollama") {
    return askOllama(params);
  }

  if (env.ASSISTANT_PROVIDER === "claude") {
    return askClaude(params);
  }

  return null;
}
