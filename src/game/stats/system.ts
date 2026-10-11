/**
 * Statistics and milestones (MASTERPROMPT §23.3 "Statistiken", §D "Pacing … gemessen per Debug-Statistik (Zeit bis zu
 * Meilenstein-Ereignissen)"; docs/SPIEL.md §23 "Statistiken"; strand G, system `stats`, M7-47, M7-64, M7-72).
 *
 * - **Sources** (content `statSources`, one file per strand): every event of the step that passes a source's filter adds 1 –
 *   or its payload field `wert` – to the source's statistic, per key when the statistic is keyed (`schluessel` names the
 *   payload field: kills per creature, harvests per crop). The system knows no event of another strand in code.
 * - Counted here: `spielzeit` [ticks of play; while asleep a tick counts 1/time scale – the night passes thirty times faster
 *   (§11.5) and is no half hour at the screen] and `distanz` [tiles walked; a step longer than
 *   `BALANCE.quests.distanceMaxStepTiles` is a jump: travel, respawn, teleport].
 * - **Milestones** (content `milestones`): the play time (`spielzeit`, ticks of play) when their trigger first holds
 *   (src/game/triggers) – the pacing measurement of §D: time to a milestone as the player lived it, without the debug time
 *   jumps and with the night asleep as long as it lasted at the screen.
 *
 * An observer (`observeStep`, src/game/observe.ts): it sees each step's events once, headless as in the browser. Global (it
 * counts time in `update`). Save participant `stats` (version 1). Nothing here allocates per tick or per event once the keys
 * of the world exist.
 */
import { BALANCE } from '../../content/balance';
import { CONTENT } from '../../content/index';
import type { MilestoneDef, StatDef, StatSourceDef } from '../../content/stats/schema';
import { TILE_PX } from '../../world/model/coords';
import type { StepEvents } from '../observe';
import type { SaveParticipant } from '../participant';
import type { SimEventMap, SimSystem, Simulation } from '../sim';
import { compileTrigger, type EventLeaf } from '../triggers/compile';
import { Armed, leafMatches, TriggerBoard } from '../triggers/evaluator';
import type { SimTriggerWorld } from '../triggers/world';
import { emptyStatsSnapshot, statsSnapshotSchema, type StatsSnapshot } from './state';
import type { StatsApi } from './types';

/** Id of the statistics system and its save participant. */
export const STATS_SYSTEM_ID = 'stats';
/** Data version of the `stats` participant. */
export const STATS_SAVE_VERSION = 1;
/** The statistics this system counts itself (docs/SPIEL.md §29). */
export const OWN_STATS = { playTime: 'spielzeit', distance: 'distanz' } as const;
/** `statValue(stat, ALL_KEYS)`: how many keys of a keyed statistic were counted (18 different crops, 8 different fish). */
export const ALL_KEYS = '*';

/** One counter: its sum and its value per key. */
export class StatCounter {
  total = 0;
  readonly keys = new Map<string, number>();

  add(amount: number, key: string | null): void {
    this.total += amount;
    if (key !== null) this.keys.set(key, (this.keys.get(key) ?? 0) + amount);
  }
}

/** A compiled source: its filter as an event leaf, the counter, the key and value fields. */
interface Source {
  readonly leaf: EventLeaf;
  readonly counter: StatCounter;
  readonly keyField: string | null;
  readonly valueField: string | null;
}

/** Where the player stands (filled by the dependency, held). */
export interface StatsPosition {
  x: number;
  y: number;
  layer: number;
}

/** Dependencies of the statistics system (tests hand in their own content and views). */
export interface StatsSystemDeps {
  /** The trigger world (shared by the observers, src/game/triggers/world.ts). */
  readonly world: SimTriggerWorld;
  /** Fills `out` with the player's position; false without a living player. */
  readonly playerAt?: (sim: Simulation, out: StatsPosition) => boolean;
  /** The speed of time the simulation asks for (×30 while asleep, §11.5); 1 when absent. */
  readonly timeScale?: () => number;
  readonly stats?: readonly StatDef[];
  readonly sources?: readonly StatSourceDef[];
  readonly milestones?: readonly MilestoneDef[];
}

