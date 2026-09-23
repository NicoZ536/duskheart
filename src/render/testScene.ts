/**
 * M0-Testszene: beweist die WebGL2-Kette (Kontext, Shader mit #include, Offscreen-Ziel in interner
 * Auflösung, Paletten-Textur, scharfe Präsentation). Wird von der echten Pipeline (M1) abgelöst.
 */
import { PALETTE_HEX } from '../generated/palette';
import { createProgram, type Program } from './gl/program';
import { SHADERS, shader } from './shaderLib';
import { computeViewport, type ScaleMode } from './viewport';

export interface TestSceneStats {
  drawCalls: number;
  frames: number;
}

export class TestScene {
  private scene!: Program;
  private present!: Program;
  private paletteTex!: WebGLTexture;
  private target!: WebGLTexture;
  private fbo!: WebGLFramebuffer;
  private vao!: WebGLVertexArrayObject;
  private targetW = 0;
  private targetH = 0;
  readonly stats: TestSceneStats = { drawCalls: 0, frames: 0 };

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.createResources();
  }

  /** (Re)create every GPU resource – also used after webglcontextrestored. */
  createResources(): void {
    const gl = this.gl;
    this.scene = createProgram(gl, 'testscene', shader('fullscreen.vert'), shader('testscene.frag'), SHADERS);
    this.present = createProgram(gl, 'present', shader('fullscreen.vert'), shader('present.frag'), SHADERS);
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('VAO fehlgeschlagen');
    this.vao = vao;
    const pal = new Uint8Array(64 * 4);
    PALETTE_HEX.forEach((hex, i) => {
      const v = Number.parseInt(hex.slice(1), 16);
      pal[i * 4] = (v >> 16) & 255;
      pal[i * 4 + 1] = (v >> 8) & 255;
      pal[i * 4 + 2] = v & 255;
      pal[i * 4 + 3] = 255;
    });
    this.paletteTex = this.texture(64, 1, pal);
    this.targetW = 0;
  }

  private texture(w: number, h: number, data: Uint8Array | null): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error('Textur fehlgeschlagen');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private ensureTarget(w: number, h: number): void {
    if (w === this.targetW && h === this.targetH) return;
    const gl = this.gl;
    // Release the previous target (resizes would otherwise leak one texture + FBO each).
    if (this.targetW !== 0) {
      gl.deleteFramebuffer(this.fbo);
      gl.deleteTexture(this.target);
    }
    this.target = this.texture(w, h, null);
    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('Framebuffer fehlgeschlagen');
    this.fbo = fbo;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.target, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.targetW = w;
    this.targetH = h;
  }

  /** Draw one frame. `timeSeconds` drives the wandering light (frozen time → identical image). */
  render(canvasW: number, canvasH: number, timeSeconds: number, mode: ScaleMode): void {
    const gl = this.gl;
    const vp = computeViewport(canvasW, canvasH, mode);
    this.ensureTarget(vp.internalWidth, vp.internalHeight);
    this.stats.drawCalls = 0;
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, vp.internalWidth, vp.internalHeight);
    gl.useProgram(this.scene.handle);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.uniform1i(this.scene.uniform('uPalette'), 0);
    gl.uniform2f(this.scene.uniform('uSize'), vp.internalWidth, vp.internalHeight);
    gl.uniform1f(this.scene.uniform('uTime'), timeSeconds);
    const lx = vp.internalWidth * (0.5 + 0.35 * Math.cos(timeSeconds * 0.6));
    const ly = vp.internalHeight * (0.5 + 0.3 * Math.sin(timeSeconds * 0.9));
    gl.uniform2f(this.scene.uniform('uLight'), Math.floor(lx), Math.floor(ly));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.stats.drawCalls++;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasW, canvasH);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(vp.outX, canvasH - vp.outY - vp.outHeight, vp.outWidth, vp.outHeight);
    gl.useProgram(this.present.handle);
    gl.bindTexture(gl.TEXTURE_2D, this.target);
    gl.uniform1i(this.present.uniform('uScene'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.stats.drawCalls++;
    this.stats.frames++;
  }
}
