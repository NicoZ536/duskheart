/**
 * What the ambience reads from the simulation (M7-06; docs/SPIEL.md §24 "Umgebung"): the listener's layer, biome, season
 * and time of day, the blended weather of its region (precipitation, its kind, wind, a thunderstorm), whether a roof or a
 * room is around it, and the water nearby – the nearest river tiles (at most `MAX_RIVERS`, `RIVER_SPACING_TILES` apart, so
 * three voices are three stretches of the river, not one tile thrice) and the nearest shore of the sea.
 *
 * Read-only and never generating anything (`materialized` and `planned` are checked first); no allocation: the
 * situation is a held record, the water scan writes into fixed arrays.
 */
import type { Simulation } from '../../game/sim';
import { worldOf } from '../simWorld';
import { PlayerSystem } from '../../game/player/system';
import { RoomsSystem } from '../../game/rooms/system';
import { NO_WEATHER_REGION } from '../../world/climate/temperature';
import { createWeatherSample, type WeatherSample } from '../../world/climate/weather';
import { WATER_FROZEN, WATER_RIVER, WATER_SEA } from '../../world/model/chunk';
import { CHUNK_SHIFT, TILE_PX, tileLocalIndex, type Layer } from '../../world/model/coords';
import { contentWorldIdTables } from '../../world/model/runtimeIds';

/** River voices at most. */
export const MAX_RIVERS = 3;
/** How far the scan looks for river tiles [tiles] (the river loop's reach). */
export const RIVER_SCAN_TILES = 14;
/** Smallest distance between two river voices [tiles]. */
export const RIVER_SPACING_TILES = 6;
/** How far the scan looks for the sea [tiles] (the waves' reach). */
export const SEA_SCAN_TILES = 22;

/** The listener's surroundings as the ambience hears them. */
export interface AmbienceState {
  /** A world with a player (false: title, loading – the ambience is silent). */
  active: boolean;
  layer: number;
  biome: string;
  season: string;
  /** Night and evening dusk (crickets and owls). */
  night: boolean;
  indoors: boolean;
  /** Weather of the region (surface only; caves have none). */
  weather: string;
  precipitation: number;
  /** Precipitation falls as rain (snow and ash are silent). */
  rain: boolean;
  wind: number;
  /** A thunderstorm has (mostly) arrived. */
  storm: boolean;
  rivers: number;
  readonly riverX: Float64Array;
  readonly riverY: Float64Array;
  sea: boolean;
  seaX: number;
  seaY: number;
}

/** A silent state. */
export function createAmbienceState(): AmbienceState {
  return {
    active: false,
    layer: 0,
    biome: '',
    season: '',
    night: false,
    indoors: false,
    weather: '',
    precipitation: 0,
    rain: false,
    wind: 0,
    storm: false,
    rivers: 0,
    riverX: new Float64Array(MAX_RIVERS),
    riverY: new Float64Array(MAX_RIVERS),
    sea: false,
    seaX: 0,
    seaY: 0,
  };
}

/** Blend share from which the incoming weather is the one heard (as the session shows it). */
const WEATHER_HEARD_FROM_BLEND = 0.5;

/** A source of resident chunks' water and biome fields. */
interface ChunkFields {
  readonly water: ArrayLike<number>;
  readonly biome: ArrayLike<number>;
}

/** Resident chunks by chunk coordinates (the simulation's chunk store; tests: drawn chunks). */
export interface WaterChunks {
  get(layer: Layer, cx: number, cy: number): { readonly water: ArrayLike<number> } | undefined;
}

