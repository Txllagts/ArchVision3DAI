import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/lib/env";

export interface StorageAdapter {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
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
      return readFile(resolveKey(key));
    },
    async remove(key) {
      await rm(resolveKey(key), { force: true });
    },
  };
}

export function storage(): StorageAdapter {
  const env = getEnv();
  switch (env.STORAGE_DRIVER) {
    case "local":
      return localAdapter(env.STORAGE_LOCAL_DIR);
    case "s3":
      throw new Error(
        "STORAGE_DRIVER=s3 requiere un adaptador S3 que aun no esta implementado. Usa STORAGE_DRIVER=local.",
      );
    default:
      return localAdapter(env.STORAGE_LOCAL_DIR);
  }
}
