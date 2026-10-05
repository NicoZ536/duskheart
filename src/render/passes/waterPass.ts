/**
 * Water pass (MASTERPROMPT §6.1 pass 7, M5-07 … M5-09, the mirror part of M5-23; `PASS_ORDER.water`, after the
 * composition): the water of the lit scene – refraction of the ground, depth colouring, shore foam over the water's
 * distance field, caustics in the shallows, the mirror of sky, moon, stars and of what stands above the shoreline,
 * the immersion mask of figures, interactive waves and winter ice (shader: `water_surface.frag`, parameters:
 * `water/params.ts`).
 *
 * - **Waves:** the wave equation on a world-anchored grid of `WAVES.texelPx` px around the camera, two RGBA8 fields
 *   ping-pong (`water_wave.frag`), stepped at `WAVES.stepHz` on the presentation clock (the same waves at every
 *   frame rate; a frozen clock freezes them). The grid follows the camera in whole texels. Impulses of the frame
 *   (`scene.water.impulse…`) wait for the next step.
 * - **Surface:** the HDR target is copied (blit), then the water pixels, the ice and the submerged parts of figures
 *   are drawn back into it from the copy; every other pixel is left as it is.
 * - **Drift:** the caustics' two layers and the small waves' three trains move by offsets integrated over the
 *   presentation clock and kept modulo their lattice or `AMBIENT_WAVES.travelWaves` wavelengths (`world/drift.ts`) –
 *   reduced motion slows them without a jump; the caustics' cell wobble, the surf and the waterline's wobble run on the
 *   motion clock (presentation time × the motion scale, integrated), the sparkle, twinkle and churn on the flicker clock
 *   (× the flicker rate of the settings: flash reduction). In a still picture whose world moved on (the scene's
 *   `water.stepKey` changed while the clock stood) they show velocity × time under the wind they end with, like the
 *   clouds and the fog (M5-43).
 * - **Sunlight on the water:** the directed light's share of the daylight and the daylight's brightness go to the
 *   shader, which reads how much sun reaches a water pixel from the light the composition gave it (sun glitter only in
 *   the sun, not in the shadow of a tree or a cloud).
 * - **Distance field:** the occluder pass's water field (light strand, M5-01) when it ran this frame; without it
 *   the shader searches the G-buffer for the nearest shore.
 * - Nothing runs in a frame that cannot show water (`frameMayShowWater`): a tile grid without water, ice or figure in
 *   water and no sprite on the water layer – or, in a scene without the tile grid, no such sprite and a ground that
 *   draws no water (the M1 tile map).
 *
 * Every GPU object is created through the setup (context loss restores it; the waves start calm again). Render
 * debugger: `wellen` (the wave field). Settings (§6.3): `water/settings.ts`.
 */
import { SampledClock } from '../sampledClock';
import { AMBIENT_R, frameAmbient } from '../light/frameAmbient';
import { GBUFFER_ALBEDO, GBUFFER_EMISSIVE, GBUFFER_NORMAL } from '../gbuffer';
import { RenderTarget } from '../gl/framebuffer';
import type { GpuResourceRegistry } from '../gl/resources';
import type { ShaderProgram } from '../gl/shaders';
import { Texture2D } from '../gl/texture';
import { waterShaderDefines } from '../water/defines';
import { AMBIENT_WAVES, CAUSTICS, FLICKER_CLOCK, MAX_IMMERSIONS, MAX_IMPULSES, MOTION_CLOCK, WATER_FRAME_VEC4S, WAVES } from '../water/params';
import { DEFAULT_WATER_SETTINGS, type WaterRenderSettings } from '../water/settings';
import { WATER_GRID_H, WATER_GRID_W, type WaterState } from '../water/state';
import { bitsChanged } from '../uniformBits';
import type { DirectionalRecord } from '../light/sky';
import { packHeight, waveFieldOrigin, waveFieldTexels, waveSteps } from '../water/waves';
import { frameMayShowWater } from '../water/presence';
import { DriftOffset, driftClock } from '../world/drift';
import type { FrameSize, PassSetup, RenderContext, RenderPass } from './registry';

