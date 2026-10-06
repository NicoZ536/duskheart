/**
 * The world events at runtime (MASTERPROMPT §10 "Ereignisse", "Blitze"; docs/SPIEL.md §18; M7-38 … M7-40). System
 * `world-events`, global (it keeps every deadline in absolute ticks and game minutes; nothing waits in frozen chunks), save
 * participant `world-events`.
 *
 * - **Register:** every event of the collection `worldEvents` that runs (`umgesetzt: true`) has a state: `ruhe` →
 *   `angekuendigt` → `aktiv` → `ruhe` (`worldEventAnnounced`, `worldEventStarted`, `worldEventEnded`). At most one big
 *   event at a time (`gross`); the Finstermond runs beside them.
 * - **Plan:** the calendar events come from `occurrenceOn` (formulas.ts: `hash(seed, 'weltereignis', id, day)`), checked
 *   every world tick against the clock's game minute – jumping in time or loading never changes the plan; a run whose start
 *   was skipped by a jump is simply missed. The weather events (`wetter`, the forest fire) run while the weather of the
 *   player's region is one of theirs on a day the draw allows. A run's condition (the clear sky of the Lumen rain) is checked
 *   at its announcement and at its start, and the rain ends early when the sky clouds over.
 * - **Finstermond:** the night of the new moon (the calendar's `isFinstermond`, M6's stronger brood), announced at dusk.
 * - **Lumen rain** (M7-39): every game minute of the run a draw lets a glowing shard (`lumen_scherbe`) fall near the player on
 *   the surface (`lumenShardFell`, a drop); with `meteorChance` per run a meteorite comes down once at the minute its plan
 *   says (`meteorImpact`, star ore as drops).
 * - **Eclipse** (M7-39): an hour of night by day – `daylightFactor`, registered as the calendar's daylight modifier
 *   (`Calendar.addDaylightModifier`, setup.ts), darkens the daylight the light map, the shadow brood, fear and the sky read.
 * - **Lightning** (M7-40, `lightning.ts`): in a thunderstorm over the player's region every game minute draws
 *   `hash(seed, 'blitz', region, minute)`; a strike lands in the active zone and seeks the tallest target around its point;
 *   a tree or a wooden part catches fire with a chance (`FireSystem.ignite`, cause `blitz`) – far more often during the forest
 *   fire (a dry summer storm) –, a player close by is hurt (`blitz`).
 *
 * The world comes in through `WorldEventsWorld` (the simulation's weather, regions, active zone and chunks; tests draw their
 * own). Allocation-free per tick (the tick-time occurrences and scratch points are reused).
 */
import { BALANCE, type SeasonId } from '../../content/balance';
import { CONTENT } from '../../content/index';
import type { WorldEventDef } from '../../content/worldEvents/schema';
import type { WeatherStateId } from '../../content/weather';
import { NULL_ENTITY } from '../../engine/ecs';
import type { Calendar } from '../../world/calendar';
import { clockMinute, dayOfMinute, minutesPerTick } from '../../world/climate/gameTime';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX, type Layer } from '../../world/model/coords';
import type { GameCommandType } from '../commands';
import type { ItemCatalog } from '../items/catalog';
import { newStack, type ItemStack } from '../items/stack';
import type { SaveParticipant } from '../participant';
import type { PlayerSystem } from '../player/system';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import type { WorldEventEndReason, WorldEventRejectReason } from './events';
import { eclipseFactor, emptyOccurrence, occurrenceOn, planDraw, pointAround, shardDraw, strikeDraw, weatherDay, weatherDuration, type Occurrence } from './formulas';
import { Lightning, type LightningDeps } from './lightning';
import { copyWorldEventState, newWorldEventState, NO_TICK, worldEventsSnapshotSchema, type WorldEventsSnapshot } from './state';
import type { WorldEventPhase, WorldEventsApi, WorldEventState } from './types';

/** Id of the system and its save participant. */
export const WORLD_EVENTS_SYSTEM_ID = 'world-events';
/** The draws of a storm minute's strike (`strikeDraw` index): whether it strikes, the angle and distance of its point, its target. */
const STRIKE_DRAW = { chance: 0, angle: 1, distance: 2, target: 3 } as const;
/** Data version of the `world-events` participant. */
export const WORLD_EVENTS_SAVE_VERSION = 1;

