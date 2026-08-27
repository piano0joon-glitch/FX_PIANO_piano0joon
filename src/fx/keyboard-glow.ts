import {
  Buffer,
  BufferUsage,
  Container,
  Geometry,
  GlProgram,
  Mesh,
  Shader,
  Sprite,
  Texture,
  UniformGroup
} from "pixi.js";
import { clamp } from "./fx-types";
import type { Point } from "../geometry/models";

export interface KeyGlowAnchor {
  midiNote: number;
  topPoint: Point;
  width: number;
  leftPoint?: Point;
  rightPoint?: Point;
}

interface ActiveKeyGlow {
  intensity: number;
  color: number;
  birthTime: number;
}

interface FogWisp {
  x: number;
  y: number;
  driftSpeed: number;
  life: number;
  maxLife: number;
  width: number;
  height: number;
  alpha: number;
  tint: number;
  turbulence: number;
  phase: number;
}

interface SparkleDot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  tint: number;
}

type GlowStyleUniformStructure = {
  uTime: { value: number; type: "f32" };
  uStyle: { value: number; type: "f32" };
  uIntensity: { value: number; type: "f32" };
  uThickness: { value: number; type: "f32" };
  uColor: { value: [number, number, number, number]; type: "vec4<f32>" };
};

const GLOW_STYLE_VERTEX = `
in vec2 aPosition;
in vec2 aUV;

out vec2 vUV;

void main(void)
{
    gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
}
`;

const GLOW_STYLE_FRAGMENT = `
in vec2 vUV;

uniform float uTime;
uniform float uStyle;
uniform float uIntensity;
uniform float uThickness;
uniform vec4 uColor;

float hash21(vec2 p)
{
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

void main(void)
{
    float x = clamp(vUV.x, 0.0, 1.0);
    float v = clamp(vUV.y, 0.0, 1.0);
    float edgeFade = smoothstep(0.0, 0.055, x) * (1.0 - smoothstep(0.945, 1.0, x));
    float lineDistance = abs(v - 0.5);
    float lineWidth = max(0.012, uThickness);
    float alpha = 0.0;
    vec3 color = uColor.rgb;

    if (uStyle < 1.5) {
        // Wave: two smooth GPU-generated strands and a soft underwater halo.
        float waveA = sin(x * 14.0 + uTime * 3.2) * 0.055
            + sin(x * 31.0 - uTime * 4.6) * 0.018;
        float waveB = sin(x * 9.0 - uTime * 1.9 + 1.7) * 0.085
            + sin(x * 23.0 + uTime * 2.4) * 0.022;
        float strandA = 1.0 - smoothstep(lineWidth * 0.5, lineWidth * 1.8, abs(v - (0.5 + waveA)));
        float strandB = 1.0 - smoothstep(lineWidth * 0.9, lineWidth * 3.2, abs(v - (0.5 + waveB)));
        float halo = 1.0 - smoothstep(0.08, 0.28, lineDistance);
        alpha = (strandA * 0.72 + strandB * 0.26 + halo * 0.12) * 0.72;
        color = mix(uColor.rgb, vec3(0.80, 0.92, 1.0), 0.48);
    } else if (uStyle < 2.5) {
        // Fire: deterministic flickering flame field rising above the line.
        float rise = max(0.0, 0.5 - v);
        float flicker = 0.5 + 0.5 * sin(x * 57.0 + uTime * 8.5)
            + 0.22 * sin(x * 131.0 - uTime * 12.0);
        float flameHeight = 0.15 + 0.28 * clamp(flicker, 0.0, 1.0);
        float flame = 1.0 - smoothstep(flameHeight * 0.66, flameHeight, rise);
        float base = 1.0 - smoothstep(lineWidth * 0.7, lineWidth * 3.0, lineDistance);
        float emberBand = 1.0 - smoothstep(0.012, 0.04, abs(fract(x * 23.0 + uTime * 0.8) - 0.5));
        alpha = (flame * 0.82 + base * 0.35 + emberBand * rise * 0.25) * 0.78;
        color = mix(vec3(1.0, 0.18, 0.015), vec3(1.0, 0.86, 0.22), clamp(rise / max(0.001, flameHeight), 0.0, 1.0));
    } else {
        // Particles: moving deterministic dots, fully evaluated in the fragment shader.
        vec2 cell = floor(vec2(x * 34.0, v * 18.0));
        float seed = hash21(cell);
        vec2 local = fract(vec2(x * 34.0, v * 18.0)) - 0.5;
        local.y += sin(uTime * (0.7 + seed * 1.8) + seed * 6.283) * 0.22;
        float dot = 1.0 - smoothstep(0.06 + seed * 0.035, 0.005, length(local));
        float pulse = 0.35 + 0.65 * sin(uTime * (2.0 + seed * 3.0) + seed * 9.0) * 0.5 + 0.35;
        float base = 1.0 - smoothstep(0.02, 0.14, lineDistance);
        alpha = (dot * pulse * 0.8 + base * 0.16) * 0.72;
        color = mix(vec3(0.42, 0.76, 1.0), vec3(0.92, 0.98, 1.0), seed);
    }

    float visible = clamp(alpha * edgeFade * uIntensity, 0.0, 1.0);
    finalColor = vec4(color * visible, visible) * uWorldColorAlpha;
}
`;

