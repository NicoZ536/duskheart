/**
 * Render targets: a framebuffer with one or more colour attachments (MRT for the G-buffer), created
 * with the device's real formats (`resolveTargetFormat`) and checked for completeness.
 */
import { resolveTargetFormat, type ResolvedFormat, type TargetEncoding, type TextureFormat } from './formats';
import type { GpuResource } from './resources';
import { Texture2D, type TextureFilter } from './texture';

export interface AttachmentSpec {
  /** Name of the attachment (debug views, error messages). */
  readonly name: string;
  /** Requested format; float formats fall back to RGBA8/RG8 encodings without float render targets. */
  readonly format: TextureFormat;
  readonly filter?: TextureFilter;
}

export interface RenderTargetOptions {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly attachments: readonly AttachmentSpec[];
  /** Whether the device renders to float formats (see `resolveTargetCaps`). */
  readonly floatTargets: boolean;
}

/** The status enums of `checkFramebufferStatus`, by name (for readable errors). */
const STATUS_NAMES = [
  'FRAMEBUFFER_COMPLETE',
  'FRAMEBUFFER_INCOMPLETE_ATTACHMENT',
  'FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT',
  'FRAMEBUFFER_INCOMPLETE_DIMENSIONS',
  'FRAMEBUFFER_UNSUPPORTED',
  'FRAMEBUFFER_INCOMPLETE_MULTISAMPLE',
] as const;

type StatusName = (typeof STATUS_NAMES)[number];
const HEX_RADIX = 16;

/** Name of a framebuffer status value, e.g. `FRAMEBUFFER_UNSUPPORTED`. */
export function framebufferStatusName(gl: Readonly<Record<StatusName, number>>, status: number): string {
  for (const name of STATUS_NAMES) if (gl[name] === status) return name;
  return `0x${status.toString(HEX_RADIX)}`;
}

export class FramebufferIncompleteError extends Error {
  override readonly name = 'FramebufferIncompleteError';
  constructor(
    readonly target: string,
    readonly status: string,
    readonly formats: readonly TextureFormat[],
  ) {
    super(`Render-Ziel „${target}“ unvollständig: ${status} (${formats.join(', ')})`);
  }
}

export class RenderTarget implements GpuResource {
  readonly kind = 'framebuffer';
  readonly label: string;
  readonly attachments: readonly Texture2D[];
  readonly formats: readonly ResolvedFormat[];
  private fbo: WebGLFramebuffer | null = null;
  private w: number;
  private h: number;
  private readonly drawBuffers: number[];

  constructor(
    private readonly gl: WebGL2RenderingContext,
    options: RenderTargetOptions,
  ) {
    if (options.attachments.length === 0) throw new Error(`Render-Ziel „${options.label}“ ohne Anhang`);
    this.label = options.label;
    this.w = Math.max(1, Math.floor(options.width));
    this.h = Math.max(1, Math.floor(options.height));
    this.formats = options.attachments.map((a) => resolveTargetFormat(a.format, options.floatTargets));
    this.attachments = options.attachments.map(
      (a, i) =>
        new Texture2D(gl, {
          label: `${options.label}.${a.name}`,
          width: this.w,
          height: this.h,
          format: this.formats[i]?.actual ?? a.format,
          filter: a.filter ?? 'nearest',
        }),
    );
    this.drawBuffers = this.attachments.map((_, i) => gl.COLOR_ATTACHMENT0 + i);
  }

  get width(): number {
    return this.w;
  }

  get height(): number {
    return this.h;
  }

  get handle(): WebGLFramebuffer | null {
    return this.fbo;
  }

  /** Encoding of attachment `i` (how shaders write and read it). */
  encoding(i: number): TargetEncoding {
    return this.formats[i]?.encoding ?? 'none';
  }

  texture(i: number): Texture2D {
    const t = this.attachments[i];
    if (t === undefined) throw new RangeError(`Render-Ziel „${this.label}“ hat keinen Anhang ${i}`);
    return t;
  }

  create(): void {
    const gl = this.gl;
    for (const t of this.attachments) t.create();
    this.fbo = gl.createFramebuffer();
    if (this.fbo === null) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    this.attachments.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t.handle, 0));
    gl.drawBuffers(this.drawBuffers);
    this.check();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Throws `FramebufferIncompleteError` unless the bound framebuffer is complete (ignored while the context is lost). */
  private check(): void {
    const gl = this.gl;
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status === gl.FRAMEBUFFER_COMPLETE || gl.isContextLost()) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    throw new FramebufferIncompleteError(
      this.label,
      framebufferStatusName(gl, status),
      this.formats.map((f) => f.actual),
    );
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    for (const t of this.attachments) t.resize(w, h);
    if (this.fbo === null) return;
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fbo);
    this.check();
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
  }

  /** Binds as draw target with a full viewport. */
  bind(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.w, this.h);
  }

  release(): void {
    if (this.fbo !== null) this.gl.deleteFramebuffer(this.fbo);
    this.fbo = null;
    for (const t of this.attachments) t.release();
  }

  forget(): void {
    this.fbo = null;
    for (const t of this.attachments) t.forget();
  }

  bytes(): number {
    let sum = 0;
    for (const t of this.attachments) sum += t.bytes();
    return sum;
  }
}
