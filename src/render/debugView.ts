/**
 * Render debugger (MASTERPROMPT §6.3, docs/RENDER.md §3): shows one buffer instead of the final
 * image – `__dh.call('renderDebug', 'albedo' | 'normal' | 'height' | 'emissive' | … | 'off')`.
 * The renderer registers the G-buffer and HDR views; later passes register theirs (`sdf`, `sun`,
 * `light`, `gi`, `fog`, `lightmap`) with `DebugViews.register`.
 */
import { RenderTarget } from './gl/framebuffer';
import type { GpuResourceRegistry } from './gl/resources';
import type { ShaderLibrary, ShaderProgram } from './gl/shaders';
import type { Texture2D } from './gl/texture';

/** How a buffer is turned into colours (`debug_view.frag`). */
export const DEBUG_VIEW_MODES = ['rgb', 'normal', 'blue', 'alpha', 'red', 'green', 'material', 'emissive', 'hdr', 'scalar', 'mask'] as const;
export type DebugViewMode = (typeof DEBUG_VIEW_MODES)[number];

export interface DebugView {
  readonly name: string;
  readonly mode: DebugViewMode;
  /** The texture to show (looked up each frame; targets are resized and restored). */
  source(): Texture2D | null;
  /** Range of `scalar` views (value shown as white), bit of `mask` views. */
  readonly scale?: number;
}

/** Name that switches the debugger off. */
export const DEBUG_VIEW_OFF = 'off';

export class DebugViews {
  private readonly views = new Map<string, DebugView>();

  register(view: DebugView): void {
    if (view.name === DEBUG_VIEW_OFF) throw new Error(`Debug-Ansicht darf nicht „${DEBUG_VIEW_OFF}“ heißen`);
    if (this.views.has(view.name)) throw new Error(`Debug-Ansicht ${view.name} ist schon registriert`);
    this.views.set(view.name, view);
  }

  unregister(name: string): void {
    this.views.delete(name);
  }

  get(name: string): DebugView | undefined {
    return this.views.get(name);
  }

  names(): string[] {
    return [...this.views.keys(), DEBUG_VIEW_OFF];
  }
}

/** Draws the selected view into its own RGBA8 target (same size as the final image). */
export class DebugViewRenderer {
  private readonly program: ShaderProgram;
  private readonly target: RenderTarget;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    resources: GpuResourceRegistry,
    shaders: ShaderLibrary,
  ) {
    this.program = shaders.program({ name: 'debug-view', vertex: 'fullscreen.vert', fragment: 'debug_view.frag' });
    this.target = resources.add(new RenderTarget(gl, { label: 'debug-view', width: 1, height: 1, attachments: [{ name: 'color', format: 'RGBA8' }], floatTargets: false }));
  }

  /** Renders `view` (at `width`×`height`); returns the texture to present, or null if it cannot be shown. */
  render(view: DebugView, albedo: Texture2D, width: number, height: number, drawFullscreen: () => void): Texture2D | null {
    const source = view.source();
    if (source === null || !this.program.use()) return null;
    const gl = this.gl;
    this.target.resize(width, height);
    this.target.bind();
    source.bind(0);
    albedo.bind(1);
    gl.uniform1i(this.program.uniform('uSource'), 0);
    gl.uniform1i(this.program.uniform('uAlbedo'), 1);
    gl.uniform1i(this.program.uniform('uMode'), DEBUG_VIEW_MODES.indexOf(view.mode));
    gl.uniform1f(this.program.uniform('uScale'), view.scale ?? 1);
    drawFullscreen();
    return this.target.texture(0);
  }
}
