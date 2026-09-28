/**
 * Atmosphere and post state of the game view (M5-10, M5-14, M5-15, M5-22): called by `gameScene.ts`
 * once per frame after it placed the camera, the figure and the lights. Fills
 *
 * - `scene.grading`: biome × daytime × weather, blended – the biomes by their share of a 3 × 3 grid of
 *   samples over the view (a border crossing fades instead of switching), day and night by the
 *   calendar's daylight, the twilight grade by 4·d·(1 − d), the weather by its blend between the
 *   previous and the new state – and eased over time (`GRADING_EASE_SECONDS`) towards that target;
 * - `scene.env.fog*` and `scene.env.heat`: fog density, colour and thickness (biome base, morning mist at
 *   dawn, ground mist at night, the weather's haze in its own colour), the floor it lies on (the ground
 *   level at the camera, eased like the grade), heat shimmer (the biome's under a clear midday sky, the
 *   heat wave's);
 * - `scene.corruption.strength`: the region's corruption at the camera (the biome's base value until
 *   the beacons of M7 lower it per region);
 * - `scene.post`: the player's fear, low health and conditions, the grain, the Bayer cover when the view
 *   changes layer – and the debug pins (`PostOverrides`), applied last.
 *
 * The biome × daytime × weather blend is held per scene and rebuilt only when its inputs moved
 * (`AtmosphereBlend`). Reads the simulation, never writes it. No allocation per frame (preallocated scratch
 * records).
 */
import { CONDITIONS } from '../../content/conditions';
import { BIOMES } from '../../content/biomes';
import { WEATHER_STATE_IDS } from '../../content/weather';
import { createPlayerSample } from '../../game/session';
import { ConditionsSystem } from '../../game/conditions/system';
import { FearSystem } from '../../game/fear/system';
import type { Simulation } from '../../game/sim';
import { NO_WEATHER_REGION } from '../../world/climate/temperature';
import { createWeatherSample, type WeatherSample } from '../../world/climate/weather';
import { WAND_PX_JE_STUFE } from '../../world/autotile';
import type { Layer } from '../../world/model/coords';
import { contentWorldIdTables } from '../../world/model/runtimeIds';
import type { RenderScene } from '../scene';
import { CHUNK_TILES, TILE_SHIFT } from '../tilemap/chunk';
import { addGradingDelta, createGrading, GRADING_PARAM_COUNT, GRADING_REGEN_EPSILON, gradingDistance, mixGrading } from '../post/grading';
import { BIOME_ATMOSPHERE, CORRUPTION_GRADING, FALLBACK_BIOME, HAZE_TO_FOG, MAX_FOG, paletteColor, TWILIGHT_GRADING, VIEW_GRAIN, WEATHER_ATMOSPHERE, type BiomeAtmosphere } from '../post/atmosphereTable';
import { CONDITION_POST_EFFECTS, hurtFromHealth, LAYER_NOT_SHOWN, layerTransition } from '../post/state';
import type { GameWorldBinding } from './gameScene';

/** Time constant of the grade easing towards its target [s] (a biome border fades over ~2 s). */
export const GRADING_EASE_SECONDS = 0.7;
/** Longest frame gap that still eases; a longer gap (a pause, a scene switch) snaps to the target. */
const EASE_MAX_GAP_SECONDS = 1;
/**
 * A grade this close to its target takes it (a sixteenth of the LUT's regeneration step: no visible change) – the easing
 * ends instead of creeping on for ever.
 */
const GRADE_SETTLED = GRADING_REGEN_EPSILON / 16;
/** Time constant of the fog floor following the ground level at the camera [s] (a climb lifts the fog smoothly). */
export const FOG_FLOOR_EASE_SECONDS = 0.8;
/** Samples per axis of the biome grid over the view. */
const BIOME_GRID = 3;
/** Clock hour before which a twilight is the dawn. */
const NOON = 12;
const MINUTES_PER_HOUR = 60;

