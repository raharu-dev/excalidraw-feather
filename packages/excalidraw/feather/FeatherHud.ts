/**
 * Feather diagnostics HUD.
 *
 * A small, non-interactive overlay rendered inside the owning editor's
 * container. It is created only when the host enables `hudEnabled`, so no DOM
 * work happens for normal users. The copy button serializes the latest sample
 * for bug reports and benchmarks.
 *
 * Author: raharu-dev (Feather fork)
 * References: docs/superpowers/specs/2026-09-30-feather-design.md (M0 diagnostics)
 */

import type { FeatherStats } from "./performance";

const UPDATE_INTERVAL_MS = 250;

const formatMegabytes = (bytes: number | null): string =>
  bytes === null ? "n/a" : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** Renders a stats sample as compact monospace lines. */
export const formatFeatherStats = (stats: FeatherStats): string => {
  const pointers =
    stats.pointers.types.length > 0
      ? `${stats.pointers.types.join(",")} last=${String(
          stats.pointers.lastType,
        )} pressure=${
          stats.pointers.pressureRange
            ? `${stats.pointers.pressureRange[0].toFixed(
                2,
              )}-${stats.pointers.pressureRange[1].toFixed(2)}`
            : "n/a"
        } coalesced=${stats.pointers.coalescedMax}`
      : "none";
  return [
    `fps ${stats.fps.toFixed(1)}  p50 ${stats.frameP50.toFixed(
      1,
    )}ms  p95 ${stats.frameP95.toFixed(1)}ms  long ${stats.longTasks}`,
    `elements ${stats.elementsTotal} / visible ${stats.elementsVisible}`,
    `images ${stats.images.entries}  ${formatMegabytes(
      stats.images.bytes,
    )}  pending ${stats.images.pending}`,
    `heap ${formatMegabytes(stats.heapBytes)}`,
    `pointers ${pointers}`,
  ].join("\n");
};

/** Diagnostics overlay for one editor instance. */
export class FeatherHud {
  private root: HTMLDivElement | null = null;
  private output: HTMLPreElement | null = null;
  private intervalHandle: number | null = null;
  private copyResetHandle: number | null = null;

  constructor(
    private readonly doc: Document,
    private readonly parent: HTMLElement,
    private readonly getStats: () => FeatherStats,
  ) {}

  /** Creates and appends the overlay; safe to call once. */
  mount(): void {
    if (this.root) {
      return;
    }
    const doc = this.doc;
    const root = doc.createElement("div");
    root.setAttribute("data-feather-hud", "true");
    root.style.cssText = [
      "position:absolute",
      "top:8px",
      "left:8px",
      "z-index:1000",
      "padding:6px 8px",
      "border:1px solid rgba(127,127,127,0.5)",
      "border-radius:6px",
      "background:rgba(0,0,0,0.72)",
      "color:#eee",
      "font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
      "pointer-events:none",
      "white-space:pre",
      "max-width:480px",
    ].join(";");

    const title = doc.createElement("div");
    title.textContent = "Feather diagnostics";
    title.style.cssText = "font-weight:600;margin-bottom:4px";

    const output = doc.createElement("pre");
    output.style.cssText = "margin:0";

    const copy = doc.createElement("button");
    copy.textContent = "copy report";
    copy.style.cssText = [
      "pointer-events:auto",
      "margin-top:6px",
      "font:inherit",
      "cursor:pointer",
    ].join(";");
    copy.addEventListener("click", () => {
      const text = JSON.stringify(this.getStats(), null, 2);
      void this.doc.defaultView?.navigator.clipboard
        ?.writeText(text)
        .catch(() => {});
      copy.textContent = "copied";
      if (this.copyResetHandle !== null) {
        this.doc.defaultView?.clearTimeout(this.copyResetHandle);
      }
      this.copyResetHandle =
        this.doc.defaultView?.setTimeout(() => {
          copy.textContent = "copy report";
          this.copyResetHandle = null;
        }, 1000) ?? null;
    });

    root.append(title, output, copy);
    this.parent.appendChild(root);
    this.root = root;
    this.output = output;

    this.refresh();
    this.intervalHandle =
      this.doc.defaultView?.setInterval(
        () => this.refresh(),
        UPDATE_INTERVAL_MS,
      ) ?? null;
  }

  /** Removes the overlay and stops updates. */
  destroy(): void {
    if (this.intervalHandle !== null) {
      this.doc.defaultView?.clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.copyResetHandle !== null) {
      this.doc.defaultView?.clearTimeout(this.copyResetHandle);
      this.copyResetHandle = null;
    }
    this.root?.remove();
    this.root = null;
    this.output = null;
  }

  private refresh(): void {
    if (!this.output) {
      return;
    }
    this.output.textContent = formatFeatherStats(this.getStats());
  }
}
