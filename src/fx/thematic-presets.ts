import type { VisualFxPreset } from './fx-types';

export type ThematicPresetKey =
  | 'cyber-neon'
  | 'ethereal-gold'
  | 'galaxy-aurora'
  | 'minimal-monochrome'
  | 'electric-blue';

export interface ThematicPreset {
  id: ThematicPresetKey;
  label: string;
  description: string;
  settings: Partial<VisualFxPreset>;
}

export const THEMATIC_PRESETS: Record<ThematicPresetKey, ThematicPreset> = {
  'cyber-neon': {
    id: 'cyber-neon',
    label: 'Cyber Neon',
    description: 'Cyan and magenta energy with high-speed sparks',
    settings: {
      enableParticles: true,
      enableLightTrail: true,
      enableKeyboardGlow: true,
      enableSmoke: true,
      particleSpawnRate: 1.5,
      particleSpread: 1.2,
      particleDecay: 0.85,
      trailLength: 1.4,
      trailGlow: 1.8,
      smokeDensity: 0.9,
      keyboardLineThickness: 3.5,
      keyboardGlowSpread: 2.2,
      keyboardDissolveSpeed: 1.1,
      keyboardPulseAmount: 2.0
    }
  },
  'ethereal-gold': {
    id: 'ethereal-gold',
    label: 'Ethereal Gold',
    description: 'Classic orchestral golden glow with floating ambient embers',
    settings: {
      enableParticles: true,
      enableLightTrail: true,
      enableKeyboardGlow: true,
      enableSmoke: true,
      particleSpawnRate: 0.9,
      particleSpread: 0.8,
      particleDecay: 0.6,
      trailLength: 1.0,
      trailGlow: 1.3,
      smokeDensity: 1.1,
      keyboardLineThickness: 2.8,
      keyboardGlowSpread: 1.8,
      keyboardDissolveSpeed: 0.7,
      keyboardPulseAmount: 1.3
    }
  },
  'galaxy-aurora': {
    id: 'galaxy-aurora',
    label: 'Galaxy Aurora',
    description: 'Deep violet and emerald aurora with smooth wave ribbon movement',
    settings: {
      enableParticles: true,
      enableLightTrail: true,
      enableKeyboardGlow: true,
      enableSmoke: true,
      particleSpawnRate: 1.2,
      particleSpread: 1.4,
      particleDecay: 0.75,
      trailLength: 1.6,
      trailGlow: 1.6,
      smokeDensity: 1.4,
      keyboardLineThickness: 3.0,
      keyboardGlowSpread: 2.0,
      keyboardDissolveSpeed: 0.9,
      keyboardPulseAmount: 1.6
    }
  },
  'minimal-monochrome': {
    id: 'minimal-monochrome',
    label: 'Minimal Monochrome',
    description: 'Sharp ice-white aesthetic with tight emissive outlines',
    settings: {
      enableParticles: false,
      enableLightTrail: true,
      enableKeyboardGlow: true,
      enableSmoke: false,
      particleSpawnRate: 0.4,
      particleSpread: 0.4,
      particleDecay: 1.2,
      trailLength: 0.8,
      trailGlow: 1.0,
      smokeDensity: 0.0,
      keyboardLineThickness: 1.8,
      keyboardGlowSpread: 1.1,
      keyboardDissolveSpeed: 1.4,
      keyboardPulseAmount: 1.0
    }
  },
  'electric-blue': {
    id: 'electric-blue',
    label: 'Electric Blue',
    description: 'High turbulence shockwaves and reactive micro-sparks',
    settings: {
      enableParticles: true,
      enableLightTrail: true,
      enableKeyboardGlow: true,
      enableSmoke: true,
      particleSpawnRate: 1.8,
      particleSpread: 1.5,
      particleDecay: 0.95,
      trailLength: 1.5,
      trailGlow: 2.0,
      smokeDensity: 0.8,
      keyboardLineThickness: 4.0,
      keyboardGlowSpread: 2.5,
      keyboardDissolveSpeed: 1.3,
      keyboardPulseAmount: 2.4
    }
  }
};
