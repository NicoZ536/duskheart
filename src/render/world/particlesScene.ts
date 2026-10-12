/**
 * The particle part of the game view (docs/RENDER.md §4 "Szene", M5-12, M5-21): fills `scene.particles` from the
 * simulation – read only – once per frame (`gameScene.ts` calls `fill`):
 * - **Weather particles** from the weather at the camera (`WeatherSystem.sample` of its region): rain, snow, ash or
 *   sand with the blended precipitation as amount (`weatherChoice`), drifting with the weather's wind – its strength
 *   from the weather, its direction the one the fire simulation spreads with (`windDirection` of the region's weather
 *   period), so smoke, rain and flames lean the same way; the thunderstorm's share lights the lightning. Caves have no
 *   sky: no weather particles there.
 * - **Sparks and smoke of the player's fires** (the light source list, M3-22): a burning camp fire sparks, smokes and
 *   glows by its brightness, its hot air shimmers; a lit torch – placed or carried – throws a spark now and then
 *   and trails a thin wisp – a carried one from where the light pass draws it (in the hand, or at the hip on the belt,
 *   `carriedLightAt`). Burning tiles of the fire simulation are the fire view's (`../game/fire.ts`).
 * - **Moths at the lights** (M7-149, `LIGHT_VISITORS` of the particle data): on the surface at night (daylight under the
 *   visitor's threshold), in its seasons and with the air clear (no precipitation, no sand), every placed light of its kinds
 *   in view gets its source at the flame – a camp fire by its brightness, a carried light none (it moves on). Whether they
 *   fly is read once per tick (the calendar and the weather move with the simulation).
 *
 * No allocation per frame.
 */
import { BALANCE } from '../../content/balance';
import { LIGHT_VISITORS } from '../../content/particles';
import { hash2, normalizeSeed } from '../../engine/rng';
import { windDirection } from '../../game/fire/formulas';
import { CARRIED_LIGHT_ID } from '../../game/light/system';
import type { Simulation } from '../../game/sim';
import { createWeatherSample, type WeatherSample } from '../../world/climate/weather';
import { NO_WEATHER_REGION } from '../../world/climate/temperature';
import type { Layer } from '../../world/model/coords';
import { carriedLightAt, lightSystemOf, type CarriedLightPlace } from '../game/lights';
import { particleEmitter } from '../particles/tables';
import { createWeatherChoice, weatherChoice, windVelocity, type WeatherChoice } from '../particles/weather';
import { WeatherParticleState } from '../particles/sceneParticles';
import type { RenderScene } from '../scene';
import { TILE_PX, TILE_SHIFT } from '../tilemap/chunk';

/** Light kinds whose flames throw particles (src/content/lights.ts). */
const TORCH_KIND = 'fackel';
const CAMP_FIRE_KIND = 'lagerfeuer';
/** Sparks begin above this share of a camp fire's full brightness (embers alone do not spark); smoke follows the brightness. */
const SPARK_FROM = 0.3;
/** Column of hot air over a burning camp fire: above the flame [px], width, height [px], strongest displacement [px]. */
export const CAMP_FIRE_SHIMMER = { above: 4, width: 14, height: 28, strength: 1.5 } as const;
/** Margin around the view in which sources still emit (their smoke drifts into view) [px]. */
const MARGIN_PX = 4 * TILE_PX;
/** Half size of the largest internal view (§4.2: 640 × 270) [px]. */
const VIEW_HALF = { w: 320, h: 135 } as const;
/** Salt of the storm's lightning sequence. */
const STORM_SALT = 0x5707;
/** A camp fire's full intensity (a module constant: read without a property lookup per frame, §30). */
const CAMP_FIRE_FULL = BALANCE.light.campfire.intensity;

/** What the filler needs of the game view's frame. */
export interface ParticleFrame {
  /** The camera's tile [whole tiles] (the weather is looked up there). */
  tileX: number;
  tileY: number;
  layer: Layer;
  /** View centre [world px] and the half size of the largest view [px]. */
  cameraX: number;
  cameraY: number;
  halfWidth: number;
  halfHeight: number;
  /** The figure as drawn (the carried torch follows it). */
  hasFigure: boolean;
  figureX: number;
  figureY: number;
}

export function createParticleFrame(): ParticleFrame {
  return { tileX: 0, tileY: 0, layer: 0, cameraX: 0, cameraY: 0, halfWidth: 0, halfHeight: 0, hasFigure: false, figureX: 0, figureY: 0 };
}

