import "server-only";

import type { SceneCommand } from "@archvision/types";
import {
  greeting,
  planLocally,
  reviewScene,
  tutorialProgress,
  type AssistantContext,
  type AssistantMessage,
  type AssistantTurn,
  type ProposedAction,
} from "@archvision/assistant";
import { parseSceneCommand } from "@archvision/validation";
import { loadScene } from "@/lib/projects/scene-service";
import { getProject } from "@/lib/projects/service";
import { askModel, isModelConfigured } from "./model";

/**
 * Servicio del asistente.
 *
 * Dos responsabilidades que no pueden vivir en el paquete puro: leer la
 * escena del proyecto comprobando que pertenece a quien pregunta, y validar
 * lo que sale antes de devolverlo.
 *
 * La validacion no es una formalidad. Todo comando propuesto pasa por el
 * mismo esquema Zod que usa el editor, venga de las reglas locales o del
 * modelo de lenguaje. Una accion con un solo comando invalido se descarta
 * entera: aplicar la mitad de una operacion deja el modelo en un estado que
 * el usuario no pidio ni entiende.
 */

export interface AssistantRequest {
  message: string;
  history: AssistantMessage[];
  selection: string[];
  activeFloorId: string | null;
  tool?: string;
}

export interface AssistantResponse extends AssistantTurn {
  /** Acciones descartadas por no superar la validacion. */
  rejected: number;
}

/** Deja pasar solo las acciones cuyos comandos son todos validos. */
function validateActions(actions: readonly ProposedAction[]): {
  actions: ProposedAction[];
  rejected: number;
} {
  const valid: ProposedAction[] = [];
  let rejected = 0;

  for (const action of actions) {
    const commands: SceneCommand[] = [];
    let ok = action.commands.length > 0;

    for (const command of action.commands) {
      const parsed = parseSceneCommand(command);
      if (!parsed.ok) {
        console.warn(
          `[assistant] comando descartado en "${action.title}": ${parsed.errors.join("; ")}`,
        );
        ok = false;
        break;
      }
      commands.push(parsed.command);
    }

    if (ok) valid.push({ ...action, commands });
    else rejected += 1;
  }

  return { actions: valid, rejected };
}

export async function runAssistant(
  userId: string,
  projectId: string,
  request: AssistantRequest,
): Promise<AssistantResponse | null> {
  const [loaded, project] = await Promise.all([
    loadScene(userId, projectId),
    getProject(userId, projectId),
  ]);
  if (!loaded || !project) return null;

  const { scene } = loaded;
  const context: AssistantContext = {
    projectName: project.name,
    selection: request.selection,
    activeFloorId: request.activeFloorId,
    ...(request.tool ? { tool: request.tool } : {}),
    displayUnit: scene.displayUnit,
  };

  let turn = planLocally({ message: request.message, scene, context });

  // El modelo entra solo donde las reglas no llegan: es mas lento y cuesta
  // dinero, y para "crea una habitacion de 4x3" no aporta nada.
  if (turn.fallback && isModelConfigured()) {
    try {
      const answer = await askModel({
        message: request.message,
        history: request.history,
        scene,
        context,
      });
      if (answer) {
        turn = { ...answer, followUps: turn.followUps };
      }
    } catch (error) {
      // Un fallo del proveedor no puede dejar al usuario sin respuesta: se
      // queda la del motor local, que ya esta calculada.
      console.error("[assistant] fallo del modelo de lenguaje", error);
    }
  }

  const { actions, rejected } = validateActions(turn.actions);

  return { ...turn, actions, rejected };
}

/** Estado inicial del panel: saludo, revision y progreso del tutorial. */
export async function assistantOverview(userId: string, projectId: string) {
  const [loaded, project] = await Promise.all([
    loadScene(userId, projectId),
    getProject(userId, projectId),
  ]);
  if (!loaded || !project) return null;

  const context: AssistantContext = {
    projectName: project.name,
    selection: [],
    activeFloorId: loaded.scene.activeFloorId,
    displayUnit: loaded.scene.displayUnit,
  };

  return {
    greeting: greeting(loaded.scene, context),
    diagnostics: reviewScene(loaded.scene),
    tutorial: tutorialProgress(loaded.scene),
    modelEnabled: isModelConfigured(),
  };
}