const W = BALANCE.worldEvents;
const SURFACE: Layer = 0;
const SHARD_ITEM = 'lumen_scherbe';
/** The events with effects of their own here. */
const ECLIPSE = 'sonnenfinsternis';
const LUMEN_RAIN = 'lumenregen';
const FOREST_FIRE = 'waldbrand';
const ORE_ITEM = 'sternenerz';
/** Draw indices of the Lumen rain's plan (formulas.ts `planDraw` 0–2 are the run's own). */
const METEOR_CHANCE_DRAW = 3;
const METEOR_MINUTE_DRAW = 4;
const METEOR_ORE_DRAW = 5;
/** Draw indices of a minute's shard (`shardDraw`). */
const SHARD_FALL = 0;
const SHARD_ANGLE = 1;
const SHARD_DIST = 2;
const METEOR_ANGLE = 3;
const METEOR_DIST = 4;
/** Landing points the meteorite tries per minute. */
const METEOR_TRIES = 8;
/** Most minutes one world tick draws for (a day length of 12 minutes makes two game minutes a second). */
const MAX_DRAW_MINUTES = 8;

/** The world the events read (the simulation's weather, regions, zone and chunks; tests draw their own). */
export interface WorldEventsWorld {
  /** Weather region of surface tile (tx, ty), −1 at sea or before the world. */
  regionAt(sim: Simulation, tx: number, ty: number): number;
  /** Weather of `region` now, or null. */
  weather(sim: Simulation, region: number): WeatherStateId | null;
  /** Start and end of the region's current weather period [absolute game minutes]. */
  periodStart(sim: Simulation, region: number): number;
  periodEnd(sim: Simulation, region: number): number;
  /** Whether surface tile (tx, ty) lies in the active zone. */
  active(sim: Simulation, tx: number, ty: number): boolean;
  /** Whether surface tile (tx, ty) is dry, open land of a resident chunk (a shard or meteorite can land there). */
  landsOn(sim: Simulation, tx: number, ty: number): boolean;
  /** Biome of weather region `region`. */
  regionBiome(sim: Simulation, region: number): string;
}

/** The world of the simulation. */
export function simWorldEventsWorld(blocked: (sim: Simulation, layer: Layer, tx: number, ty: number) => boolean): WorldEventsWorld {
  return {
    regionAt: (sim, tx, ty) => (sim.world.planned ? sim.world.regionAt(tx, ty) : -1),
    weather: (sim, region) => (region >= 0 && sim.world.planned ? sim.world.weather.state(region) : null),
    periodStart: (sim, region) => sim.world.weather.periodStart(region),
    periodEnd: (sim, region) => sim.world.weather.periodEnd(region),
    active: (sim, tx, ty) => sim.world.materialized && sim.world.zone.isTileActive(SURFACE, tx, ty),
    landsOn: (sim, tx, ty) => {
      if (!sim.world.materialized) return false;
      const chunk = sim.world.chunks.get(SURFACE, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
      if (chunk === undefined) return false;
      const i = ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK);
      return chunk.water[i] === 0 && !blocked(sim, SURFACE, tx, ty);
    },
    regionBiome: (sim, region) => sim.world.weather.regionBiome(region),
  };
}

/** Dependencies of the world events (the systems registered before them). */
export interface WorldEventsDeps extends LightningDeps {
  /** The world's calendar (its clock, the seasons; the eclipse registers as its daylight modifier, setup.ts). */
  readonly calendar: Calendar;
  readonly player: PlayerSystem;
  readonly catalog: ItemCatalog;
  /** Spawns a stack as a drop at (x, y) [px] (the drop system). */
  readonly spill: (sim: Simulation, stack: ItemStack, layer: Layer, x: number, y: number) => void;
  readonly world: WorldEventsWorld;
  /** The events (default: the content's `worldEvents` that run). */
  readonly events?: readonly WorldEventDef[];
}