/** Biome ids with an atmosphere, in table order (index = profile). */
const PROFILE_IDS: readonly string[] = Object.keys(BIOME_ATMOSPHERE);
const PROFILES: readonly BiomeAtmosphere[] = PROFILE_IDS.map((id) => BIOME_ATMOSPHERE[id] as BiomeAtmosphere);
const FALLBACK_PROFILE = PROFILE_IDS.indexOf(FALLBACK_BIOME);
/** Packed day and night grades per profile. */
const DAY_GRADES: readonly Float32Array[] = PROFILES.map((p) => createGrading(p.day));
const NIGHT_GRADES: readonly Float32Array[] = PROFILES.map((p) => createGrading(p.night));
/** Fog colours per profile (display-space RGB). */
const FOG_COLORS: readonly (readonly [number, number, number])[] = PROFILES.map((p) => paletteColor(p.fog.color));
/** Haze colours per weather state (null: the biome's). */
const WEATHER_FOG: Readonly<Record<string, readonly [number, number, number] | null>> = Object.fromEntries(
  WEATHER_STATE_IDS.map((id) => {
    const ref = WEATHER_ATMOSPHERE[id].fogColor;
    return [id, ref === null ? null : paletteColor(ref)];
  }),
);
/** Whether a profile's biome lies underground (no sky: the day grade holds). */
const UNDERGROUND_PROFILE: readonly boolean[] = PROFILE_IDS.map((id) => BIOMES.some((b) => b.id === id && b.layer !== 0));
/** Neutral value per packed index. */
const NEUTRAL: Float32Array = createGrading();

/** Profile index per biome runtime id (index 0 = no biome → −1), built once. */
let profileByRuntimeId: Int16Array | null = null;
function profileOfRuntimeId(rid: number): number {
  if (profileByRuntimeId === null) {
    const biomes = contentWorldIdTables().biomes;
    const table = new Int16Array(biomes.size + 1).fill(-1);
    for (let r = 1; r <= biomes.size; r++) table[r] = PROFILE_IDS.indexOf(biomes.stringId(r));
    profileByRuntimeId = table;
  }
  return profileByRuntimeId[rid] ?? -1;
}

/** Condition content ids with a post effect, checked once against the content. */
for (const id of Object.keys(CONDITION_POST_EFFECTS)) {
  if (!CONDITIONS.some((c) => c.id === id)) throw new Error(`Zustandseffekte: Zustand „${id}“ gibt es im Content nicht`);
}

/** The fear and condition systems of a simulation (looked up once per simulation). */
let systems: { sim: Simulation; fear: FearSystem | null; conditions: ConditionsSystem | null } | null = null;
function systemsOf(sim: Simulation): { fear: FearSystem | null; conditions: ConditionsSystem | null } {
  if (systems === null || systems.sim !== sim) {
    const fear = sim.systems.find((s) => s.id === 'fear');
    const conditions = sim.systems.find((s) => s.id === 'conditions');
    systems = { sim, fear: fear instanceof FearSystem ? fear : null, conditions: conditions instanceof ConditionsSystem ? conditions : null };
  }
  return systems;
}

const scratch = {
  player: createPlayerSample(),
  weights: new Float32Array(PROFILES.length),
  grade: createGrading(),
};
/** The view's grain by night and its rise to the day's (module constants: the frame computes no constant, §30). */
const GRAIN_NIGHT = VIEW_GRAIN.night;
const GRAIN_DAY_MINUS_NIGHT = VIEW_GRAIN.day - VIEW_GRAIN.night;

/** A chunk field's value at the tile under world px (x, y) of `layer`, or `missing` where nothing is loaded. */
function fieldAt(binding: GameWorldBinding, layer: Layer, field: 'biome' | 'height', x: number, y: number, missing: number): number {
  const tx = Math.floor(x) >> TILE_SHIFT;
  const ty = Math.floor(y) >> TILE_SHIFT;
  const cx = Math.floor(tx / CHUNK_TILES);
  const cy = Math.floor(ty / CHUNK_TILES);
  const chunk = binding.host.get(layer, cx, cy);
  return chunk === undefined ? missing : (chunk[field][(ty - cy * CHUNK_TILES) * CHUNK_TILES + (tx - cx * CHUNK_TILES)] as number);
}

