/** WebGL2 context creation and capability detection (MASTERPROMPT §6.3 Robustheit). */

export interface GlCaps {
  /** EXT_color_buffer_float: RGBA16F/R16F render targets. Without it the RGBA8 encoding fallback is used. */
  floatRenderTargets: boolean;
  /** OES_texture_float_linear: linear filtering of float textures. */
  floatLinear: boolean;
  maxDrawBuffers: number;
  maxTextureSize: number;
  renderer: string;
}

export type GlContextResult = { ok: true; gl: WebGL2RenderingContext; caps: GlCaps } | { ok: false; reason: 'no-webgl2' };

/** The part of a canvas needed to create the context (a fake in unit tests). */
export interface GlCanvas {
  getContext(contextId: 'webgl2', options?: WebGLContextAttributes): WebGL2RenderingContext | null;
}

/**
 * Creates the WebGL2 context. Never throws: a browser without WebGL2 (or with a blocked GPU, where
 * some browsers throw instead of returning `null`) yields `{ ok: false }`, and the caller shows the
 * explanation screen (§6.3 "verständliche Meldung").
 */
export function createGlContext(canvas: GlCanvas): GlContextResult {
  let gl: WebGL2RenderingContext | null;
  try {
    gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
  } catch {
    gl = null;
  }
  if (!gl) return { ok: false, reason: 'no-webgl2' };
  return { ok: true, gl, caps: detectCaps(gl) };
}

/** Extensions the renderer uses when present (float render targets, linear float filtering). */
export const OPTIONAL_EXTENSIONS = ['EXT_color_buffer_float', 'OES_texture_float_linear'] as const;

/**
 * Enables the optional extensions; returns which are available. Must run again after
 * `webglcontextrestored`: a restored context starts without any enabled extension.
 */
export function enableExtensions(gl: WebGL2RenderingContext): Record<(typeof OPTIONAL_EXTENSIONS)[number], boolean> {
  return {
    EXT_color_buffer_float: gl.getExtension('EXT_color_buffer_float') !== null,
    OES_texture_float_linear: gl.getExtension('OES_texture_float_linear') !== null,
  };
}

export function detectCaps(gl: WebGL2RenderingContext): GlCaps {
  const ext = enableExtensions(gl);
  const floatRenderTargets = ext.EXT_color_buffer_float;
  const floatLinear = ext.OES_texture_float_linear;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  return {
    floatRenderTargets,
    floatLinear,
    maxDrawBuffers: Number(gl.getParameter(gl.MAX_DRAW_BUFFERS)),
    maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
    renderer,
  };
}

/**
 * Registers context loss handling: prevents default on loss (so the browser may restore),
 * calls `onLost` and, after restoration, `onRestored` so the owner rebuilds every GPU resource.
 */
export function watchContextLoss(canvas: HTMLCanvasElement, onLost: () => void, onRestored: () => void): () => void {
  const lost = (e: Event): void => {
    e.preventDefault();
    onLost();
  };
  const restored = (): void => onRestored();
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);
  return () => {
    canvas.removeEventListener('webglcontextlost', lost);
    canvas.removeEventListener('webglcontextrestored', restored);
  };
}

/** Renderer switches from the page URL (debug and tests). */
export interface RenderFlags {
  /** `?forceRgba8=1`: behave as if float render targets were missing (tests the RGBA8 fallback). */
  readonly forceRgba8: boolean;
}

/** Parses the renderer flags from a query string such as `location.search`. */
export function parseRenderFlags(search: string): RenderFlags {
  const params = new URLSearchParams(search);
  const v = params.get('forceRgba8');
  return { forceRgba8: v === '1' || v === 'true' };
}

/** What the render targets of this device use (float or the RGBA8 encoding fallback). */
export interface TargetCaps {
  readonly floatTargets: boolean;
  /** True when float targets exist but `forceRgba8` switched them off. */
  readonly forcedRgba8: boolean;
  readonly maxDrawBuffers: number;
}

/** Number of colour attachments the G-buffer writes at once (G0, G1, G2). */
export const REQUIRED_DRAW_BUFFERS = 3;

export function resolveTargetCaps(caps: Pick<GlCaps, 'floatRenderTargets' | 'maxDrawBuffers'>, flags: RenderFlags): TargetCaps {
  if (caps.maxDrawBuffers < REQUIRED_DRAW_BUFFERS) {
    throw new Error(`WebGL2 meldet nur ${caps.maxDrawBuffers} Zeichenpuffer, der G-Buffer braucht ${REQUIRED_DRAW_BUFFERS}`);
  }
  return {
    floatTargets: caps.floatRenderTargets && !flags.forceRgba8,
    forcedRgba8: caps.floatRenderTargets && flags.forceRgba8,
    maxDrawBuffers: caps.maxDrawBuffers,
  };
}