/** Render-debugger view of the wave field. */
export const WATER_DEBUG_VIEW = 'wellen';

/** What the water pass needs of the occluder pass (its water distance field, M5-01). */
export interface WaterShoreSource {
  ranInFrame(frameIndex: number): boolean;
  waterTexture(): Texture2D | null;
  /** Sets `uSdfFrame` of `program` (the field's placement in the world). */
  bindFrame(gl: WebGL2RenderingContext, program: ShaderProgram): void;
}

/** What the pass did in its last frame (tests, `__dh.call('renderInfo')`-style diagnostics). */
export interface WaterPassStats {
  /** Whether the surface was drawn. */
  drawn: boolean;
  /** Wave steps of the frame and impulses applied. */
  steps: number;
  impulses: number;
  /** Whether the occluder pass's distance field was used. */
  shoreField: boolean;
  /** CPU time of the pass (impulses, uploads, wave steps and the surface dispatched) [ms]; GPU time per timer query where available (M5-30). */
  prepMs: number;
}

const VEC4 = 4;
/**
 * Float offsets in the surface shader's frame array `uFrame` (one upload per frame instead of two dozen uniform
 * calls; the shader names them with macros, water_surface.frag).
 */
export const WATER_FRAME = {
  origin: 0,
  targetSize: 2,
  viewSize: 4,
  /** The motion clock [1/DRIFT_UNITS s]: presentation time × the motion scale of the settings, integrated. */
  motionTime: 6,
  motion: 7,
  wind: 8,
  shoreIce: 11,
  fieldFrame: 12,
  tileFrame: 16,
  waves: 20,
  tilesKnown: 21,
  hasShore: 22,
  refraction: 23,
  reflection: 24,
  caustics: 25,
  immerseCount: 26,
  /** The flicker clock [1/DRIFT_UNITS s]: presentation time at the settings' flicker rate. */
  flickerTime: 27,
  /** Offsets of the caustics' two layers [1/DRIFT_UNITS world px]. */
  causticA: 28,
  causticB: 30,
  /** How far each of the three ambient wave trains has travelled [1/DRIFT_UNITS px, within half its travel period of 0]. */
  travel: 32,
  /** Share of the daylight that comes from the sun (0: none shines); the daylight itself goes as `uDaylight`. */
  sunShare: 35,
} as const;
/** Period of the caustics' first and second layer [px]: their Voronoi lattice repeats after `CAUSTICS.periodCells` cells. */
const CAUSTIC_PERIOD_A = CAUSTICS.cellPx * CAUSTICS.periodCells;
const CAUSTIC_PERIOD_B = CAUSTICS.cellPx * CAUSTICS.layerScale * CAUSTICS.periodCells;
/** Travel period of each ambient train [px]: `AMBIENT_WAVES.travelWaves` of its wavelengths (M5-42). */
export const TRAVEL_PERIODS: readonly [number, number, number] = [
  AMBIENT_WAVES.wavelengthsPx[0] * AMBIENT_WAVES.travelWaves,
  AMBIENT_WAVES.wavelengthsPx[1] * AMBIENT_WAVES.travelWaves,
  AMBIENT_WAVES.wavelengthsPx[2] * AMBIENT_WAVES.travelWaves,
];
const RGBA = 4;
const UNIT = { scene: 0, albedo: 1, normal: 2, surface: 3, field: 4, tiles: 5, shore: 6, atlas: 7, palette: 8 } as const;
const BYTE_MAX = 255;
/** Clear value of a field: height and previous height 0 (`packHeight(0)`). */
const CALM: readonly number[] = ((): number[] => {
  const [hi, lo] = packHeight(0);
  return [hi / BYTE_MAX, lo / BYTE_MAX, hi / BYTE_MAX, lo / BYTE_MAX];
})();