export class StatsSystem implements SimSystem, StatsApi {
  readonly id = STATS_SYSTEM_ID;
  readonly timeScope = 'global';
  readonly save: SaveParticipant;
  readonly defs: readonly StatDef[];
  readonly milestoneDefs: readonly MilestoneDef[];
  private readonly counters = new Map<string, StatCounter>();
  private readonly sourcesByType = new Map<string, Source[]>();
  private readonly reached = new Map<string, number>();
  private readonly board = new TriggerBoard();
  private readonly armedById = new Map<string, Armed>();
  private readonly world: SimTriggerWorld;
  private readonly playerAt: ((sim: Simulation, out: StatsPosition) => boolean) | null;
  private readonly timeScale: () => number;
  private readonly pos: StatsPosition = { x: 0, y: 0, layer: 0 };
  private last: StatsPosition | null = null;
  private readonly lastRecord: StatsPosition = { x: 0, y: 0, layer: 0 };
  /** Values of the running step's observation (held so the event callback is created once). */
  private player = 0;
  private worldTickSeen = false;
  /** The trigger world's statistics revision at the last check (a change checks the state-like triggers). */
  private seenStatRevision = -1;
  private readonly onEvent: <K extends keyof SimEventMap>(type: K, payload: SimEventMap[K]) => void;
  private readonly onMilestone: (a: Armed) => void;
  private stepSim: Simulation | null = null;

  constructor(deps: StatsSystemDeps) {
    this.world = deps.world;
    this.playerAt = deps.playerAt ?? null;
    this.timeScale = deps.timeScale ?? (() => 1);
    this.defs = deps.stats ?? CONTENT.collection('stats').values();
    this.milestoneDefs = deps.milestones ?? CONTENT.collection('milestones').values();
    for (const d of this.defs) this.counters.set(d.id, new StatCounter());
    const sources = deps.sources ?? CONTENT.collection('statSources').values();
    for (const s of sources) {
      const counter = this.counters.get(s.statistik);
      if (counter === undefined) throw new Error(`Stats: source "${s.id}" counts the unknown statistic "${s.statistik}"`);
      const leaf = compileTrigger({ art: 'ereignis', ereignis: s.ereignis, ...(s.wo === undefined ? {} : { wo: s.wo }) }).leaves[0] as EventLeaf;
      let list = this.sourcesByType.get(s.ereignis);
      if (list === undefined) {
        list = [];
        this.sourcesByType.set(s.ereignis, list);
      }
      list.push({ leaf, counter, keyField: s.schluessel ?? null, valueField: s.wert ?? null });
    }
    // The statistics are what `statistik` triggers read – of every observer sharing this world.
    this.world.use({ stat: (id, key) => this.value(id, key) });
    this.armMilestones(null);
    this.onEvent = (type, payload) => {
      if (type === 'worldTick') this.worldTickSeen = true;
      const list = this.sourcesByType.get(type);
      if (list !== undefined) for (let i = 0; i < list.length; i++) this.count(list[i] as Source, payload as object);
      this.board.dispatch(type, payload as object, this.player);
    };
    this.onMilestone = (a) => {
      const sim = this.stepSim;
      this.board.disarm(a);
      this.armedById.delete(a.owner);
      if (sim !== null && !this.reached.has(a.owner)) this.reached.set(a.owner, Math.floor(this.playTicks()));
    };
    this.save = {
      id: STATS_SYSTEM_ID,
      version: STATS_SAVE_VERSION,
      // Saves before M7 count nothing yet.
      migrations: [{ from: 0, migrate: (): StatsSnapshot => emptyStatsSnapshot() }],
      serialize: (): StatsSnapshot => this.snapshot(),
      deserialize: (data) => this.restore(data),
    };
  }

  /** Value of `stat` (its sum), of one `key` of it, or with `ALL_KEYS` the number of its keys counted so far (0 unknown). */
  value(stat: string, key?: string): number {
    const c = this.counters.get(stat);
    if (c === undefined) return 0;
    if (key === undefined) return c.total;
    if (key === ALL_KEYS) return c.keys.size;
    return c.keys.get(key) ?? 0;
  }

  /** Play time [ticks of play, statistic `spielzeit`] when milestone `id` was first reached, or −1 while it is not reached. */
  milestoneTime(id: string): number {
    return this.reached.get(id) ?? -1;
  }

  /** The play time so far [ticks of play]. */
  playTicks(): number {
    return (this.counters.get(OWN_STATS.playTime) as StatCounter).total;
  }

  /** Calls `visit` for every key of `stat` with its value (insertion order: the order they were first counted). */
  forEachKey(stat: string, visit: (key: string, value: number) => void): void {
    const c = this.counters.get(stat);
    if (c !== undefined) for (const [k, v] of c.keys) visit(k, v);
  }

