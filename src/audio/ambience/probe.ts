/**
 * What the ambience reads from the simulation (M7-06; docs/SPIEL.md §24 "Umgebung"): the listener's layer, biome, season
 * and time of day, the blended weather of its region (precipitation, its kind, wind, a thunderstorm), whether a roof or a
 * room is around it, and the water nearby – the nearest river tiles (at most `MAX_RIVERS`, `RIVER_SPACING_TILES` apart, so
 * three voices are three stretches of the river, not one tile thrice) and the nearest shore of the sea.
 *
 * Read-only and never generating anything (`materialized` and `planned` are checked first); no allocation: the
 * situation is a held record, the water scan writes into fixed arrays, and only whole numbers, strings and booleans cross
 * the calls into the simulation (the weather is read at the whole game minute; M7-78).
 */
import { DOUBLE_FIELD, HeldPoint } from '../../engine/heldRecords';
import type { Simulation } from '../../game/sim';
import { calendarMinute } from '../dayPhase';
import { worldOf } from '../simWorld';
import { PlayerSystem } from '../../game/player/system';
import { RoomsSystem } from '../../game/rooms/system';
import { clockWholeMinute } from '../../world/climate/gameTime';
import { NO_WEATHER_REGION } from '../../world/climate/temperature';
import type { WeatherSample } from '../../world/climate/weather';
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
  /**
   * Counts the reads that changed what the loops play (M7-78): the probe raises it when a field above changed since its last
   * read, so the director lays out its loops only on a change. 0: not kept by a probe (a state filled by hand) – always laid
   * out.
   */
  revision: number;
}

/** The held state: a class of its own whose fractional fields start as such (src/engine/heldRecords.ts). */
class HeldAmbienceState implements AmbienceState {
  active = false;
  layer = 0;
  biome = '';
  season = '';
  night = false;
  indoors = false;
  weather = '';
  precipitation = DOUBLE_FIELD;
  rain = false;
  wind = DOUBLE_FIELD;
  storm = false;
  rivers = 0;
  readonly riverX = new Float64Array(MAX_RIVERS);
  readonly riverY = new Float64Array(MAX_RIVERS);
  sea = false;
  seaX = DOUBLE_FIELD;
  seaY = DOUBLE_FIELD;
  revision = 0;

  constructor() {
    this.precipitation = 0;
    this.wind = 0;
    this.seaX = 0;
    this.seaY = 0;
  }
}

/** A silent state. */
export function createAmbienceState(): AmbienceState {
  return new HeldAmbienceState();
}

/** The weather sample the probe reads into: fractional fields of a class of its own (src/engine/heldRecords.ts). */
class HeldWeatherSample implements WeatherSample {
  state: WeatherSample['state'] = 'klar';
  previous: WeatherSample['previous'] = 'klar';
  blend = DOUBLE_FIELD;
  cloudCover = DOUBLE_FIELD;
  wind = DOUBLE_FIELD;
  precipitation = DOUBLE_FIELD;
  precipitationKind: WeatherSample['precipitationKind'] = 'keiner';
  haze = DOUBLE_FIELD;
  lightFactor = DOUBLE_FIELD;
  temperatureOffsetC = DOUBLE_FIELD;
}

/** What the loops play from, as of the probe's last read (to see a change). */
class LoopFields {
  active = false;
  layer = 0;
  biome = '';
  season = '';
  night = false;
  indoors = false;
  precipitation = DOUBLE_FIELD;
  rain = false;
  wind = DOUBLE_FIELD;
  storm = false;
  rivers = 0;
  readonly riverX = new Float64Array(MAX_RIVERS);
  readonly riverY = new Float64Array(MAX_RIVERS);
  sea = false;
  seaX = DOUBLE_FIELD;
  seaY = DOUBLE_FIELD;

  /** The fields of a silent state (`createAmbienceState`): a read without a player changes nothing. */
  constructor() {
    this.precipitation = 0;
    this.wind = 0;
    this.seaX = 0;
    this.seaY = 0;
  }
}

