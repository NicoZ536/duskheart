/**
 * Optional CRT filter (MASTERPROMPT §6.1 pass 10 "Präsentation: scharfes Hochskalieren + Subpixel-Offset;
 * optionaler CRT-Filter (standardmäßig aus)", §29 "Grafik: … CRT"; M5-16). The presentation is the fixed
 * last step of the renderer (the upscaler, ADR-0011), not a registry pass – this pass only owns the CRT
 * program (created through the pass setup, restored after a context loss) and is the upscaler's final
 * step (`PresentationFinish`): in a frame it armed the upscaler hands it the integer pre-scaled picture
 * instead of drawing the linear step (crt.frag). Armed by the setting `graphics.crt` (default off) or the
 * debug pin `PostOverrides.crt`; switching the pass off in the debugger keeps the plain upscaling.
 */
import type { ShaderProgram } from '../gl/shaders';
import type { Texture2D } from '../gl/texture';
import type { PresentationFinish } from '../output/upscaler';
import type { FrameSize, PassSetup, RenderContext, RenderPass } from '../passes/registry';
import type { ViewportLayout } from '../viewport';
import { DEFAULT_ATMOSPHERE_POST_SETTINGS, type AtmospherePostSettings } from './settings';

/**
 * CRT look: screen curvature (barrel strength at the corners), scanline depth at a row's seam, aperture
 * grille strength, corner rounding (share of the short side) and darkening, gain that restores the
 * brightness the scanlines and the grille take.
 */
export const CRT = { curve: 0.035, scanline: 0.42, mask: 0.12, corner: 0.025, vignette: 0.28, gain: 1.22 } as const;

function glslFloat(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}

/** `#define`s of the CRT program. */
export function crtDefines(): Readonly<Record<string, string>> {
  return {
    DH_CRT_CURVE: glslFloat(CRT.curve),
    DH_CRT_SCANLINE: glslFloat(CRT.scanline),
    DH_CRT_MASK: glslFloat(CRT.mask),
    DH_CRT_CORNER: glslFloat(CRT.corner),
    DH_CRT_VIGNETTE: glslFloat(CRT.vignette),
    DH_CRT_GAIN: glslFloat(CRT.gain),
  };
}

/** Where output point uv (0…1) reads the picture on the curved screen (mirror of `crtCurve` in crt.frag). */
export function crtCurve(u: number, v: number, out: [number, number]): [number, number] {
  const x = u * 2 - 1;
  const y = v * 2 - 1;
  const k = 1 + (x * x + y * y) * CRT.curve;
  out[0] = x * k * 0.5 + 0.5;
  out[1] = y * k * 0.5 + 0.5;
  return out;
}

/** Brightness of a scanline at `rowFraction` (0…1 across an internal row; mirror of `crtScanline`). */
export function crtScanline(rowFraction: number): number {
  const s = Math.sin(Math.PI * rowFraction);
  return 1 - CRT.scanline * (1 - s * s);
}

export class CrtPass implements RenderPass, PresentationFinish {
  readonly name = 'crt';
  /** Runs every frame to arm the filter; switching it off in the debugger keeps the plain upscaling. */
  enabled = true;
  /** The setting `graphics.crt` (default off). */
  setting = DEFAULT_ATMOSPHERE_POST_SETTINGS.crt;
  private gl: WebGL2RenderingContext | null = null;
  private program: ShaderProgram | null = null;
  /** Armed by `execute` for the frame being rendered, consumed by the presentation. */
  private armed = false;
  /** Frames presented through the CRT (statistics, tests). */
  drawn = 0;

  configure(settings: AtmospherePostSettings): void {
    this.setting = settings.crt;
  }

  /** Whether the presentation of this frame draws the CRT. */
  get active(): boolean {
    return this.armed && this.program !== null;
  }

  init(setup: PassSetup): void {
    this.gl = setup.gl;
    this.program = setup.shaders.program({ name: 'crt', vertex: 'fullscreen.vert', fragment: 'crt.frag', defines: crtDefines() });
  }

  resize(_size: FrameSize): void {
    // Draws into the canvas at the presentation's size.
  }

  /** Arms the filter for this frame: the setting, or the scene's debug pin (`PostOverrides.crt`). */
  execute(ctx: RenderContext): void {
    this.armed = ctx.scene.post.overrides.crt ?? this.setting;
  }

  draw(image: Texture2D, layout: ViewportLayout, outX: number, outY: number, drawFullscreen: () => void): boolean {
    this.armed = false;
    const gl = this.gl;
    const p = this.program;
    if (gl === null || p === null || !p.use()) return false;
    image.bind(0);
    gl.uniform1i(p.uniform('uImage'), 0);
    gl.uniform2f(p.uniform('uViewport'), outX, outY);
    gl.uniform2f(p.uniform('uSize'), layout.outWidth, layout.outHeight);
    gl.uniform1f(p.uniform('uRows'), layout.internalHeight);
    drawFullscreen();
    this.drawn++;
    return true;
  }

  dispose(setup: PassSetup): void {
    if (this.program !== null) setup.shaders.release(this.program);
    this.program = null;
    this.gl = null;
    this.armed = false;
  }
}
