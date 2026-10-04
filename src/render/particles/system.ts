/**
 * The GPU particle system (MASTERPROMPT §6.2 "GPU-Partikel ≥ 20 000 gleichzeitig", M5-11): transform-feedback
 * simulation of up to `PARTICLE_CAPACITY` particles in two buffers that take turns (read one, write the other), births
 * of the frame's sources written into a ring on the CPU (`spawn.ts`), the weather pool in front of the ring
 * (`weather.ts`), and the draw of all of them as instanced quads.
 *
 * Time: the system follows the presentation time in steps of at most `MAX_STEP_S` (at most `MAX_STEPS_PER_FRAME`; a
 * longer gap is dropped). It starts over – ring emptied, weather pool in its steady state, then `PREWARM_S` of
 * simulation in one frame – when it has no state yet, after a context loss, when time jumps (backwards or by more than
 * `RESET_GAP_S`), and while time stands still (screenshots) whenever the sources or the weather change: a frozen frame
 * shows the steady state of exactly its sources, whatever came before. The prewarm runs in steps of `PREWARM_STEP_S`,
 * each one feedback pass of sub-steps no longer than `MAX_STEP_S` (the same motion as frame by frame, ten draw calls
 * instead of a hundred and fifty). Transform feedback needs no float render target,
 * so the simulation is the same with the RGBA8 fallback; the draw writes the HDR target through `encodeHdr`.
 *
 * All GPU objects come from the pass setup's registry (restored after a context loss, when the system starts over);
 * no allocation per frame.
 */
import { WEATHER_PARTICLE_IDS, weatherParticles, type WeatherParticleId, type WeatherParticles } from '../../content/particles';
import { GpuBuffer } from '../gl/buffer';
import type { ShaderProgram } from '../gl/shaders';
import type { GpuResourceRegistry } from '../gl/resources';
import { VertexArray } from '../gl/vertexArray';
import { findLightPipeline } from '../light/pipeline';
import { pointOverDaylightDefines } from '../light/banding';
import { spectralDefines } from '../light/spectral';
import { LIGHT_DIFFUSE, type LightingPass } from '../passes/lightingPass';
import type { PassRegistry, PassSetup, RenderContext } from '../passes/registry';
import { particleDefines } from './defines';
import { KIND_ROWS } from './kinds';
import { GBUFFER_ALBEDO } from '../gbuffer';
import { ATTRIB_OFFSET, DEAD_AGE, DEAD_LIFE, DRAW_LOCATION, P, PARTICLE_CAPACITY, PARTICLE_FLOATS, PARTICLE_STRIDE, RING_CAPACITY, UPDATE_LOCATION, UPDATE_VARYINGS, WEATHER_CAPACITY } from './layout';
import { DEFAULT_PARTICLE_SETTINGS, type ParticleRenderSettings } from './settings';
import { ParticleRing, SpawnBatch, spawnStep } from './spawn';
import type { ParticleScene, WeatherParticleState } from './sceneParticles';
import { bitsChanged } from '../uniformBits';
import { particleTables, type ParticleTables } from './tables';
import { createWeatherBox, initWeatherPool, lightningFlash, weatherBox, weatherCount, weatherShares, type WeatherBox } from './weather';
import { LIGHTNING } from '../../content/particles';
import { paletteLight } from '../light/lightColors';
import { SampledClock } from '../sampledClock';
import { frameAmbient, frameDayLevel } from '../light/frameAmbient';

/** Light of one glowing particle on Ultra: reach [px] and strength at its footprint per unit of glow (a swarm adds up). */
export const PARTICLE_LIGHT = { radius: 14, intensity: 0.12 } as const;
/** Longest simulation step [s] (two frames at 60 Hz: smooth arcs, stable drag). */
export const MAX_STEP_S = 1 / 30;
/** Most steps in an ordinary frame; a longer gap is dropped (the particles slow down instead of stuttering). */
export const MAX_STEPS_PER_FRAME = 4;
/** Simulated time before the first frame after a start-over [s]: the longest life of an emitted particle (smoke 4,6 s) is over. */
export const PREWARM_S = 5;
/**
 * One step of the prewarm [s]: births of this span go into the ring at once (≤ `SPAWN_BATCH`: 16 000 births a second),
 * the feedback pass moves every particle in sub-steps of at most `MAX_STEP_S` through it.
 */
