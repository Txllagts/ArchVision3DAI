import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export interface Storage {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

const root = path.resolve(process.env.FILE_STORAGE_DIR ?? ".storage");

function safePath(key: string): string {
  const resolved = path.resolve(root, key);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid storage key");
  }
  return resolved;
}

const localStorage: Storage = {
  async put(key, data) {
    const filename = safePath(key);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, data);
  },

  async get(key) {
    return readFile(safePath(key));
  },

  async remove(key) {
    await unlink(safePath(key));
  },
};

export function storage(): Storage {
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
