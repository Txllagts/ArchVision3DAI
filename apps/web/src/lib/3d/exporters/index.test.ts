import { describe, expect, it, vi } from "vitest";
import { createEmptyScene } from "@archvision/types";
import { PerspectiveCamera, Scene, type WebGLRenderer } from "three";
import type { ActiveViewport } from "../active-scene";
import { exportScene } from "./index";
import type { ExportFormat, ExportOptions } from "./types";

function options(format: ExportFormat): ExportOptions {
  return {
    format,
    unit: "m",
    includeFurniture: true,
    includeMaterials: true,
  };
}

function fakeViewport(): ActiveViewport {
  const gl = {
    render: vi.fn(),
    domElement: {
      toBlob: (callback: BlobCallback) => {
        callback(new Blob(["png"], { type: "image/png" }));
      },
    } as unknown as HTMLCanvasElement,
  } as unknown as WebGLRenderer;
  return { scene: new Scene(), camera: new PerspectiveCamera(), gl };
}

describe("exportScene (despacho por fuente)", () => {
  it("genera PNG desde el visor activo con extension .png", async () => {
    const { blob, filename } = await exportScene(options("png"), fakeViewport());

    expect(filename).toMatch(/\.png$/);
    expect(blob.type).toBe("image/png");
  });

  it("rechaza PNG cuando la fuente es el plano 2D", async () => {
    await expect(exportScene(options("png"), createEmptyScene())).rejects.toThrow(
      "La captura PNG necesita el visor 3D activo",
    );
  });

  it("rechaza los formatos de malla sin visor 3D", async () => {
    await expect(exportScene(options("glb"), createEmptyScene())).rejects.toThrow(
      "El formato GLB necesita el visor 3D activo",
    );
  });
});
