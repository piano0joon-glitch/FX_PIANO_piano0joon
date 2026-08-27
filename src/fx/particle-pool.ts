import { Container, Texture } from "pixi.js";
import type { Point } from "../geometry/models";
import type { FxTextureId } from "./fx-asset-types";
import type { FxAssetPipeline } from "./asset-pipeline";
import { clamp, MAX_ACTIVE_PARTICLES } from "./fx-types";
import {
  blendModeForGpuTexture,
  GpuParticleBatch,
  type GpuParticleSpawn
} from "./gpu-particle-batch";
import { SeededRandom } from "./seeded-random";

const GPU_BATCH_CAPACITY = 256;

/**
 * GPU-backed particle pool.
 *
 * The old implementation kept 5,000 Sprite objects and integrated every
 * active particle on the CPU on every tick. This pool keeps only compact spawn
 * data on the CPU; the GPU batch evaluates motion, turbulence, fade, scale and
 * rotation in its vertex shader.
 */
export class ParticlePool {
  readonly layer = new Container();

  private readonly maxParticles: number;
  private readonly batches = new Map<FxTextureId, GpuParticleBatch[]>();
  private texturePipeline: FxAssetPipeline | undefined;
  private random = new SeededRandom("piano-puzzle-particles");
  private currentTimeSeconds = 0;
  private allocatedSlots = 0;
  private activeParticles = 0;
  private droppedParticles = 0;

  constructor(maxParticles = MAX_ACTIVE_PARTICLES) {
    this.maxParticles = Math.max(1, Math.min(MAX_ACTIVE_PARTICLES, Math.floor(maxParticles)));
  }

  setTexturePipeline(pipeline: FxAssetPipeline): void {
    this.texturePipeline = pipeline;
  }

  setSeed(seed: string | number): void {
    this.random = new SeededRandom(seed);
  }

  acquire(
    position: Point,
    velocity: Point,
    lifetime: number,
    color: number,
    scale: number,
    textureId: FxTextureId = "dust-mote",
    alpha = 1
  ): boolean {
    if (this.activeParticles >= this.maxParticles) {
      this.droppedParticles += 1;
      return false;
    }

    let rotation = this.random.range(0, Math.PI * 2);
    const spin = this.random.signed(textureId === "light-streak" ? 1.4 : 3.8);
    const phase = this.random.range(0, Math.PI * 2);
    const drag = textureId === "light-streak"
      ? 0.35
      : textureId === "soft-bokeh"
        ? 0.55
        : textureId === "glow-orb"
          ? 0.6
          : 0.9;
    const turbulence = textureId === "sharp-dot"
      ? 5.5 + this.random.signed(1.5)
      : textureId === "glow-orb"
        ? 4.0 + this.random.signed(1.2)
        : textureId === "warm-orb" || textureId === "ice-orb"
          ? 3.5 + this.random.signed(1)
          : 2.5 + this.random.signed(0.8);
    const turbulenceFrequency = textureId === "sharp-dot"
      ? 4.5 + this.random.signed(1)
      : textureId === "glow-orb"
        ? 3.5 + this.random.signed(0.8)
        : 2.8 + this.random.signed(0.6);
    const rise = textureId === "sharp-dot" || textureId === "glow-orb"
      ? -4.0 + this.random.signed(1.5)
      : -1.0 + this.random.signed(0.5);
    const fadeInEnd = textureId === "light-streak"
      ? 0.02
      : textureId === "glow-orb"
        ? 0.04
        : textureId === "sharp-dot"
          ? 0.015
          : 0.05;
    const fadeOutStart = textureId === "glow-orb"
      ? 0.5
      : textureId === "sharp-dot"
        ? 0.68
        : 0.58;
    const flipX = this.random.nextFloat() > 0.5;
    const colorShift = this.random.range(0.08, 0.18);
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    const endColor = (Math.min(255, Math.round(r * 0.7 + 80)) << 16)
      | (Math.min(255, Math.round(g * 0.6 + 60)) << 8)
      | Math.min(255, Math.round(b * 0.5 + 40));

    if (textureId === "light-streak") {
      rotation = Math.atan2(velocity.y, velocity.x) + this.random.signed(0.24);
    }

    const spawn: GpuParticleSpawn = {
      x: position.x,
      y: position.y,
      vx: velocity.x,
      vy: velocity.y,
      lifetimeSeconds: Math.max(0.001, lifetime / 1000),
      baseScale: Math.max(0.01, scale),
      rotation,
      spin,
      phase,
      drag,
      turbulence,
      turbulenceFrequency,
      rise,
      fadeInEnd,
      fadeOutStart,
      baseAlpha: clamp(alpha),
      color,
      endColor,
      colorShift,
      flipX,
      mode: "particle"
    };

    const texture = this.texturePipeline?.getTexture(textureId) ?? Texture.WHITE;
    const batches = this.batches.get(textureId) ?? [];
    this.batches.set(textureId, batches);

    let accepted = false;
    for (const batch of batches) {
      batch.setTexture(texture);
      if (batch.spawn(this.currentTimeSeconds, spawn)) {
        accepted = true;
        break;
      }
    }

    if (!accepted && this.allocatedSlots < this.maxParticles) {
      const capacity = Math.min(GPU_BATCH_CAPACITY, this.maxParticles - this.allocatedSlots);
      const batch = new GpuParticleBatch(
        capacity,
        texture,
        blendModeForGpuTexture(textureId)
      );
      this.layer.addChild(batch.mesh);
      batches.push(batch);
      this.allocatedSlots += capacity;
      accepted = batch.spawn(this.currentTimeSeconds, spawn);
    }

    if (!accepted) {
      this.droppedParticles += 1;
      return false;
    }

    this.activeParticles += 1;
    return true;
  }

  update(deltaSeconds: number): void {
    this.currentTimeSeconds += Math.min(0.1, Math.max(0, deltaSeconds));
    let active = 0;
    for (const batches of this.batches.values()) {
      for (const batch of batches) {
        batch.update(this.currentTimeSeconds);
        batch.flush();
        active += batch.activeCount;
      }
    }
    this.activeParticles = active;
  }

  /**
   * Uploads particles spawned during the current FX tick. Spawns that happen
   * between ticks are flushed here as well, without an O(capacity) simulation.
   */
  flush(): void {
    let active = 0;
    for (const batches of this.batches.values()) {
      for (const batch of batches) {
        batch.flush();
        active += batch.activeCount;
      }
    }
    this.activeParticles = active;
  }

  clear(): void {
    for (const batches of this.batches.values()) {
      for (const batch of batches) batch.clear();
    }
    this.currentTimeSeconds = 0;
    this.activeParticles = 0;
    this.droppedParticles = 0;
  }

  get activeCount(): number {
    return this.activeParticles;
  }

  get droppedCount(): number {
    return this.droppedParticles;
  }

  get capacity(): number {
    return this.maxParticles;
  }

  dispose(): void {
    for (const batches of this.batches.values()) {
      for (const batch of batches) batch.destroy();
    }
    this.batches.clear();
    this.layer.destroy({ children: false });
  }
}
