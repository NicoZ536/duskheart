/**
 * Achievements (MASTERPROMPT §23.3 "Erfolge (≥ 60, lokal)"; docs/SPIEL.md §23 "Erfolge"; strand G, system `achievements`,
 * M7-47): every open achievement waits on the trigger board (src/game/triggers) – its event parts count from the world's
 * start, its state parts are read on the world tick – and is unlocked once, with its tick (`achievementUnlocked`).
 *
 * An observer (`observeStep`): it sees each step's events once, after `stats` – an achievement that reads a statistic sees
 * the value of the same step. No tick hooks. Save participant `achievements` (version 1).
 */
import { CONTENT } from '../../content/index';
import type { AchievementDef } from '../../content/quests/schema';
import type { StepEvents } from '../observe';
import type { SaveParticipant } from '../participant';
import type { SimEventMap, SimSystem, Simulation } from '../sim';
import { OWN_STATS } from '../stats/system';
import { Armed, TriggerBoard } from '../triggers/evaluator';
import { triggerProgress, type TriggerProgress } from '../triggers/progress';
import type { SimTriggerWorld } from '../triggers/world';
import { achievementsSnapshotSchema, type AchievementsSnapshot } from './state';
import type { AchievementState } from './types';

/** Id of the achievement system and its save participant. */
export const ACHIEVEMENTS_SYSTEM_ID = 'achievements';
/** Data version of the `achievements` participant. */
export const ACHIEVEMENTS_SAVE_VERSION = 1;

/** Dependencies of the achievement system (tests hand in their own achievements). */
export interface AchievementsSystemDeps {
  readonly world: SimTriggerWorld;
  readonly achievements?: readonly AchievementDef[];
}

export class AchievementsSystem implements SimSystem {
  readonly id = ACHIEVEMENTS_SYSTEM_ID;
  readonly save: SaveParticipant;
  readonly defs: readonly AchievementDef[];
  private readonly unlockedList: AchievementState[] = [];
  private readonly unlockedById = new Map<string, AchievementState>();
  private readonly board = new TriggerBoard();
  private readonly armedById = new Map<string, Armed>();
  private readonly world: SimTriggerWorld;
  private player = 0;
  private worldTickSeen = false;
  /** The trigger world's statistics revision at the last check (a change checks the state-like triggers). */
  private seenStatRevision = -1;
  private stepSim: Simulation | null = null;
  private readonly onEvent: <K extends keyof SimEventMap>(type: K, payload: SimEventMap[K]) => void;
  private readonly onReady: (a: Armed) => void;

  constructor(deps: AchievementsSystemDeps) {
    this.world = deps.world;
    this.defs = deps.achievements ?? CONTENT.collection('achievements').values();
    this.onEvent = (type, payload) => {
      if (type === 'worldTick') this.worldTickSeen = true;
      this.board.dispatch(type, payload as object, this.player);
    };
    this.onReady = (a) => {
      const sim = this.stepSim;
      if (sim !== null) this.unlock(sim, a.owner);
    };
    this.arm(null);
    this.save = {
      id: ACHIEVEMENTS_SYSTEM_ID,
      version: ACHIEVEMENTS_SAVE_VERSION,
      // Saves before M7 know no achievements: all open.
      migrations: [{ from: 0, migrate: (): AchievementsSnapshot => ({ erreicht: [], wartend: {} }) }],
      serialize: (): AchievementsSnapshot => this.snapshot(),
      deserialize: (data) => this.restore(data),
    };
  }

  /** The unlocked achievements in unlock order. */
  unlocked(): readonly AchievementState[] {
    return this.unlockedList;
  }

  /** Whether `id` is unlocked. */
  has(id: string): boolean {
    return this.unlockedById.has(id);
  }

  /** The armed trigger of the open achievement `id` (its counters for the chronicle's progress), or `undefined`. */
  waiting(id: string): Armed | undefined {
    return this.armedById.get(id);
  }

  /** Fills `out` with how far the open achievement `def` is (`need` 0: not countable; an unlocked one counts as full). */
  progress(sim: Simulation, def: AchievementDef, out: TriggerProgress): TriggerProgress {
    triggerProgress(def.ausloeser, this.armedById.get(def.id) ?? null, this.world.bind(sim), out);
    if (this.has(def.id)) out.count = out.need;
    return out;
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
    this.board.settle(this.world.bind(sim), this.stateDue(), this.onReady);
    this.stepSim = null;
  }

  /** Unlocks `id` now (its trigger held, or the debug console); false when unknown or unlocked already. */
  unlock(sim: Simulation, id: string): boolean {
    if (this.unlockedById.has(id) || !this.defs.some((d) => d.id === id)) return false;
    const a = this.armedById.get(id);
    if (a !== undefined) {
      this.board.disarm(a);
      this.armedById.delete(id);
    }
    const state: AchievementState = { id, tick: sim.eventTick, spielzeit: Math.floor(this.world.statValue(OWN_STATS.playTime)) };
    this.unlockedList.push(state);
    this.unlockedById.set(id, state);
    sim.events.push('achievementUnlocked', { achievement: id, tick: sim.eventTick });
    return true;
  }

  private arm(saved: Readonly<Record<string, readonly number[]>> | null): void {
    this.board.clear();
    this.armedById.clear();
    for (const d of this.defs) {
      if (this.unlockedById.has(d.id)) continue;
      const a = new Armed(d.ausloeser, d.id, saved?.[d.id]);
      this.armedById.set(d.id, a);
      this.board.arm(a);
    }
  }

  private snapshot(): AchievementsSnapshot {
    const wartend: Record<string, number[]> = {};
    for (const [id, a] of this.armedById) if (a.counts.some((c) => c > 0)) wartend[id] = a.savedCounts();
    return { erreicht: this.unlockedList.map((s) => ({ id: s.id, tick: s.tick, spielzeit: s.spielzeit })), wartend };
  }

  private restore(data: unknown): void {
    const parsed = achievementsSnapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`achievements snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const known = new Set(this.defs.map((d) => d.id));
    for (const id of [...parsed.data.erreicht.map((a) => a.id), ...Object.keys(parsed.data.wartend)]) {
      if (!known.has(id)) throw new TypeError(`achievements snapshot invalid: unknown achievement "${id}"`);
    }
    this.unlockedList.length = 0;
    this.unlockedById.clear();
    for (const a of parsed.data.erreicht) {
      const state: AchievementState = { id: a.id, tick: a.tick, spielzeit: a.spielzeit };
      this.unlockedList.push(state);
      this.unlockedById.set(a.id, state);
    }
    this.arm(parsed.data.wartend);
  }
}
