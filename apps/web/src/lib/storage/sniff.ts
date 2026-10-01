export interface SniffResult {
  mime:
    | "image/png"
    | "image/jpeg"
    | "image/webp"
    | "application/pdf";
  extension: "png" | "jpg" | "webp" | "pdf";
  width: number | null;
  height: number | null;
}

export function sniff(data: Uint8Array): SniffResult | null {
  // PNG — cabecera: 89 50 4E 47 0D 0A 1A 0A
  if (
    data.length >= 24 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  ) {
    return {
      mime: "image/png",
      extension: "png",
      width: readUInt32BE(data, 16),
      height: readUInt32BE(data, 20),
    };
  }

  // JPEG — cabecera: FF D8 FF
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return {
      mime: "image/jpeg",
      extension: "jpg",
      width: null,
      height: null,
    };
  }

  // WebP — RIFF....WEBP
  if (
    data.length >= 12 &&
    ascii(data, 0, 4) === "RIFF" &&
    ascii(data, 8, 4) === "WEBP"
  ) {
    return {
      mime: "image/webp",
      extension: "webp",
      width: null,
      height: null,
    };
  }

  // PDF — cabecera: %PDF-
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
