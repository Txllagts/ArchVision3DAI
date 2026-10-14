import type { SceneDocument } from "@archvision/types";
import { hasUnsavedChanges, useEditorStore } from "./store";
import { mergeScenes, stableStringify } from "./scene-merge";
import { getProjectWriteChannel } from "./write-channel";

export interface SceneSaverOptions {
  fetchImpl?: typeof fetch;
  debounceMs?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
}

export interface SceneSaver {
  start(): void;
  stop(): void;
  saveNow(): Promise<boolean>;
  /** Resuelve el conflicto abierto: conserva lo local o adopta lo del servidor. */
  resolveConflict(choice: "keep" | "server"): Promise<boolean>;
}

interface SavePayload {
  data?: { revision: number };
  error?: { message?: string; details?: { currentRevision?: number } };
}

type Outcome =
  | { kind: "ok"; revision: number; scene: SceneDocument }
  | { kind: "conflict"; currentRevision: number | null }
  | { kind: "fatal"; text: string }
  | { kind: "retry"; text: string }
  | { kind: "stale" };

/** Resultado de comparar la escena local contra la del servidor en un 409. */
type Resolution =
  | { kind: "retry" }
  | { kind: "saved" }
  | { kind: "dialog"; serverScene: SceneDocument; serverRevision: number }
  | { kind: "failed" };

const DEBOUNCE_MS = 1200;
const TIMEOUT_MS = 15000;
const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 8000;

/** Copias de escenas enviadas sin confirmar, para detectar escrituras propias. */
const UNCONFIRMED_LIMIT = 3;

/** Resoluciones automaticas de conflicto antes de recurrir al dialogo. */
const MAX_CONFLICT_RESOLUTIONS = 2;

const CONFLICT_TEXT =
  "La escena cambio en el servidor y los cambios solapan. Elige como resolverlo.";

const STALE: Outcome = { kind: "stale" };

function defaultFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, init);
}

class SceneSaveController implements SceneSaver {
  private readonly fetchImpl: typeof fetch;
  private readonly debounceMs: number;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly random: () => number;

  private unsubscribe: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wakeSleep: (() => void) | null = null;
  private attemptAbort: AbortController | null = null;
  private inFlight = false;
  private rerunRequested = false;
  private stopped = false;
  private epoch = 0;
  /** Ultima escena confirmada en el servidor (ancestro comun para el merge). */
  private baseScene: SceneDocument | null = null;
  /** Escenas enviadas cuya respuesta no llego todavia. */
  private unconfirmed: SceneDocument[] = [];

  constructor(options: SceneSaverOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.debounceMs = options.debounceMs ?? DEBOUNCE_MS;
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
    this.baseDelayMs = options.baseDelayMs ?? BASE_DELAY_MS;
    this.maxDelayMs = options.maxDelayMs ?? MAX_DELAY_MS;
    this.random = options.random ?? Math.random;
  }

  start(): void {
    if (this.unsubscribe) return;
    this.stopped = false;
    // Captura inicial de la base: en produccion `initialize` llega despues y
    // la corrige via el cambio de revision; en pruebas llega antes.
    if (!this.baseScene) this.baseScene = useEditorStore.getState().scene;
    this.unsubscribe = useEditorStore.subscribe((state, previous) => {
      // Cambio de revision = nueva escena en el servidor (carga inicial,
      // guardado propio o fusion): la base para el merge pasa a ser aqui.
      if (state.revision !== previous.revision) this.baseScene = state.scene;
      if (state.scene === previous.scene) return;
      // Con el dialogo de conflicto abierto no se autosavea: los cambios
      // locales esperan la decision del usuario.
      if (state.conflict) return;
      if (state.saveStatus !== "dirty") return;
      this.arm();
    });
  }

  stop(): void {
    this.stopped = true;
    this.epoch += 1;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.clearDebounce();
    this.attemptAbort?.abort();
    this.unconfirmed = [];
    const wake = this.wakeSleep;
    this.wakeSleep = null;
    wake?.();
  }

