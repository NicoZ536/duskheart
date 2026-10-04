/**
 * `RenderScene.particles` (docs/RENDER.md §4, M5-11/M5-12/M5-21): what the presentation hands the particle passes each
 * frame – the particle sources in view (`emitters`), the weather particles (`weather`), the heat shimmer sources
 * (`distortion`, read by the post chain's distortion buffer or drawn by the particle strand's own shimmer pass) – and
 * what the passes report back (`flash`: the lightning's brightness of the frame, for grading and sound).
 *
 * Storage is preallocated and reused (no allocation per frame); the lists are emptied by `beginFrame`.
 */
import { WEATHER_PARTICLE_IDS, type WeatherParticleId } from '../../content/particles';
import { zeroAt } from '../uniformBits';

/** Initial capacity of the source and shimmer lists (they grow by doubling). */
const INITIAL_EMITTERS = 64;
const INITIAL_DISTORTIONS = 32;

function grown(a: Float32Array, cap: number): Float32Array {
  const b = new Float32Array(cap);
  b.set(a);
  return b;
}

/** Particle sources of the frame (struct of arrays). */
export class EmitterList {
  /** Source index in the content's table (`particleEmitter(id)`). */
  preset: Float32Array;
  /** Ground position [world px] and height of the source above it [px]. */
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  /** Share of the source's rate, 0…1 (a young fire, a dying ember bed). */
  strength: Float32Array;
  /** Stable number of the source (the same fire keeps its sparks' random sequence from frame to frame). */
  id: Float64Array;
  private n = 0;
  private cap = INITIAL_EMITTERS;

  constructor() {
    this.preset = new Float32Array(this.cap);
    this.x = new Float32Array(this.cap);
    this.y = new Float32Array(this.cap);
    this.z = new Float32Array(this.cap);
    this.strength = new Float32Array(this.cap);
    this.id = new Float64Array(this.cap);
  }

  get count(): number {
    return this.n;
  }

  clear(): void {
    this.n = 0;
  }

  /** Adds source `preset` at ground point (x, y), `z` px above it, with `strength` 0…1 and the stable number `id`. */
  push(preset: number, x: number, y: number, z: number, strength: number, id: number): void {
    if (!(strength > 0)) return;
    if (this.n === this.cap) {
      this.cap *= 2;
      this.preset = grown(this.preset, this.cap);
      this.x = grown(this.x, this.cap);
      this.y = grown(this.y, this.cap);
      this.z = grown(this.z, this.cap);
      this.strength = grown(this.strength, this.cap);
      const id = new Float64Array(this.cap);
      id.set(this.id);
      this.id = id;
    }
    const i = this.n++;
    this.preset[i] = preset;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.strength[i] = Math.min(1, strength);
    this.id[i] = id;
  }
}

/**
 * Heat shimmer sources of the frame (§6.2 "Feuer … Hitzeflimmern", M5-21): the air above a fire wavers. Each entry is a
 * column of hot air standing on ground point (x, y), from `z` px above it up `height` px, `width` px wide, displacing the
 * picture behind it by up to `strength` px. The post chain's distortion buffer (M5-13) reads this list; until it claims
 * it (`claimHeatShimmer`, `distortion.ts`) the particle strand's own shimmer pass draws it.
 */
export class DistortionList {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  width: Float32Array;
  height: Float32Array;
  strength: Float32Array;
  private n = 0;
  private cap = INITIAL_DISTORTIONS;

  constructor() {
    this.x = new Float32Array(this.cap);
    this.y = new Float32Array(this.cap);
    this.z = new Float32Array(this.cap);
    this.width = new Float32Array(this.cap);
    this.height = new Float32Array(this.cap);
    this.strength = new Float32Array(this.cap);
  }

  get count(): number {
    return this.n;
  }

  clear(): void {
    this.n = 0;
  }

  push(x: number, y: number, z: number, width: number, height: number, strength: number): void {
    if (!(strength > 0) || !(width > 0) || !(height > 0)) return;
    if (this.n === this.cap) {
      this.cap *= 2;
      this.x = grown(this.x, this.cap);
      this.y = grown(this.y, this.cap);
      this.z = grown(this.z, this.cap);
      this.width = grown(this.width, this.cap);
      this.height = grown(this.height, this.cap);
      this.strength = grown(this.strength, this.cap);
    }
    const i = this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.width[i] = width;
    this.height[i] = height;
    this.strength[i] = strength;
  }
}

