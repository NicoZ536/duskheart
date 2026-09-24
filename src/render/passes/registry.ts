/**
 * Render pass registry (MASTERPROMPT §6.1). The renderer runs the enabled passes in order between
 * the G-buffer and the presentation; later passes (occluder/SDF, shadows, light, composition,
 * water, atmosphere, post) register here with an order from `PASS_ORDER`.
 *
 * Contract: a pass creates its GPU resources in `init` through `setup.resources` /
 * `setup.shaders` (so they survive a context loss), reacts to size changes in `resize`, and draws in
 * `execute`. The HDR target (`ctx.targets.hdr`) holds the lit scene – written with `encodeHdr`
 * (`shaders/hdr.glsl`) because it may be an RGBA8 fallback –, `ctx.targets.ldr` the final colours
 * that the presentation scales to the screen.
 */
import type { SpriteBatcher } from '../batch/spriteBatcher';
import type { CameraSnap } from '../camera';
import type { AtlasTextures } from '../assets/atlas';
import type { TargetCaps } from '../gl/context';
import type { RenderTarget } from '../gl/framebuffer';
import type { GpuResourceRegistry } from '../gl/resources';
import type { ShaderLibrary } from '../gl/shaders';
import type { PaletteLut } from '../palette/lut';
import type { DebugViews } from '../debugView';
import type { RenderScene } from '../scene';

/** Order of the §6.1 passes (gaps leave room for passes in between). */
export const PASS_ORDER = {
  gbuffer: 100,
  occluder: 200,
  shadow: 300,
  lighting: 400,
  composite: 500,
  water: 600,
  atmosphere: 700,
  post: 800,
  resolve: 900,
  outline: 950,
  /** Debug overlays of the world view (chunks, collision, temperature field; M2-29), below the world UI. */
  debugOverlay: 970,
  /** World-near UI (names, bars, damage numbers, markers) on top of the final image (M1-23). */
  worldUi: 980,
} as const;

/** Sizes of the internal targets. */
export interface FrameSize {
  /** Target size including the 1 px border. */
  readonly width: number;
  readonly height: number;
  /** Visible image (internal resolution). */
  readonly viewWidth: number;
  readonly viewHeight: number;
}

export interface FrameInfo extends FrameSize {
  readonly camera: CameraSnap;
  /** Presentation time in seconds. */
  readonly time: number;
  /** Frames rendered so far. */
  readonly index: number;
}

export interface FrameTargets {
  /** G0 albedo, G1 normal/height/material, G2 emissive/gloss/wet/water (gbuffer.ts). */
  readonly gbuffer: RenderTarget;
  /** Lit scene: RGBA16F or its RGBA8 encoding (`encodeHdr`). */
  readonly hdr: RenderTarget;
  /** Final colours (RGBA8), input of the presentation. */
  readonly ldr: RenderTarget;
}

export interface RenderStats {
  frames: number;
  drawCalls: number;
  /** Draw calls of the sprite batcher alone. */
  spriteDrawCalls: number;
  sprites: number;
  lights: number;
  particles: number;
  contextLosses: number;
  contextRestores: number;
}

export function emptyRenderStats(): RenderStats {
  return { frames: 0, drawCalls: 0, spriteDrawCalls: 0, sprites: 0, lights: 0, particles: 0, contextLosses: 0, contextRestores: 0 };
}

/** What passes get once, to create their resources. */
export interface PassSetup {
  readonly gl: WebGL2RenderingContext;
  readonly resources: GpuResourceRegistry;
  readonly shaders: ShaderLibrary;
  readonly caps: TargetCaps;
  readonly debugViews: DebugViews;
}

export interface RenderContext {
  readonly gl: WebGL2RenderingContext;
  readonly frame: FrameInfo;
  readonly scene: RenderScene;
  readonly targets: FrameTargets;
  readonly caps: TargetCaps;
  readonly palette: PaletteLut;
  /** Textures of `scene.atlas` (null when the scene has none). */
  readonly atlas: AtlasTextures | null;
  /** The frame's sprites, sorted and uploaded (occluder/shadow passes may draw them again). */
  readonly sprites: SpriteBatcher;
  readonly stats: RenderStats;
  /** Draws a fullscreen triangle into the bound target (counts as a draw call). */
  drawFullscreen(): void;
}

export interface RenderPass {
  readonly name: string;
  enabled: boolean;
  init?(setup: PassSetup): void;
  resize(size: FrameSize): void;
  execute(ctx: RenderContext): void;
  dispose?(setup: PassSetup): void;
}

export interface PassInfo {
  readonly name: string;
  readonly order: number;
  readonly enabled: boolean;
}

interface Entry {
  readonly pass: RenderPass;
  readonly order: number;
  readonly seq: number;
}

export class PassRegistry {
  private readonly entries: Entry[] = [];
  private sorted: RenderPass[] = [];
  private seq = 0;
  private size: FrameSize | null = null;

  constructor(private readonly setup: PassSetup) {}

  /** Adds a pass at `order` (equal orders run in registration order), initialises and sizes it. */
  add(pass: RenderPass, order: number): void {
    if (this.entries.some((e) => e.pass.name === pass.name)) throw new Error(`Render-Pass ${pass.name} ist schon registriert`);
    pass.init?.(this.setup);
    if (this.size) pass.resize(this.size);
    this.entries.push({ pass, order, seq: this.seq++ });
    this.resort();
  }

  remove(name: string): boolean {
    const i = this.entries.findIndex((e) => e.pass.name === name);
    if (i < 0) return false;
    const [e] = this.entries.splice(i, 1);
    e?.pass.dispose?.(this.setup);
    this.resort();
    return true;
  }

  get(name: string): RenderPass | undefined {
    return this.entries.find((e) => e.pass.name === name)?.pass;
  }

  setEnabled(name: string, enabled: boolean): void {
    const p = this.get(name);
    if (!p) throw new Error(`Render-Pass ${name} gibt es nicht (vorhanden: ${this.list().map((i) => i.name).join(', ')})`);
    p.enabled = enabled;
  }

  list(): PassInfo[] {
    return this.entries
      .slice()
      .sort((a, b) => a.order - b.order || a.seq - b.seq)
      .map((e) => ({ name: e.pass.name, order: e.order, enabled: e.pass.enabled }));
  }

  /** Passes in execution order (cached; no allocation per frame). */
  ordered(): readonly RenderPass[] {
    return this.sorted;
  }

  resize(size: FrameSize): void {
    this.size = size;
    for (const e of this.entries) e.pass.resize(size);
  }

  private resort(): void {
    this.sorted = this.entries
      .slice()
      .sort((a, b) => a.order - b.order || a.seq - b.seq)
      .map((e) => e.pass);
  }
}
