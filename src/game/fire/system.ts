/**
 * Fire simulation (MASTERPROMPT §16.2 "Brennbar", §16.8 "Gebäude nehmen nur durch Schattenflut, Brände und Bosse
 * Schaden", §10 "Wind … Feuer löschen", §3.3 "Welt-Tick … Feuer"; M4-28; values `BALANCE.fire`).
 *
 * - **A fire burns on a tile.** It starts from a torch set to something flammable (`light.ignite`, the light system's
 *   flammables: `flammableProvider`) or from the console (`fire.ignite`). Every world second (1 Hz) it takes hit
 *   points from each finished flammable part on the tile – its material's flammability of `damagePerSecond`, so timber
 *   frame loses 70 % less than wood (§16.2 "kaum (−70 %)") – through `BuildingSystem.damage` (a destroyed part is gone,
 *   wall furniture falls, roofs it carried come down), and burns a standing tree to its stump. When nothing on the
 *   tile burns any more, the fire is out (`abgebrannt`). Stone, clay and glass never burn; nothing decays without fire.
 * - **Spreading** (§16.2 "Ausbreitung auf Holzbauten und Bäume"): in its first second a burning tile plans when it
 *   reaches each of its eight neighbours – `spreadSeconds` over the flammability of what stands there, faster downwind,
 *   slower upwind (§10 "Wind begünstigt", the wind of its weather region); at that second the neighbour catches fire
 *   if something there still burns.
 * - **Rain** (§10 "Feuer löschen"): a fire under the open sky goes out in rain (`regen`); a roof shelters it.
 * - **Active zone:** burning tiles in active chunks burn at every world tick with events; those in frozen chunks catch
 *   up second by second when their chunk activates (`catchUp`), reading the rain and wind of each past second from the
 *   climate runs this system records at every world tick for the regions of the burning tiles – the same steps, the
 *   same result (docs/ARCHITEKTUR.md "Aktive Zone"). A fire only ever reads and spreads into chunks that are active
 *   (or the one catching up): a neighbour in a chunk outside the active zone stays undecided (`PENDING_SPREAD`) until
 *   that chunk activates, and then its caught-up state decides – so what a fire does never depends on which chunks
 *   the camera happens to keep loaded. A catch-up only works through the seconds in which its tiles burn, one sorted
 *   pass over the burning tiles per second; a part covering several burning tiles loses its hit points once a second.
 * - Burning tiles light their surroundings (`lightProvider`) and warm them (`heatSources`); a player standing in the
 *   flames catches "Brennen" (`useConditions`).
 *
 * Chunk-bound (catch-up registry). Save participant `fire` (version 1).
 */
import { BALANCE } from '../../content/balance';
import { BUILD_LAYERS } from '../../content/buildParts';
import { NULL_ENTITY } from '../../engine/ecs';
import { normalizeSeed } from '../../engine/rng';
import { NO_WEATHER_REGION } from '../../world/climate/temperature';
import { createWeatherSample } from '../../world/climate/weather';
import { CHUNK_SHIFT, TILE_PX, type Layer } from '../../world/model/coords';
import { BUILD_LAYER_COUNT, cellBlueprint, cellPart } from '../../world/structures/cells';
import { anchorOf, type AnchorRef } from '../../world/structures/query';
import type { BuildingSystem } from '../building/system';
import type { CommandOfType } from '../commands';
import type { ConditionsSystem } from '../conditions/system';
import { createObjectHit, type GatheringSystem } from '../gathering/system';
import type { ExtraLightProvider, FlammableProvider } from '../light/system';
import type { SaveParticipant } from '../participant';
import type { PlayerSystem } from '../player/system';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import type { HeatSource, HeatSourceProvider } from '../survival/modifiers';
import type { FireCause, FireOutReason } from './events';
import { DIR_DX, DIR_DY, TICKS_PER_WORLD_SECOND, burnDamage, climateAt, climateCode, codeWet, pruneClimate, recordClimate, spreadDelay, windDirection, worldSecond } from './formulas';
import { FIRE_DIRECTIONS, NO_SPREAD, PENDING_SPREAD, createFireState, fireSnapshotSchema, type FireCell, type FireState } from './state';

