import {
  Buffer,
  BufferUsage,
  Container,
  Geometry,
  GlProgram,
  Mesh,
  Shader,
  Texture,
  UniformGroup
} from "pixi.js";
import type { FxTextureId } from "./fx-asset-types";

export type GpuParticleMode = "particle" | "smoke";

export interface GpuParticleSpawn {
  x: number;
  y: number;
  vx: number;
  vy: number;
  lifetimeSeconds: number;
  baseScale: number;
  rotation: number;
  spin: number;
  phase: number;
  drag: number;
  turbulence: number;
  turbulenceFrequency: number;
  rise: number;
  fadeInEnd: number;
  fadeOutStart: number;
  baseAlpha: number;
  color: number;
  endColor: number;
  colorShift: number;
  flipX: boolean;
  mode: GpuParticleMode;
  depth?: number;
}

interface ExpiryEntry {
  time: number;
  index: number;
}

type ParticleUniformStructure = {
  uTime: { value: number; type: "f32" };
};

const PARTICLE_VERTEX = `
in vec2 aPosition;
in vec2 aUV;
in vec4 aParticle0;
in vec4 aParticle1;
in vec4 aParticle2;
in vec4 aParticle3;
in vec4 aParticle4;
in vec4 aParticle5;
in vec4 aParticle6;

uniform float uTime;

out vec2 vUV;
out vec4 vColor;

void main(void)
{
    float age = max(0.0, uTime - aParticle1.x);
    float lifetime = max(0.001, aParticle1.y);
    float progress = clamp(age / lifetime, 0.0, 1.0);
    float alive = aParticle6.y * step(age, lifetime);
    float isSmoke = step(0.5, aParticle6.z);

    float drag = max(0.001, aParticle2.z);
    float travel = (1.0 - exp(-drag * age)) / drag;
    vec2 position = aParticle0.xy + aParticle0.zw * travel;

    float phase = aParticle2.y + age * aParticle3.x * 6.2831853;
    float turbulence = aParticle2.w;
    float curlX = sin(position.y * 0.008 + aParticle2.y * 3.7 + age * 0.42) * turbulence;
    float curlY = cos(position.x * 0.009 + aParticle2.y * 2.1 - age * 0.31) * turbulence * 0.72;
    vec2 organicMotion = vec2(
        sin(phase) * turbulence * 0.12 + curlX * age * 0.16,
        cos(phase * 0.83 + aParticle2.y * 0.7) * turbulence * 0.09 + curlY * age * 0.13
    );

    // The original CPU simulation applied rise as an acceleration. Keep the
    // same direction while integrating that acceleration analytically here.
    float riseAcceleration = mix(aParticle3.y, -aParticle3.y, isSmoke);
    position += organicMotion + vec2(0.0, 0.5 * riseAcceleration * age * age);

    float fadeIn = smoothstep(0.0, max(0.001, aParticle3.z), progress);
    float fadeOut = 1.0 - smoothstep(aParticle3.w, 1.0, progress);
    float fade = pow(max(0.0, fadeIn * fadeOut), mix(0.42, 0.68, isSmoke));

    float particlePulse = 1.0
        + sin(progress * 6.9115 + aParticle2.y * 2.0) * 0.18
        + sin(progress * 14.137 + aParticle2.y * 3.0) * 0.08;
    float smokeBreathing = 1.0
        + sin(aParticle2.y + progress * 5.2) * 0.1
        + sin(aParticle2.y * 1.7 + progress * 2.6) * 0.05;
    float smokeGrowth = 0.68 + progress * 1.62;
    float size = aParticle1.z * mix(particlePulse * (1.0 + progress * 0.2), smokeGrowth * smokeBreathing, isSmoke);
    size *= mix(1.0, 0.94 + aParticle6.w * 0.06, isSmoke);

    float colorT = min(1.0, progress * aParticle6.x * 5.0);
    vec3 color = mix(aParticle4.xyz, aParticle5.xyz, colorT);
    float finalAlpha = aParticle4.w * fade * alive;

    float flip = aParticle5.w;
    vec2 local = aPosition * size;
    local.x *= flip;
    float cosRotation = cos(aParticle1.w + aParticle2.x * age);
    float sinRotation = sin(aParticle1.w + aParticle2.x * age);
    local = vec2(
        local.x * cosRotation - local.y * sinRotation,
        local.x * sinRotation + local.y * cosRotation
    );

    vec2 worldPosition = position + local;
    mat3 modelViewProjectionMatrix = uProjectionMatrix * uWorldTransformMatrix;
    gl_Position = vec4((modelViewProjectionMatrix * vec3(worldPosition, 1.0)).xy, 0.0, 1.0);

    vUV = aUV;
    vColor = vec4(color * finalAlpha, finalAlpha) * uWorldColorAlpha;
}
`;

