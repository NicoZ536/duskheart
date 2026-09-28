/**
 * `RenderScene` (docs/RENDER.md §3): what the presentation layer hands the renderer each frame –
 * camera, sprites, lights, environment, time. Filled per frame into preallocated storage (no
 * allocation per frame); the renderer only reads it.
 */
import type { AtlasData } from './assets/atlas';
import { SpriteDesc, SpriteList } from './batch/spriteList';
import { Camera } from './camera';
import type { RenderContext } from './passes/registry';
import { WorldUiList } from './worldUi/worldUi';
import { DebugOverlayList } from './debugOverlay';
import { SkyState } from './light/sky';
import { SurfaceState } from './surface/state';
import { PostState } from './post/state';
import { GradingState } from './post/grading';
import { CorruptionState } from './post/corruption';
import { ParticleScene } from './particles/sceneParticles';
import { WaterState } from './water/state';

/** Initial light capacity (grows by doubling; §30: up to 256 lights on "Ultra"). */
export const DEFAULT_LIGHT_CAPACITY = 256;
/** A cone angle of a full turn or more is a point light. */
export const FULL_CIRCLE = Math.PI * 2;

/**
 * One light (`LightInstance`): world position of its footprint, height above the ground, radius,
 * linear colour, intensity, flicker amount (0…1, phase from `seed`) and an optional cone.
 * The list comes from the same source as the gameplay light map (§12.1).
 */
export class LightDesc {
  x = 0;
  y = 0;
  height = 0;
  radius = 0;
  r = 1;
  g = 1;
  b = 1;
  intensity = 1;
  flicker = 0;
  seed = 0;
  coneDirection = 0;
  coneAngle = FULL_CIRCLE;

  reset(): this {
    this.x = 0;
    this.y = 0;
    this.height = 0;
    this.radius = 0;
    this.r = 1;
    this.g = 1;
    this.b = 1;
    this.intensity = 1;
    this.flicker = 0;
    this.seed = 0;
    this.coneDirection = 0;
    this.coneAngle = FULL_CIRCLE;
    return this;
  }
}

/** Struct-of-arrays light storage, read by the lighting passes. */
export class LightList {
  x: Float32Array;
  y: Float32Array;
  height: Float32Array;
  radius: Float32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  intensity: Float32Array;
  flicker: Float32Array;
  seed: Float32Array;
  coneDirection: Float32Array;
  coneAngle: Float32Array;
  private n = 0;
  private cap: number;

  constructor(capacity = DEFAULT_LIGHT_CAPACITY) {
    this.cap = Math.max(1, Math.floor(capacity));
    this.x = new Float32Array(this.cap);
    this.y = new Float32Array(this.cap);
    this.height = new Float32Array(this.cap);
    this.radius = new Float32Array(this.cap);
    this.r = new Float32Array(this.cap);
    this.g = new Float32Array(this.cap);
    this.b = new Float32Array(this.cap);
    this.intensity = new Float32Array(this.cap);
    this.flicker = new Float32Array(this.cap);
    this.seed = new Float32Array(this.cap);
    this.coneDirection = new Float32Array(this.cap);
    this.coneAngle = new Float32Array(this.cap);
  }

  get count(): number {
    return this.n;
  }

  get capacity(): number {
    return this.cap;
  }

  clear(): void {
    this.n = 0;
  }

  private grow(): void {
    const cap = this.cap * 2;
    const g = (a: Float32Array): Float32Array => {
      const b = new Float32Array(cap);
      b.set(a);
      return b;
    };
    this.x = g(this.x);
    this.y = g(this.y);
    this.height = g(this.height);
    this.radius = g(this.radius);
    this.r = g(this.r);
    this.g = g(this.g);
    this.b = g(this.b);
    this.intensity = g(this.intensity);
    this.flicker = g(this.flicker);
    this.seed = g(this.seed);
    this.coneDirection = g(this.coneDirection);
    this.coneAngle = g(this.coneAngle);
    this.cap = cap;
  }

  push(l: LightDesc): number {
    if (this.n === this.cap) this.grow();
    const i = this.n++;
    this.x[i] = l.x;
    this.y[i] = l.y;
    this.height[i] = l.height;
    this.radius[i] = l.radius;
    this.r[i] = l.r;
    this.g[i] = l.g;
    this.b[i] = l.b;
    this.intensity[i] = l.intensity;
    this.flicker[i] = l.flicker;
    this.seed[i] = l.seed;
    this.coneDirection[i] = l.coneDirection;
    this.coneAngle[i] = l.coneAngle;
    return i;
  }
}

