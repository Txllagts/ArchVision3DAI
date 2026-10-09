export interface SniffResult {
  mime: "image/png" | "image/jpeg" | "image/webp" | "application/pdf";
  extension: "png" | "jpg" | "webp" | "pdf";
  width: number | null;
  height: number | null;
}

export function sniff(data: Uint8Array): SniffResult | null {
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
    const jpegDims = parseJpegDimensions(data);
    return {
      mime: "image/jpeg",
      extension: "jpg",
      width: jpegDims?.width ?? null,
      height: jpegDims?.height ?? null,
    };
  }

  if (
    data.length >= 12 &&
    ascii(data, 0, 4) === "RIFF" &&
    ascii(data, 8, 4) === "WEBP"
  ) {
    const webpDims = parseWebpDimensions(data);
    return {
      mime: "image/webp",
      extension: "webp",
      width: webpDims?.width ?? null,
      height: webpDims?.height ?? null,
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

function parseJpegDimensions(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 4) return null;
  let offset = 2;

  while (offset < data.length - 1) {
    if (data[offset] !== 0xff) {
      offset++;
      continue;
    }

    while (offset < data.length && data[offset] === 0xff) {
      offset++;
    }
    const marker = data[offset++];
    if (marker === undefined) break;

    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;

    if (offset + 1 >= data.length) break;
    const length = ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0);
    if (length < 2 || offset + length > data.length) break;

    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isSof) {
      if (length >= 7 && offset + 6 < data.length) {
        const height = ((data[offset + 3] ?? 0) << 8) | (data[offset + 4] ?? 0);
        const width = ((data[offset + 5] ?? 0) << 8) | (data[offset + 6] ?? 0);
        if (width > 0 && height > 0) {
          return { width, height };
        }
      }
      break;
    }

    offset += length;
  }

  return null;
}

function parseWebpDimensions(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 12) return null;

  let offset = 12;
  while (offset + 8 <= data.length) {
    const chunkType = ascii(data, offset, 4);
    const chunkSize =
      (data[offset + 4] ?? 0) |
      ((data[offset + 5] ?? 0) << 8) |
      ((data[offset + 6] ?? 0) << 16) |
      ((data[offset + 7] ?? 0) << 24);

    const payloadOffset = offset + 8;

    if (chunkType === "VP8 " && payloadOffset + 10 <= data.length) {
      if (
        data[payloadOffset + 3] === 0x9d &&
        data[payloadOffset + 4] === 0x01 &&
        data[payloadOffset + 5] === 0x2a
      ) {
        const width =
          ((data[payloadOffset + 6] ?? 0) | ((data[payloadOffset + 7] ?? 0) << 8)) & 0x3fff;
        const height =
          ((data[payloadOffset + 8] ?? 0) | ((data[payloadOffset + 9] ?? 0) << 8)) & 0x3fff;
        if (width > 0 && height > 0) return { width, height };
      }
    } else if (chunkType === "VP8L" && payloadOffset + 5 <= data.length) {
      if (data[payloadOffset] === 0x2f) {
        const b0 = data[payloadOffset + 1] ?? 0;
        const b1 = data[payloadOffset + 2] ?? 0;
        const b2 = data[payloadOffset + 3] ?? 0;
        const b3 = data[payloadOffset + 4] ?? 0;
        const width = 1 + (((b1 & 0x3f) << 8) | b0);
        const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
        if (width > 0 && height > 0) return { width, height };
      }
    } else if (chunkType === "VP8X" && payloadOffset + 10 <= data.length) {
      const width =
        1 +
        ((data[payloadOffset + 4] ?? 0) |
          ((data[payloadOffset + 5] ?? 0) << 8) |
          ((data[payloadOffset + 6] ?? 0) << 16));
      const height =
        1 +
        ((data[payloadOffset + 7] ?? 0) |
          ((data[payloadOffset + 8] ?? 0) << 8) |
          ((data[payloadOffset + 9] ?? 0) << 16));
      if (width > 0 && height > 0) return { width, height };
    }

    const paddedSize = chunkSize + (chunkSize % 2);
    offset += 8 + paddedSize;
  }

  return null;
}