  saveNow(): Promise<boolean> {
    this.clearDebounce();
    if (this.inFlight) {
      this.rerunRequested = true;
      return Promise.resolve(false);
    }
    return this.runCycle();
  }

  private arm(): void {
    this.clearDebounce();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.trigger();
    }, this.debounceMs);
  }

  private trigger(): void {
    if (this.stopped) return;
    if (this.inFlight) {
      this.rerunRequested = true;
      return;
    }
    const state = useEditorStore.getState();
    if (!state.projectId) return;
    // El timer puede dispararse tarde: si ya no hay nada sucio, no se guarda.
    if (state.saveStatus !== "dirty") return;
    void this.runCycle();
  }

  private clearDebounce(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async runCycle(): Promise<boolean> {
    if (this.inFlight) {
      this.rerunRequested = true;
      return false;
    }
    if (this.stopped) return false;
    const state = useEditorStore.getState();
    if (!state.projectId) return false;

    this.clearDebounce();
    this.inFlight = true;
    useEditorStore.setState({ saveStatus: "saving", saveError: null });

    try {
      let attempt = 0;
      let conflictResolutions = 0;

      while (attempt < this.maxAttempts) {
        const outcome = await this.attemptOnce();

        if (outcome.kind === "stale") return false;
        if (outcome.kind === "ok") {
          this.applySuccess(outcome);
          return true;
        }
        if (outcome.kind === "conflict") {
          conflictResolutions += 1;
          if (conflictResolutions > MAX_CONFLICT_RESOLUTIONS) {
            const server = await this.fetchServerScene();
            if (server) {
              this.applyDialogConflict(server.scene, server.revision);
            } else {
              this.applyFailure("No fue posible consultar la escena del servidor");
            }
            return false;
          }

          const resolution = await this.resolveAgainstServer();
          if (resolution.kind === "failed") {
            this.applyFailure("No fue posible consultar la escena del servidor");
            return false;
          }
          if (resolution.kind === "dialog") {
            this.applyDialogConflict(resolution.serverScene, resolution.serverRevision);
            return false;
          }
          if (resolution.kind === "saved") return true;
          // "retry": se adopto la revision del servidor o se aplico una
          // fusion; el siguiente intento usa la base mas reciente.
          continue;
        }
        if (outcome.kind === "fatal") {
          this.applyFailure(outcome.text);
          return false;
        }

        attempt += 1;
        if (attempt >= this.maxAttempts) {
          this.applyFailure(
            `No fue posible guardar tras ${this.maxAttempts} intentos (${outcome.text})`,
          );
          return false;
        }

        const completed = await this.sleep(this.backoffMs(attempt));
        if (!completed) return false;
      }
      return false;
    } catch {
      if (!this.stopped) this.applyFailure("No fue posible guardar");
      return false;
    } finally {
      this.inFlight = false;
      this.attemptAbort = null;
      if (this.rerunRequested) {
        this.rerunRequested = false;
        const current = useEditorStore.getState();
        if (!this.stopped && hasUnsavedChanges(current) && current.projectId) {
          void this.runCycle();
        }
      }
    }
  }

  private async attemptOnce(): Promise<Outcome> {
    const attemptId = ++this.epoch;
    const state = useEditorStore.getState();
    const controller = new AbortController();
    this.attemptAbort = controller;
    this.noteSent(state.scene);

    const request = this.execute(
      controller.signal,
      state.projectId,
      state.scene,
      state.revision,
    ).then((outcome) => (attemptId === this.epoch ? outcome : STALE));

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<Outcome>((resolve) => {
      timeoutHandle = setTimeout(() => {
        controller.abort();
        resolve({ kind: "retry", text: "Tiempo de espera agotado" });
      }, this.timeoutMs);
    });

    const outcome = await Promise.race([request, timeout]);

    if (timeoutHandle) clearTimeout(timeoutHandle);
    this.attemptAbort = null;
    if (attemptId !== this.epoch) return STALE;
    return outcome;
  }

  private async execute(
    signal: AbortSignal,
    projectId: string,
    scene: SceneDocument,
    expectedRevision: number,
  ): Promise<Outcome> {
    try {
      // Unica via de escritura: el PUT viaja por el canal serializado, asi
      // nunca solapa a una subida de archivo en vuelo. El abort libera el
      // canal aunque la respuesta nunca llegue (timeout del cliente).
      const response = await getProjectWriteChannel().run(
        () =>
          new Promise<Response>((resolve, reject) => {
            if (signal.aborted) {
              reject(new Error("Solicitud abortada"));
              return;
            }
            const onAbort = () => reject(new Error("Solicitud abortada"));
            signal.addEventListener("abort", onAbort, { once: true });
            this.fetchImpl(`/api/projects/${projectId}/scene`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ scene, expectedRevision }),
              signal,
            }).then(resolve, reject).finally(() => {
              signal.removeEventListener("abort", onAbort);
            });
          }),
      );

      let payload: SavePayload | null = null;
      try {
        payload = (await response.json()) as SavePayload;
      } catch {
        payload = null;
      }

      if (response.status === 409) {
        const currentRevision = payload?.error?.details?.currentRevision;
        return {
          kind: "conflict",
          currentRevision: typeof currentRevision === "number" ? currentRevision : null,
        };
      }
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        return { kind: "retry", text: `El servidor respondio ${response.status}` };
      }

      if (response.ok) {
        const revision = payload?.data?.revision;
        if (typeof revision === "number") return { kind: "ok", revision, scene };
        return { kind: "retry", text: "Respuesta inesperada del servidor" };
      }

      return {
        kind: "fatal",
        text: payload?.error?.message || `Error ${response.status} al guardar`,
      };
    } catch {
      return { kind: "retry", text: "Sin conexion con el servidor" };
    }
  }

  private backoffMs(attempt: number): number {
    const capped = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (attempt - 1));
    return Math.round(capped * (0.5 + 0.5 * this.random()));
  }

  private sleep(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const handle = setTimeout(() => {
        this.wakeSleep = null;
        resolve(true);
      }, ms);
      this.wakeSleep = () => {
        clearTimeout(handle);
        this.wakeSleep = null;
        resolve(false);
      };
    });
  }

  private applySuccess(outcome: { revision: number; scene: SceneDocument }): void {
    const current = useEditorStore.getState();
    const stillDirty = current.scene !== outcome.scene;

    useEditorStore.setState({
      revision: outcome.revision,
      saveStatus: stillDirty ? "dirty" : "saved",
      saveError: null,
      lastSavedAt: Date.now(),
      conflict: null,
    });
    // La escena enviada quedo confirmada en el servidor: es la nueva base
    // para detectar escrituras propias y para el merge de tres vias.
    this.baseScene = outcome.scene;
    this.unconfirmed = [];

    if (stillDirty) this.arm();
  }

  private applyFailure(text: string): void {
    useEditorStore.setState({
      saveStatus: "error",
      saveError: text,
      message: { kind: "error", text },
    });
  }

  private applyDialogConflict(serverScene: SceneDocument, serverRevision: number): void {
    useEditorStore.setState({
      saveStatus: "conflict",
      saveError: CONFLICT_TEXT,
      message: { kind: "error", text: CONFLICT_TEXT },
      conflict: { serverScene, serverRevision },
    });
  }

  private noteSent(scene: SceneDocument): void {
    this.unconfirmed.push(scene);
    if (this.unconfirmed.length > UNCONFIRMED_LIMIT) this.unconfirmed.shift();
  }

  private async fetchServerScene(): Promise<{ scene: SceneDocument; revision: number } | null> {
    const { projectId } = useEditorStore.getState();
    if (!projectId) return null;
    try {
      const response = await this.fetchImpl(`/api/projects/${projectId}/scene`, {
        method: "GET",
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as {
        data?: { scene?: SceneDocument; revision?: number };
      };
      const data = payload?.data;
      if (!data?.scene || typeof data.revision !== "number") return null;
      return { scene: data.scene, revision: data.revision };
    } catch {
      return null;
    }
  }

  /**
   * Tras un 409 se consulta la escena del servidor y se compara con la local
   * y con las enviadas sin confirmar:
   *  - si el servidor tiene una escritura propia (respuesta perdida), se
   *    adopta el token y se reintenta con los cambios locales;
   *  - si hay cambios ajenos no solapados, se fusionan;
   *  - si solapan, se abre el dialogo sin tocar la escena local.
   */
  private async resolveAgainstServer(): Promise<Resolution> {
    const server = await this.fetchServerScene();
    if (!server) return { kind: "failed" };

    const state = useEditorStore.getState();
    const local = state.scene;

    // El servidor coincide con lo local: no hay nada que guardar.
    if (stableStringify(server.scene) === stableStringify(local)) {
      this.unconfirmed = [];
      useEditorStore.setState({
        revision: server.revision,
        saveStatus: "saved",
        saveError: null,
        lastSavedAt: Date.now(),
        conflict: null,
      });
      this.baseScene = server.scene;
      return { kind: "saved" };
    }

    const ownSent = this.unconfirmed.some(
      (sent) => stableStringify(sent) === stableStringify(server.scene),
    );
    this.unconfirmed = [];
    if (ownSent) {
      // Escritura propia ya aplicada: se adopta el token y se reintenta una
      // vez con los cambios locales posteriores; no se pierde nada.
      useEditorStore.setState({
        revision: server.revision,
        saveError: null,
        conflict: null,
      });
      this.baseScene = server.scene;
      return { kind: "retry" };
    }

    // Cambios ajenos: fusion tres vias sobre la ultima escena comun.
    const base = this.baseScene ?? local;
    const { scene: merged, overlap } = mergeScenes(base, local, server.scene);

    if (overlap) {
      return { kind: "dialog", serverScene: server.scene, serverRevision: server.revision };
    }

    if (stableStringify(merged) === stableStringify(server.scene)) {
      // Lo local esta contenido en el servidor: nada que guardar.
      useEditorStore.setState({
        revision: server.revision,
        saveStatus: "saved",
        saveError: null,
        lastSavedAt: Date.now(),
        conflict: null,
      });
      this.baseScene = server.scene;
      return { kind: "saved" };
    }

    useEditorStore.getState().mergeScene(merged, server.revision);
    this.baseScene = server.scene;
    return { kind: "retry" };
  }

  async resolveConflict(choice: "keep" | "server"): Promise<boolean> {
    const state = useEditorStore.getState();
    if (!state.conflict) return false;
    const { serverScene, serverRevision } = state.conflict;

    if (choice === "server") {
      this.unconfirmed = [];
      useEditorStore.getState().replaceScene(serverScene, serverRevision);
      this.baseScene = serverScene;
      return true;
    }

    // Conservar mis cambios: se adopta la revision del servidor como base y
    // la escena local se vuelve a guardar encima (decision explicita).
    this.unconfirmed = [];
    useEditorStore.setState({
      revision: serverRevision,
      conflict: null,
      saveStatus: "dirty",
      saveError: null,
    });
    this.baseScene = serverScene;
    return this.saveNow();
  }
}

export function createSceneSaver(options: SceneSaverOptions = {}): SceneSaver {
  return new SceneSaveController(options);
}

let defaultSaver: SceneSaver | null = null;

export function getSceneSaver(): SceneSaver {
  if (!defaultSaver) defaultSaver = createSceneSaver();
  return defaultSaver;
}