/** Shares of the atmosphere profiles on a 3 × 3 grid over the view (sums to 1). */
function sampleBiomes(binding: GameWorldBinding, layer: Layer, cameraX: number, cameraY: number, viewW: number, viewH: number, out: Float32Array): void {
  out.fill(0);
  const share = 1 / (BIOME_GRID * BIOME_GRID);
  for (let j = 0; j < BIOME_GRID; j++) {
    for (let i = 0; i < BIOME_GRID; i++) {
      const x = cameraX + ((i + 0.5) / BIOME_GRID - 0.5) * viewW;
      const y = cameraY + ((j + 0.5) / BIOME_GRID - 0.5) * viewH;
      const rid = fieldAt(binding, layer, 'biome', x, y, 0);
      const p = rid === 0 ? -1 : profileOfRuntimeId(rid);
      const k = p < 0 ? FALLBACK_PROFILE : p;
      out[k] = (out[k] as number) + share;
    }
  }
}

/** Ground level at world px (x, y) of `layer` [px above level 0]; 0 underground (one level) or where nothing is loaded. */
function groundLevelPx(binding: GameWorldBinding, layer: Layer, x: number, y: number): number {
  return layer === 0 ? fieldAt(binding, layer, 'height', x, y, 0) * WAND_PX_JE_STUFE : 0;
}

/** `target += w · (grade − neutral)` for a packed grade. */
function addPacked(target: Float32Array, grade: Float32Array, w: number): void {
  for (let i = 0; i < GRADING_PARAM_COUNT; i++) target[i] = (target[i] as number) + w * ((grade[i] as number) - (NEUTRAL[i] as number));
}

/** Inputs of a blend: layer, daylight, dawn (1) or dusk (0), weather known (1), its blend, haze and cloud cover, then the biome shares. */
const KEY_FIXED = 7;
const KEY_LENGTH = KEY_FIXED + PROFILES.length;
/** Largest move of a blend input that keeps the last blend (far below a visible step; the easing smooths the rest). */
export const BLEND_EPSILON = 1 / 1024;

/**
 * The biome × daytime × weather blend of a scene, held across frames: rebuilt only when one of its inputs
 * moved by more than `BLEND_EPSILON` (the daylight and a weather change drift slowly, the biome shares change
 * at borders) – most frames only copy it. The corruption and the debug pins are applied on top every frame.
 */
class AtmosphereBlend {
  readonly key = new Float64Array(KEY_LENGTH).fill(Number.NaN);
  readonly next = new Float64Array(KEY_LENGTH);
  /** The keys' bit patterns: a frame whose inputs did not change at all compares integers only (§30). */
  readonly keyBits = new Int32Array(this.key.buffer);
  readonly nextBits = new Int32Array(this.next.buffer);
  state = '';
  previous = '';
  /** Grade of biome, daytime and weather (without corruption). */
  readonly grade = createGrading();
  /** Fog density, colour, thickness, heat shimmer, corruption of the biomes. */
  readonly out = new Float64Array(BLEND_OUT_LENGTH);
  /** Whether the blend has heat shimmer and corruption (a frame without reads neither value). */
  hasHeat = false;
  hasCorruption = false;
  /** Blends built so far (statistics, tests). */
  builds = 0;
  /** The build whose fog colour and thickness are in the scene's environment (only this filler writes them). */
  written = -1;
  /**
   * The weather at the camera as last sampled: the simulation, tick, region and weather period it is valid for (the
   * simulation moves once per tick; a forced weather starts a new period).
   */
  readonly weather: WeatherSample = createWeatherSample();
  weatherSim: Simulation | null = null;
  weatherTick = -1;
  weatherRegion = NO_WEATHER_REGION;
  weatherPeriod = -1;
  /** The grade has reached its target (the easing is done until the target moves), and what that target was made of. */
  settled = false;
  targetBuild = -1;
  targetCorruption = 0;
}