export const PREWARM_STEP_S = 0.5;
/** A jump of presentation time longer than this starts the particles over [s]. */
export const RESET_GAP_S = 1;
/** Births collected per step at most (a burst beyond waits for the next step). */
export const SPAWN_BATCH = 8192;
/** A rest of the frame shorter than this is not stepped (float rounding of the step sum) [s]. */
const STEP_EPSILON_S = 1e-6;
/** Presentation time is wrapped to this period for the shaders' waves (float precision over long sessions) [s]. */
const TIME_WRAP_S = 3600;
/** Extra time the weather pool runs after its weather stopped, beyond the longest fall and landing [s]. */
const WEATHER_LINGER_S = 1;

const QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
const QUAD_VERTICES = 4;
const UNIT_PALETTE = 0;
const UNIT_LIGHT = 1;

/** What the particle system did in the last frame (F3, `renderInfo`, bench). */
export interface ParticleStats {
  /** Particles alive: emitted ones in the ring plus the weather particles falling or landed. */
  alive: number;
  /** Weather particles the weather asks for. */
  weather: number;
  /** Sources in the frame. */
  sources: number;
  /** Births, simulation steps (feedback passes) and their sub-steps in the frame. */
  born: number;
  steps: number;
  substeps: number;
  /** Start-overs so far. */
  resets: number;
  /** CPU time of births, uploads and step dispatch [ms] (GPU time per timer query where available: M5-30). */
  prepMs: number;
  /** Lightning brightness 0…1. */
  flash: number;
}

type Pair<T> = [T, T];

/** Element `i` (0 or 1) of a pair. */
function at<T>(pair: Pair<T>, i: number): T {
  return i === 0 ? pair[0] : pair[1];
}

export class ParticleSystem {
  settings: ParticleRenderSettings = DEFAULT_PARTICLE_SETTINGS;
  /** The pass registry whose light pipeline lights the particles (set by `installParticles`). */
  passes: PassRegistry | null = null;
  /** Its light pass (looked up on the first draw). */
  private lighting: LightingPass | null = null;
  readonly stats: ParticleStats = { alive: 0, weather: 0, sources: 0, born: 0, steps: 0, substeps: 0, resets: 0, prepMs: 0, flash: 0 };
  private readonly tables: ParticleTables = particleTables();
  private resources: GpuResourceRegistry | null = null;
  private buffers: Pair<GpuBuffer> | null = null;
  private updateVaos: Pair<VertexArray> | null = null;
  private drawVaos: Pair<VertexArray> | null = null;
  private quad: GpuBuffer | null = null;
  private update: ShaderProgram | null = null;
  private draw: ShaderProgram | null = null;
  private light: ShaderProgram | null = null;
  /** Buffer holding the latest state. */
  private current = 0;
  private simTime = Number.NaN;
  private restores = -1;
  /** Signature of the last frame's sources (an integer from the start: it reads without a new number per frame, §30). */
  private signature = 0;
  private prepared = -1;
  private readonly ring = new ParticleRing(RING_CAPACITY);
  private ringDeath = 0;
  private readonly batch = new SpawnBatch(SPAWN_BATCH);
  private readonly pool = new Float32Array(WEATHER_CAPACITY * PARTICLE_FLOATS);
  private zeros: Float32Array | null = null;
  private weatherActive = false;
  /**
   * Records of the weather pool stepped and drawn: the most the weather has asked for since the pool was filled (a
   * particle beyond the weather's number finishes its fall before it waits; beyond this mark every record waits).
   */
  private poolEnd = 0;
  private weatherUntil = 0;
  private weatherConfig: WeatherParticles | null = null;
  private weatherCountValue = 0;
  private readonly box: WeatherBox = createWeatherBox();
  /**
   * Centre of the view [world px] and the weather box (half width, top, bottom, particles falling) as the shaders take
   * them: written where they are computed, uploaded as they are – no float is read back per frame (§30).
   */
  private readonly camera = new Float32Array(2);
  private readonly boxUniform = new Float32Array(4);
  /**
   * Uniforms copied or kept instead of read per frame (§30): the weather's wind (`uWind`), the fall of the weather
   * config `fallOf` (`uWeatherFall`), and the wind's share of the start-over signature for the wind words seen last.
   */
  private readonly windUniform = new Float32Array(2);
  /** The camera snap and view the centre in `camera` was formed for. */
  private cameraAt = -1;
  private cameraViewW = -1;
  private cameraViewH = -1;
  /**
   * What the weather's box and count were chosen from (`chooseWeather`): kind, config, the config in use, view, settings
   * and the amount's words – a frame of the same weather chooses nothing again (§30).
   */
  private chosenKind = Number.MIN_SAFE_INTEGER;
  private chosenConfig: WeatherParticles | null | undefined = undefined;
  private chosenFrom: WeatherParticles | null | undefined = undefined;
  private chosenW = -1;
  private chosenH = -1;
  private chosenSettings: ParticleRenderSettings | null = null;
  private readonly amountSeen = new Int32Array(2);
  private readonly fallUniform = new Float32Array(4);
  private fallOf: WeatherParticles | null | undefined = undefined;
  private windOf: WeatherParticleState | null = null;
  private readonly windSeen = new Int32Array(4);
  private windHash = 0;
  /** The lightning's light of the frame (`uFlash`). */
  private readonly flashUniform = new Float32Array(3);
  /** The frame's lightning is on (`flashValue` > 0). */
  private flashing = false;
  /** CPU time of `prepare` (sampled, `stats.prepMs`). */
  private readonly clock = new SampledClock();
  private readonly weatherKinds = new Int32Array(4);
  private readonly weatherKindShares = new Float32Array(4);
  private readonly weatherLayers = new Float32Array(4 * 3);
  private weatherLayerCount = 1;
  private weatherSalt = 0;
  private readonly flashColor = paletteLight(LIGHTNING.farbe);
  private flashValue = 0;

