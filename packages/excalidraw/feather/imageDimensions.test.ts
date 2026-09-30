// Feather image dimension parser tests.
//
// Author: raharu-dev (Feather fork)
// References: docs/superpowers/specs/2026-09-30-feather-design.md (image previews)

import { readImageDimensions } from "./imageDimensions";

const toDataUrl = (mimeType: string, bytes: number[]) =>
  `data:${mimeType};base64,${btoa(String.fromCharCode(...bytes))}`;

const pngDataUrl = (width: number, height: number) => {
  const bytes = new Array(33).fill(0);
  bytes.splice(0, 8, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  bytes.splice(12, 4, 0x49, 0x48, 0x44, 0x52); // "IHDR"
  const view = new DataView(Uint8Array.from(bytes).buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return toDataUrl("image/png", Array.from(new Uint8Array(view.buffer)));
};

const jpegDataUrl = (width: number, height: number) => {
  const bytes = [
    0xff,
    0xd8, // SOI
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08, // SOF0, length, precision
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  ];
  return toDataUrl("image/jpeg", bytes);
};

describe("readImageDimensions", () => {
  it("reads PNG dimensions from the IHDR chunk", () => {
    expect(readImageDimensions(pngDataUrl(4000, 3000))).toEqual({
      width: 4000,
      height: 3000,
    });
  });

  it("reads JPEG dimensions from the SOF marker", () => {
    expect(readImageDimensions(jpegDataUrl(1024, 768))).toEqual({
      width: 1024,
      height: 768,
    });
  });

  it("returns null for unsupported or malformed data", () => {
    expect(
      readImageDimensions(
        "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
      ),
    ).toBeNull();
    expect(readImageDimensions("not-a-data-url")).toBeNull();
    expect(readImageDimensions("data:image/png;base64,AAAA")).toBeNull();
  });
});