/** Slots of `AtmosphereBlend.out`. */
const OUT_FOG = 0;
const OUT_FOG_R = 1;
const OUT_FOG_G = 2;
const OUT_FOG_B = 3;
const OUT_FOG_HEIGHT = 4;
const OUT_HEAT = 5;
const OUT_CORRUPTION = 6;
const BLEND_OUT_LENGTH = 7;

const blends = new WeakMap<RenderScene, AtmosphereBlend>();

/** Blends built for `scene` so far (tests: a still frame builds none). */
export function atmosphereBlendBuilds(scene: RenderScene): number {
  return blends.get(scene)?.builds ?? 0;
}

/**
 * Whether a blend input moved by more than `BLEND_EPSILON` (NaN – never built – counts as moved). Inputs whose bits did
 * not change at all (a still frame) are recognised without reading a float.
 */
function keyMoved(b: AtmosphereBlend): boolean {
  const kb = b.keyBits;
  const nb = b.nextBits;
  let same = true;
  for (let i = 0; i < kb.length; i++) {
    if (kb[i] !== nb[i]) {
      same = false;
      break;
    }
  }
  if (same) return false;
  const key = b.key;
  const next = b.next;
  for (let i = 0; i < KEY_LENGTH; i++) {
    const a = key[i] as number;
    const b = next[i] as number;
    if (!(Math.abs(a - b) <= BLEND_EPSILON)) return true;
  }
  return false;
}

/** Builds the blend from its inputs (`b.next`, the weather sample `w` when the key says it is known). */
function buildBlend(b: AtmosphereBlend, w: WeatherSample): void {
  const k0 = b.next;
  const surface = (k0[0] as number) === 0;
  const d = k0[1] as number;
  const morning = (k0[2] as number) === 1;
  const weather = (k0[3] as number) === 1;
  const twilight = surface ? 4 * d * (1 - d) : 0;
  const target = b.grade;
  target.set(NEUTRAL);
  const grade = scratch.grade;
  let fog = 0;
  let fogR = 0;
  let fogG = 0;
  let fogB = 0;
  let fogHeight = 0;
  let heat = 0;
  let corruption = 0;
  for (let k = 0; k < PROFILES.length; k++) {
    const share = k0[KEY_FIXED + k] as number;
    if (share <= 0) continue;
    const p = PROFILES[k] as BiomeAtmosphere;
    const underground = UNDERGROUND_PROFILE[k] as boolean;
    mixGrading(grade, NIGHT_GRADES[k] as Float32Array, DAY_GRADES[k] as Float32Array, underground ? 1 : d);
    addPacked(target, grade, share);
    const density = p.fog.base + (surface && morning ? p.fog.mist * twilight : 0) + (surface ? p.fog.night * (1 - d) : 0);
    fog += share * density;
    const c = FOG_COLORS[k] as readonly [number, number, number];
    fogR += share * c[0];
    fogG += share * c[1];
    fogB += share * c[2];
    fogHeight += share * p.fog.heightPx;
    heat += share * p.heat * (underground ? 1 : d * (1 - (weather ? w.cloudCover : 0)));
    corruption += share * p.corruption;
  }
  addGradingDelta(target, morning ? TWILIGHT_GRADING.dawn : TWILIGHT_GRADING.dusk, twilight);
  if (weather) {
    const now = WEATHER_ATMOSPHERE[w.state];
    const before = WEATHER_ATMOSPHERE[w.previous];
    addGradingDelta(target, now.grading, w.blend);
    addGradingDelta(target, before.grading, 1 - w.blend);
    heat += (now.heat * w.blend + before.heat * (1 - w.blend)) * d;
    // The weather's haze, in its own colour and height where it has one.
    const haze = w.haze * HAZE_TO_FOG;
    if (haze > 0) {
      const own = WEATHER_FOG[w.blend >= 0.5 ? w.state : w.previous] ?? null;
      const height = (w.blend >= 0.5 ? now.fogHeightPx : before.fogHeightPx) ?? fogHeight;
      const share = haze / (fog + haze);
      if (own !== null) {
        fogR += (own[0] - fogR) * share;
        fogG += (own[1] - fogG) * share;
        fogB += (own[2] - fogB) * share;
      }
      fogHeight += (height - fogHeight) * share;
      fog += haze;
    }
  }
  const out = b.out;
  out[OUT_FOG] = Math.min(MAX_FOG, fog);
  out[OUT_FOG_R] = fogR;
  out[OUT_FOG_G] = fogG;
  out[OUT_FOG_B] = fogB;
  out[OUT_FOG_HEIGHT] = fogHeight;
  out[OUT_HEAT] = Math.min(1, heat);
  out[OUT_CORRUPTION] = corruption;
  b.hasHeat = (out[OUT_HEAT] as number) !== 0;
  b.hasCorruption = corruption !== 0;
  b.key.set(k0);
  b.state = weather ? w.state : '';
  b.previous = weather ? w.previous : '';
  b.builds++;
}