const PARTICLE_FRAGMENT = `
in vec2 vUV;
in vec4 vColor;

uniform sampler2D uTexture;

out vec4 finalColor;

void main(void)
{
    finalColor = texture(uTexture, vUV) * vColor;
}
`;

/**
 * A fixed-capacity GPU particle batch.
 *
 * Each particle is four indexed vertices. Spawn parameters are uploaded once
 * and all motion/fade/rotation/scale work happens in the vertex shader. The
 * CPU only reclaims expired slots and uploads newly spawned slots.
 */
export class GpuParticleBatch {
  readonly mesh: Mesh<Geometry, Shader>;

  private readonly capacity: number;
  private readonly particle0: Float32Array;
  private readonly particle1: Float32Array;
  private readonly particle2: Float32Array;
  private readonly particle3: Float32Array;
  private readonly particle4: Float32Array;
  private readonly particle5: Float32Array;
  private readonly particle6: Float32Array;
  private readonly particle0Buffer: Buffer;
  private readonly particle1Buffer: Buffer;
  private readonly particle2Buffer: Buffer;
  private readonly particle3Buffer: Buffer;
  private readonly particle4Buffer: Buffer;
  private readonly particle5Buffer: Buffer;
  private readonly particle6Buffer: Buffer;
  private readonly uniforms: UniformGroup<ParticleUniformStructure>;
  private readonly freeIndices: number[] = [];
  private readonly activeFlags: Uint8Array;
  private readonly expiryTimes: Float64Array;
  private readonly expiryHeap: ExpiryEntry[] = [];
  private activeParticles = 0;
  private dirty = false;
  private texture: Texture;

  constructor(
    capacity: number,
    texture: Texture,
    blendMode: "add" | "screen" | "normal",
    zIndex = 0
  ) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.texture = texture;
    this.activeFlags = new Uint8Array(this.capacity);
    this.expiryTimes = new Float64Array(this.capacity);

    const vertexCount = this.capacity * 4;
    const positions = new Float32Array(vertexCount * 2);
    const uvs = new Float32Array(vertexCount * 2);
    const indices = new Uint16Array(this.capacity * 6);
    const width = Math.max(1, texture.width || 1);
    const height = Math.max(1, texture.height || 1);
    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;
    const quad = [
      -halfWidth, -halfHeight,
      halfWidth, -halfHeight,
      halfWidth, halfHeight,
      -halfWidth, halfHeight
    ];
    const quadUv = [0, 0, 1, 0, 1, 1, 0, 1];

    for (let index = 0; index < this.capacity; index += 1) {
      const vertexOffset = index * 8;
      positions.set(quad, vertexOffset);
      uvs.set(quadUv, vertexOffset);
      const indexOffset = index * 6;
      const baseVertex = index * 4;
      indices.set([
        baseVertex,
        baseVertex + 1,
        baseVertex + 2,
        baseVertex,
        baseVertex + 2,
        baseVertex + 3
      ], indexOffset);
      this.freeIndices.push(this.capacity - index - 1);
    }

    this.particle0 = new Float32Array(vertexCount * 4);
    this.particle1 = new Float32Array(vertexCount * 4);
    this.particle2 = new Float32Array(vertexCount * 4);
    this.particle3 = new Float32Array(vertexCount * 4);
    this.particle4 = new Float32Array(vertexCount * 4);
    this.particle5 = new Float32Array(vertexCount * 4);
    this.particle6 = new Float32Array(vertexCount * 4);

    const dynamicUsage = BufferUsage.VERTEX | BufferUsage.COPY_DST;
    this.particle0Buffer = new Buffer({ data: this.particle0, usage: dynamicUsage, shrinkToFit: false });
    this.particle1Buffer = new Buffer({ data: this.particle1, usage: dynamicUsage, shrinkToFit: false });
    this.particle2Buffer = new Buffer({ data: this.particle2, usage: dynamicUsage, shrinkToFit: false });
    this.particle3Buffer = new Buffer({ data: this.particle3, usage: dynamicUsage, shrinkToFit: false });
    this.particle4Buffer = new Buffer({ data: this.particle4, usage: dynamicUsage, shrinkToFit: false });
    this.particle5Buffer = new Buffer({ data: this.particle5, usage: dynamicUsage, shrinkToFit: false });
    this.particle6Buffer = new Buffer({ data: this.particle6, usage: dynamicUsage, shrinkToFit: false });

