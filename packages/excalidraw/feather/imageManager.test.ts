// Feather image manager tests.
//
// Author: raharu-dev (Feather fork)
// References: docs/superpowers/specs/2026-09-30-feather-design.md (workstream 1)

import type { FileId } from "@excalidraw/element/types";

import { DEFAULT_FEATHER_PERFORMANCE_CONFIG } from "./performance";

import {
  estimateImageBytes,
  FeatherImageManager,
  getImageNaturalSize,
  selectVisibleImageFileIds,
  shouldUseFullResolution,
  type FeatherImageEntry,
} from "./imageManager";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const fakeBitmap = (width = 64, height = 48) =>
  ({ width, height, close: vi.fn() } as unknown as ImageBitmap);

const fakeImage = (naturalWidth = 1024, naturalHeight = 768) =>
  ({ naturalWidth, naturalHeight } as HTMLImageElement);

const file = (id: string) => ({
  id,
  dataURL: `data:image/png;base64,${id}`,
  mimeType: "image/png",
  created: 1,
});

const imageElement = (
  id: string,
  fileId: string,
  x: number,
  y: number,
  crop: unknown = null,
) => ({
  id,
  type: "image",
  fileId,
  status: "saved",
  x,
  y,
  width: 100,
  height: 100,
  crop,
  isDeleted: false,
  version: 1,
  versionNonce: 1,
});

const viewport = {
  zoom: { value: 1 },
  scrollX: 0,
  scrollY: 0,
  offsetLeft: 0,
  offsetTop: 0,
  width: 800,
  height: 600,
};

const scene = (elements: ReturnType<typeof imageElement>[], ids: string[]) => ({
  elements: elements as never,
  elementsMap: new Map(elements.map((el) => [el.id, el])) as never,
  appState: viewport as never,
  files: Object.fromEntries(ids.map((id) => [id, file(id)])) as never,
});

const createManager = (options: {
  budget?: number;
  decodePreview: (file: unknown, maxEdge: number) => Promise<ImageBitmap>;
  decodeFull: (file: unknown) => Promise<HTMLImageElement>;
}) => {
  const cache = new Map<string, FeatherImageEntry>();
  const decoded: string[] = [];
  const manager = new FeatherImageManager({
    cache: cache as never,
    getConfig: () => ({
      ...DEFAULT_FEATHER_PERFORMANCE_CONFIG,
      imageBudgetBytes: options.budget ?? 256 * 1024 * 1024,
    }),
    decodePreview: options.decodePreview as never,
    decodeFull: options.decodeFull as never,
    onDecoded: (fileId) => decoded.push(fileId),
  });
  return { manager, cache, decoded };
};

describe("image manager helpers", () => {
  it("estimates decoded bytes", () => {
    expect(estimateImageBytes(10, 20)).toBe(800);
  });

  it("reads natural size from image elements and bitmaps", () => {
    expect(getImageNaturalSize(fakeImage(1024, 768))).toEqual({
      width: 1024,
      height: 768,
    });
    expect(
      getImageNaturalSize({ width: 64, height: 48 } as ImageBitmap),
    ).toEqual({
      width: 64,
      height: 48,
    });
  });

  it("selects full resolution for crops, small originals, and zoomed-in images", () => {
    expect(
      shouldUseFullResolution({
        screenWidth: 100,
        naturalWidth: 800,
        previewMaxEdge: 1024,
        hasCrop: false,
      }),
    ).toBe(true);
    expect(
      shouldUseFullResolution({
        screenWidth: 300,
        naturalWidth: 4000,
        previewMaxEdge: 1024,
        hasCrop: false,
      }),
    ).toBe(false);
    expect(
      shouldUseFullResolution({
        screenWidth: 700,
        naturalWidth: 4000,
        previewMaxEdge: 1024,
        hasCrop: false,
      }),
    ).toBe(true);
    expect(
      shouldUseFullResolution({
        screenWidth: 50,
        naturalWidth: 4000,
        previewMaxEdge: 1024,
        hasCrop: true,
      }),
    ).toBe(true);
  });

  it("selects visible images including the margin but not far off-screen ones", () => {
    const elements = [
      imageElement("e1", "f1", 0, 0),
      imageElement("e2", "f2", 850, 0),
      imageElement("e3", "f3", 5000, 0),
    ];
    const ids = selectVisibleImageFileIds({
      elements: elements as never,
      elementsMap: new Map(elements.map((el) => [el.id, el])) as never,
      appState: viewport as never,
      marginPx: 100,
    });
    expect(ids).toEqual(["f1", "f2"]);
  });
});