export class WaterPass implements RenderPass {
  readonly name = 'water';
  enabled = true;
  settings: WaterRenderSettings = DEFAULT_WATER_SETTINGS;
  readonly stats: WaterPassStats = { drawn: false, steps: 0, impulses: 0, shoreField: false, prepMs: 0 };
  private copy: RenderTarget | null = null;
  private fields: readonly [RenderTarget, RenderTarget] | null = null;
  private debug: RenderTarget | null = null;
  private tiles: Texture2D | null = null;
  private waveProgram: ShaderProgram | null = null;
  private surfaceProgram: ShaderProgram | null = null;
  private debugProgram: ShaderProgram | null = null;
  private current = 0;
  private fieldW = 1;
  private fieldH = 1;
  private fieldX = 0;
  private fieldY = 0;
  private fieldValid = false;
  private simTime = 0;
  private tileVersion = -1;
  private tileKnown = false;
  private debugWanted = false;
  /** The registry of the resources and how often it was rebuilt: after a context loss the fields hold nothing. */
  private resources: GpuResourceRegistry | null = null;
  private restores = 0;
  private readonly clock = { steps: 0, simTime: 0 };
  /** CPU time of `execute` (sampled, `stats.prepMs`). */
  private readonly prepClock = new SampledClock();
  /** Build of the surface program whose sampler units are set. */
  private samplersAt = -1;
  private readonly origin = { x: 0, y: 0 };
  private readonly pendingX = new Float32Array(MAX_IMPULSES);
  private readonly pendingY = new Float32Array(MAX_IMPULSES);
  private readonly pendingS = new Float32Array(MAX_IMPULSES);
  private readonly pendingR = new Float32Array(MAX_IMPULSES);
  private pending = 0;
  private readonly impulseData = new Float32Array(MAX_IMPULSES * VEC4);
  private readonly frameData = new Float32Array(WATER_FRAME_VEC4S * VEC4);
  /** The wave and debug shaders' frame pair: field placement, tile grid. */
  private readonly fieldFrames = new Float32Array(2 * VEC4);
  private readonly immerseA = new Float32Array(MAX_IMMERSIONS * VEC4);
  private readonly immerseB = new Float32Array(MAX_IMMERSIONS * VEC4);
  private readonly immerseC = new Float32Array(MAX_IMMERSIONS * VEC4);
  private readonly immerseD = new Float32Array(MAX_IMMERSIONS * VEC4);
  /** The caustics' layers, the ambient trains' travel and the flicker clock (`world/drift.ts`). */
  private readonly causticA = new DriftOffset(CAUSTIC_PERIOD_A, CAUSTIC_PERIOD_A, CAUSTICS.driftPxPerSecond);
  private readonly causticB = new DriftOffset(CAUSTIC_PERIOD_B, CAUSTIC_PERIOD_B, CAUSTICS.driftPxPerSecond * CAUSTICS.layerDrift);
  private readonly travel: readonly [DriftOffset, DriftOffset, DriftOffset] = [
    new DriftOffset(TRAVEL_PERIODS[0], 0, AMBIENT_WAVES.speedPxPerSecond),
    new DriftOffset(TRAVEL_PERIODS[1], 0, AMBIENT_WAVES.speedPxPerSecond),
    new DriftOffset(TRAVEL_PERIODS[2], 0, AMBIENT_WAVES.speedPxPerSecond),
  ];
  private readonly flickerClock = new DriftOffset(FLICKER_CLOCK.periodSeconds, 0);
  private readonly motionClock = new DriftOffset(MOTION_CLOCK.periodSeconds, 0);
  /** What the drifts' velocities were set for: the settings and the water's wind (set when either changes, not per frame). */
  /** The settings and the wind words the drifts' velocities were set for (a still wind is told without a read, §30). */
  private readonly driftOf: { settings: WaterRenderSettings | null; water: WaterState | null } = { settings: null, water: null };
  private readonly driftWind = new Int32Array(4);
  /** The directed light whose share is in the frame values (its record and version, whether it shone). */
  private shareOf: DirectionalRecord | null = null;
  private shareVersion = -1;
  private shareLit = false;