    const geometry = new Geometry({
      attributes: {
        aPosition: {
          buffer: new Buffer({
            data: positions,
            usage: BufferUsage.VERTEX | BufferUsage.STATIC,
            shrinkToFit: false
          }),
          format: "float32x2",
          stride: 2 * 4
        },
        aUV: {
          buffer: new Buffer({
            data: uvs,
            usage: BufferUsage.VERTEX | BufferUsage.STATIC,
            shrinkToFit: false
          }),
          format: "float32x2",
          stride: 2 * 4
        },
        aParticle0: { buffer: this.particle0Buffer, format: "float32x4", stride: 4 * 4 },
        aParticle1: { buffer: this.particle1Buffer, format: "float32x4", stride: 4 * 4 },
        aParticle2: { buffer: this.particle2Buffer, format: "float32x4", stride: 4 * 4 },
        aParticle3: { buffer: this.particle3Buffer, format: "float32x4", stride: 4 * 4 },
        aParticle4: { buffer: this.particle4Buffer, format: "float32x4", stride: 4 * 4 },
        aParticle5: { buffer: this.particle5Buffer, format: "float32x4", stride: 4 * 4 },
        aParticle6: { buffer: this.particle6Buffer, format: "float32x4", stride: 4 * 4 }
      },
      indexBuffer: new Buffer({
        data: indices,
        usage: BufferUsage.INDEX | BufferUsage.STATIC,
        shrinkToFit: false
      })
    });

    this.uniforms = new UniformGroup<ParticleUniformStructure>({
      uTime: { value: 0, type: "f32" }
    });

    const shader = new Shader({
      glProgram: GlProgram.from({
        vertex: PARTICLE_VERTEX,
        fragment: PARTICLE_FRAGMENT,
        name: "piano-puzzle-gpu-particle"
      }),
      resources: {
        particleUniforms: this.uniforms,
        uTexture: texture.source
      }
    });