/** No weather particles. */
export const NO_WEATHER = -1;

/** Slots of `WeatherParticleState.values`. */
const AMOUNT = 0;
const WIND_X = 1;
const WIND_Y = 2;
const STORM = 3;
const WEATHER_VALUES = 4;

/** The weather particles of the frame (M5-12), set by the game view from the simulation's weather at the camera. */
export class WeatherParticleState {
  /** Index in `WEATHER_PARTICLE_IDS` (`regen`, `schnee`, `asche`, `sand`), or `NO_WEATHER`. */
  kind = NO_WEATHER;
  /**
   * Amount, wind and storm (see the accessors) in a typed record: a filler that keeps its weather between frames hands
   * it over with one copy (`take`), and the particle system copies the wind into its uniform and tells a calm storm from
   * the bits – no float is read (§30).
   */
  readonly values = new Float64Array(WEATHER_VALUES);
  /** The same memory as 32-bit words (`calm`). */
  private readonly words = new Int32Array(this.values.buffer);
  /** The wind as a two-element view (copied into the uniform without a read). */
  readonly windValues = this.values.subarray(WIND_X, WIND_Y + 1);
  /** The amount's words (an unchanged amount is told without a read). */
  readonly amountWords = new Int32Array(this.values.buffer, AMOUNT * Float64Array.BYTES_PER_ELEMENT, 2);
  /** The wind's words (a still wind is told without a read). */
  readonly windWords = new Int32Array(this.values.buffer, WIND_X * Float64Array.BYTES_PER_ELEMENT, 4);
  /** Share of the weather's full density, 0…1 (drizzle 0,25, rain 0,65, thunderstorm 1). */
  get amount(): number {
    return this.values[AMOUNT] as number;
  }
  set amount(v: number) {
    this.values[AMOUNT] = v;
  }
  /** Wind [px/s on screen]: the direction the weather's wind blows towards, times its speed. */
  get windX(): number {
    return this.values[WIND_X] as number;
  }
  set windX(v: number) {
    this.values[WIND_X] = v;
  }
  get windY(): number {
    return this.values[WIND_Y] as number;
  }
  set windY(v: number) {
    this.values[WIND_Y] = v;
  }
  /** Strength of the thunderstorm, 0…1 (lightning flashes; 0 without). */
  get storm(): number {
    return this.values[STORM] as number;
  }
  set storm(v: number) {
    this.values[STORM] = v;
  }
  /** Stable number of the storm (its lightning sequence), e.g. the weather region and period. */
  stormSeed = 0;
  /**
   * False where the sky is not above the camera (caves): every weather particle disappears at once instead of
   * finishing its fall.
   */
  sky = true;

  /** Id of the current weather particles, or null. */
  get id(): WeatherParticleId | null {
    return this.kind === NO_WEATHER ? null : (WEATHER_PARTICLE_IDS[this.kind] ?? null);
  }

  /** Sets the weather particles `id` (null: none) with `amount` 0…1. */
  set(id: WeatherParticleId | null, amount: number): void {
    this.kind = id === null ? NO_WEATHER : WEATHER_PARTICLE_IDS.indexOf(id);
    this.amount = id === null ? 0 : Math.max(0, Math.min(1, amount));
  }

  reset(): void {
    this.kind = NO_WEATHER;
    this.values.fill(0);
    this.stormSeed = 0;
    this.sky = true;
  }

  /** Takes the weather particles, amount, wind and storm of `from` (one copy; `sky` stays). */
  take(from: WeatherParticleState): void {
    this.kind = from.kind;
    this.values.set(from.values);
    this.stormSeed = from.stormSeed;
  }

  /** Whether no thunderstorm rages (its strength exactly 0, told without reading a float, §30). */
  get calm(): boolean {
    return zeroAt(this.words, STORM);
  }
}

/** The particle part of the render scene. */
export class ParticleScene {
  readonly emitters = new EmitterList();
  readonly distortion = new DistortionList();
  /** The weather particles of the frame (none unless the producer sets them). */
  readonly weather = new WeatherParticleState();
  /** Brightness of the lightning in the last frame, 0…1 (written by the particle passes; with flash reduction ≤ its cap). */
  flash = 0;

  /** Empties the per-frame lists (sources, shimmer) and clears the weather. */
  beginFrame(): void {
    this.emitters.clear();
    this.distortion.clear();
    this.weather.reset();
  }
}
