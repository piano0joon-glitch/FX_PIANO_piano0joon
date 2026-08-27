export type AssetType = "image" | "video" | "midi" | "audio";
export type AssetStatus = "empty" | "loading" | "loaded" | "error";
export type AssetRole = "reference-piano-frame" | "puzzle-artwork" | "performer-video" | "midi";
import type { Calibration } from "../../keyboard/models";
import type { MidiMappingConfig } from "../../puzzle/puzzle-event-models";
import type { AnimationTimingSettings } from "../../animation/models";
import type { ExpressionSettings } from "../../expression/models";
import { DEFAULT_EXPRESSION_SETTINGS } from "../../expression/expression-store";
import { DEFAULT_VIDEO_CROP, DEFAULT_VIDEO_OUTPUT_SETTINGS, type VideoCropSettings, type VideoOutputSettings } from "../../video/models";

export interface Asset {
  id: string;
  type: AssetType;
  fileName: string;
  filePath: string;
  mimeType: string;
  fileSize: number;
  duration?: number;
  width?: number;
  height?: number;
  importedAt: string;
  status: AssetStatus;
  error?: string;
  dataUrl?: string;
  role?: AssetRole;
}

export interface Project {
  projectId: string;
  projectName: string;
  createdAt: string;
  updatedAt: string;
  imageAsset?: Asset;
  videoAsset?: Asset;
  midiAsset?: Asset;
  audioAsset?: Asset;
  videoCrop: VideoCropSettings;
  outputSettings: VideoOutputSettings;
  canvasSettings: { width: number; height: number; fit: "contain" | "cover" };
  midiSettings: { selectedTrackIndices: number[]; chordTolerance: number };
  previewSettings: { fps: 30 | 60; loop: boolean; currentTime: number };
  keyboardCalibration?: Calibration;
  midiMappingConfig?: MidiMappingConfig;
  animationTimingSettings: AnimationTimingSettings;
  animationEasing: AnimationTimingSettings["easing"];
  animationSpeed: number;
  overlapMode: AnimationTimingSettings["overlapMode"];
  debugVisible: boolean;
  expressionSettings: ExpressionSettings;
  version: string;
}

export function createProject(): Project {
  const now = new Date().toISOString();
  return {
    projectId: crypto.randomUUID(),
    projectName: "پروژه بدون نام",
    createdAt: now,
    updatedAt: now,
    canvasSettings: { width: 1080, height: 1920, fit: "contain" },
    videoCrop: DEFAULT_VIDEO_CROP,
    outputSettings: DEFAULT_VIDEO_OUTPUT_SETTINGS,
    midiSettings: { selectedTrackIndices: [], chordTolerance: 0.045 },
    previewSettings: { fps: 60, loop: false, currentTime: 0 },
    midiMappingConfig: { enabled: true, mappingMode: "deterministic-sequence", outOfRangePolicy: "mark-invalid", chordWindowMs: 45, showDebugMarkers: true, showAssignmentLines: false, sequenceCycle: true },
    animationTimingSettings: {
      baseTravelDurationMs: 520,
      minTravelDurationMs: 160,
      maxTravelDurationMs: 1100,
      preHitDelayMs: 0,
      postHitHoldMs: 120,
      durationInfluence: 0.25,
      velocityInfluence: 220,
      overlapMode: "allow-overlap",
      easing: "easeOut",
      animationSpeed: 1,
      debugVisible: false,
      randomSpawn: false,
      randomOrder: false,
      revealOrderMode: "scattered",
      revealZoneRows: 3,
      revealZoneCols: 3,
      pathSeed: "piano-puzzle",
      spawnJitterPx: 2.5,
      motionPathKind: "auto",
      pathCurvature: 0.6,
      orbitStrength: 0.45,
      spiralStrength: 0.55,
      waveStrength: 0.4,
      turbulence: 0.25,
      overshootPx: 14,
      revealStartProgress: 0.82,
      travelRevealCeiling: 0.28,
      arrivalRevealDurationMs: 620,
      glassEnabled: true,
      glassOpacity: 0.35,
      completionGlowDurationMs: 800,
      completionGlowIntensity: 1.0
    },
    animationEasing: "easeOut",
    animationSpeed: 1,
    overlapMode: "allow-overlap",
    debugVisible: true,
    expressionSettings: DEFAULT_EXPRESSION_SETTINGS,
    version: "0.3.0"
  };
}
