export type StudioTab =
  | 'video-canvas'
  | 'piano-mask'
  | 'cinematic-fx'
  | 'puzzle-reveal'
  | 'export';

export interface StudioTabItem {
  id: StudioTab;
  label: string;
  icon: string;
  description: string;
}

export const STUDIO_TABS: StudioTabItem[] = [
  {
    id: 'video-canvas',
    label: 'Video & Canvas',
    icon: 'film',
    description: 'Aspect ratios (9:16, 1:1, 4:5, 16:9), background video loading, calibration'
  },
  {
    id: 'piano-mask',
    label: 'Piano & Mask',
    icon: 'piano',
    description: 'Glass keyboard overlay, emissive keyboard line, soft hand mask'
  },
  {
    id: 'cinematic-fx',
    label: 'Cinematic FX',
    icon: 'sparkles',
    description: 'Micro sparks, energy ribbons, organic bloom/glow, smoke and presets'
  },
  {
    id: 'puzzle-reveal',
    label: 'Puzzle & Reveal',
    icon: 'puzzle',
    description: 'Motion trajectories, dissolve modes, and glass piece reveal'
  },
  {
    id: 'export',
    label: 'Export',
    icon: 'download',
    description: 'Frame-accurate offline renderer, bitrates, audio sync & progress'
  }
];
