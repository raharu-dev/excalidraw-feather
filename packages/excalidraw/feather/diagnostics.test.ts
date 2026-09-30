// Feather diagnostics collector tests.
//
// Author: raharu-dev (Feather fork)
// References: docs/superpowers/specs/2026-09-30-feather-design.md (M0 diagnostics)

import {
  FeatherDiagnostics,
  percentile,
  type FeatherStatsCounters,
} from "./diagnostics";

const counters: FeatherStatsCounters = {
  elementsTotal: 42,
  elementsVisible: 7,
  images: { entries: 3, bytes: 1024, pending: 1 },
};

const createDiagnostics = (
  overrides: {
    now?: () => number;
    requestAnimationFrame?: (callback: FrameRequestCallback) => number;
    cancelAnimationFrame?: (handle: number) => void;
  } = {},
) =>
  new FeatherDiagnostics({
    ownerWindow: {
      performance: {},
      requestAnimationFrame: overrides.requestAnimationFrame ?? (() => 1),
      cancelAnimationFrame: overrides.cancelAnimationFrame ?? (() => {}),
    } as unknown as Window,
    getStats: () => counters,
    now: overrides.now,
  });

describe("percentile", () => {
  it("returns the inclusive percentile for sorted and unsorted input", () => {
    const values = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(percentile(values, 0.5)).toBe(50);
    expect(percentile(values, 0.95)).toBe(95);
    expect(percentile([...values].reverse(), 0.95)).toBe(95);
    expect(percentile([], 0.95)).toBe(0);
  });
});

describe("FeatherDiagnostics", () => {
  it("tracks frame timing and computes fps and percentiles", () => {
    const diagnostics = createDiagnostics();
    for (let index = 0; index <= 100; index++) {
      diagnostics.frame(index * 20); // every frame is 20 ms -> 50 fps
    }

    const stats = diagnostics.snapshot();
    expect(stats.fps).toBeCloseTo(50, 1);
    expect(stats.frameP50).toBeCloseTo(20, 5);
    expect(stats.frameP95).toBeCloseTo(20, 5);
  });

  it("passes element and image counters through unchanged", () => {
    const diagnostics = createDiagnostics();
    expect(diagnostics.snapshot()).toMatchObject({
      elementsTotal: 42,
      elementsVisible: 7,
      images: { entries: 3, bytes: 1024, pending: 1 },
    });
  });

  it("records pointer types, pressure range, and coalesced counts", () => {
    const diagnostics = createDiagnostics();
    diagnostics.recordPointer({
      pointerType: "pen",
      pressure: 0.4,
      getCoalescedEvents: () => [1, 2, 3],
    } as unknown as PointerEvent);
    diagnostics.recordPointer({
      pointerType: "touch",
      pressure: 0.2,
    } as unknown as PointerEvent);

    const { pointers } = diagnostics.snapshot();
    expect([...pointers.types].sort()).toEqual(["pen", "touch"]);
    expect(pointers.lastType).toBe("touch");
    expect(pointers.pressureRange).toEqual([0.2, 0.4]);
    expect(pointers.coalescedMax).toBe(3);
  });

  it("ignores zero pressure when reporting the range", () => {
    const diagnostics = createDiagnostics();
    diagnostics.recordPointer({
      pointerType: "touch",
      pressure: 0,
    } as unknown as PointerEvent);

    expect(diagnostics.snapshot().pointers.pressureRange).toBeNull();
  });

  it("starts once and stops idempotently", () => {
    let scheduled = 0;
    let cancelled = 0;
    const diagnostics = createDiagnostics({
      requestAnimationFrame: () => {
        scheduled++;
        return scheduled;
      },
      cancelAnimationFrame: () => {
        cancelled++;
      },
      now: () => 0,
    });

    diagnostics.start();
    diagnostics.start();
    diagnostics.stop();
    diagnostics.stop();

    expect(scheduled).toBe(1);
    expect(cancelled).toBe(1);
  });
});