  /** @param shore the occluder pass with the water's distance field (null: the shader searches the shore itself) */
  constructor(private readonly shore: WaterShoreSource | null) {}

  /** The wave field of the last step and its placement (tests, debugging). */
  get waveField(): { readonly texture: Texture2D | null; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly valid: boolean } {
    return { texture: this.currentField()?.texture(0) ?? null, x: this.fieldX, y: this.fieldY, width: this.fieldW, height: this.fieldH, valid: this.fieldValid };
  }

  init(setup: PassSetup): void {
    const gl = setup.gl;
    const r = setup.resources;
    const floatTargets = setup.caps.floatTargets;
    const defines = waterShaderDefines();
    this.resources = r;
    this.restores = r.restoreCount;
    this.copy = r.add(new RenderTarget(gl, { label: 'water-scene', width: 1, height: 1, attachments: [{ name: 'color', format: 'RGBA16F' }], floatTargets }));
    const field = (label: string): RenderTarget => r.add(new RenderTarget(gl, { label, width: 1, height: 1, attachments: [{ name: 'field', format: 'RGBA8' }], floatTargets }));
    this.fields = [field('water-waves-a'), field('water-waves-b')];
    this.debug = r.add(new RenderTarget(gl, { label: 'water-debug', width: 1, height: 1, attachments: [{ name: 'color', format: 'RGBA8' }], floatTargets }));
    this.tiles = r.add(new Texture2D(gl, { label: 'water-tiles', width: WATER_GRID_W, height: WATER_GRID_H, format: 'RGBA8', pixels: new Uint8Array(WATER_GRID_W * WATER_GRID_H * RGBA) }));
    this.waveProgram = setup.shaders.program({ name: 'water-wave', vertex: 'fullscreen.vert', fragment: 'water_wave.frag', defines });
    this.surfaceProgram = setup.shaders.program({ name: 'water-surface', vertex: 'fullscreen.vert', fragment: 'water_surface.frag', defines });
    this.debugProgram = setup.shaders.program({ name: 'water-debug', vertex: 'fullscreen.vert', fragment: 'water_debug.frag', defines });
    this.tileVersion = -1;
    this.fieldValid = false;
    const debug = this.debug;
    setup.debugViews.register({
      name: WATER_DEBUG_VIEW,
      mode: 'rgb',
      source: () => {
        this.debugWanted = true;
        return debug.texture(0);
      },
    });
  }

  resize(size: FrameSize): void {
    this.copy?.resize(size.width, size.height);
    this.debug?.resize(size.width, size.height);
    const w = waveFieldTexels(size.width);
    const h = waveFieldTexels(size.height);
    if (w !== this.fieldW || h !== this.fieldH) {
      this.fieldW = w;
      this.fieldH = h;
      this.fields?.[0].resize(w, h);
      this.fields?.[1].resize(w, h);
      this.fieldValid = false;
    }
  }

  execute(ctx: RenderContext): void {
    this.prepClock.begin();
    this.stats.drawn = false;
    this.stats.steps = 0;
    this.stats.impulses = 0;
    this.stats.shoreField = false;
    this.run(ctx);
    if (this.prepClock.end()) this.stats.prepMs = this.prepClock.ms;
  }

