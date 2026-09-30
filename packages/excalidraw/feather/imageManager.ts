/**
 * Feather image manager.
 *
 * Decodes image elements lazily when they enter the viewport instead of
 * decoding every image when a drawing opens, and keeps memory bounded with a
 * byte-budget LRU. At low zoom a downscaled preview is decoded; the original
 * resolution is loaded only when the on-screen size justifies it (or when the
 * image has a crop, because crop coordinates are in original pixels).
 *
 * Author: raharu-dev (Feather fork)
 * References: docs/superpowers/specs/2026-09-30-feather-design.md (workstream 1)
 */

import {
  isElementInViewport,
  isInitializedImageElement,
} from "@excalidraw/element";

import type { ElementsMap } from "@excalidraw/element/types";
import type { ExcalidrawElement, FileId } from "@excalidraw/element/types";

import type { FeatherPerformanceConfig } from "./performance";

import type { AppState, BinaryFileData, BinaryFiles } from "../types";

/** Long edge of the downscaled preview used at low zoom. */
export const FEATHER_PREVIEW_MAX_EDGE = 1024;
/** Maximum concurrently running decodes. */
export const FEATHER_MAX_CONCURRENT_DECODES = 2;

export type FeatherImageLevel = "preview" | "full";

/** Cache entry created by the Feather image manager. */
export type FeatherImageEntry = {
  image:
    | HTMLImageElement
    | ImageBitmap
    | Promise<HTMLImageElement | ImageBitmap>;
  mimeType: BinaryFileData["mimeType"];
  level: FeatherImageLevel;
  naturalWidth: number;
  naturalHeight: number;
  bytes: number;
  lastUsed: number;
};

export type FeatherImageCache = Map<FileId, FeatherImageEntry>;

export type FeatherViewport = Pick<
  AppState,
  | "width"
  | "height"
  | "scrollX"
  | "scrollY"
  | "zoom"
  | "offsetLeft"
  | "offsetTop"
>;

/** Decoded size estimate in bytes (RGBA surface). */
export const estimateImageBytes = (width: number, height: number): number =>
  width * height * 4;

/**
 * Natural (original or preview) pixel size of a cache image. `ImageBitmap`
 * exposes `width`/`height`; `HTMLImageElement` exposes `naturalWidth`/
 * `naturalHeight`. Duck-typing avoids cross-realm `instanceof` failures in
 * popout windows.
 */
export const getImageNaturalSize = (
  image: HTMLImageElement | ImageBitmap,
): { width: number; height: number } => {
  const imageElement = image as HTMLImageElement;
  return {
    width: imageElement.naturalWidth ?? (image as ImageBitmap).width,
    height: imageElement.naturalHeight ?? (image as ImageBitmap).height,
  };
};

/**
 * Whether an image should be decoded at original resolution instead of using
 * a preview. Cropped images always need the original because stored crop
 * coordinates are in original pixels.
 */
export const shouldUseFullResolution = (args: {
  screenWidth: number;
  naturalWidth: number;
  previewMaxEdge: number;
  hasCrop: boolean;
}): boolean => {
  if (args.hasCrop) {
    return true;
  }
  if (args.naturalWidth <= args.previewMaxEdge) {
    return true;
  }
  return args.screenWidth * 1.5 >= args.previewMaxEdge;
};

/** File IDs of initialized image elements inside the viewport plus margin. */
export const selectVisibleImageFileIds = (args: {
  elements: readonly ExcalidrawElement[];
  elementsMap: ElementsMap;
  appState: FeatherViewport;
  marginPx: number;
}): FileId[] => {
  const { elements, elementsMap, appState, marginPx } = args;
  const fileIds: FileId[] = [];
  for (const element of elements) {
    if (!isInitializedImageElement(element) || element.isDeleted) {
      continue;
    }
    if (
      isElementInViewport(
        element,
        appState.width + marginPx * 2,
        appState.height + marginPx * 2,
        {
          zoom: appState.zoom,
          offsetLeft: appState.offsetLeft - marginPx,
          offsetTop: appState.offsetTop - marginPx,
          scrollX: appState.scrollX,
          scrollY: appState.scrollY,
        },
        elementsMap,
      )
    ) {
      fileIds.push(element.fileId);
    }
  }
  return fileIds;
};