  init(setup: PassSetup): void {
    const gl = setup.gl;
    const res = setup.resources;
    this.resources = res;
    const bytes = PARTICLE_CAPACITY * PARTICLE_STRIDE;
    const a = res.add(new GpuBuffer(gl, { label: 'particles-a', target: 'vertex', usage: 'dynamic', byteLength: bytes }));
    const b = res.add(new GpuBuffer(gl, { label: 'particles-b', target: 'vertex', usage: 'dynamic', byteLength: bytes }));
    this.buffers = [a, b];
    this.quad = res.add(new GpuBuffer(gl, { label: 'particle-quad', target: 'vertex', usage: 'static', data: QUAD }));
    const records = (buf: GpuBuffer, loc: { pos: number; vel: number; meta: number }, divisor: number) =>
      (['pos', 'vel', 'meta'] as const).map((k) => ({ location: loc[k], buffer: buf, components: 4 as const, type: 'f32' as const, stride: PARTICLE_STRIDE, offset: ATTRIB_OFFSET[k], divisor }));
    this.updateVaos = [
      res.add(new VertexArray(gl, { label: 'particles-update-a', attributes: records(a, UPDATE_LOCATION, 0) })),
      res.add(new VertexArray(gl, { label: 'particles-update-b', attributes: records(b, UPDATE_LOCATION, 0) })),
    ];
    const corner = { location: DRAW_LOCATION.corner, buffer: this.quad, components: 2 as const, type: 'f32' as const, stride: 0, offset: 0 };
    this.drawVaos = [
      res.add(new VertexArray(gl, { label: 'particles-draw-a', attributes: [corner, ...records(a, DRAW_LOCATION, 1)] })),
      res.add(new VertexArray(gl, { label: 'particles-draw-b', attributes: [corner, ...records(b, DRAW_LOCATION, 1)] })),
    ];
    const defines = particleDefines();
    this.update = setup.shaders.program({ name: 'particle-update', vertex: 'particle_update.vert', fragment: 'particle_update.frag', defines, varyings: UPDATE_VARYINGS });
    this.draw = setup.shaders.program({ name: 'particle-draw', vertex: 'particle_draw.vert', fragment: 'particle_draw.frag', defines: { ...defines, ...spectralDefines(), ...pointOverDaylightDefines() } });
    this.light = setup.shaders.program({ name: 'particle-light', vertex: 'particle_light.vert', fragment: 'particle_light.frag', defines: { ...defines, ...pointOverDaylightDefines() } });
    this.simTime = Number.NaN;
  }

