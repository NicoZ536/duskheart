/**
 * GPU text batch for world UI in the WebGL pass (MASTERPROMPT §26, docs/RENDER.md §3; used by M1-23
 * for damage numbers, names, interaction markers and life bars). Every glyph is an instanced quad
 * that samples the R8 glyph atlas with `texelFetch` on whole target pixels – the text stays exactly
 * as crisp as the baked font. Solid rectangles (bar fills, backgrounds) share the batch.
 *
 * Usage per frame (the caller binds the target framebuffer and viewport):
 * `begin(w, h)` → `text(…)` / `rect(…)` → `end()` (one instanced draw call, alpha blending).
 * The instance array grows by doubling and is reused, so steady frames allocate nothing. All GPU
 * objects live in the given registry and come back after a context loss (`restoreAll`).
 *
 * | Byte | Attribute (location) | Type | Content |
 * |---|---|---|---|
 * | 0 | aPos (1) | i16×2 → ivec2 | top-left in target px (y down) |
 * | 4 | aBox (2) | u16×4 → uvec4 | width, height [px]; atlas cell x, y [texels] |
 * | 12 | aMode (3) | u8 → uint | `TEXT_MODE` (3 bytes padding) |
 * | 16 | aColor (4) | u8×4 normalised | ink colour RGBA |
 * | 20 | aEffect (5) | u8×4 normalised | shadow/outline colour RGBA |
 */
import { GpuBuffer } from '../gl/buffer';
import type { GpuResource, GpuResourceRegistry } from '../gl/resources';
import { ShaderLibrary, type ShaderErrorReporter, type ShaderProgram } from '../gl/shaders';
import { Texture2D } from '../gl/texture';
import { VertexArray } from '../gl/vertexArray';
import { shaderSources } from '../shaderLib';
import { GLYPH_PADDING, type GlyphAtlas } from './glyphAtlas';
import { layoutText, TextLayout, type TextAlign } from './layout';

/** How an instance is drawn (`aMode`). */
export const TEXT_MODE = { plain: 0, shadow: 1, outline: 2, rect: 3 } as const;
export type TextEffect = 'none' | 'shadow' | 'outline';
/** Rows the drop shadow is shifted down. */
export const TEXT_SHADOW_OFFSET = 1;

export const TEXT_INSTANCE_STRIDE = 24;
/** Byte offsets of the attributes. */
export const TEXT_OFFSET = { pos: 0, box: 4, mode: 12, color: 16, effect: 20 } as const;
/** Attribute locations (`layout(location = …)` in text.vert). */
export const TEXT_LOCATION = { corner: 0, pos: 1, box: 2, mode: 3, color: 4, effect: 5 } as const;
/** Initial instance capacity. */
export const TEXT_INITIAL_INSTANCES = 256;
/** Range of the i16 position attribute; instances outside are skipped (far off-screen). */
const POS_MIN = -32768;
const POS_MAX = 32767;
/** Largest instance size (u16). */
const SIZE_MAX = 65535;

const I16_PER_INSTANCE = TEXT_INSTANCE_STRIDE / Int16Array.BYTES_PER_ELEMENT;
const BOX_INDEX = TEXT_OFFSET.box / Uint16Array.BYTES_PER_ELEMENT;
/** Byte shifts of a packed 0xRRGGBBAA colour. */
const SHIFT_R = 24;
const SHIFT_G = 16;
const SHIFT_B = 8;
const BYTE = 0xff;

/** Quad corners as a triangle strip. */
const QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
const QUAD_VERTICES = 4;
const CORNER_COMPONENTS = 2;
const PAIR = 2;
const QUAD4 = 4;
const COLOR_COMPONENTS = 4;
/** Texture unit of the glyph atlas. */
const ATLAS_UNIT = 0;

/** Packs 8-bit channels into 0xRRGGBBAA. */
export function packRgba(r: number, g: number, b: number, a = BYTE): number {
  return (((r & BYTE) << SHIFT_R) | ((g & BYTE) << SHIFT_G) | ((b & BYTE) << SHIFT_B) | (a & BYTE)) >>> 0;
}

/** `#rrggbb` (+ alpha 0…255) → 0xRRGGBBAA. */
export function rgbaFromHex(hex: string, alpha = BYTE): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`Textfarbe ${hex} ist kein #rrggbb`);
  const v = Number.parseInt(hex.slice(1), 16);
  return packRgba((v >> SHIFT_G) & BYTE, (v >> SHIFT_B) & BYTE, v & BYTE, alpha);
}

export interface TextStyle {
  /** Ink colour 0xRRGGBBAA. */
  readonly color: number;
  readonly effect?: TextEffect;
  /** Shadow/outline colour 0xRRGGBBAA. */
  readonly effectColor?: number;
  /** Alignment of the lines; also what `x` refers to: left edge, centre or right edge of the block. */
  readonly align?: TextAlign;
  /** Wrap width [px]. */
  readonly maxWidth?: number;
  readonly lineHeight?: number;
}

