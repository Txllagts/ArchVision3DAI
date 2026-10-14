import JSZip from "jszip";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import {
  Color,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
} from "three";
import { slugify } from "./slug";

/**
 * Exporta la escena como ZIP con OBJ + MTL + texturas.
 *
 * OBJExporter de three.js escribe la geometria y las referencias `usemtl`, pero
 * no genera MTL: aqui se construye a mano a partir de los
 * `MeshStandardMaterial` de la escena (Kd difuso, Ks/Ns especular, d opacidad,
 * `map_Kd` difuso y `norm` normal) y las texturas se vuelcan como PNG dentro
 * de `textures/`.
 */

const OBJ_FILENAME = "modelo.obj";
const MTL_FILENAME = "modelo.mtl";

interface MtlContext {
  /** Ruta dentro del ZIP -> PNG pendiente de generar. */
  files: Map<string, Promise<Blob>>;
  /** Misma textura reutilizada entre materiales -> misma ruta. */
  byTexture: Map<Texture, string>;
}

export async function exportObj(root: Object3D): Promise<Blob> {
  const context: MtlContext = { files: new Map(), byTexture: new Map() };

  const mtlParts: string[] = [];
  for (const material of collectMaterials(root)) {
    mtlParts.push(mtlEntry(material, context));
  }

  // OBJExporter no escribe `mtllib`: se antepone para que el importador sepa
  // donde estan los materiales.
  const objText = `mtllib ${MTL_FILENAME}\n${new OBJExporter().parse(root)}`;

  const zip = new JSZip();
  zip.file(OBJ_FILENAME, objText);
  zip.file(MTL_FILENAME, `${mtlParts.join("\n")}\n`);

  for (const [path, pending] of context.files) {
    try {
      zip.file(path, await pending);
    } catch {
      // Una textura no exportable no debe invalidar el modelo completo.
    }
  }

  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

function collectMaterials(root: Object3D): Material[] {
  const materials: Material[] = [];
  const seen = new Set<Material>();

  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of list) {
      if (seen.has(material)) continue;
      seen.add(material);
      materials.push(material);
    }
  });

  return materials;
}

function mtlEntry(material: Material, context: MtlContext): string {
  const standard = material as MeshStandardMaterial;
  const name = material.name || "material";
  const lines = [`newmtl ${name}`];

  const color = standard.color instanceof Color ? standard.color : new Color(0xcccccc);
  lines.push(`Kd ${fmt(color.r)} ${fmt(color.g)} ${fmt(color.b)}`);
  lines.push("Ks 0.05 0.05 0.05");

  const roughness = typeof standard.roughness === "number" ? standard.roughness : 0.8;
  const ns = Math.max(2, Math.min(1000, Math.round(100 * (1 - roughness))));
  lines.push(`Ns ${ns}`);

  const opacity = typeof standard.opacity === "number" ? standard.opacity : 1;
  lines.push(`d ${fmt(opacity)}`);
  lines.push("illum 2");

  const diffuse = tryTexturePath(standard.map, name, "d", context);
  if (diffuse) lines.push(`map_Kd ${diffuse}`);

  const normal = tryTexturePath(standard.normalMap, name, "n", context);
  if (normal) lines.push(`norm ${normal}`);

  return lines.join("\n");
}

function tryTexturePath(
  texture: Texture | null,
  materialName: string,
  role: string,
  context: MtlContext,
): string | null {
  if (!texture) return null;
  const known = context.byTexture.get(texture);
  if (known) return known;

  const base = slugify(materialName) || "textura";
  let path = `textures/${base}_${role}.png`;
  let suffix = 2;
  while (context.files.has(path)) path = `textures/${base}_${role}_${suffix++}.png`;

  context.files.set(path, textureToPng(texture));
  context.byTexture.set(texture, path);
  return path;
}

function textureToPng(texture: Texture): Promise<Blob> {
  const image: unknown = texture.image;
  const canvas = document.createElement("canvas");

  if (isRasterImage(image)) {
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) return Promise.reject(new Error("Canvas 2D no disponible"));
    if (image.data.length !== image.width * image.height * 4) {
      return Promise.reject(new Error("La textura no esta en formato RGBA"));
    }
    context.putImageData(
      new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
      0,
      0,
    );
  } else if (isDrawableImage(image)) {
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) return Promise.reject(new Error("Canvas 2D no disponible"));
    context.drawImage(image, 0, 0);
  } else {
    return Promise.reject(new Error("Textura sin imagen exportable"));
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("No se pudo generar el PNG"))),
      "image/png",
    );
  });
}

interface RasterImage {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

function isRasterImage(image: unknown): image is RasterImage {
  if (typeof image !== "object" || image === null) return false;
  const candidate = image as Partial<RasterImage>;
  return (
    ArrayBuffer.isView(candidate.data) &&
    typeof candidate.width === "number" &&
    typeof candidate.height === "number"
  );
}

function isDrawableImage(
  image: unknown,
): image is CanvasImageSource & { width: number; height: number } {
  if (typeof image !== "object" || image === null) return false;
  const candidate = image as { width?: unknown; height?: unknown };
  if (typeof candidate.width !== "number" || typeof candidate.height !== "number") {
    return false;
  }
  return (
    image instanceof HTMLImageElement ||
    image instanceof HTMLCanvasElement ||
    (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) ||
    (typeof OffscreenCanvas !== "undefined" && image instanceof OffscreenCanvas)
  );
}

function fmt(value: number): string {
  return value.toFixed(4);
}