  private run(ctx: RenderContext): void {
    const copy = this.copy;
    const program = this.surfaceProgram;
    const tilesTex = this.tiles;
    if (copy === null || program === null || tilesTex === null) return;
    const water = ctx.scene.water;
    const tiles = water.tiles;
    const restores = this.resources?.restoreCount ?? 0;
    if (restores !== this.restores) {
      // The context was lost and restored: the fields and the tile texture start over.
      this.restores = restores;
      this.fieldValid = false;
      this.tileVersion = -1;
    }
    this.collectImpulses(water);
    if (!frameMayShowWater(ctx)) {
      // No water in view: the waves calm down, nothing to draw.
      this.fieldValid = false;
      this.pending = 0;
      return;
    }
    const gl = ctx.gl;
    if (tiles.known && (tiles.version !== this.tileVersion || !this.tileKnown)) {
      tilesTex.setPixels(tiles.data);
      this.tileVersion = tiles.version;
    }
    this.tileKnown = tiles.known;
    if (this.settings.waves) this.simulate(ctx, water);
    else {
      this.fieldValid = false;
      this.pending = 0;
    }
    // Copy the lit scene: the surface reads the copy and writes the water back into the HDR target.
    const hdr = ctx.targets.hdr;
    const f = ctx.frame;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, hdr.handle);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, copy.handle);
    gl.blitFramebuffer(0, 0, f.width, f.height, 0, 0, f.width, f.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    if (!program.use()) return;
    hdr.bind();
    this.bindSurface(ctx, program, water, copy);
    ctx.drawFullscreen();
    this.stats.drawn = true;
    if (this.debugWanted) this.drawDebug(ctx);
    this.debugWanted = false;
  }

  /** The field of the last step (null before `init`). */
  private currentField(): RenderTarget | null {
    const f = this.fields;
    if (f === null) return null;
    return this.current === 0 ? f[0] : f[1];
  }

  /** Keeps the frame's impulses until the next wave step (at most `MAX_IMPULSES`). */
  private collectImpulses(water: WaterState): void {
    const list = water.impulses;
    for (let i = 0; i < list.count && this.pending < MAX_IMPULSES; i++) {
      const k = this.pending++;
      this.pendingX[k] = list.x[i] ?? 0;
      this.pendingY[k] = list.y[i] ?? 0;
      this.pendingS[k] = list.strength[i] ?? 0;
      this.pendingR[k] = list.radius[i] ?? 1;
    }
  }

  /** Steps the wave field on the presentation clock, following the camera in whole texels. */
  private simulate(ctx: RenderContext, water: WaterState): void {
    const fields = this.fields;
    const program = this.waveProgram;
    if (fields === null || program === null) return;
    const gl = ctx.gl;
    const f = ctx.frame;
    const t = WAVES.texelPx;
    const origin = waveFieldOrigin(f.camera.originX, f.camera.originY, this.origin);
    const shiftX = Math.round((origin.x - this.fieldX) / t);
    const shiftY = -Math.round((origin.y - this.fieldY) / t);
    if (!this.fieldValid || Math.abs(shiftX) >= this.fieldW || Math.abs(shiftY) >= this.fieldH) {
      for (const target of fields) {
        target.bind();
        gl.clearBufferfv(gl.COLOR, 0, CALM);
      }
      this.fieldValid = true;
      this.fieldX = origin.x;
      this.fieldY = origin.y;
      this.simTime = f.time;
      this.pending = 0;
      return;
    }
    const clock = waveSteps(this.simTime, f.time, this.clock);
    this.simTime = clock.simTime;
    if (clock.steps === 0 || !program.use()) return;
    gl.uniform1i(program.uniform('uField'), UNIT.field);
    gl.uniform1i(program.uniform('uTiles'), UNIT.tiles);
    gl.uniform1i(program.uniform('uTilesKnown'), this.tileKnown ? 1 : 0);
    gl.uniform2i(program.uniform('uSize'), this.fieldW, this.fieldH);
    gl.uniform4fv(program.uniform('uFrames'), this.packFieldFrames(origin.x, origin.y, water));
    this.tiles?.bind(UNIT.tiles);
    const impulses = this.packImpulses(origin.x, origin.y);
    for (let k = 0; k < clock.steps; k++) {
      const from = this.current === 0 ? fields[0] : fields[1];
      const to = this.current === 0 ? fields[1] : fields[0];
      to.bind();
      from.texture(0).bind(UNIT.field);
      gl.uniform2i(program.uniform('uShift'), k === 0 ? shiftX : 0, k === 0 ? shiftY : 0);
      gl.uniform1i(program.uniform('uImpulseCount'), k === 0 ? impulses : 0);
      if (k === 0) gl.uniform4fv(program.uniform('uImpulses'), this.impulseData);
      ctx.drawFullscreen();
      this.current = 1 - this.current;
    }
    this.fieldX = origin.x;
    this.fieldY = origin.y;
    this.stats.steps = clock.steps;
    this.stats.impulses = impulses;
    this.pending = 0;
  }

  /** The pending impulses in texels of the field placed at (`ox`, `oy`) [world px]; returns their number. */
  private packImpulses(ox: number, oy: number): number {
    const t = WAVES.texelPx;
    const d = this.impulseData;
    for (let i = 0; i < this.pending; i++) {
      const o = i * VEC4;
      d[o] = ((this.pendingX[i] ?? 0) - ox) / t;
      d[o + 1] = this.fieldH - ((this.pendingY[i] ?? 0) - oy) / t;
      d[o + 2] = (this.pendingR[i] ?? 1) / t;
      d[o + 3] = this.pendingS[i] ?? 0;
    }
    return this.pending;
  }

  /** Textures and uniforms of the surface program. */
  private bindSurface(ctx: RenderContext, p: ShaderProgram, water: WaterState, copy: RenderTarget): void {
    const gl = ctx.gl;
    const f = ctx.frame;
    const g = ctx.targets.gbuffer;
    copy.texture(0).bind(UNIT.scene);
    g.texture(GBUFFER_ALBEDO).bind(UNIT.albedo);
    g.texture(GBUFFER_NORMAL).bind(UNIT.normal);
    g.texture(GBUFFER_EMISSIVE).bind(UNIT.surface);
    const field = this.currentField()?.texture(0) ?? null;
    (field ?? copy.texture(0)).bind(UNIT.field);
    this.tiles?.bind(UNIT.tiles);
    const shore = this.shore;
    const shoreTexture = shore !== null && shore.ranInFrame(f.index) ? shore.waterTexture() : null;
    (shoreTexture ?? copy.texture(0)).bind(UNIT.shore);
    const atlas = ctx.atlas;
    (atlas?.albedo ?? copy.texture(0)).bind(UNIT.atlas);
    ctx.palette.texture.bind(UNIT.palette);
    if (this.samplersAt !== p.buildCount) {
      // Sampler units stay with the program: set once per build (a context restore or hot reload builds it again).
      gl.uniform1i(p.uniform('uScene'), UNIT.scene);
      gl.uniform1i(p.uniform('uAlbedo'), UNIT.albedo);
      gl.uniform1i(p.uniform('uNormal'), UNIT.normal);
      gl.uniform1i(p.uniform('uSurface'), UNIT.surface);
      gl.uniform1i(p.uniform('uField'), UNIT.field);
      gl.uniform1i(p.uniform('uTiles'), UNIT.tiles);
      gl.uniform1i(p.uniform('uShore'), UNIT.shore);
      gl.uniform1i(p.uniform('uAtlas'), UNIT.atlas);
      gl.uniform1i(p.uniform('uPalette'), UNIT.palette);
      this.samplersAt = p.buildCount;
    }
    if (shoreTexture !== null && shore !== null) {
      shore.bindFrame(gl, p);
      this.stats.shoreField = true;
    }
    gl.uniform4fv(p.uniform('uFrame'), this.packFrame(ctx, water, field !== null, shoreTexture !== null));
    gl.uniform4fv(p.uniform('uSky'), water.sky.values);
    // The frame's ambient (colour × strength): the daylight on a flat, sunlit pixel (the sunlight on the water).
    gl.uniform3fv(p.uniform('uDaylight'), frameAmbient(ctx), AMBIENT_R, 3);
    this.packImmersions(water, f.camera.originX, f.camera.originY, atlas !== null);
    gl.uniform4fv(p.uniform('uImmerseA'), this.immerseA);
    gl.uniform4fv(p.uniform('uImmerseB'), this.immerseB);
    gl.uniform4fv(p.uniform('uImmerseC'), this.immerseC);
    gl.uniform4fv(p.uniform('uImmerseD'), this.immerseD);
  }

  /** The surface shader's frame values (`WATER_FRAME`). */
  private packFrame(ctx: RenderContext, water: WaterState, hasField: boolean, hasShore: boolean): Float32Array {
    const d = this.frameData;
    const F = WATER_FRAME;
    const f = ctx.frame;
    const settings = this.settings;
    const tiles = water.tiles;
    d[F.origin] = f.camera.originX;
    d[F.origin + 1] = f.camera.originY;
    d[F.targetSize] = f.width;
    d[F.targetSize + 1] = f.height;
    d[F.viewSize] = f.viewWidth;
    d[F.viewSize + 1] = f.viewHeight;
    d[F.motion] = settings.motionScale;
    // Wind and shore ice by copies (no float read, §30).
    d.set(water.windValues, F.wind);
    d.set(water.iceValue, F.shoreIce);
    d[F.fieldFrame] = this.fieldX;
    d[F.fieldFrame + 1] = this.fieldY;
    d[F.fieldFrame + 2] = this.fieldW;
    d[F.fieldFrame + 3] = this.fieldH;
    d[F.tileFrame] = tiles.originTx;
    d[F.tileFrame + 1] = tiles.originTy;
    d[F.tileFrame + 2] = tiles.width;
    d[F.tileFrame + 3] = tiles.height;
    d[F.waves] = hasField && this.fieldValid && settings.waves ? 1 : 0;
    d[F.tilesKnown] = tiles.known ? 1 : 0;
    d[F.hasShore] = hasShore ? 1 : 0;
    d[F.refraction] = settings.refraction ? 1 : 0;
    d[F.reflection] = settings.reflection ? 1 : 0;
    d[F.caustics] = settings.caustics ? 1 : 0;
    d[F.immerseCount] = water.immersions.count;
    this.packDrift(d, f.time, water, settings);
    // The sun's share, read again only when the sky's directed light was written.
    const sky = ctx.scene.sky;
    const dir = sky.directional;
    const lit = sky.hasDirectional;
    if (dir !== this.shareOf || dir.version !== this.shareVersion || lit !== this.shareLit) {
      this.shareOf = dir;
      this.shareVersion = dir.version;
      this.shareLit = lit;
      d[F.sunShare] = lit ? dir.share : 0;
    }
    return d;
  }

  /**
   * Moves the caustics, the ambient trains, the motion and the flicker clock on to presentation time `time`
   * (`WATER_FRAME`, whole 1/DRIFT_UNITS px or s: the shader divides). Their key is the scene's `water.stepKey` (the
   * simulation tick of the world it shows): a frame whose clock stands while the world stepped – a still picture –
   * takes velocity × time under the wind of that step, as the clouds and the fog do (M5-43); a change of the settings
   * alone (a menu over the paused game) never moves the water.
   */
  private packDrift(d: Float32Array, time: number, water: WaterState, settings: WaterRenderSettings): void {
    const F = WATER_FRAME;
    const of = this.driftOf;
    const windMoved = bitsChanged(water.windWords, this.driftWind, 4);
    if (windMoved || of.settings !== settings || of.water !== water) {
      of.settings = settings;
      of.water = water;
      const motion = settings.motionScale;
      this.causticA.setVelocity(water.windX * motion, water.windY * motion);
      this.causticB.setVelocity(water.windX * motion, water.windY * motion);
      for (const train of this.travel) train.setVelocity(motion, 0);
      this.flickerClock.setVelocity(settings.flicker, 0);
      this.motionClock.setVelocity(motion, 0);
    }
    const clock = driftClock(time);
    const key = water.stepKey;
    this.causticA.advance(clock, key);
    this.causticA.store(d, F.causticA);
    this.causticB.advance(clock, key);
    this.causticB.store(d, F.causticB);
    const travel = this.travel;
    for (let k = 0; k < travel.length; k++) {
      const train = travel[k];
      if (train === undefined) continue;
      train.advance(clock, key);
      train.storeX(d, F.travel + k);
    }
    const flicker = this.flickerClock;
    flicker.advance(clock, key);
    flicker.storeX(d, F.flickerTime);
    const motionClock = this.motionClock;
    motionClock.advance(clock, key);
    motionClock.storeX(d, F.motionTime);
  }

  /** The wave and debug shaders' pair: the field at (`x`, `y`) [world px], the tile grid. */
  private packFieldFrames(x: number, y: number, water: WaterState): Float32Array {
    const d = this.fieldFrames;
    d[0] = x;
    d[1] = y;
    d[2] = this.fieldW;
    d[3] = this.fieldH;
    d[4] = water.tiles.originTx;
    d[5] = water.tiles.originTy;
    d[6] = water.tiles.width;
    d[7] = water.tiles.height;
    return d;
  }

  /** Immersions in target px (anchors snapped like the sprites); body frames only with an atlas bound. */
  private packImmersions(water: WaterState, ox: number, oy: number, withAtlas: boolean): void {
    const m = water.immersions;
    const a = this.immerseA;
    const b = this.immerseB;
    const c = this.immerseC;
    const d = this.immerseD;
    // Slots below `count` are always written (`WaterImmersions.push`): read without a default, which would make each a
    // new number in code V8 has not optimised (§30) – creatures in water fill several slots every frame (ADR-0167).
    for (let i = 0; i < m.count; i++) {
      const o = i * VEC4;
      a[o] = Math.floor((m.x[i] as number) + 0.5) - ox;
      a[o + 1] = Math.floor((m.y[i] as number) + 0.5) - oy;
      a[o + 2] = m.halfWidth[i] as number;
      a[o + 3] = m.top[i] as number;
      b[o] = m.line[i] as number;
      b[o + 1] = m.sink[i] as number;
      b[o + 2] = m.mirror[i] as number;
      b[o + 3] = m.row[i] as number;
      c[o] = m.frameX[i] as number;
      c[o + 1] = m.frameY[i] as number;
      c[o + 2] = withAtlas ? (m.frameW[i] as number) : 0;
      c[o + 3] = m.frameH[i] as number;
      d[o] = m.anchorX[i] as number;
      d[o + 1] = m.anchorY[i] as number;
      // Whether the water mirrors it (0: it floats in the water, `WaterImmersions.floating`).
      d[o + 2] = m.mirrored[i] as number;
      d[o + 3] = 0;
    }
  }

  /** The render debugger's view of the wave field. */
  private drawDebug(ctx: RenderContext): void {
    const debug = this.debug;
    const p = this.debugProgram;
    const field = this.currentField();
    if (debug === null || p === null || field === null || !p.use()) return;
    const gl = ctx.gl;
    const f = ctx.frame;
    debug.bind();
    field.texture(0).bind(UNIT.field);
    this.tiles?.bind(UNIT.tiles);
    gl.uniform1i(p.uniform('uField'), UNIT.field);
    gl.uniform1i(p.uniform('uTiles'), UNIT.tiles);
    gl.uniform4fv(p.uniform('uFrames'), this.packFieldFrames(this.fieldX, this.fieldY, ctx.scene.water));
    gl.uniform1i(p.uniform('uTilesKnown'), this.tileKnown ? 1 : 0);
    gl.uniform2f(p.uniform('uOrigin'), f.camera.originX, f.camera.originY);
    gl.uniform2f(p.uniform('uTargetSize'), f.width, f.height);
    ctx.drawFullscreen();
  }

  dispose(setup: PassSetup): void {
    setup.debugViews.unregister(WATER_DEBUG_VIEW);
    for (const r of [this.copy, this.fields?.[0] ?? null, this.fields?.[1] ?? null, this.debug, this.tiles]) if (r !== null) setup.resources.remove(r);
    for (const p of [this.waveProgram, this.surfaceProgram, this.debugProgram]) if (p !== null) setup.shaders.release(p);
    this.copy = null;
    this.fields = null;
    this.debug = null;
    this.tiles = null;
    this.waveProgram = null;
    this.surfaceProgram = null;
    this.debugProgram = null;
    this.fieldValid = false;
  }
}
