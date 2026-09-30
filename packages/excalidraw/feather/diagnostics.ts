/**
 * Feather runtime diagnostics.
 *
 * Collects frame timing, long tasks, element/image counters, and observed
 * pointer behavior. The diagnostics overlay (FeatherHud) and the optional
 * host report both read snapshots from a single collector per editor.
 *
 * Author: raharu-dev (Feather fork)
 * References: docs/superpowers/specs/2026-09-30-feather-design.md (M0 diagnostics)
 */

import type { FeatherStats } from "./performance";

/** Counters the owning App supplies when a snapshot is taken. */
export type FeatherStatsCounters = Pick<
  FeatherStats,
  "elementsTotal" | "elementsVisible" | "images"
>;

type FeatherDiagnosticsOptions = {
  ownerWindow: Window;
  getStats: () => FeatherStatsCounters;
  now?: () => number;
};

/** Structural long-task observer contract (the TS lib here lacks the global). */
type LongTaskObserver = {
  observe(options: { entryTypes: string[] }): void;
  disconnect(): void;
};

type LongTaskObserverConstructor = new (
  callback: (list: { getEntries(): unknown[] }) => void,
) => LongTaskObserver;

const FRAME_WINDOW = 240;
const FPS_WINDOW = 60;

/** Inclusive percentile of the given values; returns 0 for an empty list. */
export const percentile = (values: readonly number[], p: number): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1),
  );
  return sorted[index];
};

/** Frame, long-task, and pointer diagnostics for one Excalidraw editor. */
export class FeatherDiagnostics {
  private readonly ownerWindow: Window;
  private readonly getStats: () => FeatherStatsCounters;
  private readonly now: () => number;

  private frames: number[] = [];
  private lastFrameTimestamp: number | null = null;
  private frameHandle: number | null = null;
  private longTasks = 0;
  private observer: LongTaskObserver | null = null;

  private readonly pointerTypes = new Set<string>();
  private lastPointerType: string | null = null;
  private minPressure: number | null = null;
  private maxPressure: number | null = null;
  private coalescedMax = 0;

  constructor(options: FeatherDiagnosticsOptions) {
    this.ownerWindow = options.ownerWindow;
    this.getStats = options.getStats;
    this.now = options.now ?? (() => Date.now());
  }

  /** Starts the animation-frame sampler and long-task observer once. */
  start(): void {
    if (this.frameHandle !== null) {
      return;
    }
    const schedule = () => {
      this.frameHandle = this.ownerWindow.requestAnimationFrame((timestamp) => {
        this.frameHandle = null;
        this.frame(timestamp);
        schedule();
      });
    };
    schedule();

    const PerformanceObserverCtor = (
      this.ownerWindow as unknown as {
        PerformanceObserver?: LongTaskObserverConstructor;
      }
    ).PerformanceObserver;
    if (typeof PerformanceObserverCtor === "function") {
      try {
        const observer = new PerformanceObserverCtor((list) => {
          this.longTasks += list.getEntries().length;
        });
        observer.observe({ entryTypes: ["longtask"] });
        this.observer = observer;
      } catch {
        this.observer = null;
      }
    }
  }

  /** Stops sampling; safe to call repeatedly. */
  stop(): void {
    if (this.frameHandle !== null) {
      this.ownerWindow.cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
    this.lastFrameTimestamp = null;
    this.observer?.disconnect();
    this.observer = null;
  }

  /** Records one sampled frame. Exposed for tests. */
  frame(timestamp: number = this.now()): void {
    if (this.lastFrameTimestamp !== null) {
      const delta = timestamp - this.lastFrameTimestamp;
      if (delta > 0 && delta < 10_000) {
        this.frames.push(delta);
        if (this.frames.length > FRAME_WINDOW) {
          this.frames.shift();
        }
      }
    }
    this.lastFrameTimestamp = timestamp;
  }

  /** Records pointer diagnostics for a DOM pointer event. */
  recordPointer(event: PointerEvent): void {
    const type =
      typeof event.pointerType === "string" && event.pointerType !== ""
        ? event.pointerType
        : "unknown";
    this.pointerTypes.add(type);
    this.lastPointerType = type;

    if (typeof event.pressure === "number" && event.pressure > 0) {
      this.minPressure =
        this.minPressure === null
          ? event.pressure
          : Math.min(this.minPressure, event.pressure);
      this.maxPressure =
        this.maxPressure === null
          ? event.pressure
          : Math.max(this.maxPressure, event.pressure);
    }

    if (typeof event.getCoalescedEvents === "function") {
      const coalesced = event.getCoalescedEvents()?.length ?? 0;
      this.coalescedMax = Math.max(this.coalescedMax, coalesced);
    }
  }

  /** Builds the current diagnostics sample. */
  snapshot(): FeatherStats {
    const counters = this.getStats();
    const recent = this.frames.slice(-FPS_WINDOW);
    const mean =
      recent.length > 0
        ? recent.reduce((sum, value) => sum + value, 0) / recent.length
        : 0;
    return {
      timestamp: Date.now(),
      fps: mean > 0 ? Math.round((1000 / mean) * 10) / 10 : 0,
      frameP50: Math.round(percentile(this.frames, 0.5) * 100) / 100,
      frameP95: Math.round(percentile(this.frames, 0.95) * 100) / 100,
      longTasks: this.longTasks,
      elementsTotal: counters.elementsTotal,
      elementsVisible: counters.elementsVisible,
      images: counters.images,
      pointers: {
        types: [...this.pointerTypes],
        lastType: this.lastPointerType,
        pressureRange:
          this.minPressure === null
            ? null
            : [this.minPressure, this.maxPressure ?? this.minPressure],
        coalescedMax: this.coalescedMax,
      },
      heapBytes: this.getHeapBytes(),
    };
  }

  private getHeapBytes(): number | null {
    const performance = this.ownerWindow.performance as Performance & {
      memory?: { usedJSHeapSize?: number };
    };
    const bytes = performance?.memory?.usedJSHeapSize;
    return typeof bytes === "number" ? bytes : null;
  }
}
