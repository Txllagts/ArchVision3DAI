import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/lib/env";

export interface Storage {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

function safePath(root: string, key: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, key);
  const relative = path.relative(resolvedRoot, resolved);

  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Invalid storage key");
  }

  return resolved;
}

const localStorage: Storage = {
  async put(key, data) {
    const filename = safePath(getEnv().STORAGE_LOCAL_DIR, key);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, data);
  },

  async get(key) {
    return readFile(safePath(getEnv().STORAGE_LOCAL_DIR, key));
  },

  async remove(key) {
    await unlink(safePath(getEnv().STORAGE_LOCAL_DIR, key));
  },
};

export function storage(): Storage {
  const env = getEnv();
  if (env.STORAGE_DRIVER !== "local") {
    throw new Error(
      "STORAGE_DRIVER=s3 no está implementado; configura STORAGE_DRIVER=local.",
    );
  }
  return localStorage;
}

export function buildStorageKey(
  projectId: string,
  fileId: string,
  extension: string,
): string {
  return path.posix.join(projectId, `${fileId}.${extension}`);
}

export function checksumOf(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
