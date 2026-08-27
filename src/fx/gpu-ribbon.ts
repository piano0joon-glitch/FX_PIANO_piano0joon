/**
 * GPU ribbon renderer for light trails.
 *
 * The old implementation rebuilt a Pixi Graphics path and tessellated every
 * polygon on the CPU each frame. This version keeps one indexed triangle mesh
 * alive and only uploads the left/right ribbon vertices and their alpha values.
 */

import {
  Buffer,
  BufferUsage,
  Container,
  Geometry,
  GlProgram,
  Mesh,
  Shader,
  UniformGroup,
  type PointData
} from "pixi.js";

/** Glow layer definition: [widthMultiplier, alphaMultiplier] */
const GLOW_LAYERS: [number, number][] = [
  [3.0, 0.06],
  [2.0, 0.15],
  [1.0, 0.45],
  [0.3, 0.75]
];

type RibbonUniformStructure = {
  uColor: { value: [number, number, number, number]; type: "vec4<f32>" };
};

const RIBBON_VERTEX = `
in vec2 aPosition;
in float aAlpha;

uniform vec4 uColor;

out vec4 vColor;

void main(void)
{
    gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vColor = vec4(uColor.rgb * aAlpha, uColor.a * aAlpha) * uWorldColorAlpha;
}
`;

const RIBBON_FRAGMENT = `
in vec4 vColor;
out vec4 finalColor;

void main(void)
{
    finalColor = vColor;
}
`;

export class GpuRibbon {
  readonly container = new Container();

  private readonly mesh: Mesh<Geometry, Shader>;
  private readonly posData: Float32Array;
  private readonly alphaData: Float32Array;
  private readonly posBuffer: Buffer;
  private readonly alphaBuffer: Buffer;
  private readonly uniforms: UniformGroup<RibbonUniformStructure>;
  private readonly perpX: Float32Array;
  private readonly perpY: Float32Array;
  private readonly maxPoints: number;
  private readonly totalVertexCount: number;
  private active = false;

  constructor(maxPoints: number) {
    this.maxPoints = Math.max(2, Math.floor(maxPoints));
    this.totalVertexCount = GLOW_LAYERS.length * this.maxPoints * 2;
    this.posData = new Float32Array(this.totalVertexCount * 2);
    this.alphaData = new Float32Array(this.totalVertexCount);
    this.perpX = new Float32Array(this.maxPoints);
    this.perpY = new Float32Array(this.maxPoints);

    const indices = new Uint16Array(GLOW_LAYERS.length * (this.maxPoints - 1) * 6);
    let indexOffset = 0;
    for (let layer = 0; layer < GLOW_LAYERS.length; layer += 1) {
      const layerVertexOffset = layer * this.maxPoints * 2;
      for (let point = 0; point < this.maxPoints - 1; point += 1) {
        const base = layerVertexOffset + point * 2;
        const next = base + 2;
        indices[indexOffset++] = base;
        indices[indexOffset++] = base + 1;
        indices[indexOffset++] = next + 1;
        indices[indexOffset++] = base;
        indices[indexOffset++] = next + 1;
        indices[indexOffset++] = next;
      }
    }

    this.posBuffer = new Buffer({
      data: this.posData,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
      shrinkToFit: false
    });
    this.alphaBuffer = new Buffer({
      data: this.alphaData,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
      shrinkToFit: false
    });
    const geometry = new Geometry({
      attributes: {
        aPosition: { buffer: this.posBuffer, format: "float32x2", stride: 2 * 4 },
        aAlpha: { buffer: this.alphaBuffer, format: "float32", stride: 4 }
      },
      indexBuffer: new Buffer({
        data: indices,
        usage: BufferUsage.INDEX | BufferUsage.STATIC,
        shrinkToFit: false
      })
    });

    this.uniforms = new UniformGroup<RibbonUniformStructure>({
      uColor: { value: [1, 1, 1, 1], type: "vec4<f32>" }
    });
    const shader = new Shader({
      glProgram: GlProgram.from({
        vertex: RIBBON_VERTEX,
        fragment: RIBBON_FRAGMENT,
        name: "piano-puzzle-gpu-ribbon"
      }),
      resources: { ribbonUniforms: this.uniforms }
    });

    this.mesh = new Mesh({ geometry, shader });
    this.mesh.renderable = false;
    this.container.addChild(this.mesh);
  }

  update(
    points: PointData[],
    widths: number[],
    alphas: number[],
    color: number,
    tintAlpha = 1
  ): void {
    const n = Math.min(points.length, this.maxPoints);
    if (n < 2) {
      this.clear();
      return;
    }

    this.active = true;
    this.mesh.renderable = true;
    this.alphaData.fill(0);

    for (let i = 0; i < n; i += 1) {
      const point = points[i];
      let px = 0;
      let py = 0;
      if (i < n - 1) {
        const dx = points[i + 1].x - point.x;
        const dy = points[i + 1].y - point.y;
        const length = Math.sqrt(dx * dx + dy * dy) || 1;
        px = -dy / length;
        py = dx / length;
      } else {
        const previous = points[i - 1];
        const dx = point.x - previous.x;
        const dy = point.y - previous.y;
        const length = Math.sqrt(dx * dx + dy * dy) || 1;
        px = -dy / length;
        py = dx / length;
      }
      this.perpX[i] = px;
      this.perpY[i] = py;
    }

    const safeTintAlpha = Math.max(0, Math.min(1, tintAlpha));
    const colorRgb: [number, number, number, number] = [
      ((color >> 16) & 0xff) / 255,
      ((color >> 8) & 0xff) / 255,
      (color & 0xff) / 255,
      safeTintAlpha
    ];
    this.uniforms.uniforms.uColor = colorRgb;

    for (let layer = 0; layer < GLOW_LAYERS.length; layer += 1) {
      const [widthMultiplier, alphaMultiplier] = GLOW_LAYERS[layer];
      const vertexOffset = layer * this.maxPoints * 2;
      for (let i = 0; i < n; i += 1) {
        const point = points[i];
        const halfWidth = (widths[i] ?? 4) * widthMultiplier;
        const leftVertex = vertexOffset + i * 2;
        const rightVertex = leftVertex + 1;
        const leftPosition = leftVertex * 2;
        const rightPosition = rightVertex * 2;
        this.posData[leftPosition] = point.x + this.perpX[i] * halfWidth;
        this.posData[leftPosition + 1] = point.y + this.perpY[i] * halfWidth;
        this.posData[rightPosition] = point.x - this.perpX[i] * halfWidth;
        this.posData[rightPosition + 1] = point.y - this.perpY[i] * halfWidth;

        const alpha = Math.max(0, Math.min(1, alphas[i] ?? 0)) * alphaMultiplier;
        this.alphaData[leftVertex] = alpha;
        this.alphaData[rightVertex] = alpha;
      }
    }

    this.posBuffer.update();
    this.alphaBuffer.update();
  }

  clear(): void {
    this.active = false;
    this.mesh.renderable = false;
  }

  destroy(): void {
    const geometry = this.mesh.geometry;
    const shader = this.mesh.shader;
    this.container.removeChild(this.mesh);
    this.mesh.destroy();
    geometry.destroy(true);
    shader?.destroy();
    this.container.destroy({ children: false });
  }
}
