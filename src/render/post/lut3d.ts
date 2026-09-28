/**
 * RGBA8 3D textures for colour lookup tables (grading LUT, M5-14; corruption palette shift, M5-22) as
 * registry-managed resources: the texel data is retained, so a context restore re-uploads it
 * (MASTERPROMPT §6.3 "`webglcontextlost` sauber behandeln").
 */
import type { GpuResource } from '../gl/resources';
import type { TextureFilter } from '../gl/texture';

const RGBA = 4;

export interface Texture3DOptions {
  readonly label: string;
  /** Texels per axis. */
  readonly size: number;
  readonly filter: TextureFilter;
  /** Initial texels (`size³ · 4` bytes, x fastest); retained for restores. */
  readonly pixels: Uint8Array;
}

export class Texture3D implements GpuResource {
  readonly kind = 'texture';
  readonly label: string;
  readonly size: number;
  readonly filter: TextureFilter;
  private handleValue: WebGLTexture | null = null;
  private pixels: Uint8Array;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    options: Texture3DOptions,
  ) {
    this.label = options.label;
    this.size = Math.max(1, Math.floor(options.size));
    this.filter = options.filter;
    if (options.pixels.length < this.size * this.size * this.size * RGBA) throw new RangeError(`3D-Textur „${options.label}“: zu wenige Texel für ${this.size}³`);
    this.pixels = options.pixels;
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
    gl.bindTexture(gl.TEXTURE_3D, tex);
    const filter = this.filter === 'linear' ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    this.unpackState();
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, this.size, this.size, this.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
    gl.bindTexture(gl.TEXTURE_3D, null);
  }

  /**
   * Unpack state of a raw texel upload: other uploads (images) may leave flip or premultiply switched on,
   * which WebGL refuses for 3D uploads of typed arrays.
   */
  private unpackState(): void {
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  }

  /** Replaces the texels (same size); retained for context restores. */
  setPixels(pixels: Uint8Array): void {
    if (pixels.length < this.bytes()) throw new RangeError(`3D-Textur „${this.label}“: zu wenige Texel für ${this.size}³`);
    this.pixels = pixels;
    const tex = this.handleValue;
    if (tex === null) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_3D, tex);
    this.unpackState();
    gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, this.size, this.size, this.size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindTexture(gl.TEXTURE_3D, null);
  }

  /** Binds to texture unit `unit`. */
  bind(unit: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_3D, this.handleValue);
  }

  release(): void {
    if (this.handleValue !== null) this.gl.deleteTexture(this.handleValue);
    this.handleValue = null;
  }

  forget(): void {
    this.handleValue = null;
  }

  bytes(): number {
    return this.size * this.size * this.size * RGBA;
  }
}
