/**
 * Instanced screen quads of the atmosphere and post passes (the distortion sources): a unit quad
 * (location 0, `aCorner` 0…1) plus per-instance float attributes from one preallocated `Float32Array` that
 * grows by doubling – no allocation per frame. GPU objects come from the pass setup (restored after a
 * context loss).
 */
import { GpuBuffer } from '../gl/buffer';
import type { GpuResource } from '../gl/resources';
import { VertexArray } from '../gl/vertexArray';
import type { PassSetup, RenderContext } from '../passes/registry';

const QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
const QUAD_VERTICES = 4;
const CORNER_COMPONENTS = 2;
const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;
/** Instances the buffers start with. */
const INITIAL_INSTANCES = 32;

/** One per-instance attribute: shader location, components, offset in floats within the instance. */
export interface QuadAttribute {
  readonly location: number;
  readonly components: 1 | 2 | 3 | 4;
  readonly offset: number;
}

export class InstancedQuads {
  /** Instance data of the frame (`floats` per instance); valid up to the count passed to `draw`. */
  data: Float32Array;
  private quad: GpuBuffer | null = null;
  private instances: GpuBuffer | null = null;
  private vao: VertexArray | null = null;

  constructor(
    private readonly label: string,
    readonly floats: number,
    private readonly attributes: readonly QuadAttribute[],
  ) {
    this.data = new Float32Array(INITIAL_INSTANCES * floats);
  }

  init(setup: PassSetup): void {
    const gl = setup.gl;
    this.quad = setup.resources.add(new GpuBuffer(gl, { label: `${this.label}-quad`, target: 'vertex', usage: 'static', data: QUAD }));
    const instances = setup.resources.add(new GpuBuffer(gl, { label: `${this.label}-instances`, target: 'vertex', usage: 'stream', byteLength: INITIAL_INSTANCES * this.floats * FLOAT_BYTES }));
    this.instances = instances;
    const stride = this.floats * FLOAT_BYTES;
    this.vao = setup.resources.add(
      new VertexArray(gl, {
        label: this.label,
        attributes: [
          { location: 0, buffer: this.quad, components: CORNER_COMPONENTS, type: 'f32', stride: 0, offset: 0 },
          ...this.attributes.map((a) => ({ location: a.location, buffer: instances, components: a.components, type: 'f32' as const, stride, offset: a.offset * FLOAT_BYTES, divisor: 1 })),
        ],
      }),
    );
  }

  /** Makes room for `n` instances in `data` (keeps the first `keep` instances). */
  reserve(n: number, keep: number): void {
    if (n * this.floats <= this.data.length) return;
    let cap = this.data.length / this.floats;
    while (cap < n) cap *= 2;
    const next = new Float32Array(cap * this.floats);
    next.set(this.data.subarray(0, keep * this.floats));
    this.data = next;
  }

  /** Uploads the first `n` instances and draws them (the program and its uniforms are set by the caller). */
  draw(ctx: RenderContext, n: number): void {
    const instances = this.instances;
    const vao = this.vao;
    if (n <= 0 || instances === null || vao === null) return;
    instances.ensureCapacity(n * this.floats * FLOAT_BYTES);
    instances.orphan();
    instances.upload(this.data, 0, n * this.floats);
    vao.bind();
    ctx.gl.drawArraysInstanced(ctx.gl.TRIANGLE_STRIP, 0, QUAD_VERTICES, n);
    ctx.gl.bindVertexArray(null);
    ctx.stats.drawCalls++;
  }

  dispose(setup: PassSetup): void {
    const own: (GpuResource | null)[] = [this.vao, this.instances, this.quad];
    for (const r of own) if (r !== null) setup.resources.remove(r);
    this.vao = null;
    this.instances = null;
    this.quad = null;
  }
}