describe("FeatherImageManager", () => {
  it("decodes previews with bounded concurrency and deduplicates requests", async () => {
    const pending = new Map<string, Deferred<ImageBitmap>>();
    let started = 0;
    const { manager } = createManager({
      decodePreview: (rawFile) => {
        started++;
        const id = (rawFile as { id: string }).id;
        const request = deferred<ImageBitmap>();
        pending.set(id, request);
        return request.promise;
      },
      decodeFull: async () => fakeImage(),
    });
    const elements = [
      imageElement("e1", "f1", 0, 0),
      imageElement("e2", "f2", 120, 0),
      imageElement("e3", "f3", 240, 0),
      imageElement("e4", "f4", 360, 0),
      imageElement("e5", "f5", 480, 0),
    ];
    const args = scene(elements, ["f1", "f2", "f3", "f4", "f5"]);

    manager.refreshVisible(args);
    manager.refreshVisible(args);
    expect(started).toBe(2);

    pending.get("f1")!.resolve(fakeBitmap());
    await flush();
    expect(started).toBe(3);
    manager.cancelPending();
  });

  it("skips missing files without retrying", () => {
    let started = 0;
    const { manager } = createManager({
      decodePreview: async () => {
        started++;
        return fakeBitmap();
      },
      decodeFull: async () => fakeImage(),
    });
    const elements = [imageElement("e1", "ghost", 0, 0)];
    const args = scene(elements, []);

    manager.refreshVisible(args);
    manager.refreshVisible(args);
    expect(started).toBe(0);
  });

  it("bypasses previews for SVG images", async () => {
    let previews = 0;
    let fulls = 0;
    const { manager, cache } = createManager({
      decodePreview: async () => {
        previews++;
        return fakeBitmap();
      },
      decodeFull: async () => {
        fulls++;
        return fakeImage();
      },
    });
    const elements = [imageElement("e1", "f1", 0, 0)];
    const args = scene(elements, []);
    args.files = {
      f1: { ...file("f1"), mimeType: "image/svg+xml" },
    } as never;

    manager.refreshVisible(args);
    await flush();

    expect(previews).toBe(0);
    expect(fulls).toBe(1);
    expect(cache.get("f1")!.level).toBe("full");
    manager.cancelPending();
  });

  it("decodes to completion, records metadata, and reports stats", async () => {
    const { manager, cache, decoded } = createManager({
      decodePreview: async () => fakeBitmap(64, 48),
      decodeFull: async () => fakeImage(1024, 768),
    });
    const args = scene([imageElement("e1", "f1", 0, 0)], ["f1"]);

    manager.refreshVisible(args);
    await flush();

    const entry = cache.get("f1")!;
    expect(entry.level).toBe("preview");
    expect(entry.naturalWidth).toBe(64);
    expect(entry.bytes).toBe(estimateImageBytes(64, 48));
    expect(decoded).toEqual(["f1"]);

    const stats = manager.stats();
    expect(stats.entries).toBe(1);
    expect(stats.bytes).toBe(entry.bytes);
    expect(stats.pending).toBe(0);

    manager.cancelPending();
  });

  it("evicts least-recently-used off-screen entries and closes bitmaps", () => {
    const bitmapA = fakeBitmap();
    const bitmapB = fakeBitmap();
    const { manager, cache } = createManager({
      budget: 150,
      decodePreview: async () => fakeBitmap(),
      decodeFull: async () => fakeImage(),
    });
    cache.set("v1", {
      image: fakeBitmap(),
      level: "preview",
      naturalWidth: 8,
      naturalHeight: 8,
      bytes: 100,
      lastUsed: 5,
      mimeType: "image/png",
    } as never);
    cache.set("v2", {
      image: fakeBitmap(),
      level: "preview",
      naturalWidth: 8,
      naturalHeight: 8,
      bytes: 100,
      lastUsed: 6,
      mimeType: "image/png",
    } as never);
    cache.set("o1", {
      image: bitmapA,
      level: "preview",
      naturalWidth: 8,
      naturalHeight: 8,
      bytes: 100,
      lastUsed: 1,
      mimeType: "image/png",
    } as never);
    cache.set("o2", {
      image: bitmapB,
      level: "preview",
      naturalWidth: 8,
      naturalHeight: 8,
      bytes: 100,
      lastUsed: 2,
      mimeType: "image/png",
    } as never);

    manager.evictOffscreen(
      new Set(["v1", "v2"]) as unknown as ReadonlySet<FileId>,
    );

    expect([...cache.keys()].sort()).toEqual(["v1", "v2"]);
    expect(bitmapA.close).toHaveBeenCalled();
    expect(bitmapB.close).toHaveBeenCalled();
    manager.cancelPending();
  });
});
