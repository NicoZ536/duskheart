/**
 * M0 test scene on the M1 pipeline (scenario `testszene`): the palette ramps under a wandering warm
 * light with banding and Bayer dither, drawn by a pass into the HDR target (so it also exercises the
 * RGBA8 fallback) and presented with the sharp upscaler. Looks exactly like the M0 scene.
 */
import type { ShaderProgram } from '../gl/shaders';
import { PASS_ORDER, type FrameSize, type PassSetup, type RenderContext, type RenderPass } from '../passes/registry';
import type { Renderer } from '../renderer';
import type { RenderScene } from '../scene';
import type { SceneSource } from './sceneSource';

/** Wandering light: centre ± amplitude (fraction of the view) at angular speeds in rad/s. */
const LIGHT_CENTER = 0.5;
const LIGHT_AMP_X = 0.35;
const LIGHT_AMP_Y = 0.3;
const LIGHT_SPEED_X = 0.6;
const LIGHT_SPEED_Y = 0.9;

/** Light centre x in view px at time `t` for a view `w` px wide. */
export function testSceneLightX(w: number, t: number): number {
  return Math.floor(w * (LIGHT_CENTER + LIGHT_AMP_X * Math.cos(t * LIGHT_SPEED_X)));
}

/** Light centre y in view px (y up) at time `t` for a view `h` px high. */
export function testSceneLightY(h: number, t: number): number {
  return Math.floor(h * (LIGHT_CENTER + LIGHT_AMP_Y * Math.sin(t * LIGHT_SPEED_Y)));
}

export class TestScenePass implements RenderPass {
  readonly name = 'testszene';
  enabled = true;
  private program: ShaderProgram | null = null;

  init(setup: PassSetup): void {
    this.program = setup.shaders.program({ name: 'testszene', vertex: 'fullscreen.vert', fragment: 'testszene.frag' });
  }

  resize(_size: FrameSize): void {
    // Draws into the renderer's HDR target.
  }

  dispose(setup: PassSetup): void {
    if (this.program) setup.shaders.release(this.program);
    this.program = null;
  }

  execute(ctx: RenderContext): void {
    const p = this.program;
    if (p === null || !p.use()) return;
    const gl = ctx.gl;
    const f = ctx.frame;
    ctx.targets.hdr.bind();
    ctx.palette.texture.bind(0);
    gl.uniform1i(p.uniform('uPaletteLut'), 0);
    gl.uniform2f(p.uniform('uSize'), f.viewWidth, f.viewHeight);
    gl.uniform2f(p.uniform('uLight'), testSceneLightX(f.viewWidth, f.time), testSceneLightY(f.viewHeight, f.time));
    ctx.drawFullscreen();
  }
}

export class TestSceneSource implements SceneSource {
  readonly id = 'testszene';
  private readonly pass = new TestScenePass();
  /** State of the unlit pass before this scene took over the HDR target. */
  private unlitWasEnabled = true;

  activate(renderer: Renderer): void {
    this.unlitWasEnabled = renderer.passes.get('unlit')?.enabled ?? true;
    renderer.passes.setEnabled('unlit', false);
    if (!renderer.passes.get(this.pass.name)) renderer.passes.add(this.pass, PASS_ORDER.composite);
  }

  deactivate(renderer: Renderer): void {
    renderer.passes.remove(this.pass.name);
    renderer.passes.setEnabled('unlit', this.unlitWasEnabled);
  }

  fill(scene: RenderScene, _time: number): void {
    scene.atlas = null;
    scene.camera.set(0, 0).unfollow();
  }
}
