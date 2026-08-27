import type { CompositionLayout } from "./models";

export const DEFAULT_COMPOSITION_LAYOUT: CompositionLayout = {
  compositionWidth: 1080,
  compositionHeight: 1920,
  puzzleRegion: { x: 0, y: 0, width: 1080, height: 1114 },
  pianoRegion: { x: 0, y: 1114, width: 1080, height: 806 },
  previewMode: "split"
};

/** Responsive split: portrait gives the puzzle more vertical room, landscape gives the piano more width. */
export function createCompositionLayout(width = 1080, height = 1920): CompositionLayout {
  const compositionWidth = Math.max(320, Math.round(Number.isFinite(width) ? width : 1080));
  const compositionHeight = Math.max(320, Math.round(Number.isFinite(height) ? height : 1920));
  const aspect = compositionWidth / compositionHeight;
  const puzzleShare = aspect < 0.7 ? 0.58 : aspect < 1.05 ? 0.54 : aspect < 1.6 ? 0.48 : 0.42;
  const puzzleHeight = Math.round(compositionHeight * puzzleShare);
  return { compositionWidth, compositionHeight, puzzleRegion: { x: 0, y: 0, width: compositionWidth, height: puzzleHeight }, pianoRegion: { x: 0, y: puzzleHeight, width: compositionWidth, height: compositionHeight - puzzleHeight }, previewMode: "split" };
}

export function normalizeCompositionLayout(value?: Partial<CompositionLayout>): CompositionLayout {
  const width = value?.compositionWidth ?? DEFAULT_COMPOSITION_LAYOUT.compositionWidth;
  const height = value?.compositionHeight ?? DEFAULT_COMPOSITION_LAYOUT.compositionHeight;
  if (!value?.puzzleRegion && !value?.pianoRegion) return createCompositionLayout(width, height);
  return { ...createCompositionLayout(width, height), ...value };
}