  dispose(setup: PassSetup): void {
    for (const p of [this.update, this.draw, this.light]) if (p !== null) setup.shaders.release(p);
    for (const r of [...(this.drawVaos ?? []), ...(this.updateVaos ?? []), ...(this.buffers ?? []), this.quad]) if (r !== null) setup.resources.remove(r);
    this.update = null;
    this.draw = null;
    this.light = null;
    this.drawVaos = null;
    this.updateVaos = null;
    this.buffers = null;
    this.quad = null;
    this.resources = null;
  }

  /** Lightning brightness of the last prepared frame (0…1). */
  get flash(): number {
    return this.flashValue;
  }

  /** Whether the last prepared frame has lightning (read before `flash`: no number is read in a frame without). */
  get flashes(): boolean {
    return this.flashing;
  }

  /** Light colour of the lightning × strength at full flash. */
  get flashLight(): readonly [number, number, number] {
    return this.flashColor;
  }

  /**
   * Advances the particles to the frame's time (once per frame; every particle pass calls it first): births,
   * steps, start-overs, lightning, statistics.
   */
  prepare(ctx: RenderContext): void {
    const f = ctx.frame;
    if (this.prepared === f.index) return;
    this.prepared = f.index;
    this.clock.begin();
    const scene = ctx.scene.particles;
    const t = f.time;
    // The view's centre, formed again only when the camera was snapped anew or the view changed (§30).
    if (f.cameraVersion !== this.cameraAt || f.viewWidth !== this.cameraViewW || f.viewHeight !== this.cameraViewH) {
      this.cameraAt = f.cameraVersion;
      this.cameraViewW = f.viewWidth;
      this.cameraViewH = f.viewHeight;
      this.camera[0] = f.camera.viewLeft + f.viewWidth / 2;
      this.camera[1] = f.camera.viewTop + f.viewHeight / 2;
    }
    this.stats.born = 0;
    this.stats.steps = 0;
    this.stats.substeps = 0;
    this.stats.sources = scene.emitters.count;
    this.chooseWeather(scene, f.viewWidth, f.viewHeight);
    // Without a thunderstorm (its strength exactly 0: told from the bits, no float read) there is no flash.
    const flash = scene.weather.sky && !scene.weather.calm ? lightningFlash(t, scene.weather.stormSeed, scene.weather.storm, this.settings.flashReduction) : 0;
    this.flashValue = flash;
    this.flashing = flash > 0;
    scene.flash = flash;
    this.stats.flash = flash;
    const update = this.update;
    const buffers = this.buffers;
    if (update === null || buffers === null || update.handle === null || buffers[0].handle === null) {
      this.stats.alive = 0;
      ctx.stats.particles = 0;
      return;
    }
    const signature = this.signatureOf(scene);
    const restored = this.resources !== null && this.resources.restoreCount !== this.restores;
    // The simulation clock in a local: the field is read once and written once per frame (§30).
    let simTime = this.simTime;
    const frozen = t === simTime;
    const gap = t - simTime;
    const reset = !Number.isFinite(simTime) || restored || gap < 0 || gap > RESET_GAP_S || (frozen && signature !== this.signature);
    if (reset) {
      this.startOver(ctx, t - PREWARM_S);
      simTime = this.simTime;
    }
    this.signature = signature;
    this.setStepUniforms(ctx, scene);
    let steps = 0;
    if (reset) {
      while (t - simTime > STEP_EPSILON_S) {
        const t1 = Math.min(t, simTime + PREWARM_STEP_S);
        this.step(ctx, scene, simTime, t1, Math.max(1, Math.ceil((t1 - simTime) / MAX_STEP_S - STEP_EPSILON_S)));
        simTime = t1;
        steps++;
      }
    }
    for (let i = 0; i < MAX_STEPS_PER_FRAME && t - simTime > STEP_EPSILON_S; i++) {
      const next = simTime + MAX_STEP_S;
      const t1 = next < t ? next : t;
      this.step(ctx, scene, simTime, t1, 1);
      simTime = t1;
      steps++;
    }
    this.simTime = simTime < t ? t : simTime;
    this.stats.steps = steps;
    const weatherAlive = this.weatherActive && scene.weather.sky ? this.weatherCountValue : 0;
    this.stats.weather = this.weatherCountValue;
    this.stats.alive = this.ring.alive(t) + weatherAlive;
    ctx.stats.particles = this.stats.alive;
    if (this.clock.end()) this.stats.prepMs = this.clock.ms;
  }