/** Id of the fire system and its save participant. */
export const FIRE_SYSTEM_ID = 'fire';
/** Data version of the `fire` participant. */
export const FIRE_SAVE_VERSION = 1;
/** Light kind of a burning tile in the light source list (the renderer reads colour and radius). */
export const FIRE_LIGHT_KIND = 'brand';
/** The condition of a player standing in the flames (src/content/conditions.ts). */
export const BURNING_CONDITION = 'brennen';
/** "No weather region" (underground: no rain, no wind). */
const NO_REGION = -1;
/** Light ids of burning tiles start at 2^24 (placed lights count from 1, hearths from 2^20). */
const LIGHT_ID_BITS = 24;
const LIGHT_ID_BASE = 1 << LIGHT_ID_BITS;
/** Bits of a tile row in a light id. */
const LIGHT_ROW_BITS = 12;
/** Tile key span per axis (larger than the largest world, 2048 tiles) and the bias that makes layers non-negative. */
const TILE_SPAN = 4096;
const LAYER_BIAS = 3;

const F = BALANCE.fire;

/** Key of tile (tx, ty) of `layer`. */
export function fireKey(layer: Layer, tx: number, ty: number): number {
  return ((layer + LAYER_BIAS) * TILE_SPAN + ty) * TILE_SPAN + tx;
}

/** No climate recorded (a region without runs). */
const NO_RUNS: readonly number[] = [];

/** A chunk address. */
interface ChunkRef {
  readonly layer: Layer;
  readonly cx: number;
  readonly cy: number;
}

/** What the fire reads from the world: the active zone, weather regions and their climate. */
export interface FireEnvironment {
  /** Whether chunk (cx, cy) of `layer` is in the active zone (its fires burn at the world tick; the others catch up). */
  active(sim: Simulation, layer: Layer, cx: number, cy: number): boolean;
  /** Weather region of tile (tx, ty) of `layer`, or −1 where no weather reaches (underground, open sea). */
  region(sim: Simulation, layer: Layer, tx: number, ty: number): number;
  /** Number of weather regions. */
  regions(sim: Simulation): number;
  /** The climate of region `region` now as a code (`climateCode`: rain that puts fires out, wind class and direction). */
  climate(sim: Simulation, region: number): number;
}

/** The environment of the simulation's own world: the active zone and the weather of the surface regions. */
export function worldFireEnvironment(): FireEnvironment {
  const sample = createWeatherSample();
  return {
    active: (sim, layer, cx, cy) => sim.world.materialized && sim.world.zone.isActive(layer, cx, cy),
    region: (sim, layer, tx, ty) => {
      if (layer !== 0) return NO_REGION;
      const r = sim.world.regionAt(tx, ty);
      return r === NO_WEATHER_REGION ? NO_REGION : r;
    },
    regions: (sim) => sim.world.weather.regionCount,
    climate: (sim, region) => {
      const weather = sim.world.weather;
      const w = weather.sample(region, sample);
      return climateCode(w.precipitationKind === 'regen' ? w.precipitation : 0, w.wind, windDirection(normalizeSeed(sim.config.seed), region, weather.periodCount(region)));
    },
  };
}

/** Dependencies of the fire system. */
export interface FireSystemDeps {
  readonly building: BuildingSystem;
  /** Standing trees (they burn to their stumps). */
  readonly gathering: GatheringSystem;
  /** The player (standing in the flames). */
  readonly player: PlayerSystem;
  /** Default: `worldFireEnvironment()`. */
  readonly environment?: FireEnvironment;
}

class HeatRecord implements HeatSource {
  x = 0;
  y = 0;
  layer: Layer = 0;
  coreHeatC = F.heat.coreHeatC;
  coreRadiusPx = F.heat.coreRadiusTiles * TILE_PX;
  radiusPx = F.heat.radiusTiles * TILE_PX;
}

export class FireSystem implements SimSystem {
  readonly id = FIRE_SYSTEM_ID;
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;