export class WorldEventsSystem implements SimSystem, WorldEventsApi {
  readonly id = WORLD_EVENTS_SYSTEM_ID;
  readonly timeScope = 'global' as const;
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  private readonly defs: readonly WorldEventDef[];
  private readonly states: WorldEventState[];
  /** Start minute of each state's run while announced or running (−1: none) – identifies the run in the plan. */
  private readonly runStart: number[];
  /** Start minute of the last run each event handled (started, skipped or ended). */
  private readonly handled = new Map<string, number>();
  /** Runs started from the console (`worldEvent.start`), by event: they replace the plan until they end. */
  private readonly forced = new Map<string, Occurrence>();
  private drawnMinute = -1;
  private meteorFallen = false;
  private readonly lightning: Lightning;
  private readonly occ = emptyOccurrence();
  private readonly cand = emptyOccurrence();
  private readonly at = { x: 0, y: 0 };
  private readonly spot = { x: 0, y: 0 };
  /** The eclipse's run [absolute minutes] while it is announced or running (−1: none), for `daylightFactor`. */
  private eclipseStart = -1;
  private eclipseEnd = -1;

  /** The calendar's season of a day (bound once: the plan asks for it every tick). */
  private readonly seasonOf: (day: number) => SeasonId;

  constructor(private readonly deps: WorldEventsDeps) {
    this.defs = (deps.events ?? (CONTENT.collection('worldEvents').values() as readonly WorldEventDef[])).filter((d) => d.umgesetzt === true);
    this.states = this.defs.map((d) => newWorldEventState(d.id));
    this.runStart = this.defs.map(() => -1);
    this.seasonOf = (day) => deps.calendar.seasonOfDay(day);
    this.lightning = new Lightning(deps);
    this.commands = {
      'worldEvent.start': (s, cmd, tick) => this.refuse(s, cmd.type, tick, this.debugStart(s, cmd.event)),
      'worldEvent.stop': (s, cmd, tick) => this.refuse(s, cmd.type, tick, this.debugStop(s, cmd.event)),
      'lightning.strike': (s, cmd, tick) => this.refuse(s, cmd.type, tick, this.debugStrike(s, cmd.dx ?? 0, cmd.dy ?? 0)),
    };
    this.save = {
      id: WORLD_EVENTS_SYSTEM_ID,
      version: WORLD_EVENTS_SAVE_VERSION,
      migrations: [{ from: 0, migrate: () => ({ events: [], runStarts: {}, drawnMinute: -1, meteorFallen: false, handled: {}, forced: [] }) }],
      serialize: () => this.snapshot(),
      deserialize: (data) => this.restore(data),
    };
  }

  // -------------------------------------------------------------------------------------------
  // WorldEventsApi
  // -------------------------------------------------------------------------------------------

  phase(id: string): WorldEventPhase {
    return this.stateOf(id)?.phase ?? 'ruhe';
  }

  activeBig(): string | null {
    for (let i = 0; i < this.states.length; i++) {
      const s = this.states[i] as WorldEventState;
      if (s.phase === 'aktiv' && (this.defs[i] as WorldEventDef).gross) return s.id;
    }
    return null;
  }

  daylightFactor(minute: number): number {
    if (this.eclipseStart < 0) return 1;
    return eclipseFactor(minute, this.eclipseStart, this.eclipseEnd);
  }

  /** The state of event `id` (undefined: not a running event of the register). */
  stateOf(id: string): Readonly<WorldEventState> | undefined {
    for (const s of this.states) if (s.id === id) return s;
    return undefined;
  }

  /** Every event that runs, with its state (for the HUD and the sky). */
  forEachState(visit: (def: WorldEventDef, state: Readonly<WorldEventState>) => void): void {
    for (let i = 0; i < this.states.length; i++) visit(this.defs[i] as WorldEventDef, this.states[i] as WorldEventState);
  }

  /** Number of events that run – the index range of `defAt`/`stateAt` (the HUD and the sky read them per frame without a callback). */
  get count(): number {
    return this.defs.length;
  }

  /** The `i`-th event that runs. */
  defAt(i: number): WorldEventDef {
    return this.defs[i] as WorldEventDef;
  }

  /** The state of the `i`-th event that runs. */
  stateAt(i: number): Readonly<WorldEventState> {
    return this.states[i] as WorldEventState;
  }