  /** Draws the particles into the HDR target (blending is set by the caller: premultiplied colour). */
  drawParticles(ctx: RenderContext): void {
    const p = this.draw;
    if (p === null || !p.use()) return;
    const gl = ctx.gl;
    const f = ctx.frame;
    ctx.targets.hdr.bind();
    const lighting = (this.lighting ??= this.passes === null ? null : (findLightPipeline(this.passes)?.lighting ?? null));
    const lit = lighting !== null && lighting.ranInFrame(f.index) ? lighting.texture(LIGHT_DIFFUSE) : null;
    (lit ?? ctx.palette.texture).bind(UNIT_LIGHT);
    gl.uniform1i(p.uniform('uLight'), UNIT_LIGHT);
    gl.uniform1i(p.uniform('uLit'), lit === null ? 0 : 1);
    gl.uniform3fv(p.uniform('uAmbient'), frameAmbient(ctx), 0, 3);
    gl.uniform1fv(p.uniform('uDayLevel'), frameDayLevel(ctx));
    // Without lightning (almost every frame) the flash light stays zero and is not recomputed.
    const flashLight = this.flashUniform;
    if (this.flashing) {
      const flash = this.flashValue * LIGHTNING.staerke;
      const c = this.flashColor;
      flashLight[0] = c[0] * flash;
      flashLight[1] = c[1] * flash;
      flashLight[2] = c[2] * flash;
    } else flashLight.fill(0);
    gl.uniform3fv(p.uniform('uFlash'), flashLight);
    this.drawInstances(ctx, p);
  }

  /**
   * Ultra (§6.2 "emissive Partikel werfen in Ultra Licht", setting `particleLights`): every glowing particle adds its
   * light to the surfaces around its footprint (additive blending, set by the caller). Nothing without the setting.
   */
  drawLights(ctx: RenderContext): void {
    const p = this.light;
    if (!this.settings.particleLights || p === null || !p.use()) return;
    const gl = ctx.gl;
    ctx.targets.hdr.bind();
    ctx.targets.gbuffer.texture(GBUFFER_ALBEDO).bind(UNIT_LIGHT);
    gl.uniform1i(p.uniform('uAlbedo'), UNIT_LIGHT);
    gl.uniform1f(p.uniform('uRadius'), PARTICLE_LIGHT.radius);
    gl.uniform1f(p.uniform('uIntensity'), PARTICLE_LIGHT.intensity);
    gl.uniform3fv(p.uniform('uAmbient'), frameAmbient(ctx), 0, 3);
    gl.uniform1fv(p.uniform('uDayLevel'), frameDayLevel(ctx));
    this.drawInstances(ctx, p);
  }

