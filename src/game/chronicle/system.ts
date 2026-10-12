/**
 * The chronicle's diary and knowledge (MASTERPROMPT §23.3 "Chronik (J) … Wissen (Erbauer-Tafeln, Visionen)"; docs/SPIEL.md §23
 * "Tagebuch"; strand G, system `chronicle`, M7-41).
 *
 * - **Diary**: every chronicle rule (content `chronicleRules`, one file per strand) whose event passes its filter writes an
 *   entry `{ nr, tick, day, rule, values }` – the values are the payload fields the rule's text names (and its `zusatz`, which
 *   name a value more precisely: a place's variant, M7-122); the text itself is built
 *   by the UI in the current language (a language switch needs no restart). A one-time rule (`einmalig`) writes once per
 *   world. The diary keeps the youngest `BALANCE.quests.chronicleMaxEntries` entries; `chronicleEntryAdded` tells the UI.
 * - **Knowledge** (content `knowledge`): every entry not yet known waits on the trigger board (src/game/triggers) and is
 *   unlocked when its trigger holds (`knowledgeUnlocked`).
 *
 * An observer (`observeStep`) after `stats` and `achievements`: it sees their events of the same step (an achievement is in the
 * diary in the step it was unlocked). No tick hooks. Save participant `chronicle` (version 1). An entry allocates its record –
 * a few per hour; nothing allocates per event that writes nothing.
 */
import { BALANCE } from '../../content/balance';
import { placeholdersOf, type ChronicleRuleDef, type KnowledgeDef } from '../../content/chronik/schema';
import { CONTENT } from '../../content/index';
import type { StepEvents } from '../observe';
import type { SaveParticipant } from '../participant';
import type { SimEventMap, SimSystem, Simulation } from '../sim';
import { compileTrigger, type EventLeaf } from '../triggers/compile';
import { Armed, leafMatches, TriggerBoard } from '../triggers/evaluator';
import type { SimTriggerWorld } from '../triggers/world';
import { chronicleSnapshotSchema, emptyChronicleSnapshot, type ChronicleSnapshot } from './state';
import type { ChronicleEntry, KnowledgeState } from './types';

/** Id of the chronicle system and its save participant. */
export const CHRONICLE_SYSTEM_ID = 'chronicle';
/** Data version of the `chronicle` participant. */
export const CHRONICLE_SAVE_VERSION = 1;

/** A compiled rule: its filter as an event leaf, the payload fields its text names and those it keeps beside them (`zusatz`). */
interface Rule {
  readonly def: ChronicleRuleDef;
  readonly leaf: EventLeaf;
  readonly fields: readonly string[];
  readonly extra: readonly string[];
}
/** A rule without `zusatz`. */
const NO_EXTRA: readonly string[] = [];

/** Dependencies of the chronicle (tests hand in their own rules and knowledge). */
export interface ChronicleSystemDeps {
  readonly world: SimTriggerWorld;
  readonly rules?: readonly ChronicleRuleDef[];
  readonly knowledge?: readonly KnowledgeDef[];
}

export class ChronicleSystem implements SimSystem {
  readonly id = CHRONICLE_SYSTEM_ID;
  readonly save: SaveParticipant;
  readonly rules: readonly ChronicleRuleDef[];
  readonly knowledgeDefs: readonly KnowledgeDef[];
  private readonly rulesByType = new Map<string, Rule[]>();
  private readonly entryList: ChronicleEntry[] = [];
  private nextNr = 1;
  private readonly onceWritten = new Set<string>();
  private readonly knownList: KnowledgeState[] = [];
  private readonly known = new Map<string, KnowledgeState>();
  private readonly board = new TriggerBoard();
  private readonly armedById = new Map<string, Armed>();
  private readonly world: SimTriggerWorld;
  private player = 0;
  private worldTickSeen = false;
  /** The trigger world's statistics revision at the last check (a change checks the state-like triggers). */
  private seenStatRevision = -1;
  private stepSim: Simulation | null = null;
  private readonly onEvent: <K extends keyof SimEventMap>(type: K, payload: SimEventMap[K]) => void;
  private readonly onKnowledge: (a: Armed) => void;

  constructor(deps: ChronicleSystemDeps) {
    this.world = deps.world;
    this.rules = deps.rules ?? CONTENT.collection('chronicleRules').values();
    this.knowledgeDefs = deps.knowledge ?? CONTENT.collection('knowledge').values();
    for (const def of this.rules) {
      const leaf = compileTrigger({ art: 'ereignis', ereignis: def.ereignis, ...(def.wo === undefined ? {} : { wo: def.wo }) }).leaves[0] as EventLeaf;
      let list = this.rulesByType.get(def.ereignis);
      if (list === undefined) {
        list = [];
        this.rulesByType.set(def.ereignis, list);
      }
      list.push({ def, leaf, fields: placeholdersOf(def.text.de), extra: def.zusatz ?? NO_EXTRA });
    }
    this.onEvent = (type, payload) => {
      if (type === 'worldTick') this.worldTickSeen = true;
      const list = this.rulesByType.get(type);
      if (list !== undefined && this.stepSim !== null) for (let i = 0; i < list.length; i++) this.write(this.stepSim, list[i] as Rule, payload as object);
      this.board.dispatch(type, payload as object, this.player);
    };
    this.onKnowledge = (a) => {
      const sim = this.stepSim;
      if (sim !== null) this.unlockKnowledge(sim, a.owner);
    };
    this.arm(null);
    this.save = {
      id: CHRONICLE_SYSTEM_ID,
      version: CHRONICLE_SAVE_VERSION,
      // Saves before M7 have no diary.
      migrations: [{ from: 0, migrate: (): ChronicleSnapshot => emptyChronicleSnapshot() }],
      serialize: (): ChronicleSnapshot => this.snapshot(),
      deserialize: (data) => this.restore(data),
    };
  }

