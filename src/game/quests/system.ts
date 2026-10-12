/**
 * Quests (MASTERPROMPT §23.3 "Aufgaben (Haupt- und Nebenaufgaben mit Hinweisen und Kartenmarkern)", "Einstieg „Die ersten
 * Stunden“ … jederzeit abschaltbar"; docs/SPIEL.md §23 "Aufgaben", "Einstieg"; strand G, system `quests`, M7-42, M7-43).
 *
 * - A quest (content `quests`) begins at world start, or when its `start` trigger holds; its steps follow one another, each
 *   waiting on the trigger board (src/game/triggers) – event parts count from the moment the step became active, state parts
 *   are read on the world tick. A step that holds raises `questStepCompleted` and the next becomes active (Funke speaks its
 *   dialog, src/game/guide); after the last one `questCompleted` gives the reward (items into the bags – what does not fit
 *   lands at the feet –, knowledge).
 * - Onboarding quests (`art: 'einstieg'`) run only while the world's onboarding is on (`quest.onboarding`); switched off,
 *   their step stops waiting (its counters are kept) and they leave the tracker.
 * - Up to `BALANCE.quests.trackedMax` active quests are tracked in the HUD (`quest.track`); a quest that begins takes a free
 *   place by itself.
 *
 * An observer (`observeStep`) after the chronicle: a step reading a statistic sees the value of the same step. No tick hooks.
 * Save participant `quests` (version 1).
 */
import { BALANCE } from '../../content/balance';
import { CONTENT } from '../../content/index';
import type { QuestDef, QuestStepDef } from '../../content/quests/schema';
import type { StepEvents } from '../observe';
import type { SaveParticipant } from '../participant';
import type { CommandHandlers, SimEventMap, SimSystem, Simulation } from '../sim';
import { Armed, TriggerBoard } from '../triggers/evaluator';
import { triggerProgress, type TriggerProgress } from '../triggers/progress';
import type { SimTriggerWorld } from '../triggers/world';
import type { QuestRejectReason } from './events';
import { emptyQuestsSnapshot, questsSnapshotSchema, type QuestsSnapshot } from './state';
import type { QuestState, QuestStatusView } from './types';

/** Id of the quest system and its save participant. */
export const QUESTS_SYSTEM_ID = 'quests';
/** Data version of the `quests` participant. */
export const QUESTS_SAVE_VERSION = 1;

/** One quest of the world: its content, its state once started, the armed trigger of its current step or of its start. */
export interface QuestRun {
  readonly def: QuestDef;
  state: QuestState | null;
  /** The armed trigger of the current step (null: not started, finished, or paused onboarding). */
  step: Armed | null;
  /** The armed start trigger while the quest waits for it. */
  start: Armed | null;
}

/** Hands out a quest's reward. */
export interface QuestRewards {
  /** Puts `count` of `item` into the bags; what does not fit lands at the player's feet. */
  give?(sim: Simulation, item: string, count: number): void;
  /** Unlocks knowledge entry `id` (the chronicle). */
  knowledge?(sim: Simulation, id: string): void;
}

/** Dependencies of the quest system (tests hand in their own quests). */
export interface QuestsSystemDeps {
  readonly world: SimTriggerWorld;
  readonly rewards?: QuestRewards;
  readonly quests?: readonly QuestDef[];
}

export class QuestsSystem implements SimSystem {
  readonly id = QUESTS_SYSTEM_ID;
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  /** The quests in content order. */
  readonly runs: readonly QuestRun[];
  private readonly byId = new Map<string, QuestRun>();
  private readonly stepBoard = new TriggerBoard();
  private readonly startBoard = new TriggerBoard();
  private readonly world: SimTriggerWorld;
  private readonly rewards: QuestRewards;
  private onboardingOn = true;
  /** Quests without a start trigger are due to begin (world start, a load, the onboarding switched on). */
  private startsDue = true;
  private player = 0;
  private worldTickSeen = false;
  /** The trigger world's statistics revision at the last check (a change checks the state-like triggers). */
  private seenStatRevision = -1;
  private stepSim: Simulation | null = null;
  private readonly onEvent: <K extends keyof SimEventMap>(type: K, payload: SimEventMap[K]) => void;
  private readonly onStepHeld: (a: Armed) => void;
  private readonly onStartHeld: (a: Armed) => void;

