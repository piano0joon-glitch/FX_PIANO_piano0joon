import { describe, expect, it } from "vitest";
import { getFxPresetTuning } from "../fx-presets";
import { DEFAULT_VISUAL_FX_CONFIG, normalizeVisualFxConfig } from "../fx-types";

describe("FX phase 1 defaults", () => {
  it("keeps smoke connected for the default preset", () => {
    const tuning = getFxPresetTuning(DEFAULT_VISUAL_FX_CONFIG.preset);
    expect(DEFAULT_VISUAL_FX_CONFIG.smokeEnabled).toBe(true);
    expect(DEFAULT_VISUAL_FX_CONFIG.smokeDensity).toBeGreaterThan(0);
    expect(tuning.smokeMultiplier).toBeGreaterThan(0);
  });

  it("keeps keyboard line controls live after normalization", () => {
    const config = normalizeVisualFxConfig({
      keyboardGlowThickness: 12,
      keyboardGlowSpread: 180,
      keyboardGlowDissolveSpeed: 4.2,
      keyboardGlowPulseAmount: 0.85
    });
    expect(config.keyboardGlowThickness).toBe(12);
    expect(config.keyboardGlowSpread).toBe(180);
    expect(config.keyboardGlowDissolveSpeed).toBe(4.2);
    expect(config.keyboardGlowPulseAmount).toBe(0.85);
  });
});
