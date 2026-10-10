import type { ActiveViewport } from "../active-scene";

/**
 * Captura el visor 3D como imagen PNG.
 *
 * El Canvas se configura con `preserveDrawingBuffer: true`, de modo que el
 * framebuffer conserva el ultimo frame pintado; aun asi se fuerza un
 * `render` previo para capturar el estado exacto del momento del clic y no
 * un frame anterior del bucle de animacion.
 */
export function exportPng(viewport: ActiveViewport): Promise<Blob> {
  const { gl, scene, camera } = viewport;
  gl.render(scene, camera);

  return new Promise((resolve, reject) => {
    gl.domElement.toBlob(
      (blob) => {
        if (blob && blob.size > 0) {
          resolve(blob);
          return;
        }
        reject(new Error("El navegador no pudo generar la imagen PNG"));
      },
      "image/png",
    );
  });
}