  constructor(deps: QuestsSystemDeps) {
    this.world = deps.world;
    this.rewards = deps.rewards ?? {};
    const defs = deps.quests ?? CONTENT.collection('quests').values();
    if (defs.length > BALANCE.quests.questsMax) throw new Error(`Quests: ${defs.length} quests, at most ${BALANCE.quests.questsMax}`);
    this.runs = defs.map((def) => ({ def, state: null, step: null, start: null }));
    for (const r of this.runs) this.byId.set(r.def.id, r);
    this.onEvent = (type, payload) => {
      if (type === 'worldTick') this.worldTickSeen = true;
      this.startBoard.dispatch(type, payload as object, this.player);
      this.stepBoard.dispatch(type, payload as object, this.player);
    };
    this.onStepHeld = (a) => {
      const sim = this.stepSim;
      const run = this.byId.get(a.owner);
      if (sim !== null && run !== undefined && run.step === a) this.advance(sim, run);
    };
    this.onStartHeld = (a) => {
      const sim = this.stepSim;
      const run = this.byId.get(a.owner);
      if (sim !== null && run !== undefined && run.start === a) this.begin(sim, run, 0);
    };
    // Their status is what `aufgabe` triggers read – of every observer sharing this world.
    this.world.use({ questStatus: (quest, step) => this.status(quest, step) });
    this.armStarts(null);
    this.commands = {
      'quest.track': (sim, cmd, tick) => {
        const run = this.byId.get(cmd.quest);
        const reason: QuestRejectReason | null =
          run === undefined ? 'unknownQuest' : !this.active(run) ? 'questNotActive' : cmd.on && !(run.state as QuestState).tracked && this.trackedCount() >= BALANCE.quests.trackedMax ? 'trackerFull' : null;
        if (reason !== null) {
          sim.events.push('commandRejected', { type: cmd.type, reason, tick });
          return;
        }
        (run?.state as QuestState).tracked = cmd.on;
      },
      'quest.onboarding': (sim, cmd) => this.setOnboarding(sim, cmd.on),
      'quest.debug': (sim, cmd, tick) => {
        const run = this.byId.get(cmd.quest);
        if (run === undefined) {
          sim.events.push('commandRejected', { type: cmd.type, reason: 'unknownQuest', tick });
          return;
        }
        if (cmd.schritt !== undefined) {
          const index = run.def.schritte.findIndex((s) => s.id === cmd.schritt);
          if (index < 0) {
            sim.events.push('commandRejected', { type: cmd.type, reason: 'unknownStep', tick });
            return;
          }
          this.debugJump(sim, run, index);
          return;
        }
        if (!this.active(run)) {
          sim.events.push('commandRejected', { type: cmd.type, reason: 'questNotActive', tick });
          return;
        }
        this.advance(sim, run);
      },
    };
    this.save = {
      id: QUESTS_SYSTEM_ID,
      version: QUESTS_SAVE_VERSION,
      // Saves before M7 have no quests: they begin with the next step, the onboarding on.
      migrations: [{ from: 0, migrate: (): QuestsSnapshot => emptyQuestsSnapshot() }],
      serialize: (): QuestsSnapshot => this.snapshot(),
      deserialize: (data) => this.restore(data),
    };
  }

  /** Whether the world's onboarding is on. */
  get onboarding(): boolean {
    return this.onboardingOn;
  }

  /** The run of quest `id`, or `undefined`. */
  run(id: string): QuestRun | undefined {
    return this.byId.get(id);
  }

  /** The current step of an active quest, or `null`. */
  currentStep(run: QuestRun): QuestStepDef | null {
    const s = run.state;
    return s === null || s.status !== 'aktiv' ? null : (run.def.schritte[s.step] ?? null);
  }

  /** Whether `run` runs now (started, not finished, not a paused onboarding quest). */
  active(run: QuestRun): boolean {
    return run.state !== null && run.state.status === 'aktiv' && !this.paused(run);
  }