  /** Whether the forest fire runs (lightning sets trees alight far more often). */
  dry(): boolean {
    return this.phase(FOREST_FIRE) === 'aktiv';
  }

  // -------------------------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------------------------

  worldTick(sim: Simulation): void {
    const now = clockMinute(this.deps.calendar.clock);
    for (let i = 0; i < this.defs.length; i++) this.advance(sim, i, now);
    this.drawMinutes(sim, Math.floor(now));
  }

  /** The run of `def` that covers minute `now` (announced to ended) into `this.occ`; false when none. */
  private currentRun(sim: Simulation, def: WorldEventDef, now: number): boolean {
    const forced = this.forced.get(def.id);
    if (forced !== undefined) {
      if (now < forced.end) {
        copyInto(forced, this.occ);
        return true;
      }
      this.forced.delete(def.id);
    }
    if (def.planung.art === 'wetter') return this.weatherRun(sim, def, now);
    const seed = sim.config.seed;
    const today = dayOfMinute(now);
    // A run of yesterday may reach past midnight (a night); one of tomorrow is never announced before today ends.
    for (let d = today - 1; d <= today; d++) {
      if (d < 1 || !occurrenceOn(def, seed, d, this.seasonOf, this.cand)) continue;
      if (now >= this.cand.announce && now < this.cand.end) {
        copyInto(this.cand, this.occ);
        return true;
      }
    }
    return false;
  }

  /** The run of a weather event: while the player's region has its weather on one of its days. */
  private weatherRun(sim: Simulation, def: WorldEventDef, now: number): boolean {
    const region = this.playerRegion(sim);
    const state = region < 0 ? null : this.deps.world.weather(sim, region);
    if (state === null || def.planung.wetter === undefined || !def.planung.wetter.includes(state)) return false;
    const from = this.deps.world.periodStart(sim, region);
    const day = dayOfMinute(from);
    if (!weatherDay(def, sim.config.seed, day, this.deps.calendar.seasonOfDay(day))) return false;
    this.occ.announce = from;
    this.occ.start = from + def.ankuendigung.vorlaufMinuten;
    this.occ.end = Math.min(this.occ.start + weatherDuration(def, sim.config.seed, day), this.deps.world.periodEnd(sim, region));
    return now < this.occ.end && this.occ.end > this.occ.start;
  }

  private advance(sim: Simulation, i: number, now: number): void {
    const def = this.defs[i] as WorldEventDef;
    const st = this.states[i] as WorldEventState;
    const has = this.currentRun(sim, def, now);
    const run = this.occ;
    // The run the state belongs to is over (its time, a broken condition, a jump in time).
    if (st.phase !== 'ruhe' && (!has || run.start !== this.runStart[i])) this.finish(sim, i, now >= this.minuteOf(sim, st.endTick) ? 'zeit' : 'abgesagt');
    if (!has || this.handled.get(def.id) === run.start) return;
    if (now < run.start) {
      if (st.phase === 'ruhe' && this.conditionsHold(sim, def)) this.announce(sim, i, run);
      return;
    }
    if (st.phase === 'aktiv') {
      if (!this.conditionsHold(sim, def)) this.finish(sim, i, 'abgesagt');
      return;
    }
    const big = this.activeBig();
    if (!this.conditionsHold(sim, def) || (def.gross && big !== null && big !== def.id)) {
      if (st.phase === 'angekuendigt') this.finish(sim, i, 'abgesagt');
      this.handled.set(def.id, run.start);
      return;
    }
    if (st.phase === 'ruhe') this.announce(sim, i, run);
    this.begin(sim, i);
  }

  /** The conditions of a run besides its time: the weather of the player's region (the Lumen rain's clear sky), its biome. */
  private conditionsHold(sim: Simulation, def: WorldEventDef): boolean {
    if (this.forced.has(def.id)) return true;
    const p = def.planung;
    if (p.art === 'wetter' || (p.wetter === undefined && p.biome === undefined)) return true;
    const region = this.playerRegion(sim);
    if (region < 0) return false;
    if (p.wetter !== undefined) {
      const w = this.deps.world.weather(sim, region);
      if (w === null || !p.wetter.includes(w)) return false;
    }
    return p.biome === undefined || p.biome.includes(this.deps.world.regionBiome(sim, region));
  }

