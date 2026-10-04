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
 *   and trails a thin wisp. Burning tiles of the fire simulation are the fire view's (`../game/fire.ts`).
 *
 * No allocation per frame.
 */
import { BALANCE } from '../../content/balance';
import { hash2, normalizeSeed } from '../../engine/rng';
import { windDirection } from '../../game/fire/formulas';
import { CARRIED_LIGHT_ID } from '../../game/light/system';
import type { Simulation } from '../../game/sim';
import { createWeatherSample, type WeatherSample } from '../../world/climate/weather';
import { NO_WEATHER_REGION } from '../../world/climate/temperature';
import type { Layer } from '../../world/model/coords';
import { lightSystemOf } from '../game/lights';
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
  private presets: { sparks: number; smoke: number; embers: number; torchSparks: number; torchSmoke: number } | null = null;
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
    if (f.layer !== 0) {
      w.sky = false;
      return;
    }
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
    w.take(this.state);
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
    const sources = light.sources(sim);
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      if (s === undefined || s.layer !== f.layer) continue;
      let x = s.x;
      let y = s.y;
      if (s.id === CARRIED_LIGHT_ID) {
        if (!f.hasFigure) continue;
        light.carriedOffset(sim, this.offset);
        x = f.figureX + this.offset.dx;
        y = f.figureY + this.offset.dy;
      }
      if (Math.abs(x - f.cameraX) > f.halfWidth + MARGIN_PX || Math.abs(y - f.cameraY) > f.halfHeight + MARGIN_PX) continue;
      const id = s.id * 4;
      if (s.kind === TORCH_KIND) {
        e.push(p.torchSparks, x, y, s.height, 1, id);
        e.push(p.torchSmoke, x, y, s.height, 1, id + 1);
      } else if (s.kind === CAMP_FIRE_KIND) {
        const b = Math.max(0, Math.min(1, s.intensity / full));
        e.push(p.sparks, x, y, s.height, (b - SPARK_FROM) / (1 - SPARK_FROM), id);
        e.push(p.smoke, x, y, s.height, b, id + 1);
        e.push(p.embers, x, y, 0, 1, id + 2);
        if (b > SPARK_FROM) scene.particles.distortion.push(x, y, s.height + CAMP_FIRE_SHIMMER.above, CAMP_FIRE_SHIMMER.width, CAMP_FIRE_SHIMMER.height, CAMP_FIRE_SHIMMER.strength * b);
      }
    }
  }
}