  /** Whether `run` is an onboarding quest while the onboarding is off. */
  paused(run: QuestRun): boolean {
    return run.def.art === 'einstieg' && !this.onboardingOn;
  }

  /** Status of quest `quest` (or of its step `step`) for the triggers (`aufgabe`): open, active or done. */
  status(quest: string, step?: string): QuestStatusView {
    const run = this.byId.get(quest);
    const s = run?.state ?? null;
    if (run === undefined || s === null) return 'offen';
    if (step === undefined) return s.status;
    if (s.status === 'erledigt') return 'erledigt';
    const index = run.def.schritte.findIndex((x) => x.id === step);
    return index < 0 ? 'offen' : index < s.step ? 'erledigt' : index === s.step ? 'aktiv' : 'offen';
  }

  /** Fills `out` with how far the current step of `run` is (`need` 0: not countable, or no step running). */
  stepProgress(sim: Simulation, run: QuestRun, out: TriggerProgress): TriggerProgress {
    const step = this.currentStep(run);
    if (step === null || this.paused(run)) {
      out.count = 0;
      out.need = 0;
      return out;
    }
    return triggerProgress(step.ausloeser, run.step, this.world.bind(sim), out);
  }

  /** Number of tracked active quests. */
  trackedCount(): number {
    let n = 0;
    for (const r of this.runs) if (this.active(r) && (r.state as QuestState).tracked) n++;
    return n;
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
    if (this.startsDue) this.beginDue(sim);
    events.forEach(this.onEvent);
    const world = this.world.bind(sim);
    const due = this.stateDue();
    this.startBoard.settle(world, due, this.onStartHeld);
    this.stepBoard.settle(world, due, this.onStepHeld);
    this.stepSim = null;
  }

  /** Switches the world's onboarding (`quest.onboarding`). */
  setOnboarding(sim: Simulation, on: boolean): void {
    if (on === this.onboardingOn) return;
    this.onboardingOn = on;
    for (const run of this.runs) {
      if (run.def.art !== 'einstieg' || run.state === null || run.state.status !== 'aktiv') continue;
      if (on) {
        if (run.step !== null) this.stepBoard.arm(run.step);
        run.state.tracked = this.trackedCount() < BALANCE.quests.trackedMax;
      } else {
        if (run.step !== null) this.stepBoard.disarm(run.step);
        run.state.tracked = false;
      }
    }
    if (on) {
      this.startsDue = true;
      this.armStarts(null);
      this.beginDue(sim);
    }
  }

  private beginDue(sim: Simulation): void {
    this.startsDue = false;
    for (const run of this.runs) if (run.state === null && run.def.start === undefined && this.mayBegin(run)) this.begin(sim, run, 0);
  }

  private mayBegin(run: QuestRun): boolean {
    return run.def.art !== 'einstieg' || this.onboardingOn;
  }

  /** Starts `run` at step `index` (`questStarted`). */
  private begin(sim: Simulation, run: QuestRun, index: number): void {
    if (!this.mayBegin(run)) return;
    if (run.start !== null) {
      this.startBoard.disarm(run.start);
      run.start = null;
    }
    run.state = { quest: run.def.id, status: 'aktiv', step: index, count: 0, startedTick: sim.eventTick, tracked: this.trackedCount() < BALANCE.quests.trackedMax };
    sim.events.push('questStarted', { quest: run.def.id, tick: sim.eventTick });
    this.armStep(run, null);
  }

  /** Completes the current step of `run`; the next one becomes active, or the quest is done. */
  private advance(sim: Simulation, run: QuestRun): void {
    const s = run.state;
    if (s === null || s.status !== 'aktiv') return;
    const step = run.def.schritte[s.step] as QuestStepDef;
    if (run.step !== null) {
      this.stepBoard.disarm(run.step);
      run.step = null;
    }
    sim.events.push('questStepCompleted', { quest: run.def.id, schritt: step.id, tick: sim.eventTick });
    s.step++;
    s.count = 0;
    if (s.step < run.def.schritte.length) {
      this.armStep(run, null);
      return;
    }
    s.status = 'erledigt';
    s.step = run.def.schritte.length - 1;
    s.tracked = false;
    sim.events.push('questCompleted', { quest: run.def.id, tick: sim.eventTick });
    const reward = run.def.belohnung;
    for (const r of reward?.items ?? []) this.rewards.give?.(sim, r.item, r.anzahl);
    if (reward?.wissen !== undefined) this.rewards.knowledge?.(sim, reward.wissen);
  }

