export interface SniffResult {
  mime: "image/png" | "image/jpeg" | "image/webp" | "application/pdf" | "model/gltf-binary" | "model/gltf+json" | "application/octet-stream";
  extension: "png" | "jpg" | "webp" | "pdf" | "glb" | "gltf" | "bin";
  width: number | null;
  height: number | null;
}

export function sniff(data: Uint8Array): SniffResult | null {
  // GLB detection: magic number "glTF" (0x46546C67) at offset 4
  // GLB format: 4 bytes magic ("glTF"), 4 bytes version, 4 bytes length, then chunks
  // Some exporters may have different versions, so check for "glTF" at offset 4
  if (
    data.length >= 12 &&
    data[4] === 0x67 && // 'g'
    data[5] === 0x6c && // 'l'
    data[6] === 0x54 && // 'T'
    data[7] === 0x46    // 'F'
  ) {
    return {
      mime: "model/gltf-binary",
      extension: "glb",
      width: null,
      height: null,
    };
  }

  // GLTF (JSON) detection: starts with { and contains "asset":{"version":"2.0"}
  if (data.length >= 2) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(data.subarray(0, Math.min(data.length, 512)));
    if (text.trimStart().startsWith("{") && text.includes('"asset"') && text.includes('"version"') && text.includes("2.0")) {
      return {
        mime: "model/gltf+json",
        extension: "gltf",
        width: null,
        height: null,
      };
    }
  }

  // Fallback for binary GLB files that might not have standard magic bytes
  // but have .glb extension - we'll detect this by checking for common GLB chunk patterns
  // Check for JSON chunk (0x4E4F534A = "JSON") or BIN chunk (0x004E4942 = "BIN\0")
  if (data.length >= 20) {
    for (let i = 12; i < Math.min(data.length - 8, 100); i++) {
      // JSON chunk marker
      if (data[i] === 0x4A && data[i+1] === 0x53 && data[i+2] === 0x4F && data[i+3] === 0x4E) {
        return {
          mime: "model/gltf-binary",
          extension: "glb",
          width: null,
          height: null,
        };
      }
      // BIN chunk marker
      if (data[i] === 0x42 && data[i+1] === 0x49 && data[i+2] === 0x4E && data[i+3] === 0x00) {
        return {
          mime: "model/gltf-binary",
          extension: "glb",
          width: null,
          height: null,
        };
      }
    }
  }

  if (
    data.length >= 24 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return {
      mime: "image/png",
      extension: "png",
      width: readUInt32BE(data, 16),
      height: readUInt32BE(data, 20),
    };
  }

  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    const size = jpegSize(data);
    return {
      mime: "image/jpeg",
      extension: "jpg",
      width: size?.width ?? null,
      height: size?.height ?? null,
    };
  }

  if (
    data.length >= 12 &&
    ascii(data, 0, 4) === "RIFF" &&
    ascii(data, 8, 4) === "WEBP"
  ) {
    const size = webpSize(data);
    return {
      mime: "image/webp",
      extension: "webp",
      width: size?.width ?? null,
      height: size?.height ?? null,
    };
  }

  if (data.length >= 5 && ascii(data, 0, 5) === "%PDF-") {
    return {
      mime: "application/pdf",
      extension: "pdf",
      width: null,
      height: null,
    };
  }

  return null;
}

function ascii(data: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...data.subarray(offset, offset + length));
}

function readUInt32BE(data: Uint8Array, offset: number): number {
  return (
    (data[offset] ?? 0) * 0x1000000 +
    (data[offset + 1] ?? 0) * 0x10000 +
    (data[offset + 2] ?? 0) * 0x100 +
    (data[offset + 3] ?? 0)
  );
}

function readUInt16BE(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) * 0x100 + (data[offset + 1] ?? 0);
}

function readUInt16LE(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) + (data[offset + 1] ?? 0) * 0x100;
}

/** Entero de 24 bits little-endian (WebP guarda asi el canvas). */
function readUInt24LE(data: Uint8Array, offset: number): number {
  return (
    (data[offset] ?? 0) +
    (data[offset + 1] ?? 0) * 0x100 +
    (data[offset + 2] ?? 0) * 0x10000
  );
}

/**
 * Marcadores SOF de un JPEG: los que llevan la definicion de la imagen.
 *
 * C4 es DHT (tabla de Huffman) y C8/CC reservados: tienen carga util, pero no
 * dimensiones. Los demas C0..CF si las llevan tras precision, alto y ancho.
 */
function isStartOfFrame(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

/**
 * Dimensiones de un JPEG recorriendo sus segmentos hasta el primer SOF.
 *
 * Sin esto, un plano en JPG se guardaba sin ancho ni alto y la planta no
 * podia colocar la imagen de referencia. El recorrido se detiene en SOS: ahi
 * empiezan los datos comprimidos y el resto son bytes de imagen, no marcadores.
 */
function jpegSize(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 4) return null;

  let offset = 2; // se salta el SOI (FFD8)
  let guard = 0;

  while (offset + 4 <= data.length && guard < 256) {
    guard += 1;
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    let marker = data[offset + 1] ?? 0;
    // Relleno: varios 0xFF seguidos antes del marcador real.
    while (marker === 0xff && offset + 2 < data.length) {
      offset += 1;
      marker = data[offset + 1] ?? 0;
    }

    offset += 2;

    // Sin carga util: RSTn, TEM y el propio SOI repetido.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    // Fin de imagen o comienzo de scan: no hay mas metadatos utiles.
    if (marker === 0xd9 || marker === 0xda) break;

    const length = readUInt16BE(data, offset);
    if (length < 2) break;

    if (isStartOfFrame(marker)) {
      return {
        height: readUInt16BE(data, offset + 1),
        width: readUInt16BE(data, offset + 3),
      };
    }

    offset += length;
  }

  return null;
}

/**
 * Dimensiones de un WebP segun el chunk que lleva la imagen.
 *
 * - `VP8 ` (con perdida): ancho y alto de 14 bits tras la firma del codec.
 * - `VP8L` (sin perdida): 14 bits de ancho y 14 de alto, ambos menos uno.
 * - `VP8X` (extendido): canvas de 24 bits, tambien menos uno.
 */
function webpSize(data: Uint8Array): { width: number; height: number } | null {
  let offset = 12; // "RIFF" + tamano + "WEBP"

  while (offset + 8 <= data.length) {
    const fourCc = ascii(data, offset, 4);
    const size = readUInt32LE(data, offset + 4);
    const payload = offset + 8;
    if (payload + size > data.length) return null;

    if (fourCc === "VP8 " && size >= 10) {
      return {
        width: readUInt16LE(data, payload + 6) & 0x3fff,
        height: readUInt16LE(data, payload + 8) & 0x3fff,
      };
    }

    if (fourCc === "VP8L" && size >= 5) {
      const bits = readUInt32LE(data, payload + 1);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }

    if (fourCc === "VP8X" && size >= 10) {
      return {
        width: readUInt24LE(data, payload + 4) + 1,
        height: readUInt24LE(data, payload + 7) + 1,
      };
    }

    // Los chunks se alinean a numero par.
    offset = payload + size + (size % 2);
  }

  return null;
}

function readUInt32LE(data: Uint8Array, offset: number): number {
  return (
    (data[offset] ?? 0) +
    (data[offset + 1] ?? 0) * 0x100 +
    (data[offset + 2] ?? 0) * 0x10000 +
    (data[offset + 3] ?? 0) * 0x1000000
  );
}
