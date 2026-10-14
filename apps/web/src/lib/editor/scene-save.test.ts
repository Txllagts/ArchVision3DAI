import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultScene } from "@archvision/shared";
import type { SceneDocument, Wall } from "@archvision/types";
import {
  createSceneSaver,
  type SceneSaver,
  type SceneSaverOptions,
} from "./scene-save";
import { uploadProjectFile } from "./write-channel";
import { hasUnsavedChanges, useEditorStore } from "./store";

const DEBOUNCE_MS = 100;
const TIMEOUT_MS = 50;
const BACKOFF_MS = 1000;
const MAX_ATTEMPTS = 4;

interface PendingCall {
  method: string;
  url: string;
  body: { scene?: SceneDocument; expectedRevision?: number } | null;
  form: FormData | null;
  respond: (response: unknown) => void;
}

function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

function createFetchMock() {
  const calls: PendingCall[] = [];
  let responded = 0;
  let maxActive = 0;

  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit) => {
    let settle: { resolve: (response: Response) => void } = {
      resolve: () => undefined,
    };
    const promise = new Promise<Response>((resolve) => {
      settle = { resolve };
    });

    const rawBody = init?.body;
    let body: PendingCall["body"] = null;
    let form: FormData | null = null;
    if (rawBody instanceof FormData) form = rawBody;
    else if (typeof rawBody === "string") body = JSON.parse(rawBody) as PendingCall["body"];

    calls.push({
      method: init?.method ?? "GET",
      url: String(input),
      body,
      form,
      respond: (response) => {
        responded += 1;
        settle.resolve(response as Response);
      },
    });
    maxActive = Math.max(maxActive, calls.length - responded);

    return promise;
  };

  return { fetchImpl, calls, maxActive: () => maxActive };
}

async function flushMicrotasks() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await flushMicrotasks();
}

async function until(condition: () => boolean) {
  for (let i = 0; i < 100 && !condition(); i += 1) {
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(0);
  }
  expect(condition()).toBe(true);
}

let saver: SceneSaver | null = null;
let fetchMock: ReturnType<typeof createFetchMock>;

function startSaver(options: Partial<SceneSaverOptions> = {}) {
  saver?.stop();
  saver = createSceneSaver({
    fetchImpl: fetchMock.fetchImpl,
    debounceMs: DEBOUNCE_MS,
    timeoutMs: 60000,
    maxAttempts: MAX_ATTEMPTS,
    baseDelayMs: BACKOFF_MS,
    maxDelayMs: 8000,
    random: () => 1,
    ...options,
  });
  saver.start();
  return saver;
}

function editedScene(groundColor: string): SceneDocument {
  const scene = useEditorStore.getState().scene;
  return { ...scene, environment: { ...scene.environment, groundColor } };
}

function edit(groundColor: string) {
  useEditorStore.setState({
    scene: editedScene(groundColor),
    saveStatus: "dirty",
  });
}

function respondCall(index: number, response: unknown) {
  const call = fetchMock.calls[index];
  if (!call) throw new Error(`No existe la llamada ${index}`);
  call.respond(response);
}

function serverError(status: number, message: string) {
  return jsonResponse(status, { error: { code: "TEST", message } });
}

function conflictError(currentRevision: number) {
  return jsonResponse(409, {
    error: {
      code: "CONFLICT",
      message: "La escena fue modificada por otra sesion",
      details: { currentRevision },
    },
  });
}

function getSceneOk(scene: SceneDocument, revision: number) {
  return jsonResponse(200, { data: { scene, revision } });
}

function wall(id: string, overrides: Partial<Wall> = {}): Wall {
  return {
    id,
    floorId: "flr_1",
    name: `Muro ${id}`,
    start: { x: 0, y: 0 },
    end: { x: 4, y: 0 },
    height: 2.7,
    thickness: 0.15,
    baseOffset: 0,
    visible: true,
    locked: false,
    ...overrides,
  };
}

