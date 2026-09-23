/**
 * Presentation scaling (MASTERPROMPT §4.2): integer nearest pre-scale of the visible image into an
 * intermediate target, then linear to the output rectangle ("sharp": square pixels, only the pixel
 * boundaries are blended). In "strikt pixelgenau" the output rectangle is the integer size itself,
 * so the image goes straight to the screen. The camera's subpixel fraction shifts the pre-scale
 * sampling (smooth scrolling in 1/k px steps); bars around the image are black.
 */
import { SCENE_BORDER } from '../camera';
import { RenderTarget } from '../gl/framebuffer';
import type { GpuResourceRegistry } from '../gl/resources';
import type { ShaderLibrary, ShaderProgram } from '../gl/shaders';
import type { Texture2D } from '../gl/texture';
import type { ViewportLayout } from '../viewport';

/** Whether the linear step is needed (output larger than the integer pre-scale). */
export function needsSmoothStep(layout: ViewportLayout): boolean {
  return layout.outWidth !== layout.internalWidth * layout.integerScale || layout.outHeight !== layout.internalHeight * layout.integerScale;
}

/** Horizontal sampling offset of the visible image in the bordered target (px). */
export function presentOffsetX(fracX: number): number {
  return SCENE_BORDER + fracX;
}

/** Vertical sampling offset in GL orientation (y up): the camera fraction moves the image down. */
export function presentOffsetY(fracY: number): number {
  return SCENE_BORDER - fracY;
}

export class Upscaler {
  private readonly prescale: ShaderProgram;
  private readonly smooth: ShaderProgram;
  private readonly intermediate: RenderTarget;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    resources: GpuResourceRegistry,
    shaders: ShaderLibrary,
  ) {
    this.prescale = shaders.program({ name: 'upscale-prescale', vertex: 'fullscreen.vert', fragment: 'upscale_prescale.frag' });
    this.smooth = shaders.program({ name: 'upscale-smooth', vertex: 'fullscreen.vert', fragment: 'upscale_smooth.frag' });
    this.intermediate = resources.add(
      new RenderTarget(gl, { label: 'upscale', width: 1, height: 1, attachments: [{ name: 'color', format: 'RGBA8', filter: 'linear' }], floatTargets: false }),
    );
  }

  /** Draws `source` to the default framebuffer; returns the number of draw calls. */
  present(source: Texture2D, layout: ViewportLayout, fracX: number, fracY: number, canvasWidth: number, canvasHeight: number, drawFullscreen: () => void): number {
    const gl = this.gl;
    const k = layout.integerScale;
    const ox = presentOffsetX(fracX);
    const oy = presentOffsetY(fracY);
    const outX = layout.outX;
    const outY = canvasHeight - layout.outY - layout.outHeight;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasWidth, canvasHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.prescale.use()) return 0;
    source.bind(0);
    gl.uniform1i(this.prescale.uniform('uScene'), 0);
    gl.uniform2f(this.prescale.uniform('uOffset'), ox, oy);
    gl.uniform1f(this.prescale.uniform('uScale'), k);
    if (!needsSmoothStep(layout)) {
      gl.viewport(outX, outY, layout.outWidth, layout.outHeight);
      gl.uniform2f(this.prescale.uniform('uViewport'), outX, outY);
      drawFullscreen();
      return 1;
    }
    this.intermediate.resize(layout.internalWidth * k, layout.internalHeight * k);
    this.intermediate.bind();
    gl.uniform2f(this.prescale.uniform('uViewport'), 0, 0);
    drawFullscreen();
    if (!this.smooth.use()) return 1;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(outX, outY, layout.outWidth, layout.outHeight);
    this.intermediate.texture(0).bind(0);
    gl.uniform1i(this.smooth.uniform('uImage'), 0);
    gl.uniform2f(this.smooth.uniform('uViewport'), outX, outY);
    gl.uniform2f(this.smooth.uniform('uSize'), layout.outWidth, layout.outHeight);
    drawFullscreen();
    return 2;
  }
}
