/** 2D textures (atlases, palette LUT, render-target attachments) as registry-managed resources. */
import { BYTES_PER_PIXEL, glFormat, type TextureFormat } from './formats';
import type { GpuResource } from './resources';

export type TextureFilter = 'nearest' | 'linear';
export type TextureWrap = 'clamp' | 'repeat';

/** Pixel data a texture keeps for re-uploading after a context restore. */
export type TexturePixels = Uint8Array | Uint16Array | Float32Array;

export interface Texture2DOptions {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly format: TextureFormat;
  readonly filter?: TextureFilter;
  readonly wrap?: TextureWrap;
  /** Initial pixels (tightly packed rows; the first row becomes texel row 0). Retained for restores. */
  readonly pixels?: TexturePixels | null;
  /** Initial image (decoded atlas PNG). Retained for restores. */
  readonly image?: TexImageSource | null;
}

export class Texture2D implements GpuResource {
  readonly kind = 'texture';
  readonly label: string;
  readonly format: TextureFormat;
  readonly filter: TextureFilter;
  readonly wrap: TextureWrap;
  private handleValue: WebGLTexture | null = null;
  private w: number;
  private h: number;
  private pixels: TexturePixels | null;
  private image: TexImageSource | null;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    options: Texture2DOptions,
  ) {
    this.label = options.label;
    this.format = options.format;
    this.filter = options.filter ?? 'nearest';
    this.wrap = options.wrap ?? 'clamp';
    this.w = Math.max(1, Math.floor(options.width));
    this.h = Math.max(1, Math.floor(options.height));
    this.pixels = options.pixels ?? null;
    this.image = options.image ?? null;
  }

  get width(): number {
    return this.w;
  }

  get height(): number {
    return this.h;
  }

  /** The GL texture, `null` while the context is lost. */
  get handle(): WebGLTexture | null {
    return this.handleValue;
  }

  create(): void {
    const gl = this.gl;
    const tex = gl.createTexture();
    this.handleValue = tex;
    if (tex === null) return;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const filter = this.filter === 'linear' ? gl.LINEAR : gl.NEAREST;
    const wrap = this.wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    this.allocate();
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /** Allocates storage and uploads the retained data (texture bound to TEXTURE_2D). */
  private allocate(): void {
    const gl = this.gl;
    const f = glFormat(gl, this.format);
    // Palette indices and material bits live in colour channels: never premultiply or colour-convert.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    if (this.image !== null) gl.texImage2D(gl.TEXTURE_2D, 0, f.internalFormat, f.format, f.type, this.image);
    else gl.texImage2D(gl.TEXTURE_2D, 0, f.internalFormat, this.w, this.h, 0, f.format, f.type, this.pixels);
  }

  /** Changes the size; the content is undefined afterwards (render targets redraw every frame). */
  resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.pixels = null;
    this.image = null;
    if (this.handleValue === null) return;
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.handleValue);
    this.allocate();
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
  }

  /** Replaces the whole content (size must match); the data is retained for context restores. */
  setPixels(pixels: TexturePixels): void {
    this.pixels = pixels;
    this.image = null;
    if (this.handleValue === null) return;
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.handleValue);
    this.allocate();
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
  }

  /** Binds to texture unit `unit`. */
  bind(unit: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.handleValue);
  }

  release(): void {
    if (this.handleValue !== null) this.gl.deleteTexture(this.handleValue);
    this.handleValue = null;
  }

  forget(): void {
    this.handleValue = null;
  }

  bytes(): number {
    return this.w * this.h * BYTES_PER_PIXEL[this.format];
  }
}
