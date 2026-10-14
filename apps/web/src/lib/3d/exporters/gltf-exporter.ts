import type { Object3D } from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

/**
 * Exporta la escena como GLB (glTF 2.0 binario).
 *
 * Las texturas `DataTexture` procedurales y las cargadas desde GLB se
 * incrustan en el propio binario (`binary: true`), de modo que el archivo es
 * autocontenido.
 */
export async function exportGlb(root: Object3D): Promise<Blob> {
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(root, {
    binary: true,
    onlyVisible: true,
  });

  if (!(result instanceof ArrayBuffer)) {
    throw new Error("La exportacion GLB no produjo un binario valido");
  }

  return new Blob([result], { type: "model/gltf-binary" });
}