/**
 * GPU procedural renderer for the non-default keyboard glow styles.
 *
 * It keeps one quad alive and changes only uniforms during playback. Wave,
 * fire and particle styling therefore never rebuilds Pixi Graphics geometry
 * on the CPU.
 */
class GpuGlowStyleRenderer {
  readonly mesh: Mesh<Geometry, Shader>;

  private readonly positionData = new Float32Array(8);
  private readonly positionBuffer: Buffer;
  private readonly uniforms: UniformGroup<GlowStyleUniformStructure>;
  private lastFirstX = Number.NaN;
  private lastFirstY = Number.NaN;
  private lastLastX = Number.NaN;
  private lastLastY = Number.NaN;
  private lastHalfHeight = Number.NaN;

  constructor() {
    const uvData = new Float32Array([
      0, 0,
      1, 0,
      1, 1,
      0, 1
    ]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
    this.positionBuffer = new Buffer({
      data: this.positionData,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
      shrinkToFit: false
    });
    const geometry = new Geometry({
      attributes: {
        aPosition: { buffer: this.positionBuffer, format: "float32x2", stride: 2 * 4 },
        aUV: {
          buffer: new Buffer({
            data: uvData,
            usage: BufferUsage.VERTEX | BufferUsage.STATIC,
            shrinkToFit: false
          }),
          format: "float32x2",
          stride: 2 * 4
        }
      },
      indexBuffer: new Buffer({
        data: indices,
        usage: BufferUsage.INDEX | BufferUsage.STATIC,
        shrinkToFit: false
      })
    });

    this.uniforms = new UniformGroup<GlowStyleUniformStructure>({
      uTime: { value: 0, type: "f32" },
      uStyle: { value: 0, type: "f32" },
      uIntensity: { value: 0, type: "f32" },
      uThickness: { value: 0.05, type: "f32" },
      uColor: { value: [0.35, 0.78, 1.0, 1.0], type: "vec4<f32>" }
    });
    const shader = new Shader({
      glProgram: GlProgram.from({
        vertex: GLOW_STYLE_VERTEX,
        fragment: GLOW_STYLE_FRAGMENT,
        name: "piano-puzzle-gpu-keyboard-glow"
      }),
      resources: { glowStyleUniforms: this.uniforms }
    });

    this.mesh = new Mesh({ geometry, shader });
    this.mesh.blendMode = "add";
    this.mesh.renderable = false;
  }

  update(
    first: Point,
    last: Point,
    thickness: number,
    spread: number,
    time: number,
    intensity: number,
    style: "default" | "wave" | "fire" | "particles",
    enabled: boolean
  ): void {
    const styleValue = style === "wave" ? 1 : style === "fire" ? 2 : style === "particles" ? 3 : 0;
    const halfHeight = Math.max(12, spread * 1.9 + thickness * 4);
    if (
      first.x !== this.lastFirstX
      || first.y !== this.lastFirstY
      || last.x !== this.lastLastX
      || last.y !== this.lastLastY
      || halfHeight !== this.lastHalfHeight
    ) {
      const dx = last.x - first.x;
      const dy = last.y - first.y;
      const length = Math.sqrt(dx * dx + dy * dy) || 1;
      // Screen-space "up" normal: for a horizontal line this is (0, -1).
      const normalX = dy / length;
      const normalY = -dx / length;
      this.positionData[0] = first.x + normalX * halfHeight;
      this.positionData[1] = first.y + normalY * halfHeight;
      this.positionData[2] = last.x + normalX * halfHeight;
      this.positionData[3] = last.y + normalY * halfHeight;
      this.positionData[4] = last.x - normalX * halfHeight;
      this.positionData[5] = last.y - normalY * halfHeight;
      this.positionData[6] = first.x - normalX * halfHeight;
      this.positionData[7] = first.y - normalY * halfHeight;
      this.positionBuffer.update();
      this.lastFirstX = first.x;
      this.lastFirstY = first.y;
      this.lastLastX = last.x;
      this.lastLastY = last.y;
      this.lastHalfHeight = halfHeight;
    }

    this.uniforms.uniforms.uTime = time;
    this.uniforms.uniforms.uStyle = styleValue;
    this.uniforms.uniforms.uIntensity = styleValue === 0 || !enabled ? 0 : Math.max(0, Math.min(1, intensity));
    this.uniforms.uniforms.uThickness = Math.max(0.012, Math.min(0.32, thickness / Math.max(1, halfHeight * 2)));
    this.mesh.renderable = enabled && styleValue > 0 && intensity > 0.001;
  }

  clear(): void {
    this.mesh.renderable = false;
    this.uniforms.uniforms.uIntensity = 0;
  }

  destroy(): void {
    const geometry = this.mesh.geometry;
    const shader = this.mesh.shader;
    this.mesh.destroy();
    geometry.destroy(true);
    shader?.destroy();
  }
}

const GAUSS_STOPS: Array<[number, number]> = [
  [0.0, 0.0],
  [0.18, 0.015],
  [0.3, 0.07],
  [0.4, 0.24],
  [0.46, 0.55],
  [0.5, 1.0],
  [0.54, 0.55],
  [0.6, 0.24],
  [0.7, 0.07],
  [0.82, 0.015],
  [1.0, 0.0]
];

function makeBeamTexture(): Texture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  for (const [stop, alpha] of GAUSS_STOPS) {
    grad.addColorStop(stop, `rgba(255,255,255,${alpha})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const fade = ctx.createLinearGradient(0, 0, w, 0);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(0.08, "rgba(0,0,0,1)");
  fade.addColorStop(0.92, "rgba(0,0,0,1)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);

  return Texture.from(canvas);
}

function makeUpBeamTexture(): Texture {
  const w = 128;
  const h = 512;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const grad = ctx.createLinearGradient(0, 0, w, 0);
  for (const [stop, alpha] of GAUSS_STOPS) {
    grad.addColorStop(stop, `rgba(255,255,255,${alpha})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const fade = ctx.createLinearGradient(0, 0, 0, h);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(0.45, "rgba(0,0,0,0.55)");
  fade.addColorStop(0.8, "rgba(0,0,0,1)");
  fade.addColorStop(1, "rgba(0,0,0,1)");
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);

  return Texture.from(canvas);
}

function makeBlobTexture(): Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [stop, alpha] of GAUSS_STOPS) {
    grad.addColorStop(stop, `rgba(255,255,255,${alpha})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(canvas);
}

export class KeyboardGlowController {
  readonly layer = new Container();

  private readonly ambientLayer = new Container();
  private readonly fogLayer = new Container();
  private readonly beamLayer = new Container();
  private readonly fxLayer = new Container();

  private readonly beamTex: Texture;
  private readonly upBeamTex: Texture;
  private readonly blobTex: Texture;

  private readonly hazeSprite: Sprite;
  private readonly glowSprite: Sprite;
  private readonly bandSprite: Sprite;
  private readonly coreSprite: Sprite;

  private readonly shimmerA: Sprite;
  private readonly shimmerB: Sprite;
  private readonly gpuStyle: GpuGlowStyleRenderer;

  private keyAnchors: KeyGlowAnchor[] = [];
  private readonly keyAnchorByMidi = new Map<number, KeyGlowAnchor>();
  private activeGlows = new Map<number, ActiveKeyGlow>();

  private thickness = 4;
  private spread = 60;
  private softness = 0.7;
  private dissolveSpeed = 1.5;
  private pulseAmount = 0.4;
  private glowStyle: "default" | "wave" | "fire" | "particles" = "default";
  private isEnabled = true;

  private paused = false;
  private time = 0;
  private fogWisps: FogWisp[] = [];
  private sparkles: SparkleDot[] = [];
  private static readonly MAX_FOG = 70;
  private static readonly MAX_SPARKLES = 40;

  private readonly wispPool: Sprite[] = [];
  private readonly beamPool: Sprite[] = [];
  private readonly flarePool: Sprite[] = [];
  private readonly sparklePool: Sprite[] = [];

  private fogSpawnTimer = 0;
  private fogSpawnInterval = 0.12;

  constructor() {
    this.beamTex = makeBeamTexture();
    this.upBeamTex = makeUpBeamTexture();
    this.blobTex = makeBlobTexture();

    this.layer.addChild(this.ambientLayer);
    this.layer.addChild(this.fogLayer);
    this.layer.addChild(this.beamLayer);
    this.layer.addChild(this.fxLayer);

    const mk = (tex: Texture, tint: number, parent: Container): Sprite => {
      const s = new Sprite(tex);
      s.anchor.set(0.5, 0.5);
      s.tint = tint;
      s.blendMode = "add";
      s.roundPixels = true;
      parent.addChild(s);
      return s;
    };

    this.hazeSprite = mk(this.beamTex, 0x4d8fd6, this.ambientLayer);
    this.glowSprite = mk(this.beamTex, 0x9cc4ef, this.ambientLayer);
    this.bandSprite = mk(this.beamTex, 0xe8f4ff, this.ambientLayer);
    this.coreSprite = mk(this.beamTex, 0xffffff, this.ambientLayer);

    this.shimmerA = mk(this.blobTex, 0xffffff, this.ambientLayer);
    this.shimmerB = mk(this.blobTex, 0xcfe6ff, this.ambientLayer);
    this.gpuStyle = new GpuGlowStyleRenderer();
    this.fxLayer.addChild(this.gpuStyle.mesh);

    // Hide all ambient sprites until setKeyAnchors positions them correctly
    this.hazeSprite.visible = false;
    this.glowSprite.visible = false;
    this.bandSprite.visible = false;
    this.coreSprite.visible = false;
    this.shimmerA.visible = false;
    this.shimmerB.visible = false;
  }

  setKeyAnchors(anchors: KeyGlowAnchor[]): void {
    // Always clear old particles — like note spawn points, the glow must be
    // 100% locked to the current piano position with zero ghost traces.
    this.fogWisps = [];
    this.sparkles = [];
    this.activeGlows.clear();
    this.hideAllVisuals();

    this.keyAnchors = anchors.slice().sort((a, b) => a.topPoint.x - b.topPoint.x);
    this.keyAnchorByMidi.clear();
    for (const anchor of this.keyAnchors) this.keyAnchorByMidi.set(anchor.midiNote, anchor);
    this.renderBar(1.0, this.isEnabled);
  }

  private hideAllVisuals(): void {
    this.hazeSprite.visible = false;
    this.glowSprite.visible = false;
    this.bandSprite.visible = false;
    this.coreSprite.visible = false;
    this.shimmerA.visible = false;
    this.shimmerB.visible = false;
    for (const s of this.wispPool) s.visible = false;
    for (const s of this.beamPool) s.visible = false;
    for (const s of this.flarePool) s.visible = false;
    for (const s of this.sparklePool) s.visible = false;
    this.gpuStyle.clear();
  }

  applySettings(
    thickness: number,
    spread: number,
    softness: number,
    dissolveSpeed: number,
    pulseAmount: number,
    beamIntensity = 1.0,
    enabled = true,
    style?: "default" | "wave" | "fire" | "particles"
  ): void {
    this.thickness = clamp(thickness, 0.5, 20);
    this.spread = clamp(spread, 5, 250);
    this.softness = clamp(softness, 0, 1);
    this.dissolveSpeed = clamp(dissolveSpeed, 0.1, 8);
    this.pulseAmount = clamp(pulseAmount, 0, 1);
    this.isEnabled = enabled;
    if (style) this.glowStyle = style;
    void beamIntensity;
    this.renderBar(1.0, this.isEnabled);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  hitKeyByNote(midiNote: number, color: number, velocity: number): void {
    const intensity = clamp(0.4 + velocity * 0.6);
    const existing = this.activeGlows.get(midiNote);
    if (!existing || intensity > existing.intensity) {
      this.activeGlows.set(midiNote, { intensity, color, birthTime: this.time });
    }
    const anchor = this.keyAnchorByMidi.get(midiNote);
    if (anchor) {
      const burst = Math.floor(2 + intensity * 4);
      for (let i = 0; i < burst; i++) {
        this.spawnFogWisp(anchor.topPoint, anchor.width, color, intensity, true);
      }
      const sparkleCount = Math.floor(intensity * 3);
      for (let i = 0; i < sparkleCount; i++) {
        this.spawnSparkle(anchor.topPoint, anchor.width, color);
      }
    }
  }

  private spawnFogWisp(p: Point, width: number, color: number, intensity: number, burst: boolean): void {
    if (this.fogWisps.length >= KeyboardGlowController.MAX_FOG) return;

    const driftDir = Math.random() > 0.5 ? 1 : -1;
    const speed = burst ? 25 + Math.random() * 45 : 6 + Math.random() * 14;

    this.fogWisps.push({
      x: p.x + (Math.random() - 0.5) * width * 2,
      y: p.y - (burst ? Math.random() * 12 : 2 + Math.random() * this.spread * 0.12),
      driftSpeed: speed * driftDir,
      life: 0,
      maxLife: 2.2 + Math.random() * 3,
      width: 60 + Math.random() * 110 + (burst ? intensity * 70 : 0),
      height: (burst ? 14 : 9) + Math.random() * 16,
      alpha: (burst ? 0.1 : 0.05) + intensity * 0.08 + Math.random() * 0.05,
      tint: burst ? color : 0xbfd8f2,
      turbulence: 2 + Math.random() * 5,
      phase: Math.random() * Math.PI * 2
    });
  }

  private spawnSparkle(p: Point, width: number, color: number): void {
    if (this.sparkles.length >= KeyboardGlowController.MAX_SPARKLES) return;
    const angle = Math.random() * Math.PI * 2;
    const speed = 12 + Math.random() * 26;
    this.sparkles.push({
      x: p.x + (Math.random() - 0.5) * width,
      y: p.y - Math.random() * this.spread * 0.2,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 12,
      life: 0,
      maxLife: 0.25 + Math.random() * 0.4,
      size: 1 + Math.random() * 2.5,
      tint: color
    });
  }

  private acquireSprite(pool: Sprite[], tex: Texture, parent: Container): Sprite {
    let s = pool.pop();
    if (!s) {
      s = new Sprite(tex);
      s.anchor.set(0.5, 0.5);
      s.blendMode = "add";
      s.roundPixels = true;
      parent.addChild(s);
    }
    s.texture = tex;
    s.visible = true;
    return s;
  }

  private renderBar(globalIntensity: number, enabled: boolean): void {
    if (!enabled || !this.isEnabled || this.keyAnchors.length < 2) {
      this.hideAllVisuals();
      return;
    }

    const t = this.time;
    const firstAnchor = this.keyAnchors[0];
    const lastAnchor = this.keyAnchors[this.keyAnchors.length - 1];
    const firstP = firstAnchor.leftPoint ?? firstAnchor.topPoint;
    const lastP = lastAnchor.rightPoint ?? lastAnchor.topPoint;
    const dx = lastP.x - firstP.x;
    const dy = lastP.y - firstP.y;
    const lineLen = Math.max(10, Math.hypot(dx, dy));
    const cx = (firstP.x + lastP.x) / 2;
    const cy = (firstP.y + lastP.y) / 2;
    const lineAngle = Math.atan2(dy, dx);

    const breathe = 1 - this.pulseAmount * 0.22 * (0.5 + 0.5 * Math.sin(t * 1.6));

    this.hazeSprite.visible = true;
    this.hazeSprite.position.set(cx, cy);
    this.hazeSprite.rotation = lineAngle;
    this.hazeSprite.width = lineLen * 1.15;
    this.hazeSprite.height = Math.max(4, this.spread * 3.2 * breathe);
    this.hazeSprite.alpha = (0.12 + 0.22 * this.softness) * globalIntensity;

    this.glowSprite.visible = true;
    this.glowSprite.position.set(cx, cy);
    this.glowSprite.rotation = lineAngle;
    this.glowSprite.width = lineLen * 1.08;
    this.glowSprite.height = Math.max(3, this.spread * 1.2 * breathe);
    this.glowSprite.alpha = (0.28 + 0.35 * this.softness) * globalIntensity;

    this.bandSprite.visible = true;
    this.bandSprite.position.set(cx, cy);
    this.bandSprite.rotation = lineAngle;
    this.bandSprite.width = lineLen * 1.04;
    this.bandSprite.height = Math.max(2, this.thickness * 4.5 + 4);
    this.bandSprite.alpha = 0.65 * globalIntensity * breathe;

    this.coreSprite.visible = true;
    this.coreSprite.position.set(cx, cy);
    this.coreSprite.rotation = lineAngle;
    this.coreSprite.width = lineLen * 1.01;
    this.coreSprite.height = Math.max(1.2, this.thickness * 1.5 + 1.0);
    this.coreSprite.alpha = 0.98 * globalIntensity;

    // Hide default shimmers — the GPU style mesh handles non-default effects.
    this.shimmerA.visible = false;
    this.shimmerB.visible = false;
    if (this.glowStyle === "default") {
      // ── DEFAULT: original shimmer blobs ──
      const shimmerPos = (t * 0.13) % 1.6 - 0.3;
      this.shimmerA.visible = true;
      this.shimmerA.position.set(firstP.x + dx * shimmerPos, firstP.y + dy * shimmerPos);
      this.shimmerA.rotation = lineAngle;
      this.shimmerA.width = lineLen * 0.35;
      this.shimmerA.height = this.spread * 0.9;
      this.shimmerA.alpha = 0.12 * globalIntensity;

      const shimmer2Pos = 1.6 - ((t * 0.09 + 0.5) % 1.6);
      this.shimmerB.visible = true;
      this.shimmerB.position.set(firstP.x + dx * shimmer2Pos, firstP.y + dy * shimmer2Pos);
      this.shimmerB.rotation = lineAngle;
      this.shimmerB.width = lineLen * 0.3;
      this.shimmerB.height = this.spread * 0.7;
      this.shimmerB.alpha = 0.08 * globalIntensity;
    }

    this.gpuStyle.update(
      firstP,
      lastP,
      this.thickness,
      this.spread,
      t,
      globalIntensity,
      this.glowStyle,
      enabled && this.isEnabled
    );
  }

  update(deltaSeconds: number, enabled: boolean, globalIntensity: number): void {
    this.isEnabled = enabled;
    if (!enabled) {
      this.activeGlows.clear();
      this.fogWisps.length = 0;
      this.sparkles.length = 0;
      this.hideAllVisuals();
      return;
    }
    if (!this.paused) {
      this.time += deltaSeconds;

      for (const [note, state] of this.activeGlows.entries()) {
        state.intensity -= this.dissolveSpeed * deltaSeconds;
        if (state.intensity <= 0.005) this.activeGlows.delete(note);
      }

      this.fogSpawnTimer += deltaSeconds;
      if (this.keyAnchors.length >= 2 && this.fogSpawnTimer >= this.fogSpawnInterval) {
        this.fogSpawnTimer = 0;
        const firstP = this.keyAnchors[0].topPoint;
        const lastP = this.keyAnchors[this.keyAnchors.length - 1].topPoint;
        const rx = firstP.x + Math.random() * (lastP.x - firstP.x);
        this.fogWisps.push({
          x: rx,
          y: firstP.y - 2 - Math.random() * this.spread * 0.15,
          driftSpeed: (5 + Math.random() * 11) * (Math.random() > 0.5 ? 1 : -1),
          life: 0,
          maxLife: 2.5 + Math.random() * 3.5,
          width: 80 + Math.random() * 140,
          height: 10 + Math.random() * 18,
          alpha: 0.04 + Math.random() * 0.05,
          tint: 0xbfd8f2,
          turbulence: 1.5 + Math.random() * 4,
          phase: Math.random() * Math.PI * 2
        });
      }

      for (let i = this.fogWisps.length - 1; i >= 0; i--) {
        const w = this.fogWisps[i];
        w.life += deltaSeconds;
        if (w.life >= w.maxLife) { this.fogWisps.splice(i, 1); continue; }
        w.x += w.driftSpeed * deltaSeconds;
        w.y += Math.sin(this.time * 0.9 + w.phase) * w.turbulence * deltaSeconds;
        w.width *= 1 + 0.12 * deltaSeconds;
        w.height *= 1 + 0.08 * deltaSeconds;
      }

      for (let i = this.sparkles.length - 1; i >= 0; i--) {
        const sp = this.sparkles[i];
        sp.life += deltaSeconds;
        if (sp.life >= sp.maxLife) { this.sparkles.splice(i, 1); continue; }
        sp.x += sp.vx * deltaSeconds;
        sp.y += sp.vy * deltaSeconds;
        sp.vy += 22 * deltaSeconds;
      }
    }

    for (const s of this.wispPool) s.visible = false;
    for (const s of this.beamPool) s.visible = false;
    for (const s of this.flarePool) s.visible = false;
    for (const s of this.sparklePool) s.visible = false;

    this.renderBar(globalIntensity, enabled);

    if (!enabled || !this.isEnabled || this.keyAnchors.length < 2) return;

    for (const w of this.fogWisps) {
      const lifeRatio = w.life / w.maxLife;
      const fadeIn = Math.min(1, lifeRatio * 5);
      const fadeOut = Math.max(0, 1 - Math.pow(lifeRatio, 1.6));
      const a = w.alpha * fadeIn * fadeOut * globalIntensity;
      if (a <= 0.003) continue;

      const s = this.acquireSprite(this.wispPool, this.blobTex, this.fogLayer);
      s.position.set(w.x, w.y);
      s.width = w.width;
      s.height = w.height;
      s.tint = w.tint;
      s.alpha = a;
    }

    for (const anchor of this.keyAnchors) {
      const state = this.activeGlows.get(anchor.midiNote);
      if (!state || state.intensity <= 0.01) continue;

      const p = anchor.topPoint;
      const kw = anchor.width;
      const alpha = clamp(state.intensity * globalIntensity, 0, 1);
      const age = this.time - state.birthTime;
      const attack = Math.min(1, age * 8);
      const beamH = this.spread * (1.2 + state.intensity * 0.8);
      const sway = Math.sin(age * 2.2 + anchor.midiNote) * kw * 0.15;

      const beam = this.acquireSprite(this.beamPool, this.upBeamTex, this.beamLayer);
      beam.anchor.set(0.5, 1);
      beam.position.set(p.x + sway, p.y);
      beam.width = kw * 2.6;
      beam.height = beamH;
      beam.tint = state.color;
      beam.alpha = alpha * 0.5 * attack;

      const flare = this.acquireSprite(this.flarePool, this.blobTex, this.beamLayer);
      flare.anchor.set(0.5, 0.5);
      flare.position.set(p.x, p.y);
      flare.width = kw * 3.2;
      flare.height = kw * 3.2;
      flare.tint = state.color;
      flare.alpha = alpha * 0.35 * attack;

      const hot = this.acquireSprite(this.flarePool, this.blobTex, this.beamLayer);
      hot.anchor.set(0.5, 0.5);
      hot.position.set(p.x, p.y);
      hot.width = kw * 1.2;
      hot.height = kw * 1.2;
      hot.tint = 0xffffff;
      hot.alpha = alpha * 0.8 * attack;
    }

    for (const sp of this.sparkles) {
      const lifeR = sp.life / sp.maxLife;
      const a = (1 - lifeR) * globalIntensity * 0.6;
      if (a <= 0.01) continue;
      const s = this.acquireSprite(this.sparklePool, this.blobTex, this.fxLayer);
      s.anchor.set(0.5, 0.5);
      s.position.set(sp.x, sp.y);
      s.width = sp.size * 4;
      s.height = sp.size * 4;
      s.tint = sp.tint;
      s.alpha = a;
    }
  }

  clear(): void {
    this.activeGlows.clear();
    this.fogWisps = [];
    this.sparkles = [];
    this.hideAllVisuals();
  }

  dispose(): void {
    this.clear();
    this.gpuStyle.destroy();
    this.beamTex.destroy(true);
    this.upBeamTex.destroy(true);
    this.blobTex.destroy(true);
    this.layer.destroy({ children: true });
  }
}
