import { Container, Texture } from "pixi.js";
import type { Point } from "../geometry/models";
import type { FxTextureId } from "./fx-asset-types";
import type { FxAssetPipeline } from "./asset-pipeline";
import {
  clamp,
  FxSmokeBehavior,
  FxSmokeLayer,
  MAX_ACTIVE_SMOKE
} from "./fx-types";
import {
  GpuParticleBatch,
  type GpuParticleSpawn
} from "./gpu-particle-batch";
import { SeededRandom } from "./seeded-random";

interface SmokeLayerProfile {
  scaleMultiplier: number;
  lifetimeMultiplier: number;
  alphaMultiplier: number;
  drag: number;
  turbulence: number;
  turbulenceFrequency: number;
  rise: number;
  spin: number;
  fadeInEnd: number;
  fadeOutStart: number;
}

const LAYER_PROFILES: Record<FxSmokeLayer, SmokeLayerProfile> = {
  core: {
    scaleMultiplier: 0.78,
    lifetimeMultiplier: 0.78,
    alphaMultiplier: 0.72,
    drag: 0.95,
    turbulence: 1.15,
    turbulenceFrequency: 3.8,
    rise: 5.2,
    spin: 0.6,
    fadeInEnd: 0.1,
    fadeOutStart: 0.58
  },
  volume: {
    scaleMultiplier: 1.08,
    lifetimeMultiplier: 1,
    alphaMultiplier: 0.54,
    drag: 0.72,
    turbulence: 0.75,
    turbulenceFrequency: 2.4,
    rise: 3.4,
    spin: 0.35,
    fadeInEnd: 0.14,
    fadeOutStart: 0.54
  },
  residue: {
    scaleMultiplier: 1.36,
    lifetimeMultiplier: 1.2,
    alphaMultiplier: 0.34,
    drag: 1.15,
    turbulence: 0.52,
    turbulenceFrequency: 1.8,
    rise: 2.1,
    spin: 0.2,
    fadeInEnd: 0.18,
    fadeOutStart: 0.48
  }
};

const TEXTURES_BY_LAYER: Record<FxSmokeLayer, readonly FxTextureId[]> = {
  core: ["smoke-wisp-01", "smoke-wisp-02"],
  volume: ["smoke-cloud-01", "smoke-wisp-02"],
  residue: ["smoke-wisp-01", "smoke-cloud-01"]
};

const GPU_BATCH_CAPACITY = 128;

interface SmokeBatchEntry {
  layer: FxSmokeLayer;
  textureId: FxTextureId;
  batch: GpuParticleBatch;
}

/**
 * GPU-backed layered smoke pool.
 *
 * Smoke motion, breathing, growth and alpha curves are evaluated in the same
 * particle vertex shader used by the ember/spark pool. This removes the
 * previous O(MAX_ACTIVE_SMOKE) Sprite update loop from the render ticker.
 */
export class SmokeController {
  readonly layer = new Container();

  private readonly maxPuffs: number;
  private readonly batches = new Map<string, SmokeBatchEntry[]>();
  private texturePipeline: FxAssetPipeline | undefined;
  private random = new SeededRandom("piano-puzzle-smoke");
  private currentTimeSeconds = 0;
  private allocatedSlots = 0;
  private activePuffs = 0;
  private droppedPuffs = 0;
  private readonly activeByLayer: Record<FxSmokeLayer, number> = {
    core: 0,
    volume: 0,
    residue: 0
  };
  private readonly lastTextureByLayer: Record<FxSmokeLayer, FxTextureId | undefined> = {
    core: undefined,
    volume: undefined,
    residue: undefined
  };

  constructor(maxPuffs = MAX_ACTIVE_SMOKE) {
    this.layer.sortableChildren = true;
    this.maxPuffs = Math.max(1, Math.min(MAX_ACTIVE_SMOKE, Math.floor(maxPuffs)));
  }

  setTexturePipeline(pipeline: FxAssetPipeline): void {
    this.texturePipeline = pipeline;
  }

  setSeed(seed: string | number): void {
    this.random = new SeededRandom(seed);
    this.lastTextureByLayer.core = undefined;
    this.lastTextureByLayer.volume = undefined;
    this.lastTextureByLayer.residue = undefined;
  }