/** The water bits of a resident tile (0 when not loaded). */
function waterAt(chunks: WaterChunks, layer: Layer, tx: number, ty: number): number {
  const chunk = chunks.get(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
  return chunk === undefined ? 0 : (chunk.water[tileLocalIndex(tx, ty)] as number);
}

/** Whether (x, y) lies at least `RIVER_SPACING_TILES` from every river voice found so far. */
function apart(out: AmbienceState, x: number, y: number): boolean {
  const min = RIVER_SPACING_TILES * TILE_PX;
  for (let i = 0; i < out.rivers; i++) {
    const dx = (out.riverX[i] as number) - x;
    const dy = (out.riverY[i] as number) - y;
    if (dx * dx + dy * dy < min * min) return false;
  }
  return true;
}

/**
 * Finds the river voices and the shore around tile (tx, ty) of `layer` into `out` (see module comment): the nearest
 * unfrozen river tile, then the nearest one `RIVER_SPACING_TILES` from it, and so on; the nearest unfrozen sea tile.
 */
export function scanWaterAround(chunks: WaterChunks, layer: Layer, tx: number, ty: number, out: AmbienceState): void {
  out.rivers = 0;
  const r2 = RIVER_SCAN_TILES * RIVER_SCAN_TILES;
  for (let k = 0; k < MAX_RIVERS; k++) {
    let best = Number.POSITIVE_INFINITY;
    let bx = 0;
    let by = 0;
    for (let dy = -RIVER_SCAN_TILES; dy <= RIVER_SCAN_TILES; dy++) {
      for (let dx = -RIVER_SCAN_TILES; dx <= RIVER_SCAN_TILES; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 >= best || d2 > r2) continue;
        const water = waterAt(chunks, layer, tx + dx, ty + dy);
        if ((water & WATER_RIVER) === 0 || (water & WATER_FROZEN) !== 0) continue;
        if (!apart(out, (tx + dx + 0.5) * TILE_PX, (ty + dy + 0.5) * TILE_PX)) continue;
        best = d2;
        bx = tx + dx;
        by = ty + dy;
      }
    }
    if (best === Number.POSITIVE_INFINITY) break;
    out.riverX[out.rivers] = (bx + 0.5) * TILE_PX;
    out.riverY[out.rivers] = (by + 0.5) * TILE_PX;
    out.rivers++;
  }
  out.sea = false;
  const s2 = SEA_SCAN_TILES * SEA_SCAN_TILES;
  let best = Number.POSITIVE_INFINITY;
  for (let dy = -SEA_SCAN_TILES; dy <= SEA_SCAN_TILES; dy++) {
    for (let dx = -SEA_SCAN_TILES; dx <= SEA_SCAN_TILES; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 >= best || d2 > s2) continue;
      const water = waterAt(chunks, layer, tx + dx, ty + dy);
      if ((water & WATER_SEA) === 0 || (water & WATER_FROZEN) !== 0) continue;
      best = d2;
      out.sea = true;
      out.seaX = (tx + dx + 0.5) * TILE_PX;
      out.seaY = (ty + dy + 0.5) * TILE_PX;
    }
  }
}

export class AmbienceProbe {
  private sim: Simulation | null = null;
  private player: PlayerSystem | null = null;
  private rooms: RoomsSystem | null = null;
  private readonly pos = { x: 0, y: 0 };
  private readonly weather: WeatherSample = createWeatherSample();

  /** Reads the surroundings of the player into `out`; `scanWater`: also scan for rivers and the sea (a few times a second). */
  read(sim: Simulation | undefined, out: AmbienceState, scanWater: boolean): AmbienceState {
    out.active = false;
    if (sim === undefined) return out;
    if (this.sim !== sim) {
      this.sim = sim;
      this.player = null;
      this.rooms = null;
      for (const s of sim.systems) {
        if (s instanceof PlayerSystem) this.player = s;
        else if (s instanceof RoomsSystem) this.rooms = s;
      }
    }
    const w = worldOf(sim);
    const body = this.player?.body(sim);
    if (w === null || !w.materialized || body === undefined || this.player === null || !this.player.position(sim, this.pos)) return out;
    out.active = true;
    const layer = body.layer;
    const tx = Math.floor(this.pos.x / TILE_PX);
    const ty = Math.floor(this.pos.y / TILE_PX);
    out.layer = layer;
    const calendar = w.calendar;
    out.season = calendar.season;
    const phase = calendar.dayPhase;
    out.night = phase === 'nacht' || phase === 'abenddaemmerung';
    out.indoors = this.rooms?.playerIndoors(sim) ?? false;
    const chunk = this.chunkAt(sim, layer, tx, ty);
    out.biome = '';
    const biomeId = chunk === undefined ? 0 : (chunk.biome[tileLocalIndex(tx, ty)] as number);
    if (biomeId !== 0) out.biome = contentWorldIdTables().biomes.stringId(biomeId);
    out.weather = '';
    out.precipitation = 0;
    out.rain = false;
    out.wind = 0;
    out.storm = false;
    if (layer === 0 && w.planned) {
      const region = w.regionAt(tx, ty);
      if (region !== NO_WEATHER_REGION) {
        const smp = w.weather.sample(region, this.weather);
        out.weather = smp.blend >= WEATHER_HEARD_FROM_BLEND ? smp.state : smp.previous;
        out.precipitation = smp.precipitation;
        out.rain = smp.precipitationKind === 'regen';
        out.wind = smp.wind;
        out.storm = out.weather === 'gewitter';
      }
    }
    if (scanWater) scanWaterAround(sim.world.chunks, layer, tx, ty, out);
    return out;
  }

  private chunkAt(sim: Simulation, layer: Layer, tx: number, ty: number): ChunkFields | undefined {
    return sim.world.chunks.get(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
  }
}