  private announce(sim: Simulation, i: number, run: Occurrence): void {
    const def = this.defs[i] as WorldEventDef;
    const st = this.states[i] as WorldEventState;
    st.phase = 'angekuendigt';
    st.announceTick = sim.eventTick;
    st.startTick = this.tickOf(sim, run.start);
    st.endTick = this.tickOf(sim, run.end);
    this.runStart[i] = run.start;
    if (def.id === ECLIPSE) {
      this.eclipseStart = run.start;
      this.eclipseEnd = run.end;
    }
    sim.events.push('worldEventAnnounced', { event: def.id, startTick: st.startTick, endTick: st.endTick, tick: sim.eventTick });
  }

  private begin(sim: Simulation, i: number): void {
    const def = this.defs[i] as WorldEventDef;
    const st = this.states[i] as WorldEventState;
    st.phase = 'aktiv';
    if (def.id === LUMEN_RAIN) this.meteorFallen = false;
    sim.events.push('worldEventStarted', { event: def.id, startTick: st.startTick, endTick: st.endTick, tick: sim.eventTick });
  }

  private finish(sim: Simulation, i: number, grund: WorldEventEndReason): void {
    const def = this.defs[i] as WorldEventDef;
    const st = this.states[i] as WorldEventState;
    if (this.runStart[i] !== -1) this.handled.set(def.id, this.runStart[i] as number);
    sim.events.push('worldEventEnded', { event: def.id, endTick: sim.eventTick, grund, tick: sim.eventTick });
    st.phase = 'ruhe';
    st.announceTick = NO_TICK;
    st.startTick = NO_TICK;
    st.endTick = NO_TICK;
    this.runStart[i] = -1;
    if (def.id === ECLIPSE) {
      this.eclipseStart = -1;
      this.eclipseEnd = -1;
    }
    this.forced.delete(def.id);
  }

  // -------------------------------------------------------------------------------------------
  // Per-minute draws: lightning, the Lumen rain
  // -------------------------------------------------------------------------------------------

  private drawMinutes(sim: Simulation, minute: number): void {
    if (this.drawnMinute < 0 || minute - this.drawnMinute > MAX_DRAW_MINUTES) this.drawnMinute = minute - 1;
    while (this.drawnMinute < minute) {
      this.drawnMinute++;
      const m = this.drawnMinute;
      this.lightningMinute(sim, m);
      if (this.phase(LUMEN_RAIN) === 'aktiv') this.lumenMinute(sim, m);
    }
  }

  private lightningMinute(sim: Simulation, m: number): void {
    if (!this.playerOnSurface(sim)) return;
    const region = this.playerRegion(sim);
    if (region < 0 || this.deps.world.weather(sim, region) !== 'gewitter') return;
    const seed = sim.config.seed;
    if (strikeDraw(seed, region, m, STRIKE_DRAW.chance) >= W.strikeChancePerMinute) return;
    const p = pointAround(this.at.x / TILE_PX, this.at.y / TILE_PX, [0, W.strikeRangeTiles], strikeDraw(seed, region, m, STRIKE_DRAW.angle), strikeDraw(seed, region, m, STRIKE_DRAW.distance), this.spot);
    if (!this.deps.world.active(sim, p.x, p.y)) return;
    this.lightning.strike(sim, p.x, p.y, this.dry(), strikeDraw(seed, region, m, STRIKE_DRAW.target), this.at);
  }