function sceneWith(walls: Wall[]): SceneDocument {
  const scene = createDefaultScene();
  // ids estables: `createDefaultScene` genera ids aleatorios por llamada y
  // el merge los veria como entidades distintas en cada rama.
  return {
    ...scene,
    floors: [
      { id: "flr_1", name: "Planta baja", level: 0, elevation: 0, height: 2.7, visible: true, locked: false },
    ],
    walls,
    activeFloorId: "flr_1",
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  useEditorStore.getState().initialize({
    projectId: "prj_test",
    projectName: "Proyecto de prueba",
    units: "m",
    scene: createDefaultScene(),
    revision: 5,
  });
  fetchMock = createFetchMock();
});

afterEach(() => {
  saver?.stop();
  saver = null;
  vi.useRealTimers();
});

describe("guardado de escena", () => {
  it("dos cambios rapidos: un solo request en vuelo y el ultimo estado es el que se guarda", async () => {
    startSaver();
    const primera = editedScene("#111111");
    useEditorStore.setState({ scene: primera, saveStatus: "dirty" });

    await advance(DEBOUNCE_MS);
    expect(fetchMock.calls).toHaveLength(1);
    expect(fetchMock.maxActive()).toBe(1);

    const segunda = editedScene("#222222");
    useEditorStore.setState({ scene: segunda, saveStatus: "dirty" });
    await advance(DEBOUNCE_MS);

    expect(fetchMock.calls).toHaveLength(1);
    expect(fetchMock.maxActive()).toBe(1);

    respondCall(0, jsonResponse(200, { data: { revision: 6 } }));
    await until(() => fetchMock.calls.length === 2);

    expect(fetchMock.calls[1]?.body?.expectedRevision).toBe(6);
    expect(JSON.stringify(fetchMock.calls[1]?.body?.scene)).toBe(
      JSON.stringify(segunda),
    );

    respondCall(1, jsonResponse(200, { data: { revision: 7 } }));
    await until(() => useEditorStore.getState().saveStatus === "saved");

    const state = useEditorStore.getState();
    expect(state.revision).toBe(7);
    expect(fetchMock.calls).toHaveLength(2);
    expect(fetchMock.maxActive()).toBe(1);
    expect(hasUnsavedChanges(state)).toBe(false);
  });

  it("una respuesta lenta del guardado A no sobrescribe el resultado del guardado B", async () => {
    startSaver({ timeoutMs: TIMEOUT_MS });
    edit("#111111");

    await advance(DEBOUNCE_MS);
    expect(fetchMock.calls).toHaveLength(1);

    await advance(TIMEOUT_MS);
    expect(fetchMock.calls).toHaveLength(1);

    await advance(BACKOFF_MS);
    await until(() => fetchMock.calls.length === 2);

    respondCall(1, jsonResponse(200, { data: { revision: 7 } }));
    await until(() => useEditorStore.getState().saveStatus === "saved");
    expect(useEditorStore.getState().revision).toBe(7);

    respondCall(0, jsonResponse(200, { data: { revision: 6 } }));
    await flushMicrotasks();

    const state = useEditorStore.getState();
    expect(state.revision).toBe(7);
    expect(state.saveStatus).toBe("saved");
    expect(state.saveError).toBeNull();
    expect(fetchMock.calls).toHaveLength(2);
  });

  it("un 503 reintenta con backoff y termina guardando", async () => {
    startSaver();
    edit("#111111");

    await advance(DEBOUNCE_MS);
    expect(fetchMock.calls).toHaveLength(1);

    respondCall(0, serverError(503, "Servidor no disponible"));
    await flushMicrotasks();
    expect(fetchMock.calls).toHaveLength(1);

    await advance(BACKOFF_MS - 1);
    expect(fetchMock.calls).toHaveLength(1);

    await advance(1);
    await until(() => fetchMock.calls.length === 2);
    expect(fetchMock.maxActive()).toBe(1);

    respondCall(1, jsonResponse(200, { data: { revision: 6 } }));
    await until(() => useEditorStore.getState().saveStatus === "saved");

    const state = useEditorStore.getState();
    expect(state.revision).toBe(6);
    expect(state.saveError).toBeNull();
    expect(fetchMock.calls).toHaveLength(2);
  });

  it("un 422 no reintenta y muestra el error del servidor", async () => {
    startSaver();
    edit("#111111");

    await advance(DEBOUNCE_MS);
    expect(fetchMock.calls).toHaveLength(1);

    respondCall(0, serverError(422, "Escena invalida"));
    await until(() => useEditorStore.getState().saveStatus === "error");

    const state = useEditorStore.getState();
    expect(state.saveError).toContain("Escena invalida");
    expect(state.message?.text).toContain("Escena invalida");
    expect(hasUnsavedChanges(state)).toBe(true);

    await advance(60000);
    expect(fetchMock.calls).toHaveLength(1);
  });

  it("tras agotar los reintentos el estado en memoria y el pendiente se mantienen", async () => {
    startSaver();
    const escenaEditada = editedScene("#333333");
    useEditorStore.setState({
      scene: escenaEditada,
      saveStatus: "dirty",
    });

    await advance(DEBOUNCE_MS);
    expect(fetchMock.calls).toHaveLength(1);

    const delays = [BACKOFF_MS, BACKOFF_MS * 2, BACKOFF_MS * 4];
    for (const delay of delays) {
      const antes = fetchMock.calls.length;
      respondCall(antes - 1, serverError(503, "Servidor no disponible"));
      await flushMicrotasks();
      expect(fetchMock.calls).toHaveLength(antes);
      await advance(delay);
      await until(() => fetchMock.calls.length === antes + 1);
    }

    expect(fetchMock.calls).toHaveLength(MAX_ATTEMPTS);

    respondCall(MAX_ATTEMPTS - 1, serverError(503, "Servidor no disponible"));
    await until(() => useEditorStore.getState().saveStatus === "error");
    await advance(60000);
    expect(fetchMock.calls).toHaveLength(MAX_ATTEMPTS);

    const state = useEditorStore.getState();
    expect(state.scene).toBe(escenaEditada);
    expect(hasUnsavedChanges(state)).toBe(true);
    expect(state.saveStatus).toBe("error");
    expect(state.saveError).toContain(`${MAX_ATTEMPTS} intentos`);
    expect(state.message?.text).toContain(`${MAX_ATTEMPTS} intentos`);
  });
});

