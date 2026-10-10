import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import type { Object3D } from "three";

/**
 * Exporta la escena como STL binario.
 *
 * STL es un formato solo geometrico: ignora materiales, colores y texturas
 * (esa limitacion se explica en la interfaz antes de exportar).
 */
export function exportStl(root: Object3D): Blob {
  const data = new STLExporter().parse(root, { binary: true });

  if (typeof data === "string") {
    throw new Error("La exportacion STL no produjo un binario valido");
  }

  // STLExporter devuelve un DataView; el binario vive en su buffer.
  return new Blob([data.buffer as ArrayBuffer], { type: "model/stl" });
}