  private lumenMinute(sim: Simulation, m: number): void {
    if (!this.playerOnSurface(sim)) return;
    const seed = sim.config.seed;
    const px = this.at.x / TILE_PX;
    const py = this.at.y / TILE_PX;
    if (shardDraw(seed, m, SHARD_FALL) < W.shardChancePerMinute) {
      const p = pointAround(px, py, W.shardDistanceTiles, shardDraw(seed, m, SHARD_ANGLE), shardDraw(seed, m, SHARD_DIST), this.spot);
      if (this.deps.world.active(sim, p.x, p.y) && this.deps.world.landsOn(sim, p.x, p.y)) {
        this.drop(sim, SHARD_ITEM, 1, p.x, p.y);
        sim.events.push('lumenShardFell', { layer: SURFACE, x: (p.x + 0.5) * TILE_PX, y: (p.y + 0.5) * TILE_PX, tick: sim.eventTick });
      }
    }
    // The meteorite: once, at the minute the run's plan says, with `meteorChance` per run.
    const st = this.stateOf(LUMEN_RAIN);
    if (st === undefined || this.meteorFallen) return;
    const start = this.minuteOf(sim, st.startTick);
    const end = this.minuteOf(sim, st.endTick);
    const day = dayOfMinute(start);
    if (planDraw(seed, LUMEN_RAIN, day, METEOR_CHANCE_DRAW) >= W.meteorChance) return;
    const due = Math.floor(start + planDraw(seed, LUMEN_RAIN, day, METEOR_MINUTE_DRAW) * (end - start));
    if (m < due) return;
    // A few tries a minute for open, dry ground in the active zone (water and trees all around delay it a minute).
    let p: { x: number; y: number } | null = null;
    for (let k = 0; k < METEOR_TRIES && p === null; k++) {
      const q = pointAround(px, py, W.meteorDistanceTiles, shardDraw(seed, m, METEOR_ANGLE + 2 * k), shardDraw(seed, m, METEOR_DIST + 2 * k), this.spot);
      if (this.deps.world.active(sim, q.x, q.y) && this.deps.world.landsOn(sim, q.x, q.y)) p = q;
    }
    if (p === null) return;
    this.meteorFallen = true;
    const o0 = W.meteorOre[0] as number;
    const o1 = W.meteorOre[1] as number;
    const ore = o0 + Math.floor(planDraw(seed, LUMEN_RAIN, day, METEOR_ORE_DRAW) * (o1 - o0 + 1));
    this.drop(sim, ORE_ITEM, ore, p.x, p.y);
    sim.events.push('meteorImpact', { layer: SURFACE, x: (p.x + 0.5) * TILE_PX, y: (p.y + 0.5) * TILE_PX, tick: sim.eventTick });
  }

  private drop(sim: Simulation, item: string, count: number, tx: number, ty: number): void {
    const def = this.deps.catalog.find(item);
    if (def !== undefined) this.deps.spill(sim, newStack(def, count), SURFACE, (tx + 0.5) * TILE_PX, (ty + 0.5) * TILE_PX);
  }

  // -------------------------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------------------------

  /** Whether the player stands on the surface (its position into `this.at` [px]). */
  private playerOnSurface(sim: Simulation): boolean {
    const p = this.deps.player;
    return sim.player !== NULL_ENTITY && p.body(sim)?.layer === SURFACE && p.position(sim, this.at);
  }

  /** The weather region of the player's tile (−1: none, or the player is not on the surface). */
  private playerRegion(sim: Simulation): number {
    if (!this.playerOnSurface(sim)) return -1;
    return this.deps.world.regionAt(sim, Math.floor(this.at.x / TILE_PX), Math.floor(this.at.y / TILE_PX));
  }

  /** The tick of absolute game minute `minute` at the clock's day length. */
  private tickOf(sim: Simulation, minute: number): number {
    const clock = this.deps.calendar.clock;
    return Math.max(0, Math.round(sim.tick + (minute - clockMinute(clock)) / minutesPerTick(clock)));
  }

  /** The absolute game minute of tick `tick`. */
  private minuteOf(sim: Simulation, tick: number): number {
    const clock = this.deps.calendar.clock;
    return clockMinute(clock) + (tick - sim.tick) * minutesPerTick(clock);
  }

  private refuse(sim: Simulation, type: GameCommandType, tick: number, reason: WorldEventRejectReason | null): void {
    if (reason !== null) sim.events.push('commandRejected', { type, reason, tick });
  }

  // -------------------------------------------------------------------------------------------
  // Debug
  // -------------------------------------------------------------------------------------------