describe("conflicto de version", () => {
  it("una respuesta perdida tras un guardado exitoso no genera conflicto permanente", async () => {
    startSaver({ timeoutMs: TIMEOUT_MS });
    const escena = editedScene("#111111");
    useEditorStore.setState({ scene: escena, saveStatus: "dirty" });

    // El servidor aplico el guardado (revision 6) pero la respuesta no llega.
    await advance(DEBOUNCE_MS);
    expect(fetchMock.calls).toHaveLength(1);
    await advance(TIMEOUT_MS);
    await advance(BACKOFF_MS);
    await until(() => fetchMock.calls.length === 2);

    // El reintento lleva la revision vieja: 409 con la actual.
    respondCall(1, conflictError(6));
    await until(() => fetchMock.calls.length === 3);
    expect(fetchMock.calls[2]?.method).toBe("GET");

    // El servidor tiene exactamente lo que enviamos: escritura propia, no
    // hace falta un PUT adicional.
    respondCall(2, getSceneOk(JSON.parse(JSON.stringify(escena)) as SceneDocument, 6));
    await until(() => useEditorStore.getState().saveStatus === "saved");
    expect(fetchMock.calls).toHaveLength(3);

    const state = useEditorStore.getState();
    expect(state.revision).toBe(6);
    expect(state.conflict).toBeNull();
    expect(state.saveError).toBeNull();
    expect(hasUnsavedChanges(state)).toBe(false);
  });

  it("un upload seguido de un autosave usa el token actualizado y no genera conflicto", async () => {
    startSaver();
    edit("#111111");
    await advance(DEBOUNCE_MS);
    respondCall(0, jsonResponse(200, { data: { revision: 6 } }));
    await until(() => useEditorStore.getState().saveStatus === "saved");
    expect(useEditorStore.getState().revision).toBe(6);

    // El upload devuelve la revision vigente y el cliente la adopta.
    useEditorStore.getState().adoptRevision(6);
    expect(useEditorStore.getState().revision).toBe(6);

    edit("#222222");
    await advance(DEBOUNCE_MS);
    await until(() => fetchMock.calls.length === 2);
    expect(fetchMock.calls[1]?.body?.expectedRevision).toBe(6);

    respondCall(1, jsonResponse(200, { data: { revision: 7 } }));
    await until(() => useEditorStore.getState().saveStatus === "saved");
    expect(useEditorStore.getState().conflict).toBeNull();
    expect(useEditorStore.getState().revision).toBe(7);
  });

  it("el autosave y un upload se serializan con un solo request en vuelo", async () => {
    startSaver();
    edit("#111111");
    await advance(DEBOUNCE_MS);
    expect(fetchMock.calls).toHaveLength(1);
    expect(fetchMock.maxActive()).toBe(1);

    const upload = uploadProjectFile({
      url: "/api/projects/prj_test/files",
      file: new File([new Uint8Array([1])], "plano.png", { type: "image/png" }),
      kind: "floorplan",
      fetchImpl: fetchMock.fetchImpl as typeof fetch,
      clientKey: "ck-serial",
    });

    // El upload espera en el canal: el PUT sigue siendo el unico en vuelo.
    await flushMicrotasks();
    expect(fetchMock.calls).toHaveLength(1);

    respondCall(0, jsonResponse(200, { data: { revision: 6 } }));
    await until(() => fetchMock.calls.length === 2);
    expect(fetchMock.calls[1]?.method).toBe("POST");
    expect(fetchMock.calls[1]?.form?.get("clientKey")).toBe("ck-serial");
    expect(fetchMock.maxActive()).toBe(1);

    fetchMock.calls[1]?.respond(
      jsonResponse(201, {
        data: {
          file: {
            id: "file_1",
            originalName: "plano.png",
            mimeType: "image/png",
            sizeBytes: 1,
            width: null,
            height: null,
            url: "/api/projects/prj_test/files/file_1/content",
          },
          revision: 6,
        },
      }),
    );
    await upload;
    await until(() => useEditorStore.getState().saveStatus === "saved");
    expect(useEditorStore.getState().revision).toBe(6);
  });

  it("cambios ajenos no solapados se fusionan y se guardan sin dialogo", async () => {
    useEditorStore.getState().initialize({
      projectId: "prj_test",
      projectName: "Proyecto de prueba",
      units: "m",
      scene: sceneWith([wall("w1")]),
      revision: 5,
    });
    startSaver();

    // Local anade w-local; otra sesion anade w-server sobre la misma base.
    useEditorStore.setState({
      scene: sceneWith([wall("w1"), wall("w-local")]),
      saveStatus: "dirty",
    });
    await advance(DEBOUNCE_MS);
    expect(fetchMock.calls).toHaveLength(1);
    expect(fetchMock.calls[0]?.body?.expectedRevision).toBe(5);

    respondCall(0, conflictError(6));
    await until(() => fetchMock.calls.length === 2);
    respondCall(1, getSceneOk(sceneWith([wall("w1"), wall("w-server")]), 6));

    await until(() => fetchMock.calls.length === 3);
    expect(fetchMock.calls[2]?.body?.expectedRevision).toBe(6);
    const reenviada = fetchMock.calls[2]?.body?.scene as SceneDocument;
    expect(reenviada.walls.map((item) => item.id).sort()).toEqual([
      "w-local",
      "w-server",
      "w1",
    ]);
    expect(useEditorStore.getState().conflict).toBeNull();

    respondCall(2, jsonResponse(200, { data: { revision: 7 } }));
    await until(() => useEditorStore.getState().saveStatus === "saved");

    const state = useEditorStore.getState();
    expect(state.revision).toBe(7);
    expect(state.conflict).toBeNull();
    expect(state.scene.walls.map((item) => item.id).sort()).toEqual([
      "w-local",
      "w-server",
      "w1",
    ]);
  });

  it("cambios solapados abren el dialogo y conservar mis cambios guarda y limpia el indicador", async () => {
    useEditorStore.getState().initialize({
      projectId: "prj_test",
      projectName: "Proyecto de prueba",
      units: "m",
      scene: sceneWith([wall("w1")]),
      revision: 5,
    });
    startSaver();

    const local = sceneWith([wall("w1", { height: 3 })]);
    useEditorStore.setState({ scene: local, saveStatus: "dirty" });
    await advance(DEBOUNCE_MS);

    respondCall(0, conflictError(6));
    await until(() => fetchMock.calls.length === 2);
    const serverScene = sceneWith([wall("w1", { height: 4 })]);
    respondCall(1, getSceneOk(serverScene, 6));

    await until(() => useEditorStore.getState().saveStatus === "conflict");
    const conflicto = useEditorStore.getState().conflict;
    expect(conflicto?.serverRevision).toBe(6);
    // Los cambios locales siguen en memoria hasta resolverse.
    expect(useEditorStore.getState().scene).toBe(local);

    const promesa = saver?.resolveConflict("keep");
    await until(() => fetchMock.calls.length === 3);
    expect(fetchMock.calls[2]?.body?.expectedRevision).toBe(6);
    respondCall(2, jsonResponse(200, { data: { revision: 7 } }));

    expect(await promesa).toBe(true);
    await until(() => useEditorStore.getState().saveStatus === "saved");
    const state = useEditorStore.getState();
    expect(state.conflict).toBeNull();
    expect(state.revision).toBe(7);
    expect(state.scene.walls[0]?.height).toBe(3);

    // Tras resolver se puede volver a guardar.
    edit("#333333");
    await advance(DEBOUNCE_MS);
    await until(() => fetchMock.calls.length === 4);
    expect(fetchMock.calls[3]?.body?.expectedRevision).toBe(7);
    respondCall(3, jsonResponse(200, { data: { revision: 8 } }));
    await until(() => useEditorStore.getState().saveStatus === "saved");
    expect(useEditorStore.getState().revision).toBe(8);
  });

  it("usar la version del servidor reemplaza la escena y limpia el indicador", async () => {
    useEditorStore.getState().initialize({
      projectId: "prj_test",
      projectName: "Proyecto de prueba",
      units: "m",
      scene: sceneWith([wall("w1")]),
      revision: 5,
    });
    startSaver();

    useEditorStore.setState({
      scene: sceneWith([wall("w1", { height: 3 })]),
      saveStatus: "dirty",
    });
    await advance(DEBOUNCE_MS);

    respondCall(0, conflictError(6));
    await until(() => fetchMock.calls.length === 2);
    const serverScene = sceneWith([wall("w1", { height: 4 })]);
    respondCall(1, getSceneOk(serverScene, 6));
    await until(() => useEditorStore.getState().saveStatus === "conflict");

    const resuelto = await saver?.resolveConflict("server");
    expect(resuelto).toBe(true);

    const state = useEditorStore.getState();
    expect(state.conflict).toBeNull();
    expect(state.revision).toBe(6);
    expect(state.saveStatus).toBe("saved");
    expect(state.scene.walls[0]?.height).toBe(4);
  });
});
