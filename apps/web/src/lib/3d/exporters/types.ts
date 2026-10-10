import type { UnitSystem } from "@archvision/types";

/**
 * Tipos del modulo de exportacion.
 *
 * Unico punto de verdad para formatos, unidades y opciones: los exportadores,
 * el modal y las pruebas importan de aqui, nunca redefinen estos tipos.
 */

/** Formatos soportados por el exportador. */
export type ExportFormat = "glb" | "obj" | "stl" | "dxf" | "png";

/** Unidades de salida. Subconjunto de las unidades del proyecto (metros). */
export type ExportUnit = Extract<UnitSystem, "m" | "cm" | "mm">;

export interface ExportOptions {
  format: ExportFormat;
  unit: ExportUnit;
  /** Mobiliario presente en la escena (influye en GLB/OBJ/STL). */
  includeFurniture: boolean;
  /** Materiales PBR y texturas (influye en GLB/OBJ; STL/DXF/PNG no). */
  includeMaterials: boolean;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
}

/**
 * Extension del archivo resultante. OBJ va empaquetado en un ZIP junto con el
 * MTL y las texturas, por eso su extension es `zip`.
 */
export const EXPORT_EXTENSIONS: Record<ExportFormat, string> = {
  glb: "glb",
  obj: "zip",
  stl: "stl",
  dxf: "dxf",
  png: "png",
};
