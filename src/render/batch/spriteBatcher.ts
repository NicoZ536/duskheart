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

/**
 * Words per instance record, copied one by one in `prepare` (the record layout of spriteLayout.ts:
 * 44 B = 11 words). The module refuses to load if the layout changes without this copy.
 */
const RECORD_WORDS = 11;
if (INSTANCE_WORDS !== RECORD_WORDS) throw new Error(`SpriteBatcher: Instanz-Datensatz hat ${INSTANCE_WORDS} statt ${RECORD_WORDS} Wörter – Kopierschleife in prepare anpassen`);

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
  private packed = new Uint32Array(INITIAL_INSTANCES * RECORD_WORDS);
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
    return this.packed.length / RECORD_WORDS;
  }

  layerCount(layer: number): number {
    return this.sorter.layerCount[layer] ?? 0;
  }

  layerStart(layer: number): number {
    return this.sorter.layerStart[layer] ?? 0;
  }

  /**
   * Sorts, packs and uploads the frame's sprites (M1-28: the hottest loop of the frame path after
   * `SpriteList.push`). The y-sort gets the depth range the list tracked while it was filled; the
   * records are copied in sorted order word by word with the offsets unrolled.
   */
  prepare(list: SpriteList): void {
    const n = list.count;
    this.count = n;
    const order = this.sorter.sort(list.layerKeys, list.depthKeys, n, list.depthMin, list.depthMax);
    if (n * RECORD_WORDS > this.packed.length) this.packed = new Uint32Array(grownCapacity(this.capacity, n) * RECORD_WORDS);
    const src = list.words;
    const dst = this.packed;
    for (let i = 0, d = 0; i < n; i++, d += RECORD_WORDS) {
      const s = (order[i] ?? 0) * RECORD_WORDS;
      dst[d] = src[s] ?? 0;
      dst[d + 1] = src[s + 1] ?? 0;
      dst[d + 2] = src[s + 2] ?? 0;
      dst[d + 3] = src[s + 3] ?? 0;
      dst[d + 4] = src[s + 4] ?? 0;
      dst[d + 5] = src[s + 5] ?? 0;
      dst[d + 6] = src[s + 6] ?? 0;
      dst[d + 7] = src[s + 7] ?? 0;
      dst[d + 8] = src[s + 8] ?? 0;
      dst[d + 9] = src[s + 9] ?? 0;
      dst[d + 10] = src[s + 10] ?? 0;
    }
    if (n === 0) return;
    this.instances.ensureCapacity(n * INSTANCE_STRIDE);
    this.instances.orphan();
    this.instances.upload(dst, 0, n * RECORD_WORDS);
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
