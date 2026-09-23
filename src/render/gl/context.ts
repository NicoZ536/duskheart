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

export function detectCaps(gl: WebGL2RenderingContext): GlCaps {
  const floatRenderTargets = gl.getExtension('EXT_color_buffer_float') !== null;
  const floatLinear = gl.getExtension('OES_texture_float_linear') !== null;
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