export interface TextBatchOptions {
  /**
   * Shader library that builds the text program – the renderer's (hot reload, error overlay). Without
   * one the batch builds its program through an own library over the page's shader sources
   * (`shaderLib.ts`), reporting to `errors`.
   */
  readonly shaders?: ShaderLibrary;
  /** Receives shader build errors of an own library; default: console. */
  readonly errors?: ShaderErrorReporter;
  readonly initialInstances?: number;
}

/** Shader files of the text program (below src/render/shaders). */
export const TEXT_SHADER_FILES = { vertex: 'text/text.vert', fragment: 'text/text.frag' } as const;

const consoleReporter: ShaderErrorReporter = {
  report(program, error) {
    if (error !== null) console.error(error.message);
    else console.info(`Shader „${program}“ wieder in Ordnung`);
  },
};

const PROGRAM_DEFINES: Readonly<Record<string, string>> = {
  TEXT_MODE_PLAIN: String(TEXT_MODE.plain),
  TEXT_MODE_SHADOW: String(TEXT_MODE.shadow),
  TEXT_MODE_OUTLINE: String(TEXT_MODE.outline),
  TEXT_MODE_RECT: String(TEXT_MODE.rect),
  TEXT_SHADOW_OFFSET: String(TEXT_SHADOW_OFFSET),
};

function modeOf(effect: TextEffect | undefined): number {
  return effect === 'shadow' ? TEXT_MODE.shadow : effect === 'outline' ? TEXT_MODE.outline : TEXT_MODE.plain;
}

