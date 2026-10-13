"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector2, type PerspectiveCamera } from "three";
import { slugify } from "@/lib/3d/exporters/slug";

export type RenderResolution = "1080p" | "4k";

const RESOLUTIONS: Record<RenderResolution, { width: number; height: number }> = {
  "1080p": { width: 1920, height: 1080 },
  "4k": { width: 3840, height: 2160 },
};

interface CaptureDetail {
  resolution: RenderResolution;
  projectName?: string;
}

interface Originals {
  width: number;
  height: number;
  dpr: number;
  aspect: number;
}

interface PendingCapture {
  filename: string;
}

/**
 * Captura de alta resolucion.
 *
 * La UI (ExportModal) pide un render con el CustomEvent `render-capture`; este
 * componente vive dentro del <Canvas> y hace el trabajo dentro del bucle de
 * render. Se registra con prioridad 2 para ejecutarse DESPUES del
 * <EffectComposer> (prioridad 1) y capturar asi el frame con N8AO y Bloom.
 */
export function RenderExporter() {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera) as PerspectiveCamera;

  const pendingRef = useRef<PendingCapture | null>(null);
  const originalsRef = useRef<Originals | null>(null);

  const restore = () => {
    const originals = originalsRef.current;
    if (!originals) return;
    gl.setPixelRatio(originals.dpr);
    gl.setSize(originals.width, originals.height, false);
    camera.aspect = originals.aspect;
    camera.updateProjectionMatrix();
    originalsRef.current = null;
  };

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<CaptureDetail>).detail;
      // Una captura a la vez: si ya hay una en curso se ignora.
      if (!detail || pendingRef.current) return;

      const size = gl.getSize(new Vector2());
      originalsRef.current = {
        width: size.x,
        height: size.y,
        dpr: gl.getPixelRatio(),
        aspect: camera.aspect,
      };

      const { width, height } = RESOLUTIONS[detail.resolution];
      gl.setPixelRatio(1);
      gl.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();

      // NOTA: el <EffectComposer> de @react-three/postprocessing se
      // auto-redimensiona cada frame leyendo gl.getSize()/gl.getPixelRatio(),
      // por lo que no hace falta composer.setSize(W, H) manual. Si algun dia
      // se monta un composer sin esa sincronizacion, llamar a setSize aqui.

      const base = slugify(detail.projectName ?? "") || "proyecto";
      pendingRef.current = {
        filename: `Render-${base}-${detail.resolution}.png`,
      };
    };

    window.addEventListener("render-capture", handler);
    return () => {
      window.removeEventListener("render-capture", handler);
      // Si el visor se desmonta a mitad de una captura, no dejar la escena
      // atrapada en la resolucion alta.
      restore();
      pendingRef.current = null;
    };
  }, [camera, gl]);

  useFrame(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    // Desactiva el flag PRIMERO para no repetir la captura en el siguiente frame.
    pendingRef.current = null;

    let success = false;
    let message: string | undefined;
    try {
      // toDataURL es sincrono y lee el framebuffer ya renderizado por el
      // composer en este frame (prioridad 1 < 2): incluye N8AO y Bloom.
      const dataUrl = gl.domElement.toDataURL("image/png", 1.0);
      if (!dataUrl || dataUrl === "data:," || dataUrl.length < 16) {
        throw new Error("El navegador no pudo generar la imagen PNG");
      }
      downloadDataUrl(dataUrl, pending.filename);
      success = true;
    } catch (error) {
      message =
        error instanceof Error ? error.message : "No se pudo generar el render";
    } finally {
      // Restaurar SIEMPRE: si falla, la escena no queda en 4K.
      restore();
    }

    window.dispatchEvent(
      new CustomEvent("render-capture-done", { detail: { success, message } }),
    );
  }, 2);

  return null;
}

function downloadDataUrl(dataUrl: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