export class ParticleSceneFiller {
  private readonly sample: WeatherSample = createWeatherSample();
  private readonly choice: WeatherChoice = createWeatherChoice();
  private readonly wind = { x: 0, y: 0 };
  private readonly offset = { dx: 0, dy: 0 };
  private readonly carried: CarriedLightPlace = { x: 0, y: 0, height: 0 };
  private presets: { sparks: number; smoke: number; embers: number; torchSparks: number; torchSmoke: number } | null = null;
  /** Light kind → its visitor (index in `LIGHT_VISITORS`, M7-149), built on the first frame. */
  private visitorOf: Map<string, number> | null = null;
  /** Per visitor: its source (preset index) and whether it flies this tick (1) – read once per tick (`visitorsOf`). */
  private readonly visitorPreset = new Int32Array(LIGHT_VISITORS.length);
  private readonly visitorFlies = new Uint8Array(LIGHT_VISITORS.length);
  private visitorSim: Simulation | null = null;
  private visitorTick = -1;
  private visitorLayer: Layer = 0;
  /**
   * The air at the camera on the surface is clear (no precipitation, no sand): from the weather sample, or – before the world
   * is materialized, outside every weather region – nothing falls. False below ground and before the first weather fill.
   */
  private airClear = false;
  /**
   * The simulation, tick, region and weather period the weather choice, wind and storm seed were taken for (§30: the
   * simulation moves once per tick – a frame in between, or a still picture, reuses them).
   */
  private weatherSim: Simulation | null = null;
  private weatherTick = -1;
  private weatherRegion = NO_WEATHER_REGION;
  private weatherPeriod = -1;
  /** The weather particles of the last sample, handed to every frame with one copy (`WeatherParticleState.take`, §30). */
  private readonly state = new WeatherParticleState();

  private readonly frame = createParticleFrame();

  /**
   * Fills `scene.particles` from `sim` for the view on `layer` centred on world px (`cameraX`, `cameraY`); the figure
   * drawn at (`figureX`, `figureY`) when `hasFigure` (the carried torch follows it).
   */
  fill(scene: RenderScene, sim: Simulation, layer: Layer, cameraX: number, cameraY: number, hasFigure: boolean, figureX: number, figureY: number): void {
    this.fillWeather(scene, sim, layer, cameraX, cameraY);
    this.fillFlames(scene, sim, layer, cameraX, cameraY, hasFigure, figureX, figureY);
  }

  /** The weather particles of the region at the camera (needs the simulation's world). */
  fillWeather(scene: RenderScene, sim: Simulation, layer: Layer, cameraX: number, cameraY: number): void {
    this.weather(scene, sim, this.frameOf(layer, cameraX, cameraY, false, 0, 0));
  }

  /** Sparks and smoke of the player's fires and torches in view. */
  fillFlames(scene: RenderScene, sim: Simulation, layer: Layer, cameraX: number, cameraY: number, hasFigure: boolean, figureX: number, figureY: number): void {
    this.flames(scene, sim, this.frameOf(layer, cameraX, cameraY, hasFigure, figureX, figureY));
  }

  private frameOf(layer: Layer, cameraX: number, cameraY: number, hasFigure: boolean, figureX: number, figureY: number): ParticleFrame {
    const f = this.frame;
    f.layer = layer;
    f.tileX = Math.floor(cameraX) >> TILE_SHIFT;
    f.tileY = Math.floor(cameraY) >> TILE_SHIFT;
    f.cameraX = cameraX;
    f.cameraY = cameraY;
    f.halfWidth = VIEW_HALF.w;
    f.halfHeight = VIEW_HALF.h;
    f.hasFigure = hasFigure;
    f.figureX = figureX;
    f.figureY = figureY;
    return f;
  }

  private weather(scene: RenderScene, sim: Simulation, f: ParticleFrame): void {
    const w = scene.particles.weather;
    this.airClear = false;
    if (f.layer !== 0) {
      w.sky = false;
      return;
    }
    this.airClear = true;
    if (!sim.world.materialized) return;
    const region = sim.world.regionAt(f.tileX, f.tileY);
    if (region === NO_WEATHER_REGION) return;
    const weather = sim.world.weather;
    const period = weather.periodCount(region);
    const tick = sim.tick;
    if (sim !== this.weatherSim || tick !== this.weatherTick || region !== this.weatherRegion || period !== this.weatherPeriod) {
      this.weatherSim = sim;
      this.weatherTick = tick;
      this.weatherRegion = region;
      this.weatherPeriod = period;
      const s = weather.sample(region, this.sample);
      weatherChoice(s, this.choice);
      windVelocity(windDirection(normalizeSeed(sim.config.seed), region, period), s.wind, this.wind);
      const c = this.choice;
      const state = this.state;
      state.set(c.id, c.amount);
      state.windX = this.wind.x;
      state.windY = this.wind.y;
      state.storm = c.storm;
      state.stormSeed = hash2(region, period, STORM_SALT);
    }
    this.airClear = this.choice.id === null;
    w.take(this.state);
  }