  /** Play time and the walked distance. */
  update(sim: Simulation): void {
    const scale = this.timeScale();
    (this.counters.get(OWN_STATS.playTime) as StatCounter).total += scale > 1 ? 1 / scale : 1;
    const at = this.playerAt;
    if (at === null || !at(sim, this.pos)) {
      this.last = null;
      return;
    }
    const last = this.last;
    if (last !== null && last.layer === this.pos.layer) {
      const dx = this.pos.x - last.x;
      const dy = this.pos.y - last.y;
      const tiles = Math.sqrt(dx * dx + dy * dy) / TILE_PX;
      if (tiles > 0 && tiles <= BALANCE.quests.distanceMaxStepTiles) (this.counters.get(OWN_STATS.distance) as StatCounter).total += tiles;
    }
    const rec = this.lastRecord;
    rec.x = this.pos.x;
    rec.y = this.pos.y;
    rec.layer = this.pos.layer;
    this.last = rec;
  }

  /** State-like triggers are due on the world tick and in a step in which a statistic counted. */
  private stateDue(): boolean {
    const rev = this.world.statRevision;
    const moved = rev !== this.seenStatRevision;
    this.seenStatRevision = rev;
    return this.worldTickSeen || moved;
  }

  observeStep(sim: Simulation, events: StepEvents): void {
    this.player = sim.player;
    this.worldTickSeen = false;
    this.stepSim = sim;
    events.forEach(this.onEvent);
    this.board.settle(this.world.bind(sim), this.stateDue(), this.onMilestone);
    this.stepSim = null;
  }

  private count(s: Source, payload: object): void {
    if (!leafMatches(s.leaf, payload, this.player)) return;
    const p = payload as Record<string, unknown>;
    let amount = 1;
    if (s.valueField !== null) {
      const v = p[s.valueField];
      if (typeof v !== 'number' || !(v > 0)) return;
      amount = v;
    }
    let key: string | null = null;
    if (s.keyField !== null) {
      const k = p[s.keyField];
      key = typeof k === 'string' ? k : typeof k === 'number' ? String(k) : null;
    }
    s.counter.add(amount, key);
    this.world.statRevision++;
  }

  /** Arms every milestone not reached yet (with saved counters when `saved` has them). */
  private armMilestones(saved: Readonly<Record<string, readonly number[]>> | null): void {
    this.board.clear();
    this.armedById.clear();
    for (const m of this.milestoneDefs) {
      if (this.reached.has(m.id)) continue;
      const a = new Armed(m.ausloeser, m.id, saved?.[m.id]);
      this.armedById.set(m.id, a);
      this.board.arm(a);
    }
  }

  private snapshot(): StatsSnapshot {
    const werte: StatsSnapshot['werte'] = {};
    for (const d of this.defs) {
      const c = this.counters.get(d.id) as StatCounter;
      if (c.total === 0 && c.keys.size === 0) continue;
      werte[d.id] = c.keys.size === 0 ? { summe: c.total } : { summe: c.total, schluessel: Object.fromEntries(c.keys) };
    }
    const meilensteine: Record<string, number> = {};
    for (const m of this.milestoneDefs) {
      const t = this.reached.get(m.id);
      if (t !== undefined) meilensteine[m.id] = t;
    }
    const wartend: Record<string, number[]> = {};
    for (const [id, a] of this.armedById) if (a.counts.some((c) => c > 0)) wartend[id] = a.savedCounts();
    const last = this.last;
    return { werte, meilensteine, wartend, letzte: last === null ? null : { x: last.x, y: last.y, layer: last.layer } };
  }

  private restore(data: unknown): void {
    const parsed = statsSnapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`stats snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const s = parsed.data;
    for (const id of Object.keys(s.werte)) if (!this.counters.has(id)) throw new TypeError(`stats snapshot invalid: unknown statistic "${id}"`);
    for (const id of [...Object.keys(s.meilensteine), ...Object.keys(s.wartend)]) {
      if (!this.milestoneDefs.some((m) => m.id === id)) throw new TypeError(`stats snapshot invalid: unknown milestone "${id}"`);
    }
    for (const [id, c] of this.counters) {
      c.total = 0;
      c.keys.clear();
      const v = s.werte[id];
      if (v === undefined) continue;
      c.total = v.summe;
      for (const [k, n] of Object.entries(v.schluessel ?? {})) c.keys.set(k, n);
    }
    this.reached.clear();
    for (const [id, t] of Object.entries(s.meilensteine)) this.reached.set(id, t);
    this.armMilestones(s.wartend);
    if (s.letzte === null) this.last = null;
    else {
      this.lastRecord.x = s.letzte.x;
      this.lastRecord.y = s.letzte.y;
      this.lastRecord.layer = s.letzte.layer;
      this.last = this.lastRecord;
    }
  }
}