/**
 * Fills the atmosphere and post state of the frame (see module comment) for the view of `layer` centred
 * on world px (`cameraX`, `cameraY`), `viewW` × `viewH` internal px, at presentation second `time`.
 */
export function fillAtmosphere(scene: RenderScene, binding: GameWorldBinding, layer: Layer, cameraX: number, cameraY: number, viewW: number, viewH: number, time: number): void {
  const sim = binding.session.sim;
  const env = scene.env;
  const post = scene.post;
  const surface = layer === 0;
  let b = blends.get(scene);
  if (b === undefined) {
    b = new AtmosphereBlend();
    blends.set(scene, b);
  }
  const key = b.next;
  sampleBiomes(binding, layer, cameraX, cameraY, viewW, viewH, scratch.weights);
  key.set(scratch.weights, KEY_FIXED);

  // Daylight (underground: no sky, the day grade holds) and the weather of the camera's region – sampled again only
  // when the simulation moved on (a tick, a new weather period) or the camera entered another region.
  const d = surface ? sim.world.calendar.daylight : 1;
  const w = b.weather;
  let weather = 0;
  if (surface && sim.world.materialized) {
    const region = sim.world.regionAt(Math.floor(cameraX) >> TILE_SHIFT, Math.floor(cameraY) >> TILE_SHIFT);
    if (region !== NO_WEATHER_REGION) {
      const tick = sim.tick;
      const period = sim.world.weather.periodCount(region);
      if (sim !== b.weatherSim || tick !== b.weatherTick || region !== b.weatherRegion || period !== b.weatherPeriod) {
        sim.world.weather.sample(region, w);
        b.weatherSim = sim;
        b.weatherTick = tick;
        b.weatherRegion = region;
        b.weatherPeriod = period;
        key[4] = w.blend;
        key[5] = w.haze;
        key[6] = w.cloudCover;
      }
      weather = 1;
    }
  }
  if (weather === 0) {
    b.weatherSim = null;
    key[4] = 0;
    key[5] = 0;
    key[6] = 0;
  }
  key[0] = layer;
  key[1] = d;
  key[2] = sim.clock.minuteOfDay < NOON * MINUTES_PER_HOUR ? 1 : 0;
  key[3] = weather;
  if (keyMoved(b) || (weather === 1 && (w.state !== b.state || w.previous !== b.previous))) buildBlend(b, w);
  const out = b.out;
  // Fog and heat start every frame at 0 and corruption at none (`RenderScene.beginFrame`); the fog's colour and
  // thickness stay in the environment – written again only by a new blend.
  env.fog = out[OUT_FOG] as number;
  if (b.hasHeat) env.heat = out[OUT_HEAT] as number;
  if (b.hasCorruption) scene.corruption.strength = out[OUT_CORRUPTION] as number;
  if (b.written !== b.builds) {
    env.fogR = out[OUT_FOG_R] as number;
    env.fogG = out[OUT_FOG_G] as number;
    env.fogB = out[OUT_FOG_B] as number;
    env.fogHeight = out[OUT_FOG_HEIGHT] as number;
    b.written = b.builds;
  }
  const target = scene.grading.target;
  target.set(b.grade);

  // The player: fear, low health, conditions.
  const pl = scratch.player;
  if (binding.session.samplePlayer(pl) && pl.layer === layer) {
    post.hurt = hurtFromHealth(pl.health, pl.maxHealth);
    const { fear, conditions } = systemsOf(sim);
    if (fear !== null) post.fear = Math.max(0, Math.min(1, fear.state.value / 100));
    if (conditions !== null) {
      const active = conditions.active();
      for (let i = 0; i < active.length; i++) {
        const e = CONDITION_POST_EFFECTS[(active[i] as { id: string }).id];
        if (e === undefined) continue;
        if (e.heat !== undefined) post.heat = Math.max(post.heat, e.heat);
        if (e.cold !== undefined) post.cold = Math.max(post.cold, e.cold);
        if (e.poison !== undefined) post.poison = Math.max(post.poison, e.poison);
        if (e.drunk !== undefined) post.drunk = Math.max(post.drunk, e.drunk);
        if (e.tired !== undefined) post.tired = Math.max(post.tired, e.tired);
      }
    }
  }
  post.grain = GRAIN_NIGHT + GRAIN_DAY_MINUS_NIGHT * d;

  // A Bayer cover when the view changes layer (only while presentation time runs: a frozen frame shows no cover).
  const g = scene.grading;
  const easedAt = g.easedAt;
  const running = time !== easedAt;
  if (layer !== post.layerShown) {
    if (post.layerShown === LAYER_NOT_SHOWN) post.layerShown = layer;
    else {
      post.layerShown = layer;
      post.layerChangedAt = running ? time : Number.NaN;
    }
  }
  // No change of layer yet (NaN): no cover – and no time difference is formed.
  const changedAt = post.layerChangedAt;
  if (changedAt === changedAt) post.transition = layerTransition(time - changedAt);

  // Debug pins last, then corruption pulls the grade towards its own.
  post.overrides.applyTo(post, scene.grading, scene.corruption, time);
  const corruption = scene.corruption.strength;
  if (corruption !== 0) addGradingDelta(target, CORRUPTION_GRADING, corruption);

  // Ease the grade towards its target and the fog floor towards the ground level at the camera (a frozen
  // or paused frame snaps). A grade within `GRADE_SETTLED` of its target takes it and stays there until the target
  // moves – a new blend, another corruption strength (§30: a still picture eases nothing).
  if (b.targetBuild !== b.builds || corruption !== b.targetCorruption) {
    b.targetBuild = b.builds;
    b.targetCorruption = corruption;
    b.settled = false;
  }
  const dt = time - easedAt;
  const floor = groundLevelPx(binding, layer, cameraX, cameraY);
  if (!(dt > 0) || dt > EASE_MAX_GAP_SECONDS) {
    g.params.set(target);
    b.settled = true;
    env.fogFloor = floor;
  } else {
    if (!b.settled) {
      mixGrading(g.params, g.params, target, 1 - Math.exp(-dt / GRADING_EASE_SECONDS));
      if (gradingDistance(g.params, target) <= GRADE_SETTLED) {
        g.params.set(target);
        b.settled = true;
      }
    }
    const fogFloor = env.fogFloor;
    if (fogFloor !== floor) env.fogFloor = fogFloor + (floor - fogFloor) * (1 - Math.exp(-dt / FOG_FLOOR_EASE_SECONDS));
  }
  g.easedAt = time;
  if (post.overrides.grading !== false) g.active = true;
}
