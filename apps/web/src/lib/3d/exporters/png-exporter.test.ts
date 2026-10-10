import { describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, Scene, type WebGLRenderer } from "three";
import type { ActiveViewport } from "../active-scene";
import { exportPng } from "./png-exporter";

function fakeViewport(result: Blob | null) {
  const toBlob = vi.fn((callback: BlobCallback) => {
    callback(result);
  });
  const render = vi.fn();
  const gl = {
    render,
    domElement: { toBlob } as unknown as HTMLCanvasElement,
  } as unknown as WebGLRenderer;
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  return {
    viewport: { scene, camera, gl } satisfies ActiveViewport,
    render,
    toBlob,
  };
}

describe("exportPng", () => {
  it("fuerza un render con la camara activa antes de leer el canvas", async () => {
    const { viewport, render, toBlob } = fakeViewport(
      new Blob(["png"], { type: "image/png" }),
    );

    await exportPng(viewport);

    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(viewport.scene, viewport.camera);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png");
    // El render ocurre siempre antes de tocar el canvas.
    expect(render.mock.invocationCallOrder[0]).toBeLessThan(
      toBlob.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("resuelve con el blob devuelto por el navegador", async () => {
    const blob = new Blob(["png-bytes"], { type: "image/png" });
    const { viewport } = fakeViewport(blob);

    await expect(exportPng(viewport)).resolves.toBe(blob);
  });

  it("rechaza si el navegador devuelve un blob nulo", async () => {
    const { viewport } = fakeViewport(null);

    await expect(exportPng(viewport)).rejects.toThrow(
      "El navegador no pudo generar la imagen PNG",
    );
  });

  it("rechaza si el blob viene vacio", async () => {
    const { viewport } = fakeViewport(new Blob([], { type: "image/png" }));

    await expect(exportPng(viewport)).rejects.toThrow(
      "El navegador no pudo generar la imagen PNG",
    );
  });
});