  private readonly sim: Simulation;
  private readonly building: BuildingSystem;
  private readonly gathering: GatheringSystem;
  private readonly player: PlayerSystem;
  private readonly env: FireEnvironment;
  private stateValue: FireState = createFireState();
  private conditions: ConditionsSystem | null = null;
  private readonly tree = createObjectHit();
  private readonly heatRecords: HeatRecord[] = [];
  private readonly heatList: HeatRecord[] = [];
  private readonly pos = { x: 0, y: 0 };
  /** The chunk catching up right now (its tiles may be read and set alight like active ones), or `null`. */
  private catching: ChunkRef | null = null;
  /** Scratch of `process`: keys of the tiles still to burn (by next second, then key), burning this second (by key), set alight this second. */
  private readonly waiting: number[] = [];
  private readonly live: number[] = [];
  private readonly born: number[] = [];
  /** Parts that lost their hit points in the current second (anchor keys): a part burns once a second, however many of its tiles burn. */
  private readonly scorched = new Set<number>();
  private readonly anchor: AnchorRef = { tx: 0, ty: 0, cell: 0 };
  /** Scratch of the climate bookkeeping: per needed region the earliest second a burning tile still needs. */
  private readonly needs = new Map<number, number>();

  constructor(sim: Simulation, deps: FireSystemDeps) {
    this.sim = sim;
    this.building = deps.building;
    this.gathering = deps.gathering;
    this.player = deps.player;
    this.env = deps.environment ?? worldFireEnvironment();
    this.commands = {
      'fire.ignite': (s, cmd, tick) => this.debugIgnite(s, cmd, tick),
    };
    this.save = {
      id: FIRE_SYSTEM_ID,
      version: FIRE_SAVE_VERSION,
      // Saves from before the fire simulation (save version 1, M3) have no fires.
      migrations: [{ from: 0, migrate: () => ({ cells: [], klima: [] }) }],
      serialize: () => this.snapshot(),
      deserialize: (data) => this.restore(data),
    };
  }

  // -------------------------------------------------------------------------------------------
  // Queries and hooks
  // -------------------------------------------------------------------------------------------

  /** The burning tiles (read-only for callers: flames for the renderer). */
  get cells(): Iterable<Readonly<FireCell>> {
    return this.stateValue.cells.values();
  }

  /** Number of burning tiles. */
  get size(): number {
    return this.stateValue.cells.size;
  }

  /** Whether tile (tx, ty) of `layer` burns. */
  burningAt(layer: Layer, tx: number, ty: number): boolean {
    return this.stateValue.cells.has(fireKey(layer, tx, ty));
  }

  /**
   * How flammable the most flammable thing on tile (tx, ty) is [0–1]: finished build parts and a standing tree (of a
   * resident chunk – the fire itself only asks about trees in active chunks).
   */
  flammability(layer: Layer, tx: number, ty: number): number {
    return this.fuel(layer, tx, ty, true);
  }

  /** The flammability of tile (tx, ty): its finished build parts and – with `trees` – its standing tree. */
  private fuel(layer: Layer, tx: number, ty: number, trees: boolean): number {
    let f = 0;
    const store = this.building.structures;
    const catalog = this.building.catalog;
    for (let li = 0; li < BUILD_LAYER_COUNT; li++) {
      const cell = store.cell(layer, li, tx, ty);
      if (cell === 0 || cellBlueprint(cell)) continue;
      f = Math.max(f, catalog.byRuntimeId(cellPart(cell))?.flammability ?? 0);
    }
    if (trees && this.gathering.standingTreeAt(layer, tx, ty, this.tree)) f = Math.max(f, F.tree.flammability);
    return f;
  }

  /** Whether the fire may read and set alight tile (tx, ty): its chunk is active or catching up right now. */
  private reachable(sim: Simulation, layer: Layer, tx: number, ty: number): boolean {
    const cx = tx >> CHUNK_SHIFT;
    const cy = ty >> CHUNK_SHIFT;
    const c = this.catching;
    if (c !== null && c.layer === layer && c.cx === cx && c.cy === cy) return true;
    return this.env.active(sim, layer, cx, cy);
  }

  /**
   * Sets tile (tx, ty) of `layer` alight when something on it burns and it does not burn yet; returns whether a fire
   * started. It burns from the next world second. In a chunk outside the active zone only its build parts count (the
   * trees of a frozen chunk are not read before it catches up).
   */
  ignite(sim: Simulation, layer: Layer, tx: number, ty: number, cause: FireCause): boolean {
    const key = fireKey(layer, tx, ty);
    if (this.stateValue.cells.has(key) || !(this.fuel(layer, tx, ty, this.reachable(sim, layer, tx, ty)) > 0)) return false;
    const s = worldSecond(sim.tick);
    this.stateValue.cells.set(key, { layer, tx, ty, seit: s, bis: s, plan: null, baum: -1 });
    this.event(sim, 'fireStarted', layer, tx, ty, cause);
    return true;
  }

