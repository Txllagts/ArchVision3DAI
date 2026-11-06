import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/lib/env";

export interface StorageAdapter {
  put(key: string, data: Uint8Array, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
}

export function buildStorageKey(
  projectId: string,
  fileId: string,
  extension: string,
): string {
  const safeExtension = extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `projects/${projectId}/${fileId}.${safeExtension}`;
}

export function checksumOf(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function encodeStoragePath(key: string): string {
  const normalized = key.replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((segment) => segment === ".." || segment === "." || segment === "")) {
    throw new Error("Clave de almacenamiento invalida");
  }
  return normalized
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function jwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
    if (typeof payload === "object" && payload !== null && "role" in payload) {
      const role = (payload as { role?: unknown }).role;
      return typeof role === "string" ? role : null;
    }
    return null;
  } catch {
    return null;
  }
}

const ensuredBuckets = new Set<string>();
const bucketInitPromises = new Map<string, Promise<void>>();

async function ensureSupabaseBucket(
  baseUrl: string,
  serviceRoleKey: string,
  bucket: string,
): Promise<void> {
  const cacheKey = `${baseUrl}::${bucket}`;
  if (ensuredBuckets.has(cacheKey)) return;

  const existing = bucketInitPromises.get(cacheKey);
  if (existing) return existing;

  const task = (async () => {
    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    };
    const checkRes = await fetch(
      `${baseUrl}/storage/v1/bucket/${encodeURIComponent(bucket)}`,
      { method: "GET", headers, cache: "no-store" },
    );

    if (checkRes.ok) {
      ensuredBuckets.add(cacheKey);
      return;
    }

    // Si el bucket no existe (400 / 404 en Supabase Storage API), lo creamos como privado.
    if (checkRes.status === 404 || checkRes.status === 400) {
      const createRes = await fetch(`${baseUrl}/storage/v1/bucket`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: bucket,
          name: bucket,
          public: false,
        }),
        cache: "no-store",
      });

      if (createRes.ok || createRes.status === 409) {
        ensuredBuckets.add(cacheKey);
        return;
      }

      const body = await createRes.text().catch(() => "");
      // Si ya existe (Conflict reportado como 400 "Duplicate"), continuamos.
      if (createRes.status === 400 && /already exists|duplicate/i.test(body)) {
        ensuredBuckets.add(cacheKey);
        return;
      }

      throw new Error(
        `No se pudo crear el bucket '${bucket}' en Supabase Storage (HTTP ${createRes.status}): ${body}`,
      );
    }

    const body = await checkRes.text().catch(() => "");
    throw new Error(
      `Error verificando el bucket '${bucket}' en Supabase Storage (HTTP ${checkRes.status}): ${body}`,
    );
  })().finally(() => {
    bucketInitPromises.delete(cacheKey);
  });

  bucketInitPromises.set(cacheKey, task);
  return task;
}

function localAdapter(rootDir: string): StorageAdapter {
  const root = path.resolve(process.cwd(), rootDir);
  const resolveKey = (key: string): string => {
    const target = path.resolve(root, key);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error("Clave de almacenamiento fuera del directorio permitido");
    }
    return target;
  };
  return {
    async put(key, data) {
      const target = resolveKey(key);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, data);
    },
    async get(key) {
      try {
        return await readFile(resolveKey(key));
      } catch (error) {
        if (!isFileNotFoundError(error)) throw error;
        // Compatibilidad con claves antiguas guardadas con o sin prefijo "projects/"
        if (key.startsWith("projects/")) {
          const legacyKey = key.slice("projects/".length);
          try {
            return await readFile(resolveKey(legacyKey));
          } catch (legacyError) {
            if (!isFileNotFoundError(legacyError)) throw legacyError;
          }
        }
        return null;
      }
    },
    async remove(key) {
      await rm(resolveKey(key), { force: true });
    },
  };
}