type FeatherImageManagerOptions = {
  cache: FeatherImageCache;
  getConfig: () => FeatherPerformanceConfig;
  decodePreview: (
    file: BinaryFileData,
    maxEdge: number,
  ) => Promise<ImageBitmap>;
  decodeFull: (file: BinaryFileData) => Promise<HTMLImageElement>;
  onDecoded?: (fileId: FileId) => void;
  onError?: (fileId: FileId, error: unknown) => void;
  now?: () => number;
};

/** Viewport margin (px) decoded ahead of the visible area. */
export const FEATHER_IMAGE_MARGIN_PX = 200;

/**
 * Owns viewport-driven image decoding and budget eviction for one editor.
 * All errors are contained: a failing image is recorded and not retried, and
 * rendering falls back to the existing pending/placeholder behavior.
 */
export class FeatherImageManager {
  private readonly cache: FeatherImageCache;
  private readonly getConfig: () => FeatherPerformanceConfig;
  private readonly decodePreview: FeatherImageManagerOptions["decodePreview"];
  private readonly decodeFull: FeatherImageManagerOptions["decodeFull"];
  private readonly onDecoded?: (fileId: FileId) => void;
  private readonly onError?: (fileId: FileId, error: unknown) => void;
  private readonly now: () => number;

  private readonly pending = new Map<FileId, Promise<void>>();
  private readonly failed = new Set<FileId>();
  private readonly cancelled = new Set<FileId>();
  private readonly queue: Array<() => void> = [];
  private activeDecodes = 0;

  constructor(options: FeatherImageManagerOptions) {
    this.cache = options.cache;
    this.getConfig = options.getConfig;
    this.decodePreview = options.decodePreview;
    this.decodeFull = options.decodeFull;
    this.onDecoded = options.onDecoded;
    this.onError = options.onError;
    this.now = options.now ?? (() => Date.now());
  }

  /** Decodes previews (and needed full images) for the current viewport. */
  refreshVisible(args: {
    elements: readonly ExcalidrawElement[];
    elementsMap: ElementsMap;
    appState: FeatherViewport;
    files: BinaryFiles;
  }): void {
    const { elements, elementsMap, appState, files } = args;
    for (const element of elements) {
      if (!isInitializedImageElement(element) || element.isDeleted) {
        continue;
      }
      const fileId = element.fileId;
      const file = files[fileId];
      if (!file || this.failed.has(fileId)) {
        continue;
      }
      if (
        !isElementInViewport(
          element,
          appState.width + FEATHER_IMAGE_MARGIN_PX * 2,
          appState.height + FEATHER_IMAGE_MARGIN_PX * 2,
          {
            zoom: appState.zoom,
            offsetLeft: appState.offsetLeft - FEATHER_IMAGE_MARGIN_PX,
            offsetTop: appState.offsetTop - FEATHER_IMAGE_MARGIN_PX,
            scrollX: appState.scrollX,
            scrollY: appState.scrollY,
          },
          elementsMap,
        )
      ) {
        continue;
      }

      const cached = this.cache.get(fileId) as FeatherImageEntry | undefined;
      if (!cached) {
        // SVG cannot be decoded through createImageBitmap in Chromium.
        if (file.mimeType === "image/svg+xml") {
          this.schedule(fileId, () => this.decodeFullEntry(fileId, file));
        } else {
          this.schedule(fileId, () => this.decodePreviewEntry(fileId, file));
        }
        continue;
      }
      if (this.pending.has(fileId) || cached.image instanceof Promise) {
        continue;
      }
      if (cached.level === "preview") {
        const screenWidth = element.width * appState.zoom.value;
        if (
          shouldUseFullResolution({
            screenWidth,
            naturalWidth: cached.naturalWidth,
            previewMaxEdge: FEATHER_PREVIEW_MAX_EDGE,
            hasCrop: Boolean(element.crop),
          })
        ) {
          this.schedule(fileId, () => this.decodeFullEntry(fileId, file));
        }
      }
    }
  }

