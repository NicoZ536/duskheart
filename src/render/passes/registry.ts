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
  /** Interaction texture of the world surface (grass pressure, footprints; M5-17, M5-19), read by the G-buffer. */
  surfaceInteraction: 90,
  gbuffer: 100,
  occluder: 200,
  shadow: 300,
  lighting: 400,
  composite: 500,
  /** Puddles mirror the sky and the lights (world surface, M5-20). */
  surfacePuddles: 520,
  /** Corruption: palette shift and glowing veins of the corrupted area (atmosphere & post, M5-22; post/corruptionPass.ts). */
  corruption: 550,
  water: 600,
  /** GPU particles, weather particles, lightning flash, heat shimmer (M5-11, M5-12, M5-21; passes/particlePass.ts). */
  particles: 650,
  atmosphere: 700,
  /** Distortion field: shock waves, heat, under water (atmosphere & post, M5-13; passes/distortionPass.ts). */
  distortion: 760,
  /** Bloom: bright pass, four levels, glow over the scene (atmosphere & post, M5-13; passes/bloomPass.ts). */
  bloom: 780,
  post: 800,
  resolve: 900,
  outline: 950,
  /** Debug overlays of the world view (chunks, collision, temperature field; M2-29), below the world UI. */
  debugOverlay: 970,
  /** Arms the optional CRT filter of the presentation – draws nothing itself, the world UI stays last (atmosphere & post, M5-16; post/crtPass.ts). */
  crt: 975,
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
  /**
   * Counts the snaps of `camera`: a pass that keeps something derived from it compares the count instead of reading its
   * floats (§30; the renderer snaps again only when the camera or the internal size changed).
   */
  readonly cameraVersion: number;
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
  /** Passes held off (`holdOff`): left out of `ordered` whatever their own `enabled` says. */
  private readonly heldOff = new Set<string>();

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
    if (enabled && this.heldOff.delete(name)) this.resort();
  }

  /**
   * Holds `names` off (the debug flag `passesOff` of a page, `RenderFlags`): they are switched off – a pass another one
   * stands in for hands over as on `setEnabled(name, false)` – and do not run from the next frame on; a setting that
   * switches one on again (fog, bloom) does not bring it back, `setEnabled(name, true)` does. Returns the names that are
   * no registered pass (the caller reports them).
   */
  holdOff(names: readonly string[]): string[] {
    const unknown: string[] = [];
    for (const name of names) {
      const p = this.get(name);
      if (p === undefined) {
        unknown.push(name);
        continue;
      }
      p.enabled = false;
      this.heldOff.add(name);
    }
    this.resort();
    return unknown;
  }

  list(): PassInfo[] {
    return this.entries
      .slice()
      .sort((a, b) => a.order - b.order || a.seq - b.seq)
      .map((e) => ({ name: e.pass.name, order: e.order, enabled: e.pass.enabled && !this.heldOff.has(e.pass.name) }));
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
      .filter((e) => !this.heldOff.has(e.pass.name))
      .sort((a, b) => a.order - b.order || a.seq - b.seq)
      .map((e) => e.pass);
  }
}