/** Environment of the frame (daytime, biome, weather, cave), read by lighting and post passes. */
export interface RenderEnvironment {
  /** Palette index (1…64) shown where nothing is drawn. */
  background: number;
  /** Ambient light colour (linear) and strength (caves ≈ 0). */
  ambientR: number;
  ambientG: number;
  ambientB: number;
  ambientIntensity: number;
  /** Signed wind strength (sign = direction along x) for swaying sprites. */
  wind: number;
  /** Global wetness 0…1 (rain). */
  wetness: number;
  /** Fog density 0…1. */
  fog: number;
  /** Time of day 0…1 (0 = midnight). */
  dayFraction: number;
  /** Fog colour (display space, lit by the ambient light) and its thickness above its floor, where it has thinned out [px] (atmosphere, M5-10). */
  fogR: number;
  fogG: number;
  fogB: number;
  fogHeight: number;
  /** Floor the fog lies on [px above terrain level 0]: the ground level at the camera (atmosphere, M5-10). */
  fogFloor: number;
  /** Heat shimmer over the whole view 0…1 (hot biome at midday, heat wave; atmosphere, M5-10). */
  heat: number;
}

/** Picture-wide state effects of the post pass (see `RenderScene.post`). */
export interface PostEffects {
  lid: number;
  frost: number;
}

/** Something drawn into the G-buffer before the sprites (static chunk meshes of the ground). */
export interface GBufferDrawable {
  drawGBuffer(ctx: RenderContext): void;
}

export class RenderScene {
  readonly camera = new Camera();
  readonly sprites = new SpriteList();
  readonly lights = new LightList();
  /** World-near UI of the frame: names, bars, damage numbers, interaction markers (drawn last, unlit). */
  readonly worldUi = new WorldUiList();
  /** Debug overlays of the frame (chunk borders, collision, temperature field; drawn unlit below the world UI). */
  readonly debugOverlay = new DebugOverlayList();
  /** Reusable descriptors for producers. */
  readonly sprite = new SpriteDesc();
  readonly light = new LightDesc();
  readonly env: RenderEnvironment = {
    background: 1,
    ambientR: 1,
    ambientG: 1,
    ambientB: 1,
    ambientIntensity: 1,
    wind: 0,
    wetness: 0,
    fog: 0,
    dayFraction: 0.5,
    fogR: 1,
    fogG: 1,
    fogB: 1,
    fogHeight: 0,
    fogFloor: 0,
    heat: 0,
  };
  /** Ground geometry drawn before the ground sprites (filled by the tile map). */
  readonly ground: GBufferDrawable[] = [];
  /** Atlas the sprites reference (their frames are rectangles in it). */
  atlas: AtlasData | null = null;
  /** Presentation time in seconds (frozen in screenshots). */
  time = 0;
  /** Canopy/roof see-through circle around the player: world px centre and radius (0 = off). */
  fadeX = 0;
  fadeY = 0;
  fadeRadius = 0;
  /**
   * State effects of the post pass (§6.1 pass 9 "Zustandseffekte"; M3-20, M5-15): eyelids, frost rim, fear,
   * low health, heat, cold, poison, intoxication, exhaustion, vignette, grain, transitions and the frame's
   * distortion sources (`post/state.ts`). Reset every frame; 0 is no effect.
   */
  readonly post = new PostState();
  /** Colour grade of the frame (biome × daytime × weather, M5-14; inactive = the palette as painted). */
  readonly grading = new GradingState();
  /** Corruption of the region at the camera (palette shift and glowing veins, M5-22). */
  readonly corruption = new CorruptionState();
  /** Sun and moon, their shadows, clouds and the terrain/building occluders of the frame (light strand, M5-01 … M5-04). */
  readonly sky = new SkyState();
  /** Wind, wetness, puddles, snow, seasonal foliage, grass benders and footprints of the frame (world surface, M5-17 … M5-20). */
  readonly surface = new SurfaceState();
  /** Particle sources, weather particles, heat shimmer and the lightning of the frame (particle strand, M5-11, M5-12, M5-21). */
  readonly particles = new ParticleScene();
  /** Wave impulses, the water tile grid, figures in the water and the mirrored sky of the frame (water strand, M5-07 … M5-09). */
  readonly water = new WaterState();

  /** Starts a new frame: empties the per-frame lists. */
  beginFrame(time: number): void {
    this.time = time;
    this.sprites.clear();
    this.lights.clear();
    this.worldUi.clear();
    this.debugOverlay.clear();
    this.sky.beginFrame();
    this.surface.beginFrame();
    this.post.beginFrame();
    this.grading.beginFrame();
    this.corruption.beginFrame();
    // Fog and heat shimmer only where a scene asks for them this frame (no leftovers after a scene switch).
    this.env.fog = 0;
    this.env.heat = 0;
    this.particles.beginFrame();
    this.water.beginFrame();
  }
}
