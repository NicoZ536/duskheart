/**
 * Instanced sprite batcher (docs/RENDER.md §3 `batch/spriteBatcher.ts`): sorts the frame's sprites
 * (layer, anchor depth, submission order), packs their records into one preallocated upload array,
 * streams it into one instance buffer and draws each non-empty layer with a single instanced call –
 * at most four draw calls per atlas, whatever the sprite count. No allocation per frame; the arrays
 * grow by doubling only when a frame has more sprites than any before.
 *
 * The upload path (M5-51: in `sprites-5000` the render preparation's spikes were waits inside GL calls after the
 * 261 KB of instance data and buffer orphaning of every frame):
 * - **Partial updates, no orphaning.** The batcher keeps what the instance buffer holds (the records of the last
 *   frame, `previous`) and uploads only the spans of records that differ – a still picture uploads nothing, a scene
 *   whose y-order shifts everywhere (5 000 sprites walking) one span of everything. The buffer is never re-specified
 *   in the frame path: `bufferData` with no data orphans the storage and makes the browser allocate and zero it
 *   (WebGL initialises every buffer) before the upload overwrites it; GL keeps the draws of the last frame reading
 *   the old contents either way. A grown buffer or a restored context (new handle) uploads everything once.
 * - **Fewer GL calls.** Each layer has its own vertex array whose instance attributes point at the layer's first
 *   record; they are re-pointed only when that start moves (`setInstanceOffset`: seven buffer binds and pointers per
 *   draw before), so a steady scene draws each layer with a bind and one call – in the G-buffer and the shadow pass.
 *
 * The program of a frame (M6-81): the sprite shader with the ink smoke of the shadow brood (`DH_SMOKE`, M6-25) only while
 * a sprite of the frame materialises, else the same shader compiled without it – where the smoke changes no pixel. A
 * software rasteriser runs every branch of a shader, taken or not (ADR-0066): its noise lookups and texel fetches for every
 * sprite pixel made each SwiftShader frame of `sprites-5000` 40 % longer, and the page waits for the GPU process inside
 * its GL calls (the render preparation of the benchmark, M6-81).
 */
import { GpuBuffer } from '../gl/buffer';
import type { GpuResourceRegistry } from '../gl/resources';
import type { ShaderLibrary, ShaderProgram } from '../gl/shaders';
import { VertexArray } from '../gl/vertexArray';
import { YSorter } from '../sort/ysort';
import { surfaceDefines } from '../surface/params';
import { materializeDefines } from './materialize';
import type { SpriteList } from './spriteList';
import { grownCapacity, INSTANCE_STRIDE, INSTANCE_WORDS, LAYER_COUNT, LOCATION, OFFSET } from './spriteLayout';

/**
 * Words per instance record, copied one by one in `prepare` (the record layout of spriteLayout.ts:
 * 48 B = 12 words). The module refuses to load if the layout changes without this copy.
 */
const RECORD_WORDS = 12;
if (INSTANCE_WORDS !== RECORD_WORDS) throw new Error(`SpriteBatcher: Instanz-Datensatz hat ${INSTANCE_WORDS} statt ${RECORD_WORDS} Wörter – Kopierschleife in prepare anpassen`);

/** Quad corners as a triangle strip. */
const QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
const QUAD_VERTICES = 4;
const CORNER_COMPONENTS = 2;
/** Initial instance capacity of the upload array and GPU buffer. */
export const INITIAL_INSTANCES = 1024;
/**
 * Upload spans of a frame (M5-51): changed records closer than `mergeGapRecords` to the span before join it (one
 * `bufferSubData` costs more than re-sending a few unchanged records); from the `maxSpans`-th span on, the last span
 * grows to the last changed record.
 */
export const UPLOAD_SPANS = { maxSpans: 8, mergeGapRecords: 32 } as const;
/** A layer's vertex array not pointed at any record yet. */
const UNPOINTED = -1;

/** The defines of the variant with the ink smoke (sprite_gbuffer.frag `#ifdef DH_SMOKE`). */
export const SMOKE_VARIANT = { DH_SMOKE: '1' } as const;

