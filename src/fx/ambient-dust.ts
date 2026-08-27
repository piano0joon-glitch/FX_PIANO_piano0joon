import { Container } from "pixi.js";
import { ParticlePool } from "./particle-pool";

interface DustParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  targetAlpha: number;
  maxLife: number;
  color: number;
}

const MAX_DUST = 800;

/**
 * GPU-backed ambient dust.
 *
 * The previous implementation rebuilt a Pixi Graphics path with thousands of
 * circles on every ticker pass. This version uploads spawn data only and lets
 * the shared GPU particle shader handle motion, fade and drawing.
 */
export class AmbientDustSystem {
  private readonly pool = new ParticlePool(MAX_DUST);
  readonly layer: Container = this.pool.layer;
  private density = 0.35;
  private enabled = true;
  private toneReactive = true;
  private toneShift = 0;
  private hitBoost = 0;
  private targetCount = -1;

  setTexturePipeline(pipeline: Parameters<ParticlePool["setTexturePipeline"]>[0]): void {
    this.pool.setTexturePipeline(pipeline);
  }

  setBounds(w: number, h: number): void {
    void w;
    void h;
  }

  setDensity(value: number): void {
    this.density = Math.max(0, Math.min(1, value));
  }

  setEnabled(value: boolean): void {
    if (this.enabled === value) return;
    this.enabled = value;
    this.layer.visible = value;
    if (!value) {
      this.pool.clear();
      this.targetCount = -1;
    }
  }

  setToneReactive(value: boolean): void {
    this.toneReactive = value;
  }

  noteHit(midiNote: number, velocity: number): void {
    if (this.toneReactive) this.toneShift = (midiNote - 60) / 48;
    this.hitBoost = Math.min(1, this.hitBoost + velocity * 0.3);
  }

  update(deltaMs: number): void {
    if (!this.enabled) return;

    const targetCount = Math.round(MAX_DUST * this.density);
    if (targetCount !== this.targetCount) {
      if (this.targetCount >= 0 && targetCount < this.targetCount) this.pool.clear();
      this.targetCount = targetCount;
    }

    this.hitBoost = Math.max(0, this.hitBoost - deltaMs * 0.0018);
    this.pool.update(deltaMs / 1000);

    while (this.pool.activeCount < targetCount) {
      const particle = this.spawnParticle();
      const color = this.toneReactive
        ? this.shiftColor(particle.color, this.toneShift)
        : particle.color;
      this.pool.acquire(
        { x: particle.x, y: particle.y },
        { x: particle.vx, y: particle.vy },
        particle.maxLife,
        color,
        particle.size / 48,
        "dust-mote",
        Math.min(0.9, particle.targetAlpha * (0.8 + this.hitBoost * 0.35))
      );
    }
    this.pool.flush();
  }

  clear(): void {
    this.pool.clear();
    this.toneShift = 0;
    this.hitBoost = 0;
    this.targetCount = -1;
  }

  dispose(): void {
    this.clear();
    this.pool.dispose();
  }

  private spawnParticle(): DustParticle {
    const isEmber = Math.random() < 0.3;
    const baseSize = isEmber ? 1 + Math.random() * 2 : 0.5 + Math.random() * 1.5;
    return {
      x: Math.random() * 1080,
      y: Math.random() * 1920,
      vx: (Math.random() - 0.5) * 8,
      vy: -2 - Math.random() * 6,
      size: baseSize,
      targetAlpha: 0.2 + Math.random() * 0.5,
      maxLife: 3000 + Math.random() * 8000,
      color: isEmber
        ? (Math.random() < 0.5 ? 0xff8844 : 0xffaa55)
        : (Math.random() < 0.5 ? 0xccbb99 : 0xddccaa)
    };
  }

  private shiftColor(color: number, shift: number): number {
    if (shift === 0) return color;
    let red = (color >> 16) & 0xff;
    let green = (color >> 8) & 0xff;
    let blue = color & 0xff;

    if (shift < 0) {
      const amount = Math.abs(shift) * 0.3;
      red = Math.min(255, red + amount * 40);
      green = Math.min(255, green + amount * 15);
      blue = Math.max(0, blue - amount * 30);
    } else {
      const amount = shift * 0.3;
      red = Math.max(0, red - amount * 20);
      green = Math.min(255, green + amount * 10);
      blue = Math.min(255, blue + amount * 40);
    }

    return (red << 16) | (green << 8) | blue;
  }
}