  /** The diary's entries, oldest first. */
  entries(): readonly ChronicleEntry[] {
    return this.entryList;
  }

  /** The unlocked knowledge entries in unlock order. */
  knowledge(): readonly KnowledgeState[] {
    return this.knownList;
  }

  /** Whether knowledge entry `id` is unlocked. */
  knows(id: string): boolean {
    return this.known.has(id);
  }

  /** The rule `id`, or `undefined`. */
  rule(id: string): ChronicleRuleDef | undefined {
    return this.rules.find((r) => r.id === id);
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
    this.board.settle(this.world.bind(sim), this.stateDue(), this.onKnowledge);
    this.stepSim = null;
  }

  /** Unlocks knowledge entry `id` now (its trigger held; a quest's reward); false when unknown or known already. */
  unlockKnowledge(sim: Simulation, id: string): boolean {
    if (this.known.has(id)) return false;
    const def = this.knowledgeDefs.find((k) => k.id === id);
    if (def === undefined) return false;
    const a = this.armedById.get(id);
    if (a !== undefined) {
      this.board.disarm(a);
      this.armedById.delete(id);
    }
    const state: KnowledgeState = { id, tick: sim.eventTick };
    this.knownList.push(state);
    this.known.set(id, state);
    sim.events.push('knowledgeUnlocked', { wissen: id, quelle: def.quelle, tick: sim.eventTick });
    return true;
  }

  private write(sim: Simulation, rule: Rule, payload: object): void {
    const def = rule.def;
    if (def.einmalig === true && this.onceWritten.has(def.id)) return;
    if (!leafMatches(rule.leaf, payload, this.player)) return;
    const p = payload as Record<string, unknown>;
    const values: Record<string, string | number> = {};
    for (const f of rule.fields) {
      const v = p[f];
      values[f] = typeof v === 'number' || typeof v === 'string' ? v : String(v);
    }
    // Kept beside the text's values only when the event carries them, not empty (a natural wonder's `variante`, M7-122).
    for (const f of rule.extra) {
      const v = p[f];
      if (typeof v === 'number' || (typeof v === 'string' && v !== '')) values[f] = v;
    }
    const entry: ChronicleEntry = { nr: this.nextNr++, tick: sim.eventTick, day: sim.clock.day, rule: def.id, values };
    this.entryList.push(entry);
    const max = BALANCE.quests.chronicleMaxEntries;
    if (this.entryList.length > max) this.entryList.splice(0, this.entryList.length - max);
    if (def.einmalig === true) this.onceWritten.add(def.id);
    sim.events.push('chronicleEntryAdded', { entry: entry.nr, art: def.art, regel: def.id, tick: sim.eventTick });
  }

  private arm(saved: Readonly<Record<string, readonly number[]>> | null): void {
    this.board.clear();
    this.armedById.clear();
    for (const k of this.knowledgeDefs) {
      if (this.known.has(k.id)) continue;
      const a = new Armed(k.freischaltung, k.id, saved?.[k.id]);
      this.armedById.set(k.id, a);
      this.board.arm(a);
    }
  }

  private snapshot(): ChronicleSnapshot {
    const wartend: Record<string, number[]> = {};
    for (const [id, a] of this.armedById) if (a.counts.some((c) => c > 0)) wartend[id] = a.savedCounts();
    return {
      eintraege: this.entryList.map((e) => ({ nr: e.nr, tick: e.tick, day: e.day, rule: e.rule, values: { ...e.values } })),
      naechste: this.nextNr,
      einmalig: this.rules.filter((r) => this.onceWritten.has(r.id)).map((r) => r.id),
      wissen: this.knownList.map((k) => ({ id: k.id, tick: k.tick })),
      wartend,
    };
  }

  private restore(data: unknown): void {
    const parsed = chronicleSnapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`chronicle snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const s = parsed.data;
    const ruleIds = new Set(this.rules.map((r) => r.id));
    const knowledgeIds = new Set(this.knowledgeDefs.map((k) => k.id));
    for (const id of [...s.eintraege.map((e) => e.rule), ...s.einmalig]) if (!ruleIds.has(id)) throw new TypeError(`chronicle snapshot invalid: unknown rule "${id}"`);
    for (const id of [...s.wissen.map((k) => k.id), ...Object.keys(s.wartend)]) if (!knowledgeIds.has(id)) throw new TypeError(`chronicle snapshot invalid: unknown knowledge "${id}"`);
    this.entryList.length = 0;
    for (const e of s.eintraege) this.entryList.push({ nr: e.nr, tick: e.tick, day: e.day, rule: e.rule, values: { ...e.values } });
    this.nextNr = s.naechste;
    this.onceWritten.clear();
    for (const id of s.einmalig) this.onceWritten.add(id);
    this.knownList.length = 0;
    this.known.clear();
    for (const k of s.wissen) {
      const state: KnowledgeState = { id: k.id, tick: k.tick };
      this.knownList.push(state);
      this.known.set(k.id, state);
    }
    this.arm(s.wartend);
    // The step after loading checks state-like triggers only when the running world would: on the world tick or when a
    // statistic counts in it. The revision counter is not saved, so the last one seen is the world's current one (in a running
    // world every observer has seen it by the end of each step: \`stats\` counts first) – otherwise the first step after
    // loading checks them all and a hint, milestone or step whose condition came true since the last world tick holds a
    // world tick early (M7-41 … M7-47; docs/SPIEL.md §28).
    this.seenStatRevision = this.world.statRevision;
  }
}
