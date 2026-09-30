/**
 * Feather performance configuration.
 *
 * The consuming Obsidian plugin resolves its user-facing profile into a
 * concrete configuration that this runtime reads live through the host
 * adapter. When no host is configured (for example a standalone Excalidraw
 * build), safe defaults are used.
 *
 * Author: raharu-dev (Feather fork)
 * References: docs/superpowers/specs/2026-09-30-feather-design.md
 */

import { getObsidianExcalidrawHost } from "../obsidianExcalidrawHost";

/** Resolved performance profile. `auto` is resolved by the plugin. */
export type FeatherProfile = "high" | "balanced" | "eink" | "lowend";

/** How aggressively interaction-time rendering simplifies detail. */
export type FeatherInteractionDetail = "full" | "reduced" | "minimal";

/** Performance knobs consumed by the Feather runtime. */
export type FeatherPerformanceConfig = {
  profile: FeatherProfile;
  vectorLod: boolean;
  imageLod: boolean;
  imageBudgetBytes: number;
  interactionDetail: FeatherInteractionDetail;
  inkOverlay: boolean;
  rawPointerUpdates: boolean;
  hudEnabled: boolean;
};

/** Diagnostics sample reported by the runtime to the host. */
export type FeatherStats = {
  timestamp: number;
  fps: number;
  frameP50: number;
  frameP95: number;
  longTasks: number;
  elementsTotal: number;
  elementsVisible: number;
  images: {
    entries: number;
    bytes: number;
    pending: number;
  };
  pointers: {
    types: string[];
    lastType: string | null;
    pressureRange: [number, number] | null;
    coalescedMax: number;
  };
  heapBytes: number | null;
};

export const MIN_FEATHER_IMAGE_BUDGET_BYTES = 32 * 1024 * 1024;
export const MAX_FEATHER_IMAGE_BUDGET_BYTES = 1024 * 1024 * 1024;

export const DEFAULT_FEATHER_PERFORMANCE_CONFIG: Readonly<FeatherPerformanceConfig> =
  Object.freeze({
    profile: "high",
    vectorLod: true,
    imageLod: true,
    imageBudgetBytes: 256 * 1024 * 1024,
    interactionDetail: "reduced",
    inkOverlay: true,
    rawPointerUpdates: true,
    hudEnabled: false,
  });

const PROFILES: readonly FeatherProfile[] = [
  "high",
  "balanced",
  "eink",
  "lowend",
];

const INTERACTION_DETAILS: readonly FeatherInteractionDetail[] = [
  "full",
  "reduced",
  "minimal",
];

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const asBudget = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_FEATHER_PERFORMANCE_CONFIG.imageBudgetBytes;
  }
  return Math.min(
    MAX_FEATHER_IMAGE_BUDGET_BYTES,
    Math.max(MIN_FEATHER_IMAGE_BUDGET_BYTES, Math.round(value)),
  );
};

/**
 * Replaces missing or invalid configuration fields with defaults so a
 * misbehaving host cannot break rendering.
 */
export const sanitizeFeatherPerformanceConfig = (
  candidate: Partial<FeatherPerformanceConfig> | null | undefined,
): FeatherPerformanceConfig => {
  const source = candidate ?? {};
  return {
    profile: PROFILES.includes(source.profile as FeatherProfile)
      ? (source.profile as FeatherProfile)
      : DEFAULT_FEATHER_PERFORMANCE_CONFIG.profile,
    vectorLod: asBoolean(
      source.vectorLod,
      DEFAULT_FEATHER_PERFORMANCE_CONFIG.vectorLod,
    ),
    imageLod: asBoolean(
      source.imageLod,
      DEFAULT_FEATHER_PERFORMANCE_CONFIG.imageLod,
    ),
    imageBudgetBytes: asBudget(source.imageBudgetBytes),
    interactionDetail: INTERACTION_DETAILS.includes(
      source.interactionDetail as FeatherInteractionDetail,
    )
      ? (source.interactionDetail as FeatherInteractionDetail)
      : DEFAULT_FEATHER_PERFORMANCE_CONFIG.interactionDetail,
    inkOverlay: asBoolean(
      source.inkOverlay,
      DEFAULT_FEATHER_PERFORMANCE_CONFIG.inkOverlay,
    ),
    rawPointerUpdates: asBoolean(
      source.rawPointerUpdates,
      DEFAULT_FEATHER_PERFORMANCE_CONFIG.rawPointerUpdates,
    ),
    hudEnabled: asBoolean(
      source.hudEnabled,
      DEFAULT_FEATHER_PERFORMANCE_CONFIG.hudEnabled,
    ),
  };
};

/** Reads the live performance configuration from the host adapter. */
export const getFeatherPerformanceConfig = (): FeatherPerformanceConfig => {
  const host = getObsidianExcalidrawHost();
  if (!host) {
    return { ...DEFAULT_FEATHER_PERFORMANCE_CONFIG };
  }
  return sanitizeFeatherPerformanceConfig(host.getPerformanceConfig());
};
