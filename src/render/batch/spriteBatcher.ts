/**
 * Instanced sprite batcher (docs/RENDER.md §3 `batch/spriteBatcher.ts`): sorts the frame's sprites
 * (layer, anchor depth, submission order), packs their records into one preallocated upload array,
 * streams it into one instance buffer and draws each non-empty layer with a single instanced call –
 * at most four draw calls per atlas, whatever the sprite count. No allocation per frame; the arrays
 * grow by doubling only when a frame has more sprites than any before.
 */
import { GpuBuffer } from '../gl/buffer';
import type { GpuResourceRegistry } from '../gl/resources';
import type { ShaderLibrary, ShaderProgram } from '../gl/shaders';
import { VertexArray } from '../gl/vertexArray';
import { YSorter } from '../sort/ysort';
import type { SpriteList } from './spriteList';
import { grownCapacity, INSTANCE_STRIDE, INSTANCE_WORDS, LAYER_COUNT, LOCATION, OFFSET } from './spriteLayout';

/** Quad corners as a triangle strip. */
const QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
const QUAD_VERTICES = 4;
const CORNER_COMPONENTS = 2;
/** Initial instance capacity of the upload array and GPU buffer. */
export const INITIAL_INSTANCES = 1024;

export class SpriteBatcher {
  readonly program: ShaderProgram;
  private readonly quad: GpuBuffer;
  private readonly instances: GpuBuffer;
  private readonly vao: VertexArray;
  private readonly sorter = new YSorter();
  private packed = new Uint32Array(INITIAL_INSTANCES * INSTANCE_WORDS);
  private count = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    resources: GpuResourceRegistry,
    shaders: ShaderLibrary,
  ) {
    this.program = shaders.program({ name: 'sprite-gbuffer', vertex: 'sprite_gbuffer.vert', fragment: 'sprite_gbuffer.frag' });
    this.quad = resources.add(new GpuBuffer(gl, { label: 'sprite-quad', target: 'vertex', usage: 'static', data: QUAD }));
    this.instances = resources.add(new GpuBuffer(gl, { label: 'sprite-instances', target: 'vertex', usage: 'stream', byteLength: INITIAL_INSTANCES * INSTANCE_STRIDE }));
    const inst = { buffer: this.instances, stride: INSTANCE_STRIDE, divisor: 1 } as const;
    this.vao = resources.add(
      new VertexArray(gl, {
        label: 'sprites',
        attributes: [
          { location: LOCATION.corner, buffer: this.quad, components: CORNER_COMPONENTS, type: 'f32', stride: 0, offset: 0 },
          { ...inst, location: LOCATION.pos, components: 2, type: 'f32', offset: OFFSET.pos },
          { ...inst, location: LOCATION.params, components: 4, type: 'f32', offset: OFFSET.params },
          { ...inst, location: LOCATION.rect, components: 4, type: 'u16', integer: true, offset: OFFSET.rect },
          { ...inst, location: LOCATION.anchor, components: 2, type: 'i16', integer: true, offset: OFFSET.anchor },
          { ...inst, location: LOCATION.tint, components: 4, type: 'u8', normalized: true, offset: OFFSET.tint },
          { ...inst, location: LOCATION.misc, components: 4, type: 'u8', integer: true, offset: OFFSET.misc },
        ],
      }),
    );
  }

  /** Sprites prepared this frame. */
  get size(): number {
    return this.count;
  }

  /** Instance capacity of the upload array. */
  get capacity(): number {
    return this.packed.length / INSTANCE_WORDS;
  }

  layerCount(layer: number): number {
    return this.sorter.layerCount[layer] ?? 0;
  }

  layerStart(layer: number): number {
    return this.sorter.layerStart[layer] ?? 0;
  }

  /** Sorts, packs and uploads the frame's sprites. */
  prepare(list: SpriteList): void {
    const n = list.count;
    this.count = n;
    const order = this.sorter.sort(list.layerKeys, list.depthKeys, n);
    if (n * INSTANCE_WORDS > this.packed.length) this.packed = new Uint32Array(grownCapacity(this.capacity, n) * INSTANCE_WORDS);
    const src = list.words;
    const dst = this.packed;
    for (let i = 0; i < n; i++) {
      const s = (order[i] ?? 0) * INSTANCE_WORDS;
      const d = i * INSTANCE_WORDS;
      for (let w = 0; w < INSTANCE_WORDS; w++) dst[d + w] = src[s + w] ?? 0;
    }
    if (n === 0) return;
    this.instances.ensureCapacity(n * INSTANCE_STRIDE);
    this.instances.orphan();
    this.instances.upload(dst, 0, n * INSTANCE_WORDS);
  }

  /**
   * Draws one layer's instances with the bound program (uniforms set by the caller). Returns 1 if
   * a draw call was issued, 0 for an empty layer.
   */
  drawLayer(layer: number): number {
    const count = this.layerCount(layer);
    if (count === 0 || layer < 0 || layer >= LAYER_COUNT) return 0;
    this.vao.bind();
    this.vao.setInstanceOffset(this.layerStart(layer));
    this.gl.drawArraysInstanced(this.gl.TRIANGLE_STRIP, 0, QUAD_VERTICES, count);
    return 1;
  }
}
