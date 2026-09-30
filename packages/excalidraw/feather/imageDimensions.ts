/**
 * Intrinsic image dimensions from a data URL, without decoding the image.
 *
 * Preview decoding needs the original aspect ratio before creating a resized
 * `ImageBitmap`; parsing the header avoids a transient full-resolution decode.
 * SVG is intentionally unsupported (vector images bypass previews).
 *
 * Author: raharu-dev (Feather fork)
 * References: docs/superpowers/specs/2026-09-30-feather-design.md (workstream 1)
 */

const DATA_URL_PATTERN = /^data:([^;,]+);base64,([\s\S]*)$/;

export const readImageDimensions = (
  dataURL: string,
): { width: number; height: number } | null => {
  const match = DATA_URL_PATTERN.exec(dataURL);
  if (!match) {
    return null;
  }
  const mimeType = match[1].toLowerCase();
  if (mimeType === "image/svg+xml") {
    return null;
  }
  let bytes: Uint8Array;
  try {
    const binary = atob(match[2]);
    bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
  } catch {
    return null;
  }
  switch (mimeType) {
    case "image/png":
      return readPng(bytes);
    case "image/jpeg":
    case "image/jpg":
      return readJpeg(bytes);
    case "image/gif":
      return readGif(bytes);
    case "image/webp":
      return readWebp(bytes);
    default:
      return null;
  }
};

const valid = (width: number, height: number) =>
  width > 0 && height > 0 ? { width, height } : null;

const readPng = (bytes: Uint8Array) => {
  if (bytes.length < 24) {
    return null;
  }
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let index = 0; index < signature.length; index++) {
    if (bytes[index] !== signature[index]) {
      return null;
    }
  }
  const type = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (type !== "IHDR") {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return valid(view.getUint32(16), view.getUint32(20));
};

const readJpeg = (bytes: Uint8Array) => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1];
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) {
      break;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) {
      return null;
    }
    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isStartOfFrame) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      return valid(width, height);
    }
    offset += 2 + length;
  }
  return null;
};

const readGif = (bytes: Uint8Array) => {
  if (bytes.length < 10) {
    return null;
  }
  const header = String.fromCharCode(...bytes.subarray(0, 6));
  if (header !== "GIF87a" && header !== "GIF89a") {
    return null;
  }
  return valid(bytes[6] | (bytes[7] << 8), bytes[8] | (bytes[9] << 8));
};

const readWebp = (bytes: Uint8Array) => {
  if (bytes.length < 30) {
    return null;
  }
  const tag = (offset: number) =>
    String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3],
    );
  if (tag(0) !== "RIFF" || tag(8) !== "WEBP") {
    return null;
  }
  const format = tag(12);
  if (format === "VP8X") {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return valid(width, height);
  }
  if (format === "VP8 ") {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      return null;
    }
    const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
    const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
    return valid(width, height);
  }
  if (format === "VP8L") {
    if (bytes[20] !== 0x2f) {
      return null;
    }
    const bits =
      bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return valid((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  return null;
};
