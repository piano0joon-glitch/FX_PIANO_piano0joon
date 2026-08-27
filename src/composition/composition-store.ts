import type { CompositionLayout } from "./models";

export const DEFAULT_COMPOSITION_LAYOUT: CompositionLayout = {
  compositionWidth: 1080,
  compositionHeight: 1920,
  puzzleRegion: { x: 0, y: 0, width: 1080, height: 960 },
  pianoRegion: { x: 0, y: 960, width: 1080, height: 960 },
  previewMode: "split"
};

export function createCompositionLayout(width = 1080, height = 1920): CompositionLayout {
  const compositionWidth = Math.max(320, Math.round(Number.isFinite(width) ? width : 1080));
  const compositionHeight = Math.max(320, Math.round(Number.isFinite(height) ? height : 1920));
  const isPortrait = compositionHeight / compositionWidth >= 1.1;
  const puzzleShare = isPortrait ? 0.58 : 0.54;
  const puzzleHeight = Math.round(compositionHeight * puzzleShare);

  return {
    compositionWidth,
    compositionHeight,
    puzzleRegion: { x: 0, y: 0, width: compositionWidth, height: puzzleHeight },
    pianoRegion: { x: 0, y: puzzleHeight, width: compositionWidth, height: compositionHeight - puzzleHeight },
    previewMode: "split"
  };
}

export function normalizeCompositionLayout(value?: Partial<CompositionLayout>): CompositionLayout {
  return { ...DEFAULT_COMPOSITION_LAYOUT, ...value };
}