  /** A burning torch sets flammable things alight (the light system's `addFlammables`, `light.ignite`). */
  flammableProvider(): FlammableProvider {
    return (sim, layer, tx, ty) => this.ignite(sim, layer, tx, ty, 'fackel');
  }

  /** Connects the conditions (a player in the flames catches "Brennen"). */
  useConditions(conditions: ConditionsSystem): void {
    this.conditions = conditions;
  }

  /** Burning tiles of the active zone as lights of the light source list (§12.1). */
  lightProvider(): ExtraLightProvider {
    const L = F.light;
    return (sim, emit) => {
      for (const c of this.stateValue.cells.values()) {
        if (!this.env.active(sim, c.layer, c.tx >> CHUNK_SHIFT, c.ty >> CHUNK_SHIFT)) continue;
        emit(LIGHT_ID_BASE + ((c.tx << LIGHT_ROW_BITS) | c.ty), FIRE_LIGHT_KIND, L.farbe, c.layer, (c.tx + 1 / 2) * TILE_PX, (c.ty + 1 / 2) * TILE_PX, L.flameHeightPx, L.radiusTiles * TILE_PX, L.intensity, L.flicker, 1, L.radiusTiles);
      }
    };
  }

  /** Burning tiles of the active zone as heat sources (§11.2; the player's influences and rooms). */
  heatSources(): HeatSourceProvider {
    return (sim) => {
      this.heatList.length = 0;
      let k = 0;
      for (const c of this.stateValue.cells.values()) {
        if (!this.env.active(sim, c.layer, c.tx >> CHUNK_SHIFT, c.ty >> CHUNK_SHIFT)) continue;
        let r = this.heatRecords[k];
        if (r === undefined) {
          r = new HeatRecord();
          this.heatRecords.push(r);
        }
        k++;
        r.x = (c.tx + 1 / 2) * TILE_PX;
        r.y = (c.ty + 1 / 2) * TILE_PX;
        r.layer = c.layer;
        this.heatList.push(r);
      }
      return this.heatList;
    };
  }

  // -------------------------------------------------------------------------------------------
  // Ticks
  // -------------------------------------------------------------------------------------------

  /**
   * World tick: records the climate of this second for the regions of the burning tiles, burns the tiles of active
   * chunks, sets a player in the flames alight.
   */
  worldTick(sim: Simulation): void {
    const cells = this.stateValue.cells;
    if (cells.size === 0) {
      this.stateValue.klima.clear();
      return;
    }
    const s = worldSecond(sim.tick);
    this.collectNeeds(sim);
    for (const r of this.needs.keys()) {
      let runs = this.stateValue.klima.get(r);
      if (runs === undefined) {
        runs = [];
        this.stateValue.klima.set(r, runs);
      }
      recordClimate(runs, s, this.env.climate(sim, r));
    }
    this.process(sim, s, (c) => this.env.active(sim, c.layer, c.tx >> CHUNK_SHIFT, c.ty >> CHUNK_SHIFT), true);
    this.prune(sim);
    this.scorch(sim);
  }

  /**
   * A frozen chunk activates: the neighbours in it that burning tiles left undecided are decided from its caught-up
   * state, then its fires burn second by second up to `toTick` with the recorded rain and wind.
   */
  catchUp(chunk: ChunkRef, _fromTick: number, toTick: number): void {
    if (this.stateValue.cells.size === 0) return;
    this.catching = chunk;
    try {
      this.decidePending(this.sim, chunk);
      this.process(this.sim, worldSecond(toTick), (c) => c.layer === chunk.layer && c.tx >> CHUNK_SHIFT === chunk.cx && c.ty >> CHUNK_SHIFT === chunk.cy, false);
    } finally {
      this.catching = null;
    }
    this.prune(this.sim);
  }