  /** Debug: `run` at step `index` (started if need be; the steps before it count as done, without their events). */
  private debugJump(sim: Simulation, run: QuestRun, index: number): void {
    if (run.state === null || run.state.status !== 'aktiv') {
      if (run.state !== null) run.state = null;
      if (run.step !== null) {
        this.stepBoard.disarm(run.step);
        run.step = null;
      }
      this.begin(sim, run, index);
      return;
    }
    if (run.step !== null) this.stepBoard.disarm(run.step);
    run.state.step = index;
    run.state.count = 0;
    this.armStep(run, null);
  }

  /** Arms the current step of `run` (with saved counters). */
  private armStep(run: QuestRun, counts: readonly number[] | null): void {
    const s = run.state as QuestState;
    const step = run.def.schritte[s.step] as QuestStepDef;
    const a = new Armed(step.ausloeser, run.def.id, counts ?? undefined);
    run.step = a;
    s.count = a.count;
    if (!this.paused(run)) this.stepBoard.arm(a);
  }

  /** Arms the start triggers of the quests that wait for one. */
  private armStarts(saved: Readonly<Record<string, readonly number[]>> | null): void {
    for (const run of this.runs) {
      if (run.state !== null || run.def.start === undefined || !this.mayBegin(run) || run.start !== null) continue;
      run.start = new Armed(run.def.start, run.def.id, saved?.[run.def.id]);
      this.startBoard.arm(run.start);
    }
  }

  private snapshot(): QuestsSnapshot {
    const aufgaben: QuestsSnapshot['aufgaben'] = [];
    const startWartend: Record<string, number[]> = {};
    for (const run of this.runs) {
      const s = run.state;
      if (s !== null) aufgaben.push({ quest: s.quest, status: s.status, step: s.step, counts: run.step?.savedCounts() ?? [], startedTick: s.startedTick, tracked: s.tracked });
      else if (run.start !== null && run.start.counts.some((c) => c > 0)) startWartend[run.def.id] = run.start.savedCounts();
    }
    return { aufgaben, startWartend, einstieg: this.onboardingOn };
  }

  private restore(data: unknown): void {
    const parsed = questsSnapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`quests snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const s = parsed.data;
    for (const q of s.aufgaben) {
      const run = this.byId.get(q.quest);
      if (run === undefined) throw new TypeError(`quests snapshot invalid: unknown quest "${q.quest}"`);
      if (q.step >= run.def.schritte.length) throw new TypeError(`quests snapshot invalid: quest "${q.quest}" has no step ${q.step}`);
    }
    for (const id of Object.keys(s.startWartend)) if (!this.byId.has(id)) throw new TypeError(`quests snapshot invalid: unknown quest "${id}"`);
    this.stepBoard.clear();
    this.startBoard.clear();
    for (const run of this.runs) {
      run.state = null;
      run.step = null;
      run.start = null;
    }
    this.onboardingOn = s.einstieg;
    for (const q of s.aufgaben) {
      const run = this.byId.get(q.quest) as QuestRun;
      run.state = { quest: q.quest, status: q.status, step: q.step, count: q.counts[0] ?? 0, startedTick: q.startedTick, tracked: q.tracked };
      if (q.status === 'aktiv') this.armStep(run, q.counts);
    }
    this.armStarts(s.startWartend);
    this.startsDue = true;
    // The step after loading checks state-like triggers only when the running world would: on the world tick or when a
    // statistic counts in it. The revision counter is not saved, so the last one seen is the world's current one (in a running
    // world every observer has seen it by the end of each step: \`stats\` counts first) – otherwise the first step after
    // loading checks them all and a hint, milestone or step whose condition came true since the last world tick holds a
    // world tick early (M7-41 … M7-47; docs/SPIEL.md §28).
    this.seenStatRevision = this.world.statRevision;
  }
}
