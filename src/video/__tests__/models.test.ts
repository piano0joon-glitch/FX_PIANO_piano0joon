import { describe, expect, it } from "vitest";
import { bitrateForQuality, DEFAULT_VIDEO_CROP, normalizeVideoCrop, normalizeVideoOutputSettings, VIDEO_OUTPUT_PROFILES } from "../models";
import { createCompositionLayout } from "../../composition/composition-store";

describe("video output models", () => {
  it("exposes the requested social platform sizes", () => {
    expect(VIDEO_OUTPUT_PROFILES.find((profile) => profile.id === "instagram-vertical")).toMatchObject({ width: 1080, height: 1920 });
    expect(VIDEO_OUTPUT_PROFILES.find((profile) => profile.id === "instagram-feed-portrait")).toMatchObject({ width: 1080, height: 1350 });
    expect(VIDEO_OUTPUT_PROFILES.find((profile) => profile.id === "youtube-landscape")).toMatchObject({ width: 1920, height: 1080 });
    expect(VIDEO_OUTPUT_PROFILES.find((profile) => profile.id === "youtube-shorts")).toMatchObject({ width: 1080, height: 1920 });
  });

  it("keeps crop bounds inside the source video", () => {
    expect(normalizeVideoCrop({ x: 0.9, y: -1, width: 0.4, height: 0.7 })).toEqual({
      x: 0.6,
      y: 0,
      width: 0.4,
      height: 0.7,
      opacity: DEFAULT_VIDEO_CROP.opacity
    });
  });

  it("derives the composition split from the selected output", () => {
    const layout = createCompositionLayout(1920, 1080);
    expect(layout.compositionWidth).toBe(1920);
    expect(layout.compositionHeight).toBe(1080);
    expect(layout.pianoRegion.y).toBe(layout.puzzleRegion.height);
    expect(layout.pianoRegion.height + layout.puzzleRegion.height).toBe(1080);
  });

  it("raises bitrate for high quality and 60fps", () => {
    expect(bitrateForQuality("youtube-landscape", "high", 60)).toBeGreaterThan(
      bitrateForQuality("youtube-landscape", "balanced", 30)
    );
    expect(normalizeVideoOutputSettings({ profileId: "custom", width: 1, height: 1 }).width).toBe(320);
  });
});