  /**
   * Decides the undecided spread of every burning tile into `chunk`, now resident and caught up: the delay from what
   * stands there now and the wind of the tile's next second, never before that second (the moment already passed).
   */
  private decidePending(sim: Simulation, chunk: ChunkRef): void {
    for (const c of this.stateValue.cells.values()) {
      const plan = c.plan;
      if (plan === null || c.layer !== chunk.layer) continue;
      for (let d = 0; d < FIRE_DIRECTIONS; d++) {
        if (plan[d] !== PENDING_SPREAD) continue;
        const nx = c.tx + (DIR_DX[d] as number);
        const ny = c.ty + (DIR_DY[d] as number);
        if (nx >> CHUNK_SHIFT !== chunk.cx || ny >> CHUNK_SHIFT !== chunk.cy) continue;
        const next = c.bis + 1;
        const delay = spreadDelay(this.fuel(c.layer, nx, ny, true), d, this.climateOf(sim, c, next));
        plan[d] = delay < 0 ? NO_SPREAD : Math.max(c.seit + delay, next);
      }
    }
  }

  /** The climate code of the region of tile `c` in second `s` (dry and calm where no weather reaches). */
  private climateOf(sim: Simulation, c: FireCell, s: number): number {
    const region = this.env.region(sim, c.layer, c.tx, c.ty);
    return region < 0 ? 0 : climateAt(this.stateValue.klima.get(region) ?? NO_RUNS, s);
  }

  /**
   * Burns every `eligible` tile second by second up to world second `last`: in each second the tiles due then (they
   * burned the second before) in key order; tiles that catch fire in a second burn from the next. Only seconds in which
   * something burns cost work: the tiles wait sorted by the second they burn next and join the sorted list of burning
   * tiles when it comes; when nothing burns, the pass jumps to the next waiting tile or ends.
   */
  private process(sim: Simulation, last: number, eligible: (c: FireCell) => boolean, loud: boolean): void {
    const cells = this.stateValue.cells;
    const waiting = this.waiting;
    const live = this.live;
    const born = this.born;
    waiting.length = 0;
    live.length = 0;
    for (const [key, c] of cells) if (c.bis < last && eligible(c)) waiting.push(key);
    if (waiting.length === 0) return;
    waiting.sort((a, b) => (cells.get(a) as FireCell).bis - (cells.get(b) as FireCell).bis || a - b);
    let w = 0;
    let s = (cells.get(waiting[0] as number) as FireCell).bis + 1;
    while (s <= last) {
      while (w < waiting.length && (cells.get(waiting[w] as number) as FireCell).bis === s - 1) insertSorted(live, waiting[w++] as number);
      if (live.length === 0) {
        if (w >= waiting.length) break;
        s = (cells.get(waiting[w] as number) as FireCell).bis + 1;
        continue;
      }
      this.scorched.clear();
      born.length = 0;
      for (let k = 0; k < live.length; k++) {
        const key = live[k] as number;
        this.burn(sim, key, cells.get(key) as FireCell, s, loud);
      }
      // What went out leaves the list (a tile put out and set alight again in the same second is a new fire, born
      // now); what caught fire in this second burns from the next.
      let n = 0;
      for (let k = 0; k < live.length; k++) {
        const key = live[k] as number;
        const c = cells.get(key);
        if (c !== undefined && c.seit < s) live[n++] = key;
      }
      live.length = n;
      for (let k = 0; k < born.length; k++) {
        const key = born[k] as number;
        if (eligible(cells.get(key) as FireCell)) insertSorted(live, key);
      }
      s++;
    }
    waiting.length = 0;
    live.length = 0;
    born.length = 0;
  }