  /**
   * Whether each visitor of the lights flies (M7-149): on the surface, with the air clear, at daylight under its threshold, in
   * one of its seasons. `flames` asks once per tick and layer (the calendar and the weather move with the simulation; the
   * check stands there, so a frame between two ticks calls nothing).
   */
  private visitorsOf(sim: Simulation, layer: Layer): void {
    if (this.visitorOf === null) {
      const map = new Map<string, number>();
      LIGHT_VISITORS.forEach((v, i) => {
        this.visitorPreset[i] = particleEmitter(v.emitter);
        for (const kind of v.lichter) map.set(kind, i);
      });
      this.visitorOf = map;
    }
    this.visitorSim = sim;
    this.visitorTick = sim.tick;
    this.visitorLayer = layer;
    this.visitorFlies.fill(0);
    // Clear air on the surface was read from a world (`weather`): only then is there a calendar to ask.
    if (layer !== 0 || !this.airClear) return;
    const cal = sim.world.calendar;
    const daylight = cal.daylight;
    const season = cal.season;
    for (let i = 0; i < LIGHT_VISITORS.length; i++) {
      const v = LIGHT_VISITORS[i];
      if (v !== undefined && daylight < v.tageslichtUnter && v.jahreszeiten.includes(season)) this.visitorFlies[i] = 1;
    }
  }

  private flames(scene: RenderScene, sim: Simulation, f: ParticleFrame): void {
    const light = lightSystemOf(sim);
    if (light === null) return;
    const p = (this.presets ??= {
      sparks: particleEmitter('lagerfeuer_funken'),
      smoke: particleEmitter('lagerfeuer_rauch'),
      embers: particleEmitter('lagerfeuer_glut'),
      torchSparks: particleEmitter('fackel_funken'),
      torchSmoke: particleEmitter('fackel_rauch'),
    });
    const e = scene.particles.emitters;
    const full = CAMP_FIRE_FULL;
    if (this.visitorOf === null || sim !== this.visitorSim || sim.tick !== this.visitorTick || f.layer !== this.visitorLayer) this.visitorsOf(sim, f.layer);
    const visitorOf = this.visitorOf as Map<string, number>;
    const sources = light.sources(sim);
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      if (s === undefined || s.layer !== f.layer) continue;
      let x = s.x;
      let y = s.y;
      let height = s.height;
      if (s.id === CARRIED_LIGHT_ID) {
        if (!f.hasFigure) continue;
        // Where the light pass draws it: in the hand, or at the hip when it hangs on the belt (M6-Gate, `carriedLightAt`).
        const at = carriedLightAt(light, sim, s, f.figureX, f.figureY, this.offset, this.carried);
        x = at.x;
        y = at.y;
        height = at.height;
      }
      if (Math.abs(x - f.cameraX) > f.halfWidth + MARGIN_PX || Math.abs(y - f.cameraY) > f.halfHeight + MARGIN_PX) continue;
      // Four stable numbers per light: sparks, smoke, embers – and its moths (M7-149).
      const id = s.id * 4;
      const fire = s.kind === CAMP_FIRE_KIND;
      const b = fire ? Math.max(0, Math.min(1, s.intensity / full)) : 1;
      if (s.kind === TORCH_KIND) {
        e.push(p.torchSparks, x, y, height, 1, id);
        e.push(p.torchSmoke, x, y, height, 1, id + 1);
      } else if (fire) {
        // Pushed at full strength, the brightness written into the lists' slots (a fraction passes no call, ADR-0274).
        if (b > SPARK_FROM) {
          e.push(p.sparks, x, y, s.height, 1, id);
          e.strength[e.count - 1] = (b - SPARK_FROM) / (1 - SPARK_FROM);
        }
        if (b > 0) {
          e.push(p.smoke, x, y, s.height, 1, id + 1);
          e.strength[e.count - 1] = b;
        }
        e.push(p.embers, x, y, 0, 1, id + 2);
        if (b > SPARK_FROM) {
          const heat = scene.particles.distortion;
          heat.push(x, y, s.height + CAMP_FIRE_SHIMMER.above, CAMP_FIRE_SHIMMER.width, CAMP_FIRE_SHIMMER.height, 1);
          heat.strength[heat.count - 1] = CAMP_FIRE_SHIMMER.strength * b;
        }
      }
      const visitor = visitorOf.get(s.kind);
      if (visitor === undefined || this.visitorFlies[visitor] !== 1 || s.id === CARRIED_LIGHT_ID || !(b > 0)) continue;
      // Pushed at full strength; a camp fire's brightness is written into the list's slot (a fraction passes no call).
      e.push(this.visitorPreset[visitor] as number, x, y, height, 1, id + 3);
      if (fire) e.strength[e.count - 1] = b;
    }
  }
}