  /** The live range of records as instanced quads with `p` (bound), after the uniforms both programs share. */
  private drawInstances(ctx: RenderContext, p: ShaderProgram): void {
    const vaos = this.drawVaos;
    const first = this.weatherActive && ctx.scene.particles.weather.sky ? 0 : WEATHER_CAPACITY;
    const end = this.rangeEnd();
    if (vaos === null || end <= first) return;
    const gl = ctx.gl;
    const f = ctx.frame;
    ctx.palette.texture.bind(UNIT_PALETTE);
    gl.uniform1i(p.uniform('uPalette'), UNIT_PALETTE);
    gl.uniform4fv(p.uniform('uKinds'), this.tables.kinds.data);
    gl.uniform2f(p.uniform('uOrigin'), f.camera.originX, f.camera.originY);
    gl.uniform2f(p.uniform('uTargetSize'), f.width, f.height);
    gl.uniform2fv(p.uniform('uCamera'), this.camera);
    gl.uniform4fv(p.uniform('uWeatherBox'), this.boxUniform);
    gl.uniform4fv(p.uniform('uWeatherLayers'), this.weatherLayers);
    gl.uniform1i(p.uniform('uWeatherSky'), ctx.scene.particles.weather.sky ? 1 : 0);
    gl.uniform1f(p.uniform('uTime'), f.time % TIME_WRAP_S);
    gl.uniform1f(p.uniform('uFlicker'), this.settings.flashReduction ? REDUCED_PARTICLE_FLICKER : 1);
    const vao = at(vaos, this.current);
    vao.bind();
    vao.setInstanceOffset(first);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, QUAD_VERTICES, end - first);
    ctx.stats.drawCalls++;
    vao.setInstanceOffset(0);
  }

  /** Weather particles of the frame: config, box, number falling, shader tables; activates or retires the pool. */
  private chooseWeather(scene: ParticleScene, viewW: number, viewH: number): void {
    const w = scene.weather;
    const id = w.kind >= 0 ? (WEATHER_PARTICLE_IDS[w.kind] ?? null) : null;
    const config = id === null ? this.weatherConfig : weatherParticles(id);
    const amountMoved = bitsChanged(w.amountWords, this.amountSeen, 2);
    if (!amountMoved && w.kind === this.chosenKind && config === this.chosenConfig && this.weatherConfig === this.chosenFrom && viewW === this.chosenW && viewH === this.chosenH && this.settings === this.chosenSettings) return;
    this.chosenKind = w.kind;
    this.chosenConfig = config;
    this.chosenW = viewW;
    this.chosenH = viewH;
    this.chosenSettings = this.settings;
    this.chooseWeatherOf(w, id, config, viewW, viewH);
    this.chosenFrom = this.weatherConfig;
  }

  /** The weather box, the number of weather particles and the tables of a new weather (`chooseWeather`). */
  private chooseWeatherOf(w: WeatherParticleState, id: WeatherParticleId | null, config: WeatherParticles | null, viewW: number, viewH: number): void {
    if (config !== null) {
      const box = weatherBox(viewW, viewH, config.hoehe, this.box);
      const u = this.boxUniform;
      u[0] = box.halfWidth;
      u[1] = box.top;
      u[2] = box.bottom;
    }
    const count = id === null || config === null ? 0 : weatherCount(config, w.amount, this.box, this.settings.weatherShare, WEATHER_CAPACITY);
    this.weatherCountValue = count;
    this.boxUniform[3] = count;
    if (config === null) return;
    if (config !== this.weatherConfig) this.useWeather(config);
    this.weatherKinds[3] = id === null ? 0 : config.arten.length;
  }

  /** The shader tables of a new weather (its kinds, their shares, its layers); a method of its own, so the closures stay out of the frame (§30). */
  private useWeather(config: WeatherParticles): void {
    this.weatherConfig = config;
    const shares = weatherShares(config);
    this.weatherKinds.fill(-1);
    this.weatherKindShares.fill(1);
    config.arten.forEach((a, i) => {
      this.weatherKinds[i] = this.tables.kinds.index(a.art);
      this.weatherKindShares[i] = shares.kinds[i] as number;
    });
    this.weatherLayers.fill(0);
    config.schichten.forEach((l, i) => this.weatherLayers.set([l.parallaxe, shares.layers[i] as number, l.groesse, l.deckung], i * 4));
    this.weatherLayerCount = config.schichten.length;
  }

  /**
   * A number that changes when the sources or the weather of the frame change (drives the start-over of a frozen frame);
   * the camera is not part of it – the weather box wraps around it, and panning a paused picture stays cheap.
   */
  private signatureOf(scene: ParticleScene): number {
    const e = scene.emitters;
    let h = e.count * 31 + this.weatherCountValue * 7 + scene.weather.kind * 13 + (scene.weather.sky ? 1 : 0);
    for (let i = 0; i < e.count; i++) {
      h = (Math.imul(h, 0x01000193) ^ ((e.preset[i] as number) * 131 + Math.round((e.x[i] as number) * 4) * 17 + Math.round((e.y[i] as number) * 4) * 23 + Math.round((e.z[i] as number) * 4) * 29 + Math.round((e.strength[i] as number) * 64) * 37)) | 0;
      h = (Math.imul(h, 0x01000193) ^ ((e.id[i] as number) | 0)) | 0;
    }
    // The wind's share: computed again only when its words changed (a still wind reads no float, §30).
    const w = scene.weather;
    if (bitsChanged(w.windWords, this.windSeen, 4) || w !== this.windOf) {
      this.windOf = w;
      this.windHash = Math.round(w.windX * 4) ^ (Math.round(w.windY * 4) << 12);
    }
    return (Math.imul(h, 0x01000193) ^ this.windHash) | 0;
  }

  /** Empties the ring, puts the weather pool into its steady state and sets the clock to `from`. */
  private startOver(ctx: RenderContext, from: number): void {
    const buffers = this.buffers as Pair<GpuBuffer>;
    // Only what may hold live records is cleared: the pool and the part of the ring written since the last start-over
    // (fresh buffers – a new system, a restored context – are zero-filled, and a zero record is dead).
    const dead = (this.zeros ??= deadRecords(PARTICLE_CAPACITY));
    const floats = (this.ring.used > 0 ? WEATHER_CAPACITY + this.ring.used : WEATHER_CAPACITY) * PARTICLE_FLOATS;
    buffers[0].upload(dead, 0, floats, 0);
    buffers[1].upload(dead, 0, floats, 0);
    this.current = 0;
    this.ring.reset();
    this.ringDeath = 0;
    this.weatherActive = false;
    this.poolEnd = 0;
    this.weatherSalt = (this.weatherSalt + 0x9e37) >>> 0;
    if (this.weatherCountValue > 0) this.activateWeather(ctx);
    this.simTime = from;
    this.restores = this.resources?.restoreCount ?? 0;
    this.stats.resets++;
  }

  /**
   * Fills the weather pool of both buffers with the steady state of the frame's weather: every record of the pool is a
   * valid weather particle in either buffer, so the stepped range can grow with the weather's number at any step.
   */
  private activateWeather(ctx: RenderContext): void {
    const config = this.weatherConfig;
    if (config === null) return;
    initWeatherPool(this.pool, 0, WEATHER_CAPACITY, config, this.tables.kinds, this.weatherCountValue, this.box, this.camera[0] as number, this.camera[1] as number, ctx.scene.particles.weather.stormSeed ^ this.weatherSalt);
    const buffers = this.buffers as Pair<GpuBuffer>;
    buffers[0].upload(this.pool, 0, this.pool.length, 0);
    buffers[1].upload(this.pool, 0, this.pool.length, 0);
    this.weatherActive = true;
    this.poolEnd = this.weatherCountValue;
  }

  /** End of the live records: behind the ring's used slots, else behind the weather pool's stepped range. */
  private rangeEnd(): number {
    return this.ring.used > 0 ? WEATHER_CAPACITY + this.ring.used : this.weatherActive ? this.poolEnd : 0;
  }

  private setStepUniforms(ctx: RenderContext, scene: ParticleScene): void {
    const p = this.update as ShaderProgram;
    if (!p.use()) return;
    const gl = ctx.gl;
    const w = scene.weather;
    const c = this.weatherConfig;
    gl.uniform4fv(p.uniform('uKinds'), this.tables.kinds.data);
    const wind = this.windUniform;
    wind.set(w.windValues);
    gl.uniform2fv(p.uniform('uWind'), wind);
    gl.uniform2fv(p.uniform('uCamera'), this.camera);
    gl.uniform4fv(p.uniform('uWeatherBox'), this.boxUniform);
    const fall = this.fallUniform;
    if (c !== this.fallOf) {
      this.fallOf = c;
      fall[0] = c?.fall.min ?? 0;
      fall[1] = c?.fall.max ?? 0;
      fall[2] = c?.hoehe ?? 0;
      fall[3] = c?.wind ?? 0;
    }
    gl.uniform4fv(p.uniform('uWeatherFall'), fall);
    gl.uniform4i(p.uniform('uWeatherKinds'), this.weatherKinds[0] as number, this.weatherKinds[1] as number, this.weatherKinds[2] as number, this.weatherKinds[3] as number);
    gl.uniform4fv(p.uniform('uWeatherKindShares'), this.weatherKindShares);
    gl.uniform4fv(p.uniform('uWeatherLayers'), this.weatherLayers);
    gl.uniform1i(p.uniform('uWeatherLayerCount'), this.weatherLayerCount);
    gl.uniform1ui(p.uniform('uWeatherSalt'), this.weatherSalt);
  }

  /**
   * One simulation step `(t0, t1]`: births into the ring, then the transform-feedback pass over the live range in
   * `substeps` equal sub-steps.
   */
  private step(ctx: RenderContext, scene: ParticleScene, t0: number, t1: number, substeps: number): void {
    const gl = ctx.gl;
    const buffers = this.buffers as Pair<GpuBuffer>;
    const src = at(buffers, this.current);
    const dst = at(buffers, 1 - this.current);
    // Weather pool: activated when a weather asks for particles, retired once its last particles are down.
    if (this.weatherCountValue > 0) {
      if (!this.weatherActive) this.activateWeather(ctx);
      if (this.weatherCountValue > this.poolEnd) this.poolEnd = this.weatherCountValue;
      const c = this.weatherConfig as WeatherParticles;
      this.weatherUntil = t1 + c.hoehe / Math.max(1, c.fall.min) + WEATHER_LINGER_S;
    } else if (this.weatherActive && t1 > this.weatherUntil) this.weatherActive = false;
    // Births.
    const n = spawnStep(scene.emitters, this.tables.emitters, t0, t1, this.settings.emitterShare, this.ring, this.batch);
    if (n > 0) {
      const records = this.batch.records;
      const first = this.batch.first;
      const head = Math.min(n, RING_CAPACITY - first);
      src.upload(records, 0, head * PARTICLE_FLOATS, (WEATHER_CAPACITY + first) * PARTICLE_STRIDE);
      if (n > head) src.upload(records, head * PARTICLE_FLOATS, (n - head) * PARTICLE_FLOATS, WEATHER_CAPACITY * PARTICLE_STRIDE);
      for (let i = 0; i < n; i++) {
        const d = t0 - (records[i * PARTICLE_FLOATS + P.age] as number) + (records[i * PARTICLE_FLOATS + P.life] as number);
        if (d > this.ringDeath) this.ringDeath = d;
      }
      this.stats.born += n;
    } else if (this.ring.used > 0 && t0 > this.ringDeath) {
      // Every emitted particle is dead: the ring starts from its first slot again (fewer records to step and draw).
      this.ring.reset();
      this.ringDeath = 0;
    }
    const first = this.weatherActive ? 0 : WEATHER_CAPACITY;
    const end = this.rangeEnd();
    if (end > first) {
      const p = this.update as ShaderProgram;
      p.use();
      gl.uniform1f(p.uniform('uDt'), (t1 - t0) / substeps);
      gl.uniform1i(p.uniform('uSubsteps'), substeps);
      gl.uniform1f(p.uniform('uTime'), t1 % TIME_WRAP_S);
      at(this.updateVaos as Pair<VertexArray>, this.current).bind();
      // A buffer bound for transform feedback must not stay bound to another target (WebGL2 §5.1).
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindBufferRange(gl.TRANSFORM_FEEDBACK_BUFFER, 0, dst.handle, first * PARTICLE_STRIDE, (end - first) * PARTICLE_STRIDE);
      gl.enable(gl.RASTERIZER_DISCARD);
      gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS, first, end - first);
      gl.endTransformFeedback();
      gl.disable(gl.RASTERIZER_DISCARD);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
      gl.bindVertexArray(null);
      ctx.stats.drawCalls++;
      this.stats.substeps += substeps;
    }
    this.current = 1 - this.current;
  }
}

/** Flicker left with flash reduction (emissive particles glow steadily, a trace of life stays). */
export const REDUCED_PARTICLE_FLICKER = 0.2;

/** `count` dead records (age 1 ≥ life 0). */
function deadRecords(count: number): Float32Array {
  const out = new Float32Array(count * PARTICLE_FLOATS);
  for (let i = 0; i < count; i++) {
    out[i * PARTICLE_FLOATS + P.age] = DEAD_AGE;
    out[i * PARTICLE_FLOATS + P.life] = DEAD_LIFE;
  }
  return out;
}

/** Floats of the kind table per kind (for tests). */
export const KIND_FLOATS = KIND_ROWS * 4;