  /** Second `s` of the fire on tile `c`: its plan, rain, spreading, damage. */
  private burn(sim: Simulation, key: number, c: FireCell, s: number, loud: boolean): void {
    const code = this.climateOf(sim, c, s);
    if (c.plan === null) {
      const plan: number[] = [];
      for (let d = 0; d < FIRE_DIRECTIONS; d++) {
        const nx = c.tx + (DIR_DX[d] as number);
        const ny = c.ty + (DIR_DY[d] as number);
        if (!this.reachable(sim, c.layer, nx, ny)) {
          plan.push(PENDING_SPREAD);
          continue;
        }
        const delay = spreadDelay(this.fuel(c.layer, nx, ny, true), d, code);
        plan.push(delay < 0 ? NO_SPREAD : c.seit + delay);
      }
      c.plan = plan;
      c.baum = this.gathering.standingTreeAt(c.layer, c.tx, c.ty, this.tree) ? F.tree.burnHp : 0;
    }
    c.bis = s;
    if (codeWet(code) && !this.building.roofed(c.layer, c.tx, c.ty)) {
      this.end(sim, key, c, 'regen', loud);
      return;
    }
    for (let d = 0; d < FIRE_DIRECTIONS; d++) {
      let at = c.plan[d] as number;
      if (at !== s && at !== PENDING_SPREAD) continue;
      const nx = c.tx + (DIR_DX[d] as number);
      const ny = c.ty + (DIR_DY[d] as number);
      if (!this.reachable(sim, c.layer, nx, ny)) {
        // The neighbour's chunk left the active zone since the plan was made: its activation decides.
        c.plan[d] = PENDING_SPREAD;
        continue;
      }
      if (at === PENDING_SPREAD) {
        // Undecided, but its chunk is active now without its activation having decided (activated in the tick it
        // froze): decided here, the same way – from what stands there now and the wind of this second.
        const delay = spreadDelay(this.fuel(c.layer, nx, ny, true), d, code);
        at = delay < 0 ? NO_SPREAD : Math.max(c.seit + delay, s);
        c.plan[d] = at;
        if (at !== s) continue;
      }
      const nkey = fireKey(c.layer, nx, ny);
      if (this.stateValue.cells.has(nkey) || !(this.fuel(c.layer, nx, ny, true) > 0)) continue;
      this.stateValue.cells.set(nkey, { layer: c.layer, tx: nx, ty: ny, seit: s, bis: s, plan: null, baum: -1 });
      this.born.push(nkey);
      if (loud) this.event(sim, 'fireStarted', c.layer, nx, ny, 'ausbreitung');
    }
    let left = false;
    const store = this.building.structures;
    const catalog = this.building.catalog;
    for (let li = 0; li < BUILD_LAYER_COUNT; li++) {
      const cell = store.cell(c.layer, li, c.tx, c.ty);
      if (cell === 0 || cellBlueprint(cell)) continue;
      const damage = burnDamage(catalog.byRuntimeId(cellPart(cell))?.flammability ?? 0);
      if (damage === 0) continue;
      // A part over several burning tiles burns once a second (its anchor keys it).
      if (!anchorOf(store, c.layer, li, c.tx, c.ty, this.anchor)) continue;
      const part = fireKey(c.layer, this.anchor.tx, this.anchor.ty) * BUILD_LAYER_COUNT + li;
      if (this.scorched.has(part)) {
        left = true;
        continue;
      }
      this.scorched.add(part);
      if (this.building.damage(sim, c.layer, BUILD_LAYERS[li] as (typeof BUILD_LAYERS)[number], c.tx, c.ty, damage) > 0) left = true;
    }
    if (c.baum > 0) {
      c.baum = Math.max(0, c.baum - burnDamage(F.tree.flammability));
      if (c.baum > 0) left = true;
      else if (this.gathering.burnTree(c.layer, c.tx, c.ty, s * TICKS_PER_WORLD_SECOND) && loud) {
        sim.events.push('treeBurned', { layer: c.layer, tx: c.tx, ty: c.ty, x: (c.tx + 1 / 2) * TILE_PX, y: (c.ty + 1 / 2) * TILE_PX, tick: sim.eventTick });
      }
    }
    if (!left) this.end(sim, key, c, 'abgebrannt', loud);
  }

  private end(sim: Simulation, key: number, c: FireCell, reason: FireOutReason, loud: boolean): void {
    this.stateValue.cells.delete(key);
    if (loud) sim.events.push('fireOut', { layer: c.layer, tx: c.tx, ty: c.ty, x: (c.tx + 1 / 2) * TILE_PX, y: (c.ty + 1 / 2) * TILE_PX, reason, tick: sim.eventTick });
  }

