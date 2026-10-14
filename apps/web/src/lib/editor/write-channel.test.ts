import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadProjectFile } from "./write-channel";

interface PendingUpload {
  form: FormData;
  respond: (response: unknown) => void;
  fail: (error: unknown) => void;
}

function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

function createFetchMock() {
  const calls: PendingUpload[] = [];
  let responded = 0;
  let maxActive = 0;

  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit) => {
    let settle: { resolve: (r: unknown) => void; reject: (e: unknown) => void } = {
      resolve: () => undefined,
      reject: () => undefined,
    };
    const promise = new Promise((resolve, reject) => {
      settle = { resolve, reject };
    });

    calls.push({
      form: init?.body as FormData,
      respond: (response) => {
        responded += 1;
        settle.resolve(response);
      },
      fail: (error) => {
        responded += 1;
        settle.reject(error);
      },
    });
    maxActive = Math.max(maxActive, calls.length - responded);

    return promise;
  };

  return { fetchImpl, calls, maxActive: () => maxActive };
}

function file(): File {
  return new File([new Uint8Array([1, 2, 3])], "plano.png", { type: "image/png" });
}

function uploadOk(revision?: number) {
  return jsonResponse(201, {
    data: {
      file: {
        id: "file_1",
        originalName: "plano.png",
        mimeType: "image/png",
        sizeBytes: 3,
        width: 100,
        height: 50,
        url: "/api/projects/p1/files/file_1/content",
      },
      ...(typeof revision === "number" ? { revision } : {}),
    },
  });
}

async function until(condition: () => boolean) {
  for (let i = 0; i < 300; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(condition()).toBe(true);
}

let fetchMock: ReturnType<typeof createFetchMock>;

beforeEach(() => {
  fetchMock = createFetchMock();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("uploadProjectFile", () => {
  it("sube, incluye clientKey y devuelve la revision del servidor", async () => {
    const promise = uploadProjectFile({
      url: "/api/projects/p1/files",
      file: file(),
      kind: "floorplan",
      fetchImpl: fetchMock.fetchImpl as typeof fetch,
      clientKey: "ck-test",
    });

    await until(() => fetchMock.calls.length === 1);
    expect(fetchMock.calls[0]?.form.get("clientKey")).toBe("ck-test");
    expect(fetchMock.calls[0]?.form.get("kind")).toBe("floorplan");

    fetchMock.calls[0]?.respond(uploadOk(7));
    const result = await promise;

    expect(result.file.id).toBe("file_1");
    expect(result.revision).toBe(7);
    expect(fetchMock.maxActive()).toBe(1);
  });

  it("un fallo de red reintenta con la misma clientKey y no duplica", async () => {
    const promise = uploadProjectFile({
      url: "/api/projects/p1/files",
      file: file(),
      kind: "floorplan",
      fetchImpl: fetchMock.fetchImpl as typeof fetch,
      clientKey: "ck-retry",
      baseDelayMs: 10,
    });

    await until(() => fetchMock.calls.length === 1);
    fetchMock.calls[0]?.fail(new TypeError("Sin conexion"));

    await until(() => fetchMock.calls.length === 2);
    expect(fetchMock.calls[1]?.form.get("clientKey")).toBe("ck-retry");

    fetchMock.calls[1]?.respond(uploadOk(8));
    const result = await promise;

    expect(result.file.id).toBe("file_1");
    expect(result.revision).toBe(8);
  });

  it("un 400 no reintenta y lanza el error del servidor", async () => {
    const promise = uploadProjectFile({
      url: "/api/projects/p1/files",
      file: file(),
      kind: "floorplan",
      fetchImpl: fetchMock.fetchImpl as typeof fetch,
      clientKey: "ck-400",
    });

    await until(() => fetchMock.calls.length === 1);
    fetchMock.calls[0]?.respond(
      jsonResponse(400, { error: { code: "BAD_REQUEST", message: "Formato no reconocido" } }),
    );

    await expect(promise).rejects.toThrow("Formato no reconocido");
    expect(fetchMock.calls).toHaveLength(1);
  });
});