  acquire(
    position: Point,
    velocity: Point,
    lifetime: number,
    color: number,
    radius: number,
    alpha: number,
    layer: FxSmokeLayer = "volume",
    behavior: FxSmokeBehavior = "neutral",
    dragMultiplier = 1,
    turbulenceMultiplier = 1,
    behaviorMultiplier = 1
  ): boolean {
    if (this.activePuffs >= this.maxPuffs) {
      this.droppedPuffs += 1;
      return false;
    }

    const profile = LAYER_PROFILES[layer];
    const behaviorScale = behavior === "bass" ? 1.18 : behavior === "high" ? 0.78 : 1;
    const behaviorLifetime = behavior === "bass" ? 1.18 : behavior === "high" ? 0.76 : 1;
    const behaviorDrag = behavior === "bass" ? 1.22 : behavior === "high" ? 0.78 : 1;
    const behaviorTurbulence = behavior === "bass" ? 0.72 : behavior === "high" ? 1.4 : 1;
    const behaviorRise = behavior === "bass" ? 0.62 : behavior === "high" ? 1.32 : 1;
    const lifetimeMs = Math.max(
      120,
      lifetime * profile.lifetimeMultiplier * behaviorLifetime * this.random.range(0.86, 1.18)
    );
    const baseAlpha = clamp(
      alpha * profile.alphaMultiplier * behaviorMultiplier * this.random.range(0.9, 1.12)
    );
    const textureId = this.pickTexture(layer);
    const texture = this.texturePipeline?.getTexture(textureId) ?? Texture.WHITE;
    const textureExtent = Math.max(1, texture.width, texture.height);
    const baseScale = Math.max(
      0.01,
      radius * 2 / textureExtent
        * profile.scaleMultiplier
        * behaviorScale
        * behaviorMultiplier
        * this.random.range(0.86, 1.18)
    );
    let rotation = this.random.range(0, Math.PI * 2);
    if (textureId === "smoke-wisp-01") {
      rotation = Math.atan2(velocity.y, velocity.x) + Math.PI * 0.5 + this.random.signed(0.42);
    }

    const spawn: GpuParticleSpawn = {
      x: position.x,
      y: position.y,
      vx: velocity.x,
      vy: velocity.y,
      lifetimeSeconds: lifetimeMs / 1000,
      baseScale,
      rotation,
      spin: this.random.signed(profile.spin),
      phase: this.random.range(0, Math.PI * 2),
      drag: profile.drag * behaviorDrag * dragMultiplier * this.random.range(0.88, 1.14),
      turbulence: profile.turbulence * behaviorTurbulence * turbulenceMultiplier * this.random.range(0.86, 1.18),
      turbulenceFrequency: profile.turbulenceFrequency * this.random.range(0.88, 1.12),
      rise: profile.rise * behaviorRise * this.random.range(0.86, 1.16),
      fadeInEnd: profile.fadeInEnd,
      fadeOutStart: profile.fadeOutStart,
      baseAlpha,
      color,
      endColor: color,
      colorShift: 0,
      flipX: this.random.nextFloat() > 0.5,
      mode: "smoke",
      depth: this.random.range(0.72, 1.28)
    };

    const key = `${layer}:${textureId}`;
    const entries = this.batches.get(key) ?? [];
    this.batches.set(key, entries);

    let accepted = false;
    for (const entry of entries) {
      entry.batch.setTexture(texture);
      if (entry.batch.spawn(this.currentTimeSeconds, spawn)) {
        accepted = true;
        break;
      }
    }

    if (!accepted && this.allocatedSlots < this.maxPuffs) {
      const capacity = Math.min(GPU_BATCH_CAPACITY, this.maxPuffs - this.allocatedSlots);
      const batch = new GpuParticleBatch(
        capacity,
        texture,
        layer === "volume" ? "normal" : "screen",
        layer === "core" ? 1 : layer === "volume" ? 2 : 3
      );
      this.layer.addChild(batch.mesh);
      entries.push({ layer, textureId, batch });
      this.allocatedSlots += capacity;
      accepted = batch.spawn(this.currentTimeSeconds, spawn);
    }

    if (!accepted) {
      this.droppedPuffs += 1;
      return false;
    }

    this.activePuffs += 1;
    this.activeByLayer[layer] += 1;
    return true;
  }

  update(deltaSeconds: number): void {
    this.currentTimeSeconds += Math.min(0.1, Math.max(0, deltaSeconds));
    for (const entries of this.batches.values()) {
      for (const entry of entries) {
        entry.batch.update(this.currentTimeSeconds);
        entry.batch.flush();
      }
    }
    this.syncCounts();
  }

  flush(): void {
    for (const entries of this.batches.values()) {
      for (const entry of entries) entry.batch.flush();
    }
    this.syncCounts();
  }

  clear(): void {
    for (const entries of this.batches.values()) {
      for (const entry of entries) entry.batch.clear();
    }
    this.currentTimeSeconds = 0;
    this.activePuffs = 0;
    this.droppedPuffs = 0;
    this.activeByLayer.core = 0;
    this.activeByLayer.volume = 0;
    this.activeByLayer.residue = 0;
    this.lastTextureByLayer.core = undefined;
    this.lastTextureByLayer.volume = undefined;
    this.lastTextureByLayer.residue = undefined;
  }

  get activeCount(): number {
    return this.activePuffs;
  }

  get droppedCount(): number {
    return this.droppedPuffs;
  }

  get capacity(): number {
    return this.maxPuffs;
  }

  get layerCount(): number {
    return 3;
  }

  getLayerActiveCount(layer: FxSmokeLayer): number {
    return this.activeByLayer[layer];
  }

  dispose(): void {
    for (const entries of this.batches.values()) {
      for (const entry of entries) entry.batch.destroy();
    }
    this.batches.clear();
    this.layer.destroy({ children: false });
  }

  private pickTexture(layer: FxSmokeLayer): FxTextureId {
    const candidates = TEXTURES_BY_LAYER[layer];
    let index = Math.floor(this.random.nextFloat() * candidates.length);
    const previous = this.lastTextureByLayer[layer];
    if (candidates.length > 1 && candidates[index] === previous) index = (index + 1) % candidates.length;
    const textureId = candidates[index];
    this.lastTextureByLayer[layer] = textureId;
    return textureId;
  }

  private syncCounts(): void {
    let active = 0;
    this.activeByLayer.core = 0;
    this.activeByLayer.volume = 0;
    this.activeByLayer.residue = 0;
    for (const entries of this.batches.values()) {
      for (const entry of entries) {
        const count = entry.batch.activeCount;
        active += count;
        this.activeByLayer[entry.layer] += count;
      }
    }
    this.activePuffs = active;
  }
}