    this.mesh = new Mesh({ geometry, shader, texture });
    this.mesh.blendMode = blendMode;
    this.mesh.zIndex = zIndex;
    this.mesh.renderable = false;
  }

  get activeCount(): number {
    return this.activeParticles;
  }

  get hasCapacity(): boolean {
    return this.freeIndices.length > 0 || this.expiryHeap.length > 0;
  }

  setTexture(texture: Texture): void {
    if (this.texture === texture) return;
    this.texture = texture;
    this.mesh.texture = texture;
    this.mesh.shader?.resources && (this.mesh.shader.resources.uTexture = texture.source);
  }

  spawn(nowSeconds: number, particle: GpuParticleSpawn): boolean {
    this.reapExpired(nowSeconds);
    const index = this.freeIndices.pop();
    if (index === undefined) return false;

    const vertexOffset = index * 16;
    const startColor = colorToRgb(particle.color);
    const endColor = colorToRgb(particle.endColor);
    const flip = particle.flipX ? -1 : 1;
    const mode = particle.mode === "smoke" ? 1 : 0;
    const depth = particle.depth ?? 1;

    for (let vertex = 0; vertex < 4; vertex += 1) {
      const offset = vertexOffset + vertex * 4;
      this.particle0[offset] = particle.x;
      this.particle0[offset + 1] = particle.y;
      this.particle0[offset + 2] = particle.vx;
      this.particle0[offset + 3] = particle.vy;

      this.particle1[offset] = nowSeconds;
      this.particle1[offset + 1] = Math.max(0.001, particle.lifetimeSeconds);
      this.particle1[offset + 2] = Math.max(0.001, particle.baseScale);
      this.particle1[offset + 3] = particle.rotation;

      this.particle2[offset] = particle.spin;
      this.particle2[offset + 1] = particle.phase;
      this.particle2[offset + 2] = Math.max(0.001, particle.drag);
      this.particle2[offset + 3] = particle.turbulence;

      this.particle3[offset] = particle.turbulenceFrequency;
      this.particle3[offset + 1] = particle.rise;
      this.particle3[offset + 2] = particle.fadeInEnd;
      this.particle3[offset + 3] = particle.fadeOutStart;

      this.particle4[offset] = startColor[0];
      this.particle4[offset + 1] = startColor[1];
      this.particle4[offset + 2] = startColor[2];
      this.particle4[offset + 3] = particle.baseAlpha;

      this.particle5[offset] = endColor[0];
      this.particle5[offset + 1] = endColor[1];
      this.particle5[offset + 2] = endColor[2];
      this.particle5[offset + 3] = flip;

      this.particle6[offset] = particle.colorShift;
      this.particle6[offset + 1] = 1;
      this.particle6[offset + 2] = mode;
      this.particle6[offset + 3] = depth;
    }

    this.activeFlags[index] = 1;
    this.expiryTimes[index] = nowSeconds + Math.max(0.001, particle.lifetimeSeconds);
    this.pushExpiry({ time: this.expiryTimes[index], index });
    this.activeParticles += 1;
    this.mesh.renderable = true;
    this.dirty = true;
    return true;
  }

  update(nowSeconds: number): void {
    this.uniforms.uniforms.uTime = nowSeconds;
    this.reapExpired(nowSeconds);
    if (this.activeParticles === 0) this.mesh.renderable = false;
  }

  flush(): void {
    if (!this.dirty) return;
    this.particle0Buffer.update();
    this.particle1Buffer.update();
    this.particle2Buffer.update();
    this.particle3Buffer.update();
    this.particle4Buffer.update();
    this.particle5Buffer.update();
    this.particle6Buffer.update();
    this.dirty = false;
  }

  clear(): void {
    this.freeIndices.length = 0;
    this.expiryHeap.length = 0;
    this.activeFlags.fill(0);
    this.expiryTimes.fill(0);
    for (let index = this.capacity - 1; index >= 0; index -= 1) {
      this.freeIndices.push(index);
    }
    this.activeParticles = 0;
    this.mesh.renderable = false;
    for (let index = 0; index < this.capacity; index += 1) {
      const vertexOffset = index * 16;
      for (let vertex = 0; vertex < 4; vertex += 1) {
        this.particle6[vertexOffset + vertex * 4 + 1] = 0;
      }
    }
    this.dirty = true;
  }

  destroy(): void {
    this.mesh.parent?.removeChild(this.mesh);
    this.mesh.destroy();
  }

  private reapExpired(nowSeconds: number): void {
    while (this.expiryHeap.length > 0 && this.expiryHeap[0].time <= nowSeconds) {
      const entry = this.popExpiry();
      if (!entry || this.activeFlags[entry.index] === 0) continue;
      if (this.expiryTimes[entry.index] !== entry.time) continue;
      this.release(entry.index);
    }
  }

  private release(index: number): void {
    if (this.activeFlags[index] === 0) return;
    this.activeFlags[index] = 0;
    this.freeIndices.push(index);
    this.activeParticles = Math.max(0, this.activeParticles - 1);
    const vertexOffset = index * 16;
    for (let vertex = 0; vertex < 4; vertex += 1) {
      this.particle6[vertexOffset + vertex * 4 + 1] = 0;
    }
    this.dirty = true;
  }

  private pushExpiry(entry: ExpiryEntry): void {
    this.expiryHeap.push(entry);
    let index = this.expiryHeap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.expiryHeap[parent].time <= entry.time) break;
      this.expiryHeap[index] = this.expiryHeap[parent];
      index = parent;
    }
    this.expiryHeap[index] = entry;
  }

  private popExpiry(): ExpiryEntry | undefined {
    const root = this.expiryHeap[0];
    const last = this.expiryHeap.pop();
    if (!root || !last || this.expiryHeap.length === 0) return root;

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.expiryHeap.length) break;
      const right = left + 1;
      const child = right < this.expiryHeap.length && this.expiryHeap[right].time < this.expiryHeap[left].time
        ? right
        : left;
      if (this.expiryHeap[child].time >= last.time) break;
      this.expiryHeap[index] = this.expiryHeap[child];
      index = child;
    }
    this.expiryHeap[index] = last;
    return root;
  }
}

function colorToRgb(color: number): [number, number, number] {
  return [
    ((color >> 16) & 0xff) / 255,
    ((color >> 8) & 0xff) / 255,
    (color & 0xff) / 255
  ];
}

export function blendModeForGpuTexture(textureId: FxTextureId): "add" | "screen" | "normal" {
  if (textureId === "soft-orb"
    || textureId === "glow-orb"
    || textureId === "sharp-dot"
    || textureId === "warm-orb"
    || textureId === "ice-orb"
    || textureId === "ember-small"
    || textureId === "spark-cross"
    || textureId === "dust-mote"
    || textureId === "micro-spark"
    || textureId === "spark-field"
    || textureId === "micro-streak"
    || textureId === "particle-cluster") return "add";
  if (textureId === "light-streak" || textureId === "soft-bokeh") return "screen";
  return "screen";
}
