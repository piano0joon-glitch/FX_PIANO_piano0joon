export type VideoPlatformProfileId =
  | "instagram-vertical"
  | "instagram-feed-portrait"
  | "instagram-square"
  | "youtube-landscape"
  | "youtube-shorts"
  | "custom";

export type VideoQualityPreset = "compact" | "balanced" | "high" | "custom";
export type VideoContainerFormat = "webm" | "mp4";

export interface VideoOutputProfile {
  id: VideoPlatformProfileId;
  label: string;
  width: number;
  height: number;
  fps: 30 | 60;
  bitrateMbps: number;
  description: string;
}

export const VIDEO_OUTPUT_PROFILES: VideoOutputProfile[] = [
  { id: "instagram-vertical", label: "Instagram عمودی / Reels / Stories", width: 1080, height: 1920, fps: 60, bitrateMbps: 10, description: "۹:۱۶ · استوری، Reels و TikTok" },
  { id: "instagram-feed-portrait", label: "Instagram Feed عمودی", width: 1080, height: 1350, fps: 60, bitrateMbps: 10, description: "۴:۵ · پست پرتره استاندارد" },
  { id: "instagram-square", label: "Instagram مربع", width: 1080, height: 1080, fps: 60, bitrateMbps: 8, description: "۱:۱ · پست مربعی" },
  { id: "youtube-landscape", label: "YouTube افقی", width: 1920, height: 1080, fps: 60, bitrateMbps: 14, description: "۱۶:۹ · ویدئوی افقی یوتیوب" },
  { id: "youtube-shorts", label: "YouTube Shorts", width: 1080, height: 1920, fps: 60, bitrateMbps: 10, description: "۹:۱۶ · ویدئوی کوتاه عمودی" }
];

export interface VideoCropSettings { x: number; y: number; width: number; height: number; opacity: number }
export const DEFAULT_VIDEO_CROP: VideoCropSettings = { x: 0, y: 0, width: 1, height: 1, opacity: 0.82 };

export interface VideoOutputSettings {
  profileId: VideoPlatformProfileId;
  width: number;
  height: number;
  fps: 30 | 60;
  quality: VideoQualityPreset;
  bitrateMbps: number;
  audioBitrateKbps: number;
  format: VideoContainerFormat;
  fit: "contain" | "cover";
}

export const DEFAULT_VIDEO_OUTPUT_SETTINGS: VideoOutputSettings = {
  profileId: "instagram-vertical", width: 1080, height: 1920, fps: 60,
  quality: "balanced", bitrateMbps: 10, audioBitrateKbps: 128, format: "webm", fit: "contain"
};

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }

export function normalizeVideoCrop(value?: Partial<VideoCropSettings>): VideoCropSettings {
  const width = clamp(Number(value?.width ?? 1), 0.05, 1);
  const height = clamp(Number(value?.height ?? 1), 0.05, 1);
  return { x: clamp(Number(value?.x ?? 0), 0, 1 - width), y: clamp(Number(value?.y ?? 0), 0, 1 - height), width, height, opacity: clamp(Number(value?.opacity ?? 0.82), 0, 1) };
}

export function normalizeVideoOutputSettings(value?: Partial<VideoOutputSettings>): VideoOutputSettings {
  const profile = VIDEO_OUTPUT_PROFILES.find((candidate) => candidate.id === value?.profileId);
  const width = clamp(Math.round(Number(value?.width ?? profile?.width ?? 1080)), 320, 3840);
  const height = clamp(Math.round(Number(value?.height ?? profile?.height ?? 1920)), 320, 3840);
  const fps: 30 | 60 = Number(value?.fps ?? profile?.fps) === 30 ? 30 : 60;
  const quality: VideoQualityPreset = value?.quality === "compact" || value?.quality === "high" || value?.quality === "custom" ? value.quality : "balanced";
  return { profileId: profile?.id ?? (value?.profileId === "custom" ? "custom" : "instagram-vertical"), width, height, fps, quality, bitrateMbps: clamp(Number(value?.bitrateMbps ?? profile?.bitrateMbps ?? 10), 2, 40), audioBitrateKbps: clamp(Math.round(Number(value?.audioBitrateKbps ?? 128)), 64, 320), format: value?.format === "mp4" ? "mp4" : "webm", fit: value?.fit === "cover" ? "cover" : "contain" };
}

export function bitrateForQuality(profileId: VideoPlatformProfileId, quality: VideoQualityPreset, fps: 30 | 60): number {
  const base = VIDEO_OUTPUT_PROFILES.find((candidate) => candidate.id === profileId)?.bitrateMbps ?? 10;
  const fpsMultiplier = fps === 60 ? 1.35 : 1;
  if (quality === "compact") return Math.max(3, Math.round(base * 0.65 * fpsMultiplier * 10) / 10);
  if (quality === "high") return Math.round(base * 1.45 * fpsMultiplier * 10) / 10;
  return Math.round(base * fpsMultiplier * 10) / 10;
}
