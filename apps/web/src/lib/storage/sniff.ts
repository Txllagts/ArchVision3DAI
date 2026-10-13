/**
 * Deteccion de tipo de archivo por cabecera (magic bytes).
 *
 * El tipo se decide leyendo el contenido real, nunca el `Content-Type` que
 * declara el cliente ni la extension del nombre. PNG, JPEG y WebP exponen sus
 * dimensiones en la propia cabecera; PDF, GLB, GLTF, OBJ y STL se reconocen
 * por su firma o su estructura textual.
 */

export type SniffMime =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "application/pdf"
  | "model/gltf-binary"
  | "model/gltf+json"
  | "application/octet-stream";

export interface SniffResult {
  mime: SniffMime;
  extension: "png" | "jpg" | "webp" | "pdf" | "glb" | "gltf" | "obj" | "stl";
  width: number | null;
  height: number | null;
}

function ascii(data: Uint8Array, offset: number, length: number): string {
  let value = "";
  for (let i = 0; i < length; i += 1) {
    value += String.fromCharCode(data[offset + i] ?? 0);
  }
  return value;
}

function uint16be(data: Uint8Array, offset: number): number {
  return ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0);
}

function uint16le(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8);
}

function uint32le(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] ?? 0) |
      ((data[offset + 1] ?? 0) << 8) |
      ((data[offset + 2] ?? 0) << 16) |
      ((data[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

/** Decodifica como ASCII (latin1) los primeros bytes, para comprobaciones de texto. */
function decodeAscii(data: Uint8Array, maxBytes = 4096): string {
  const end = Math.min(data.length, maxBytes);
  let value = "";
  for (let i = 0; i < end; i += 1) {
    value += String.fromCharCode(data[i] ?? 0);
  }
  return value;
}

function uint32be(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] ?? 0) * 0x1000000) +
    (((data[offset + 1] ?? 0) << 16) | ((data[offset + 2] ?? 0) << 8) | (data[offset + 3] ?? 0))
  );
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function sniffPng(data: Uint8Array): SniffResult | null {
  if (data.length < 24) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (data[i] !== PNG_SIGNATURE[i]) return null;
  }
  return {
    mime: "image/png",
    extension: "png",
    width: uint32be(data, 16),
    height: uint32be(data, 20),
  };
}

function sniffJpeg(data: Uint8Array): SniffResult | null {
  if (data.length < 4) return null;
  if (data[0] !== 0xff || data[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = data[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (
      marker === 0x01 ||
      marker === 0xd8 ||
      marker === 0xd9 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      offset += 2;
      continue;
    }
    const length = uint16be(data, offset + 2);
    if (length < 2) return null;
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      return {
        mime: "image/jpeg",
        extension: "jpg",
        width: uint16be(data, offset + 7),
        height: uint16be(data, offset + 5),
      };
    }
    offset += 2 + length;
  }
  return { mime: "image/jpeg", extension: "jpg", width: null, height: null };
}

function sniffWebp(data: Uint8Array): SniffResult | null {
  if (data.length < 16) return null;
  if (ascii(data, 0, 4) !== "RIFF" || ascii(data, 8, 4) !== "WEBP") return null;
  const fourcc = ascii(data, 12, 4);
  if (fourcc === "VP8 ") {
    if (data.length < 30) return null;
    return {
      mime: "image/webp",
      extension: "webp",
      width: uint16le(data, 26) & 0x3fff,
      height: uint16le(data, 28) & 0x3fff,
    };
  }
  if (fourcc === "VP8L") {
    if (data.length < 25) return null;
    const b0 = data[21] ?? 0;
    const b1 = data[22] ?? 0;
    const b2 = data[23] ?? 0;
    const b3 = data[24] ?? 0;
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { mime: "image/webp", extension: "webp", width, height };
  }
  if (fourcc === "VP8X") {
    if (data.length < 30) return null;
    const width =
      1 + ((data[24] ?? 0) | ((data[25] ?? 0) << 8) | ((data[26] ?? 0) << 16));
    const height =
      1 + ((data[27] ?? 0) | ((data[28] ?? 0) << 8) | ((data[29] ?? 0) << 16));
    return { mime: "image/webp", extension: "webp", width, height };
  }
  return { mime: "image/webp", extension: "webp", width: null, height: null };
}

function sniffPdf(data: Uint8Array): SniffResult | null {
  if (data.length < 5) return null;
  if (ascii(data, 0, 5) !== "%PDF-") return null;
  return { mime: "application/pdf", extension: "pdf", width: null, height: null };
}

function sniffGlb(data: Uint8Array): SniffResult | null {
  if (data.length < 12) return null;
  if (ascii(data, 0, 4) !== "glTF") return null;
  return { mime: "model/gltf-binary", extension: "glb", width: null, height: null };
}

function sniffGltf(data: Uint8Array): SniffResult | null {
  const text = decodeAscii(data).trimStart();
  if (!text.startsWith("{")) return null;
  if (!/"asset"/.test(text)) return null;
  return { mime: "model/gltf+json", extension: "gltf", width: null, height: null };
}

function sniffObj(data: Uint8Array): SniffResult | null {
  const text = decodeAscii(data);
  if (!/(^|\r?\n)\s*v\s+[-0-9.]/.test(text)) return null;
  if (!/(^|\r?\n)\s*f\s+\d/.test(text)) return null;
  return { mime: "application/octet-stream", extension: "obj", width: null, height: null };
}

function sniffStl(data: Uint8Array): SniffResult | null {
  if (data.length >= 84) {
    const triangles = uint32le(data, 80);
    if (triangles > 0 && 84 + triangles * 50 === data.length) {
      return { mime: "application/octet-stream", extension: "stl", width: null, height: null };
    }
  }
  const text = decodeAscii(data);
  if (/^\s*solid\b/.test(text) && /\bfacet\b/.test(text)) {
    return { mime: "application/octet-stream", extension: "stl", width: null, height: null };
  }
  return null;
}

export function sniff(data: Uint8Array): SniffResult | null {
  if (data.length === 0) return null;
  return (
    sniffPng(data) ??
    sniffJpeg(data) ??
    sniffWebp(data) ??
    sniffPdf(data) ??
    sniffGlb(data) ??
    sniffGltf(data) ??
    sniffObj(data) ??
    sniffStl(data) ??
    null
  );
}