function supabaseAdapter(config: {
  supabaseUrl: string;
  serviceRoleKey: string;
  bucket: string;
  localFallbackDir?: string;
}): StorageAdapter {
  const baseUrl = config.supabaseUrl.replace(/\/+$/, "");
  const serviceRoleKey = config.serviceRoleKey.trim();
  const bucket = config.bucket.trim();

  if (jwtRole(serviceRoleKey) !== "service_role") {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY invalida: debe ser la clave service_role del proyecto Supabase (no uses anon key).",
    );
  }

  const fallback = config.localFallbackDir
    ? localAdapter(config.localFallbackDir)
    : null;

  const authHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };

  return {
    async put(key, data, contentType = "application/octet-stream") {
      await ensureSupabaseBucket(baseUrl, serviceRoleKey, bucket);
      const objectPath = encodeStoragePath(key);
      const url = `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath}`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": contentType,
          "x-upsert": "true",
        },
        body: Buffer.from(data),
        cache: "no-store",
      });

      if (!response.ok) {
        const details = await response.text().catch(() => "");
        throw new Error(
          `Error al subir archivo a Supabase Storage (${response.status}): ${details}`,
        );
      }
    },

    async get(key) {
      await ensureSupabaseBucket(baseUrl, serviceRoleKey, bucket);
      const objectPath = encodeStoragePath(key);
      const url = `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath}`;

      const response = await fetch(url, {
        method: "GET",
        headers: authHeaders,
        cache: "no-store",
      });

      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      }

      // En Supabase Storage un objeto inexistente responde con 404 o 400 {"statusCode":"404", "error":"not_found"}
      if (response.status === 404 || response.status === 400) {
        const text = await response.text().catch(() => "");
        const isNotFound =
          response.status === 404 || /not_found|404|no such|object not found/i.test(text);

        if (isNotFound) {
          // Si el archivo fue creado antes en disco local, lo recuperamos y lo migramos a Supabase al vuelo
          if (fallback) {
            const localData = await fallback.get(key);
            if (localData) {
              void this.put(key, localData).catch((err) => {
                console.warn("[storage] no se pudo migrar archivo local a Supabase:", key, err);
              });
              return localData;
            }
          }
          return null;
        }

        throw new Error(
          `Error al descargar archivo de Supabase Storage (${response.status}): ${text}`,
        );
      }

      const details = await response.text().catch(() => "");
      throw new Error(
        `Error al descargar archivo de Supabase Storage (${response.status}): ${details}`,
      );
    },

    async remove(key) {
      await ensureSupabaseBucket(baseUrl, serviceRoleKey, bucket);
      const objectPath = encodeStoragePath(key);
      const url = `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath}`;

      const response = await fetch(url, {
        method: "DELETE",
        headers: authHeaders,
        cache: "no-store",
      });

      if (!response.ok && response.status !== 404 && response.status !== 400) {
        const details = await response.text().catch(() => "");
        throw new Error(
          `Error al eliminar archivo de Supabase Storage (${response.status}): ${details}`,
        );
      }

      if (fallback) {
        await fallback.remove(key).catch(() => undefined);
      }
    },
  };
}

export function storage(): StorageAdapter {
  const env = getEnv();
  switch (env.STORAGE_DRIVER) {
    case "supabase": {
      const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
      if (!supabaseUrl || !serviceRoleKey) {
        throw new Error(
          "STORAGE_DRIVER=supabase requiere SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY en .env.",
        );
      }
      return supabaseAdapter({
        supabaseUrl,
        serviceRoleKey,
        bucket: env.SUPABASE_STORAGE_BUCKET,
        localFallbackDir: env.STORAGE_LOCAL_DIR,
      });
    }
    case "local":
      return localAdapter(env.STORAGE_LOCAL_DIR);
    case "s3":
      throw new Error(
        "STORAGE_DRIVER=s3 requiere un adaptador S3 que aun no esta implementado. Usa STORAGE_DRIVER=supabase o STORAGE_DRIVER=local.",
      );
    default:
      return localAdapter(env.STORAGE_LOCAL_DIR);
  }
}