/** Whether `out` differs from `last` in what the loops play from; copies it into `last` when it does. */
function loopFieldsChanged(out: AmbienceState, last: LoopFields): boolean {
  let changed = out.active !== last.active || out.layer !== last.layer || out.biome !== last.biome || out.season !== last.season || out.night !== last.night || out.indoors !== last.indoors;
  changed = changed || out.precipitation !== last.precipitation || out.rain !== last.rain || out.wind !== last.wind || out.storm !== last.storm;
  changed = changed || out.rivers !== last.rivers || out.sea !== last.sea || (out.sea && (out.seaX !== last.seaX || out.seaY !== last.seaY));
  for (let i = 0; i < out.rivers && !changed; i++) changed = out.riverX[i] !== last.riverX[i] || out.riverY[i] !== last.riverY[i];
  if (!changed) return false;
  last.active = out.active;
  last.layer = out.layer;
  last.biome = out.biome;
  last.season = out.season;
  last.night = out.night;
  last.indoors = out.indoors;
  last.precipitation = out.precipitation;
  last.rain = out.rain;
  last.wind = out.wind;
  last.storm = out.storm;
  last.rivers = out.rivers;
  last.riverX.set(out.riverX);
  last.riverY.set(out.riverY);
  last.sea = out.sea;
  last.seaX = out.seaX;
  last.seaY = out.seaY;
  return true;
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
  /** The player's position: a record of fractional fields (src/engine/heldRecords.ts), stored without boxing. */
  private readonly pos = new HeldPoint();
  private readonly weather: WeatherSample = new HeldWeatherSample();
  /** Region and whole game minute of `weather` (−1: not sampled). */
  private weatherRegion = -1;
  private weatherMinute = -1;
  /** What the loops played from at the last change (`AmbienceState.revision`). */
  private readonly last = new LoopFields();
  private revision = 0;

  /** Reads the surroundings of the player into `out`; `scanWater`: also scan for rivers and the sea (a few times a second). */
  read(sim: Simulation | undefined, out: AmbienceState, scanWater: boolean): AmbienceState {
    this.fill(sim, out, scanWater);
    if (loopFieldsChanged(out, this.last)) this.revision++;
    out.revision = this.revision;
    return out;
  }

  private fill(sim: Simulation | undefined, out: AmbienceState, scanWater: boolean): void {
    out.active = false;
    if (sim === undefined) return;
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
    if (w === null || !w.materialized || body === undefined || this.player === null || !this.player.position(sim, this.pos)) return;
    out.active = true;
    const layer = body.layer;
    const tx = Math.floor(this.pos.x / TILE_PX);
    const ty = Math.floor(this.pos.y / TILE_PX);
    out.layer = layer;
    // The calendar once per game minute (src/audio/dayPhase.ts): its fractional hour stays out of this read.
    const calendar = calendarMinute(sim, w);
    out.season = calendar.season;
    const phase = calendar.phase;
    out.night = phase === 'nacht' || phase === 'abenddaemmerung';
    const rooms = this.rooms;
    out.indoors = rooms !== null && rooms.playerIndoors(sim);
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
        // At the whole game minute, sampled once per minute and region: no fractional minute crosses the call, and the blend
        // runs over game hours (M7-78).
        const minute = clockWholeMinute(sim.clock);
        if (region !== this.weatherRegion || minute !== this.weatherMinute) {
          this.weatherRegion = region;
          this.weatherMinute = minute;
          w.weather.sample(region, this.weather, minute);
        }
        const smp = this.weather;
        out.weather = smp.blend >= WEATHER_HEARD_FROM_BLEND ? smp.state : smp.previous;
        out.precipitation = smp.precipitation;
        out.rain = smp.precipitationKind === 'regen';
        out.wind = smp.wind;
        out.storm = out.weather === 'gewitter';
      }
    }
    if (scanWater) scanWaterAround(sim.world.chunks, layer, tx, ty, out);
  }

  private chunkAt(sim: Simulation, layer: Layer, tx: number, ty: number): ChunkFields | undefined {
    return sim.world.chunks.get(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
  }
}
