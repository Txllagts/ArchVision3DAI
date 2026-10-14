import type { SceneDocument } from "@archvision/types";
import type { ActiveViewport } from "@/lib/3d/active-scene";
import { useEditorStore } from "@/lib/editor/store";
import { exportDxf } from "./dxf-exporter";
import { exportGlb } from "./gltf-exporter";
import { exportObj } from "./obj-exporter";
import { exportPng } from "./png-exporter";
import { prepareSceneForExport } from "./scene-prep";
import { slugify } from "./slug";
import { exportStl } from "./stl-exporter";
import {
  EXPORT_EXTENSIONS,
  type ExportFormat,
  type ExportOptions,
  type ExportResult,
} from "./types";

export * from "./types";

/**
 * Fuente de datos para exportar: el visor 3D activo (GLB/OBJ/STL/PNG) o el
 * esquema parametrico `SceneDocument` (DXF).
 */
export type ExportSource = ActiveViewport | SceneDocument;

/**
 * Punto de entrada unico del modulo de exportacion. Prepara la escena,
 * delega en el exportador del formato elegido y libera los recursos clonados
 * antes de resolver.
 */
export async function exportScene(
  options: ExportOptions,
  source: ExportSource,
): Promise<ExportResult> {
  const filename = buildFilename(options.format);

  if (options.format === "dxf") {
    if (isViewport(source)) {
      throw new Error("El DXF se genera a partir del plano 2D, no del visor 3D");
    }
    return { blob: exportDxf(source, options), filename };
  }

  if (options.format === "png") {
    if (!isViewport(source)) {
      throw new Error("La captura PNG necesita el visor 3D activo");
    }
    return { blob: await exportPng(source), filename };
  }

  if (!isViewport(source)) {
    throw new Error(
      `El formato ${options.format.toUpperCase()} necesita el visor 3D activo`,
    );
  }

  const prepared = prepareSceneForExport(source.scene, options);
  try {
    let blob: Blob;
    switch (options.format) {
      case "glb":
        blob = await exportGlb(prepared.root);
        break;
      case "obj":
        blob = await exportObj(prepared.root);
        break;
      default:
        blob = exportStl(prepared.root);
        break;
    }
    return { blob, filename };
  } finally {
    prepared.dispose();
  }
}

function isViewport(source: ExportSource): source is ActiveViewport {
  return (source as ActiveViewport).gl !== undefined;
}

function buildFilename(format: ExportFormat): string {
  const { projectName } = useEditorStore.getState();
  const base = slugify(projectName) || "modelo";
  return `${base}.${EXPORT_EXTENSIONS[format]}`;
}