  /**
   * The regions whose climate the burning tiles need – the region of each burning tile and of its eight neighbours (a
   * fire it sets there reads that region) – each with the earliest second a tile there still has to burn (`needs`).
   */
  private collectNeeds(sim: Simulation): void {
    const needs = this.needs;
    needs.clear();
    for (const c of this.stateValue.cells.values()) {
      const from = c.bis + 1;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const r = this.env.region(sim, c.layer, c.tx + dx, c.ty + dy);
          if (r < 0) continue;
          const had = needs.get(r);
          if (had === undefined || from < had) needs.set(r, from);
        }
      }
    }
  }

  /**
   * Forgets the climate no burning tile needs any more: the regions no burning tile lies in or borders on, and in each
   * other region the runs before the earliest second a tile there still has to burn.
   */
  private prune(sim: Simulation): void {
    const klima = this.stateValue.klima;
    if (this.stateValue.cells.size === 0) {
      klima.clear();
      return;
    }
    this.collectNeeds(sim);
    for (const [r, runs] of klima) {
      const from = this.needs.get(r);
      if (from === undefined) klima.delete(r);
      else pruneClimate(runs, from);
    }
  }

  /** A player standing on a burning tile catches "Brennen" (§11.3). */
  private scorch(sim: Simulation): void {
    const conditions = this.conditions;
    if (conditions === null || sim.player === NULL_ENTITY) return;
    const body = this.player.body(sim);
    if (body === undefined || !this.player.position(sim, this.pos)) return;
    if (this.burningAt(body.layer, Math.floor(this.pos.x / TILE_PX), Math.floor(this.pos.y / TILE_PX))) conditions.apply(sim, BURNING_CONDITION);
  }

  // -------------------------------------------------------------------------------------------
  // Commands and helpers
  // -------------------------------------------------------------------------------------------

  private debugIgnite(sim: Simulation, cmd: CommandOfType<'fire.ignite'>, tick: number): void {
    const layer = (cmd.layer ?? 0) as Layer;
    if (this.burningAt(layer, cmd.tx, cmd.ty)) sim.events.push('commandRejected', { type: cmd.type, reason: 'burning', tick });
    else if (!this.ignite(sim, layer, cmd.tx, cmd.ty, 'debug')) sim.events.push('commandRejected', { type: cmd.type, reason: 'nothingToBurn', tick });
  }

  private event(sim: Simulation, type: 'fireStarted', layer: Layer, tx: number, ty: number, cause: FireCause): void {
    sim.events.push(type, { layer, tx, ty, x: (tx + 1 / 2) * TILE_PX, y: (ty + 1 / 2) * TILE_PX, cause, tick: sim.eventTick });
  }

  private snapshot(): unknown {
    const cells = [...this.stateValue.cells]
      .sort((a, b) => a[0] - b[0])
      .map(([, c]) => ({ layer: c.layer, tx: c.tx, ty: c.ty, seit: c.seit, bis: c.bis, plan: c.plan === null ? null : [...c.plan], baum: c.baum }));
    const klima = [...this.stateValue.klima].sort((a, b) => a[0] - b[0]).map(([r, runs]) => [r, [...runs]]);
    return { cells, klima };
  }

  private restore(data: unknown): void {
    const parsed = fireSnapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`fire snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const next = createFireState();
    for (const c of parsed.data.cells) {
      const key = fireKey(c.layer as Layer, c.tx, c.ty);
      if (c.tx >= TILE_SPAN || c.ty >= TILE_SPAN) throw new TypeError(`fire snapshot invalid: tile ${c.tx},${c.ty} outside the world`);
      if (next.cells.has(key)) throw new TypeError(`fire snapshot invalid: tile ${c.layer}/${c.tx},${c.ty} burns twice`);
      if (c.bis < c.seit) throw new TypeError(`fire snapshot invalid: tile ${c.tx},${c.ty} burned before it caught fire`);
      if (c.plan !== null && c.plan.some((at) => at !== NO_SPREAD && at !== PENDING_SPREAD && at <= c.seit)) throw new TypeError(`fire snapshot invalid: tile ${c.tx},${c.ty} spreads before it caught fire`);
      next.cells.set(key, { layer: c.layer as Layer, tx: c.tx, ty: c.ty, seit: c.seit, bis: c.bis, plan: c.plan === null ? null : [...c.plan], baum: c.baum });
    }
    for (const [region, runs] of parsed.data.klima) {
      if (runs.length % 2 !== 0) throw new TypeError(`fire snapshot invalid: the climate of region ${region} is no list of runs`);
      for (let k = 2; k < runs.length; k += 2) if ((runs[k] as number) <= (runs[k - 2] as number)) throw new TypeError(`fire snapshot invalid: the climate runs of region ${region} are out of order`);
      next.klima.set(region, [...runs]);
    }
    this.stateValue = next;
  }
}

/** Inserts `key` into the ascending list `list` (a tile set alight joins the burning ones in key order). */
function insertSorted(list: number[], key: number): void {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((list[mid] as number) < key) lo = mid + 1;
    else hi = mid;
  }
  list.splice(lo, 0, key);
}