export class SpriteBatcher {
  /**
   * The sprite program without the ink smoke, and with it (`program`). Both carry the name `sprite-gbuffer`: one shader
   * file, one entry in the error overlay. The plain one is built first, so when an edit mends the shared code and leaves
   * an error in the smoke's, the smoke variant's report comes last and stays shown.
   */
  private readonly plainProgram: ShaderProgram;
  private readonly smokeProgram: ShaderProgram;
  /** A sprite of the prepared frame materialises (`SpriteList.materializing`). */
  private smoke = false;
  private readonly quad: GpuBuffer;
  private readonly instances: GpuBuffer;
  /** One vertex array per layer, its instance attributes pointed at the layer's first record. */
  private readonly vaos: VertexArray[] = [];
  /** First record each layer's vertex array points at, and the handle it was pointed on (a restored context has new ones). */
  private readonly pointedStart = new Int32Array(LAYER_COUNT).fill(UNPOINTED);
  private readonly pointedVao: Array<WebGLVertexArrayObject | null> = [];
  private readonly sorter = new YSorter();
  /** This frame's records in draw order. */
  private packed = new Uint32Array(INITIAL_INSTANCES * RECORD_WORDS);
  /** The last frame's records in draw order: what the instance buffer holds for the first `uploadedCount` records. */
  private previous = new Uint32Array(INITIAL_INSTANCES * RECORD_WORDS);
  private uploadedCount = 0;
  /** The buffer handle the records were uploaded to (null: nothing uploaded, or the context was lost since). */
  private uploadedBuffer: WebGLBuffer | null = null;
  private readonly spanStart = new Int32Array(UPLOAD_SPANS.maxSpans);
  private readonly spanEnd = new Int32Array(UPLOAD_SPANS.maxSpans);
  private spans = 0;
  private count = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    resources: GpuResourceRegistry,
    shaders: ShaderLibrary,
  ) {
    const defines = { ...surfaceDefines(), ...materializeDefines() };
    this.plainProgram = shaders.program({ name: 'sprite-gbuffer', vertex: 'sprite_gbuffer.vert', fragment: 'sprite_gbuffer.frag', defines });
    this.smokeProgram = shaders.program({ name: 'sprite-gbuffer', vertex: 'sprite_gbuffer.vert', fragment: 'sprite_gbuffer.frag', defines: { ...defines, ...SMOKE_VARIANT } });
    this.quad = resources.add(new GpuBuffer(gl, { label: 'sprite-quad', target: 'vertex', usage: 'static', data: QUAD }));
    this.instances = resources.add(new GpuBuffer(gl, { label: 'sprite-instances', target: 'vertex', usage: 'stream', byteLength: INITIAL_INSTANCES * INSTANCE_STRIDE }));
    const inst = { buffer: this.instances, stride: INSTANCE_STRIDE, divisor: 1 } as const;
    for (let layer = 0; layer < LAYER_COUNT; layer++) {
      this.vaos.push(
        resources.add(
          new VertexArray(gl, {
            label: `sprites-${layer}`,
            attributes: [
              { location: LOCATION.corner, buffer: this.quad, components: CORNER_COMPONENTS, type: 'f32', stride: 0, offset: 0 },
              { ...inst, location: LOCATION.pos, components: 2, type: 'f32', offset: OFFSET.pos },
              { ...inst, location: LOCATION.params, components: 4, type: 'f32', offset: OFFSET.params },
              { ...inst, location: LOCATION.rect, components: 4, type: 'u16', integer: true, offset: OFFSET.rect },
              { ...inst, location: LOCATION.anchor, components: 2, type: 'i16', integer: true, offset: OFFSET.anchor },
              { ...inst, location: LOCATION.tint, components: 4, type: 'u8', normalized: true, offset: OFFSET.tint },
              { ...inst, location: LOCATION.misc, components: 4, type: 'u8', integer: true, offset: OFFSET.misc },
              { ...inst, location: LOCATION.surface, components: 4, type: 'u8', integer: true, offset: OFFSET.surface },
            ],
          }),
        ),
      );
      this.pointedVao.push(null);
    }
  }

  /**
   * The G-buffer program of the prepared frame: with the ink smoke while one of its sprites materialises, else without it
   * (the same pixels: the smoke only touches sprites flagged `materialize`).
   */
  get program(): ShaderProgram {
    return this.smoke ? this.smokeProgram : this.plainProgram;
  }

  /** Sprites prepared this frame. */
  get size(): number {
    return this.count;
  }

  /** Instance capacity of the upload array. */
  get capacity(): number {
    return this.packed.length / RECORD_WORDS;
  }

  /** Records uploaded this frame (the sum of the frame's spans; 0 when nothing changed). */
  get uploadedRecords(): number {
    let n = 0;
    for (let i = 0; i < this.spans; i++) n += (this.spanEnd[i] as number) - (this.spanStart[i] as number);
    return n;
  }

  /** `bufferSubData` calls of this frame's upload. */
  get uploadSpans(): number {
    return this.spans;
  }

  layerCount(layer: number): number {
    return this.sorter.layerCount[layer] ?? 0;
  }

  layerStart(layer: number): number {
    return this.sorter.layerStart[layer] ?? 0;
  }

  /**
   * Sorts, packs and uploads the frame's sprites (M1-28: the hottest loop of the frame path after
   * `SpriteList.push`). The y-sort gets the depth range the list tracked while it was filled (as its typed
   * array, M5-32); the records are copied in sorted order word by word with the offsets unrolled, and compared
   * with what the instance buffer holds: only the changed spans are uploaded (M5-51).
   */
  prepare(list: SpriteList): void {
    const n = list.count;
    this.count = n;
    this.spans = 0;
    this.smoke = list.materializing;
    const order = this.sorter.sortInRange(list.layerKeys, list.depthKeys, n, list.depthRange);
    let valid = this.uploadedCount;
    if (n * RECORD_WORDS > this.packed.length) {
      const cap = grownCapacity(this.capacity, n) * RECORD_WORDS;
      this.packed = new Uint32Array(cap);
      this.previous = new Uint32Array(cap);
      valid = 0;
    }
    if (n === 0) return;
    // A grown buffer holds nothing yet; a restored context has a new, empty one.
    if (this.instances.ensureCapacity(n * INSTANCE_STRIDE) || this.instances.handle !== this.uploadedBuffer) valid = 0;
    const src = list.words;
    const dst = this.packed;
    const old = this.previous;
    const starts = this.spanStart;
    const ends = this.spanEnd;
    const maxSpans = UPLOAD_SPANS.maxSpans;
    const gap = UPLOAD_SPANS.mergeGapRecords;
    let spans = 0;
    for (let i = 0, d = 0; i < n; i++, d += RECORD_WORDS) {
      const s = (order[i] ?? 0) * RECORD_WORDS;
      const w0 = src[s] ?? 0;
      const w1 = src[s + 1] ?? 0;
      const w2 = src[s + 2] ?? 0;
      const w3 = src[s + 3] ?? 0;
      const w4 = src[s + 4] ?? 0;
      const w5 = src[s + 5] ?? 0;
      const w6 = src[s + 6] ?? 0;
      const w7 = src[s + 7] ?? 0;
      const w8 = src[s + 8] ?? 0;
      const w9 = src[s + 9] ?? 0;
      const w10 = src[s + 10] ?? 0;
      const w11 = src[s + 11] ?? 0;
      dst[d] = w0;
      dst[d + 1] = w1;
      dst[d + 2] = w2;
      dst[d + 3] = w3;
      dst[d + 4] = w4;
      dst[d + 5] = w5;
      dst[d + 6] = w6;
      dst[d + 7] = w7;
      dst[d + 8] = w8;
      dst[d + 9] = w9;
      dst[d + 10] = w10;
      dst[d + 11] = w11;
      if (
        i < valid &&
        old[d] === w0 &&
        old[d + 1] === w1 &&
        old[d + 2] === w2 &&
        old[d + 3] === w3 &&
        old[d + 4] === w4 &&
        old[d + 5] === w5 &&
        old[d + 6] === w6 &&
        old[d + 7] === w7 &&
        old[d + 8] === w8 &&
        old[d + 9] === w9 &&
        old[d + 10] === w10 &&
        old[d + 11] === w11
      ) {
        continue;
      }
      // A changed record: joins the span before when close to it (or when no span is left), else opens one.
      if (spans > 0 && (i - (ends[spans - 1] as number) <= gap || spans === maxSpans)) ends[spans - 1] = i + 1;
      else {
        starts[spans] = i;
        ends[spans] = i + 1;
        spans++;
      }
    }
    for (let k = 0; k < spans; k++) {
      const a = starts[k] as number;
      const b = ends[k] as number;
      this.instances.upload(dst, a * RECORD_WORDS, (b - a) * RECORD_WORDS, a * INSTANCE_STRIDE);
    }
    this.spans = spans;
    // The buffer now holds this frame's records: they are what the next frame compares with.
    this.packed = old;
    this.previous = dst;
    this.uploadedCount = n;
    this.uploadedBuffer = this.instances.handle;
  }

  /**
   * Draws one layer's instances with the bound program (uniforms set by the caller). Returns 1 if
   * a draw call was issued, 0 for an empty layer.
   */
  drawLayer(layer: number): number {
    const count = this.layerCount(layer);
    if (count === 0 || layer < 0 || layer >= LAYER_COUNT) return 0;
    const vao = this.vaos[layer] as VertexArray;
    vao.bind();
    const start = this.layerStart(layer);
    if (start !== this.pointedStart[layer] || vao.handle !== this.pointedVao[layer]) {
      vao.setInstanceOffset(start);
      this.pointedStart[layer] = start;
      this.pointedVao[layer] = vao.handle;
    }
    this.gl.drawArraysInstanced(this.gl.TRIANGLE_STRIP, 0, QUAD_VERTICES, count);
    return 1;
  }
}
