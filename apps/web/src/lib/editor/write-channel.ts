/**
 * Canal de escritura serializado del proyecto.
 *
 * Guardados de escena y subidas de archivos comparten un unico mutex FIFO:
 * nunca hay dos peticiones de escritura en vuelo a la vez, asi que la
 * revision que viaja en cada guardado es la mas reciente que el cliente conoce
 * y una subida no puede solaparse con un autosave.
 */

export interface UploadedFileInfo {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  url: string;
}

export interface UploadOptions {
  url: string;
  file: File;
  kind: string;
  fetchImpl?: typeof fetch;
  /** Clave de idempotencia; se genera una por subida si no se indica. */
  clientKey?: string;
  maxAttempts?: number;
  baseDelayMs?: number;
}

export interface UploadOutcome {
  file: UploadedFileInfo;
  /** Revision de la escena del proyecto en el momento de responder. */
  revision?: number;
}

interface UploadPayload {
  data?: { file?: UploadedFileInfo; revision?: number };
  error?: { message?: string };
}

const UPLOAD_MAX_ATTEMPTS = 3;
const UPLOAD_BASE_DELAY_MS = 1000;

class WriteChannel {
  private tail: Promise<unknown> = Promise.resolve();

  /** Ejecuta `fn` cuando el anterior en la cola termino; la cola nunca se rompe. */
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(
      () => fn(),
      () => fn(),
    );
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

let channel: WriteChannel | null = null;

export function getProjectWriteChannel(): WriteChannel {
  if (!channel) channel = new WriteChannel();
  return channel;
}

function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function newClientKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ck-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function defaultFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, init);
}

/**
 * Sube un archivo por el canal serializado, con reintentos idempotentes:
 * todos los intentos reenvian la misma `clientKey`, de modo que si la primera
 * llego al servidor y la respuesta se perdio, el servidor devuelve el archivo
 * ya creado en lugar de duplicarlo.
 */
export async function uploadProjectFile(options: UploadOptions): Promise<UploadOutcome> {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const maxAttempts = options.maxAttempts ?? UPLOAD_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? UPLOAD_BASE_DELAY_MS;
  const clientKey = options.clientKey ?? newClientKey();

  let lastText = "No se pudo subir el archivo";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const form = new FormData();
    form.append("file", options.file);
    form.append("kind", options.kind);
    form.append("clientKey", clientKey);

    let response: Response;
    try {
      // Un intento = una peticion dentro del canal: nunca solapa a un guardado.
      response = await getProjectWriteChannel().run(() =>
        fetchImpl(options.url, { method: "POST", body: form }),
      );
    } catch {
      lastText = "Sin conexion con el servidor";
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)));
        continue;
      }
      break;
    }

    let payload: UploadPayload | null = null;
    try {
      payload = (await response.json()) as UploadPayload;
    } catch {
      payload = null;
    }

    if (response.ok && payload?.data?.file) {
      const revision = payload.data.revision;
      return {
        file: payload.data.file,
        ...(typeof revision === "number" ? { revision } : {}),
      };
    }

    lastText = payload?.error?.message ?? `Error ${response.status} al subir el archivo`;
    if (isRetryable(response.status) && attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)));
      continue;
    }
    break;
  }

  throw new Error(lastText);
}
