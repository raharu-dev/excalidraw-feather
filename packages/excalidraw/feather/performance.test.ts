// Feather performance configuration tests.
//
// Author: raharu-dev (Feather fork)
// References: docs/superpowers/specs/2026-09-30-feather-design.md (host protocol v3)

import {
  configureObsidianExcalidrawHost,
  OBSIDIAN_EXCALIDRAW_HOST_PROTOCOL_VERSION,
  type ObsidianExcalidrawHostAdapter,
} from "../obsidianExcalidrawHost";

import {
  DEFAULT_FEATHER_PERFORMANCE_CONFIG,
  getFeatherPerformanceConfig,
  MAX_FEATHER_IMAGE_BUDGET_BYTES,
  MIN_FEATHER_IMAGE_BUDGET_BYTES,
  type FeatherPerformanceConfig,
} from "./performance";

const createFakeHost = (
  config: Partial<FeatherPerformanceConfig> = {},
): ObsidianExcalidrawHostAdapter =>
  ({
    protocolVersion: OBSIDIAN_EXCALIDRAW_HOST_PROTOCOL_VERSION,
    isDoubleTapEraserEnabled: () => true,
    getZoomToFitMaxLevel: () => 2.5,
    isPenModeCrosshairVisible: () => false,
    isSingleFingerPanningEnabled: () => true,
    isDoubleClickTextEditingDisabled: () => true,
    getZoomStep: () => 0.125,
    getZoomMin: () => 0.2,
    getZoomMax: () => 42,
    isContextMenuDisabled: () => true,
    shouldSyncElementLinkWithText: () => false,
    loadFontFromFile: async () => undefined,
    getMermaid: async () => ({
      loaded: false,
      api: new Promise<never>(() => {}),
    }),
    runAction: () => {},
    getLabel: (key: string) => key,
    attachInlineLinkSuggester: () => ({
      isBlockingKeys: () => false,
      close: () => {},
    }),
    getPerformanceConfig: () => config as unknown as FeatherPerformanceConfig,
    reportPerformanceStats: () => {},
  } as unknown as ObsidianExcalidrawHostAdapter);

describe("Feather performance configuration", () => {
  const disposers: Array<() => void> = [];

  afterEach(() => {
    while (disposers.length > 0) {
      disposers.pop()?.();
    }
  });

  it("falls back to defaults without a host", () => {
    expect(getFeatherPerformanceConfig()).toEqual(
      DEFAULT_FEATHER_PERFORMANCE_CONFIG,
    );
  });

  it("returns complete host values", () => {
    disposers.push(
      configureObsidianExcalidrawHost(
        createFakeHost({
          profile: "eink",
          vectorLod: false,
          imageLod: true,
          imageBudgetBytes: 96 * 1024 * 1024,
          interactionDetail: "minimal",
          inkOverlay: false,
          rawPointerUpdates: false,
          hudEnabled: true,
        }),
      ),
    );

    expect(getFeatherPerformanceConfig()).toEqual({
      profile: "eink",
      vectorLod: false,
      imageLod: true,
      imageBudgetBytes: 96 * 1024 * 1024,
      interactionDetail: "minimal",
      inkOverlay: false,
      rawPointerUpdates: false,
      hudEnabled: true,
    });
  });

  it("replaces invalid values with defaults", () => {
    disposers.push(
      configureObsidianExcalidrawHost(
        createFakeHost({
          profile: "bogus" as never,
          interactionDetail: "loud" as never,
          imageLod: "yes" as never,
        }),
      ),
    );

    const config = getFeatherPerformanceConfig();
    expect(config.profile).toBe(DEFAULT_FEATHER_PERFORMANCE_CONFIG.profile);
    expect(config.interactionDetail).toBe(
      DEFAULT_FEATHER_PERFORMANCE_CONFIG.interactionDetail,
    );
    expect(config.imageLod).toBe(DEFAULT_FEATHER_PERFORMANCE_CONFIG.imageLod);
  });

  it("clamps the image budget into the supported range", () => {
    disposers.push(
      configureObsidianExcalidrawHost(createFakeHost({ imageBudgetBytes: -5 })),
    );
    expect(getFeatherPerformanceConfig().imageBudgetBytes).toBe(
      MIN_FEATHER_IMAGE_BUDGET_BYTES,
    );

    disposers.push(
      configureObsidianExcalidrawHost(
        createFakeHost({ imageBudgetBytes: 8 * 1024 * 1024 * 1024 }),
      ),
    );
    expect(getFeatherPerformanceConfig().imageBudgetBytes).toBe(
      MAX_FEATHER_IMAGE_BUDGET_BYTES,
    );

    disposers.push(
      configureObsidianExcalidrawHost(
        createFakeHost({ imageBudgetBytes: 64 * 1024 * 1024 }),
      ),
    );
    expect(getFeatherPerformanceConfig().imageBudgetBytes).toBe(
      64 * 1024 * 1024,
    );
  });
});