  /**
   * Ensures an image is decoded at original resolution; used by insert, paste,
   * and crop paths that need the real image immediately.
   */
  async requestFull(fileId: FileId, file: BinaryFileData): Promise<void> {
    if (this.failed.has(fileId)) {
      return;
    }
    await this.schedule(fileId, () => this.decodeFullEntry(fileId, file));
  }

  /** Prevents pending/queued decodes from being applied. */
  cancelPending(fileIds?: Iterable<FileId>): void {
    const ids = fileIds ? new Set(fileIds) : null;
    if (!ids) {
      this.queue.length = 0;
    }
    for (const fileId of this.pending.keys()) {
      if (!ids || ids.has(fileId)) {
        this.cancelled.add(fileId);
      }
    }
  }

  /** Evicts decoded off-screen entries until the byte budget is met. */
  evictOffscreen(visible: ReadonlySet<FileId>): void {
    const budget = this.getConfig().imageBudgetBytes;
    let total = this.stats().bytes;
    if (total <= budget) {
      return;
    }
    const evictable = [...this.cache.entries()]
      .filter(
        ([fileId, entry]) =>
          !visible.has(fileId) &&
          !this.pending.has(fileId) &&
          !(entry.image instanceof Promise),
      )
      .sort((a, b) => (a[1].lastUsed ?? 0) - (b[1].lastUsed ?? 0));

    for (const [fileId, entry] of evictable) {
      if (total <= budget) {
        break;
      }
      this.closeEntry(entry);
      this.cache.delete(fileId);
      total -= entry.bytes ?? 0;
    }
  }

  /** Current cache statistics. */
  stats(): { entries: number; bytes: number; pending: number } {
    let bytes = 0;
    for (const entry of this.cache.values()) {
      if (!(entry.image instanceof Promise)) {
        bytes += entry.bytes ?? 0;
      }
    }
    return { entries: this.cache.size, bytes, pending: this.pending.size };
  }

  private schedule(fileId: FileId, task: () => Promise<void>): Promise<void> {
    const existing = this.pending.get(fileId);
    if (existing) {
      return existing;
    }
    const promise = new Promise<void>((resolve) => {
      const run = () => {
        this.activeDecodes += 1;
        task()
          .catch((error) => {
            this.failed.add(fileId);
            this.cache.delete(fileId);
            this.onError?.(fileId, error);
          })
          .finally(() => {
            this.pending.delete(fileId);
            this.activeDecodes -= 1;
            resolve();
            this.drain();
          });
      };
      if (this.activeDecodes < FEATHER_MAX_CONCURRENT_DECODES) {
        run();
      } else {
        this.queue.push(run);
      }
    });
    this.pending.set(fileId, promise);
    return promise;
  }

  private drain(): void {
    while (
      this.activeDecodes < FEATHER_MAX_CONCURRENT_DECODES &&
      this.queue.length > 0
    ) {
      const run = this.queue.shift();
      run?.();
    }
  }

  private async decodePreviewEntry(
    fileId: FileId,
    file: BinaryFileData,
  ): Promise<void> {
    const bitmap = await this.decodePreview(file, FEATHER_PREVIEW_MAX_EDGE);
    if (this.cancelled.has(fileId)) {
      return;
    }
    this.cache.set(fileId, {
      image: bitmap,
      mimeType: file.mimeType,
      level: "preview",
      naturalWidth: bitmap.width,
      naturalHeight: bitmap.height,
      bytes: estimateImageBytes(bitmap.width, bitmap.height),
      lastUsed: this.now(),
    });
    this.onDecoded?.(fileId);
  }

  private async decodeFullEntry(
    fileId: FileId,
    file: BinaryFileData,
  ): Promise<void> {
    const image = await this.decodeFull(file);
    if (this.cancelled.has(fileId)) {
      return;
    }
    this.cache.set(fileId, {
      image,
      mimeType: file.mimeType,
      level: "full",
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      bytes: estimateImageBytes(image.naturalWidth, image.naturalHeight),
      lastUsed: this.now(),
    });
    this.onDecoded?.(fileId);
  }

  private closeEntry(entry: FeatherImageEntry): void {
    const image = entry.image as ImageBitmap;
    if (typeof image.close === "function") {
      image.close();
    }
  }
}