  /** Starts event `id` now for the longest of its durations (console `ereignis <id>`). */
  private debugStart(sim: Simulation, id: string): WorldEventRejectReason | null {
    const i = this.defs.findIndex((d) => d.id === id);
    if (i < 0) return 'unknownEvent';
    const def = this.defs[i] as WorldEventDef;
    const st = this.states[i] as WorldEventState;
    const big = this.activeBig();
    if (def.gross && big !== null && big !== id) return 'bigEventRunning';
    if (st.phase !== 'ruhe') this.finish(sim, i, 'debug');
    const now = clockMinute(this.deps.calendar.clock);
    const run: Occurrence = { announce: now, start: now, end: now + def.dauerMinuten[1] };
    this.forced.set(id, run);
    this.handled.delete(id);
    this.announce(sim, i, run);
    this.begin(sim, i);
    return null;
  }

  private debugStop(sim: Simulation, id: string): WorldEventRejectReason | null {
    const i = this.defs.findIndex((d) => d.id === id);
    if (i < 0) return 'unknownEvent';
    if ((this.states[i] as WorldEventState).phase === 'ruhe') return 'notRunning';
    this.finish(sim, i, 'debug');
    return null;
  }

  /** A lightning strike `dx`, `dy` tiles from the player now (console `blitz`). */
  private debugStrike(sim: Simulation, dx: number, dy: number): WorldEventRejectReason | null {
    if (!this.playerOnSurface(sim)) return 'noPlayer';
    const tx = Math.floor(this.at.x / TILE_PX) + dx;
    const ty = Math.floor(this.at.y / TILE_PX) + dy;
    this.lightning.strike(sim, tx, ty, this.dry(), 0, this.at);
    return null;
  }

  // -------------------------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------------------------

  private snapshot(): WorldEventsSnapshot {
    return {
      events: this.states.map(copyWorldEventState),
      runStarts: Object.fromEntries(this.states.flatMap((st, i) => (this.runStart[i] === -1 ? [] : [[st.id, this.runStart[i] as number]]))),
      drawnMinute: this.drawnMinute,
      meteorFallen: this.meteorFallen,
      handled: Object.fromEntries([...this.handled.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
      forced: [...this.forced.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([event, o]) => ({ event, start: o.start, end: o.end })),
    };
  }

  private restore(data: unknown): void {
    const parsed = worldEventsSnapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`world-events snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    const d = parsed.data;
    for (const e of d.events) if (!this.defs.some((def) => def.id === e.id)) throw new TypeError(`world-events snapshot invalid: unknown event ${e.id}`);
    for (const f of d.forced) if (!this.defs.some((def) => def.id === f.event)) throw new TypeError(`world-events snapshot invalid: unknown event ${f.event}`);
    this.states.forEach((s, i) => {
      const saved = d.events.find((e) => e.id === s.id);
      this.states[i] = saved === undefined ? newWorldEventState(s.id) : copyWorldEventState(saved);
      const start = d.runStarts[s.id];
      if ((this.states[i] as WorldEventState).phase !== 'ruhe' && start === undefined) throw new TypeError(`world-events snapshot invalid: ${s.id} runs without its start minute`);
      this.runStart[i] = (this.states[i] as WorldEventState).phase === 'ruhe' ? -1 : (start as number);
    });
    this.drawnMinute = d.drawnMinute;
    this.meteorFallen = d.meteorFallen;
    this.handled.clear();
    for (const [k, v] of Object.entries(d.handled)) this.handled.set(k, v);
    this.forced.clear();
    for (const f of d.forced) this.forced.set(f.event, { announce: f.start, start: f.start, end: f.end });
    // The eclipse's run comes back with its state: the daylight reads it before the first tick.
    this.eclipseStart = -1;
    this.eclipseEnd = -1;
    const e = this.defs.findIndex((def) => def.id === ECLIPSE);
    const st = this.states[e];
    if (e >= 0 && st !== undefined && st.phase !== 'ruhe') {
      this.eclipseStart = this.runStart[e] as number;
      this.eclipseEnd = this.eclipseStart + (st.endTick - st.startTick) * minutesPerTick(this.deps.calendar.clock);
    }
  }
}

function copyInto(from: Occurrence, to: Occurrence): void {
  to.announce = from.announce;
  to.start = from.start;
  to.end = from.end;
}