export class TextBatch {
  readonly program: ShaderProgram;
  readonly texture: Texture2D;
  private readonly quad: GpuBuffer;
  private readonly instances: GpuBuffer;
  private readonly vao: VertexArray;
  private readonly owned: GpuResource[];
  private readonly shaders: ShaderLibrary;
  /** The library the batch created itself (disposed with it), null when the caller passed one. */
  private readonly ownShaders: ShaderLibrary | null;
  private bytes: Uint8Array;
  private i16: Int16Array;
  private u16: Uint16Array;
  private n = 0;
  private targetW = 1;
  private targetH = 1;
  private uploadedVersion = -1;
  private readonly layout = new TextLayout();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly resources: GpuResourceRegistry,
    readonly atlas: GlyphAtlas,
    options: TextBatchOptions = {},
  ) {
    const capacity = Math.max(1, options.initialInstances ?? TEXT_INITIAL_INSTANCES);
    const buffer = new ArrayBuffer(capacity * TEXT_INSTANCE_STRIDE);
    this.bytes = new Uint8Array(buffer);
    this.i16 = new Int16Array(buffer);
    this.u16 = new Uint16Array(buffer);
    if (options.shaders) {
      this.shaders = options.shaders;
      this.ownShaders = null;
    } else {
      this.shaders = new ShaderLibrary(gl, resources, shaderSources, {}, options.errors ?? consoleReporter);
      this.ownShaders = this.shaders;
    }
    this.program = this.shaders.program({ name: 'pixel-text', ...TEXT_SHADER_FILES, defines: PROGRAM_DEFINES });
    this.texture = resources.add(new Texture2D(gl, { label: 'glyph-atlas', width: atlas.width, height: atlas.height, format: 'R8', filter: 'nearest', pixels: atlas.pixels }));
    this.uploadedVersion = atlas.version;
    this.quad = resources.add(new GpuBuffer(gl, { label: 'text-quad', target: 'vertex', usage: 'static', data: QUAD }));
    this.instances = resources.add(new GpuBuffer(gl, { label: 'text-instances', target: 'vertex', usage: 'stream', byteLength: capacity * TEXT_INSTANCE_STRIDE }));
    const inst = { buffer: this.instances, stride: TEXT_INSTANCE_STRIDE, divisor: 1 } as const;
    this.vao = resources.add(
      new VertexArray(gl, {
        label: 'text',
        attributes: [
          { location: TEXT_LOCATION.corner, buffer: this.quad, components: CORNER_COMPONENTS, type: 'f32', stride: 0, offset: 0 },
          { ...inst, location: TEXT_LOCATION.pos, components: PAIR, type: 'i16', integer: true, offset: TEXT_OFFSET.pos },
          { ...inst, location: TEXT_LOCATION.box, components: QUAD4, type: 'u16', integer: true, offset: TEXT_OFFSET.box },
          { ...inst, location: TEXT_LOCATION.mode, components: 1, type: 'u8', integer: true, offset: TEXT_OFFSET.mode },
          { ...inst, location: TEXT_LOCATION.color, components: COLOR_COMPONENTS, type: 'u8', normalized: true, offset: TEXT_OFFSET.color },
          { ...inst, location: TEXT_LOCATION.effect, components: COLOR_COMPONENTS, type: 'u8', normalized: true, offset: TEXT_OFFSET.effect },
        ],
      }),
    );
    this.owned = [this.vao, this.instances, this.quad, this.texture];
  }

  /** Instances queued since `begin`. */
  get count(): number {
    return this.n;
  }

  /** Instance capacity of the upload array. */
  get capacity(): number {
    return this.bytes.length / TEXT_INSTANCE_STRIDE;
  }

  /** Raw instance records (tests, debugging); valid for the first `count` instances. */
  get instanceBytes(): Uint8Array {
    return this.bytes;
  }

  /** Starts a batch for a target of `width` × `height` px. */
  begin(width: number, height: number): void {
    this.n = 0;
    this.targetW = Math.max(1, width);
    this.targetH = Math.max(1, height);
  }

  /**
   * Queues `text` with its block top at `y` and `x` at the left edge, centre or right edge
   * (`style.align`). Returns the layout (valid until the next call) for measuring.
   */
  text(text: string, x: number, y: number, style: TextStyle): TextLayout {
    const l = layoutText(this.atlas, text, style, this.layout);
    const align = style.align ?? 'left';
    const left = Math.round(align === 'center' ? x - Math.floor(l.width / 2) : align === 'right' ? x - l.width : x);
    const top = Math.round(y);
    const mode = modeOf(style.effect);
    const effectColor = style.effectColor ?? 0;
    for (let i = 0; i < l.count; i++) {
      const p = l.glyphs[i];
      if (p === undefined) continue;
      const g = p.glyph;
      this.push(left + p.x - GLYPH_PADDING, top + p.y - GLYPH_PADDING, g.width + 2 * GLYPH_PADDING, g.height + 2 * GLYPH_PADDING, g.atlasX, g.atlasY, mode, style.color, effectColor);
    }
    return l;
  }

  /** Queues a solid rectangle (bars, backdrops) in whole target px. */
  rect(x: number, y: number, width: number, height: number, color: number): void {
    const w = Math.round(width);
    const h = Math.round(height);
    if (w <= 0 || h <= 0) return;
    this.push(Math.round(x), Math.round(y), Math.min(w, SIZE_MAX), Math.min(h, SIZE_MAX), 0, 0, TEXT_MODE.rect, color, 0);
  }

  /** Uploads and draws the queued instances into the bound framebuffer. Returns the draw calls issued. */
  end(): number {
    const count = this.n;
    this.n = 0;
    if (count === 0 || this.gl.isContextLost()) return 0;
    this.syncAtlas();
    if (!this.program.use()) return 0;
    const gl = this.gl;
    const bytes = count * TEXT_INSTANCE_STRIDE;
    this.instances.ensureCapacity(bytes);
    this.instances.orphan();
    this.instances.upload(this.bytes, 0, bytes);
    this.texture.bind(ATLAS_UNIT);
    gl.uniform1i(this.program.uniform('uGlyphs'), ATLAS_UNIT);
    gl.uniform2f(this.program.uniform('uTarget'), this.targetW, this.targetH);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.vao.bind();
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, QUAD_VERTICES, count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    return 1;
  }

  /** Releases the GPU objects (the atlas stays usable). */
  dispose(): void {
    for (const r of this.owned) this.resources.remove(r);
    this.shaders.release(this.program);
    this.ownShaders?.dispose();
  }

  /** Re-uploads the atlas when glyphs were baked since the last draw. */
  private syncAtlas(): void {
    const a = this.atlas;
    if (a.version === this.uploadedVersion && a.height === this.texture.height) return;
    this.texture.resize(a.width, a.height);
    this.texture.setPixels(a.pixels);
    this.uploadedVersion = a.version;
  }

  private push(x: number, y: number, w: number, h: number, u: number, v: number, mode: number, color: number, effect: number): void {
    if (x < POS_MIN || y < POS_MIN || x > POS_MAX || y > POS_MAX) return;
    if (this.n >= this.capacity) this.grow();
    const i = this.n++;
    const s = i * I16_PER_INSTANCE;
    this.i16[s] = x;
    this.i16[s + 1] = y;
    const b = s + BOX_INDEX;
    this.u16[b] = w;
    this.u16[b + 1] = h;
    this.u16[b + 2] = u;
    this.u16[b + 3] = v;
    const o = i * TEXT_INSTANCE_STRIDE;
    this.bytes[o + TEXT_OFFSET.mode] = mode;
    writeColor(this.bytes, o + TEXT_OFFSET.color, color);
    writeColor(this.bytes, o + TEXT_OFFSET.effect, effect);
  }

  private grow(): void {
    const buffer = new ArrayBuffer(this.bytes.length * 2);
    const bytes = new Uint8Array(buffer);
    bytes.set(this.bytes);
    this.bytes = bytes;
    this.i16 = new Int16Array(buffer);
    this.u16 = new Uint16Array(buffer);
  }
}

function writeColor(out: Uint8Array, offset: number, c: number): void {
  out[offset] = (c >>> SHIFT_R) & BYTE;
  out[offset + 1] = (c >>> SHIFT_G) & BYTE;
  out[offset + 2] = (c >>> SHIFT_B) & BYTE;
  out[offset + 3] = c & BYTE;
}
