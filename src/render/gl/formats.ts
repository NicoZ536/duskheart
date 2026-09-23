/**
 * Texture and render-target formats (MASTERPROMPT §6.3 "Ohne Float-Render-Targets: RGBA8-Kodierung
 * als Fallback"). Passes request the format they need; `resolveTargetFormat` picks what the device
 * can render to and names the encoding the shaders must apply (`shaders/hdr.glsl`, ADR-0011).
 */

export type TextureFormat = 'R8' | 'RG8' | 'RGBA8' | 'R16F' | 'RGBA16F';

/**
 * How a render target stores its values:
 * - `none`: the requested format itself.
 * - `hdr-linear`: RGBA16F replaced by RGBA8 holding `value / HDR_FALLBACK_RANGE` (linear, so additive
 *   blending and linear filtering keep working; values above the range clip).
 * - `scalar-rg16`: R16F replaced by RG8 holding `value / range` as 16-bit fixed point (hi byte in R,
 *   lo byte in G; no blending, no filtering).
 */
export type TargetEncoding = 'none' | 'hdr-linear' | 'scalar-rg16';

/** HDR range of the RGBA8 fallback: an encoded 1.0 means a linear value of 4.0. */
export const HDR_FALLBACK_RANGE = 4;

export interface ResolvedFormat {
  readonly requested: TextureFormat;
  readonly actual: TextureFormat;
  readonly encoding: TargetEncoding;
}

/** Float formats need EXT_color_buffer_float to be rendered to. */
export function isFloatFormat(format: TextureFormat): boolean {
  return format === 'R16F' || format === 'RGBA16F';
}

/** The format a render target really gets on a device with (or without) float render targets. */
export function resolveTargetFormat(requested: TextureFormat, floatTargets: boolean): ResolvedFormat {
  if (floatTargets || !isFloatFormat(requested)) return { requested, actual: requested, encoding: 'none' };
  if (requested === 'RGBA16F') return { requested, actual: 'RGBA8', encoding: 'hdr-linear' };
  return { requested, actual: 'RG8', encoding: 'scalar-rg16' };
}

export interface GlFormat {
  readonly internalFormat: number;
  readonly format: number;
  readonly type: number;
  readonly bytesPerPixel: number;
}

/** Bytes per pixel of each format (memory statistics, upload sizes). */
export const BYTES_PER_PIXEL: Readonly<Record<TextureFormat, number>> = {
  R8: 1,
  RG8: 2,
  RGBA8: 4,
  R16F: 2,
  RGBA16F: 8,
};

/** GL enums of a format (read from the context, so no GL constants are duplicated here). */
export function glFormat(gl: WebGL2RenderingContext, format: TextureFormat): GlFormat {
  const bytesPerPixel = BYTES_PER_PIXEL[format];
  switch (format) {
    case 'R8':
      return { internalFormat: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE, bytesPerPixel };
    case 'RG8':
      return { internalFormat: gl.RG8, format: gl.RG, type: gl.UNSIGNED_BYTE, bytesPerPixel };
    case 'RGBA8':
      return { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, bytesPerPixel };
    case 'R16F':
      return { internalFormat: gl.R16F, format: gl.RED, type: gl.HALF_FLOAT, bytesPerPixel };
    case 'RGBA16F':
      return { internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, bytesPerPixel };
  }
}

/** Shader `#define`s describing the target encodings (injected into every program). */
export function encodingDefines(floatTargets: boolean): Readonly<Record<string, string>> {
  return {
    DH_FLOAT_TARGETS: floatTargets ? '1' : '0',
    DH_HDR_FALLBACK_RANGE: HDR_FALLBACK_RANGE.toFixed(1),
  };
}
