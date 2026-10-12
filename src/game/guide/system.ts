/**
 * The guide: Funke and the context hints (MASTERPROMPT §8 "Funke, ein wortkarger Flammengeist, der Hinweise gibt (höchstens 2
 * Zeilen pro Einwurf, nie aufdringlich, abschaltbar)", §23.3 "kontextuelle Hinweise … jederzeit abschaltbar. Funke kommentiert
 * sparsam"; docs/SPIEL.md §23 "Funke", "Einstieg"; strand G, system `guide`, M7-43, M7-44).
 *
 * - **Hints** (content `guideHints`, one file per strand) wait on the trigger board (src/game/triggers). One that holds joins the
 *   queue of its channel – `funke` (the lantern's box) or `hinweis` (the context line) – unless its channel is off; then it
 *   waits again (a one-time hint stays unsaid until its moment comes while the channel is on).
 * - **Never pushy**: a channel shows one thing at a time, for `funkeShowSeconds` / `hintShowSeconds`, and speaks again only
 *   `funkeMinSeconds` / `hintMinSeconds` after it last began; priority 3 (danger, a world event announced) goes first and may
 *   follow a comment after `funkeUrgentSeconds` already. At most `queueMax` wait per channel – the least urgent, then the
 *   oldest, is dropped and waits again. A one-time hint (`einmalig`) speaks once per world, the others cool down for
 *   `abklingSekunden`.
 * - **Dialogs**: when a quest step with a `dialog` becomes active, Funke speaks it line by line (`dialogLineSeconds` each) –
 *   urgent like priority 3, never two at once.
 * - **Switches**: `guide.configure {funke, hints}` from the settings `game.funkeComments` / `game.hints` (the UI sends them at
 *   start and on every change); switching a channel off clears what it shows and what waits.
 *
 * An observer (`observeStep`), the last one: it sees the steps' quest events of the same step. No tick hooks. Save
 * participant `guide` (version 1). Nothing here allocates per event or per frame; a hint that speaks allocates its queue entry.
 */
import { BALANCE } from '../../content/balance';
import type { GuideChannel, GuideHintDef } from '../../content/guide/schema';
import { CONTENT } from '../../content/index';
import type { StepEvents } from '../observe';
import type { SaveParticipant } from '../participant';
import type { CommandHandlers, SimEventMap, SimSystem, Simulation } from '../sim';
import { Armed, TriggerBoard } from '../triggers/evaluator';
import type { SimTriggerWorld } from '../triggers/world';
import { emptyGuideSnapshot, guideSnapshotSchema, NEVER_SPOKE, type GuideSnapshot } from './state';
import type { GuideConfig, GuideSample } from './types';

/** Id of the guide system and its save participant. */
export const GUIDE_SYSTEM_ID = 'guide';
/** Data version of the `guide` participant. */
export const GUIDE_SAVE_VERSION = 1;
/** Priority of danger and world event announcements (docs/SPIEL.md §23 "Priorität 3 … vor allem anderen"). */
export const URGENT_PRIORITY = 3;

const G = BALANCE.guide;
const TICK_HZ = BALANCE.time.tickHz;

/** One entry of a channel's queue: a hint, or a quest step's dialog on the Funke channel. */
interface Pending {
  readonly id: string;
  readonly kanal: GuideChannel;
  readonly prio: number;
  readonly seit: number;
  readonly dialog: boolean;
}

/** What a channel shows now. */
interface Showing {
  id: string | null;
  /** Line of a dialog (−1 for a hint). */
  zeile: number;
  bis: number;
}

/** Dependencies of the guide (tests hand in their own hints and dialogs). */
export interface GuideSystemDeps {
  readonly world: SimTriggerWorld;
  /** The dialog of quest `quest`'s current step, or `null` (the quest system). */
  readonly stepDialog?: (quest: string) => string | null;
  /** The world's onboarding switch (the quest system), for the sample. */
  readonly onboarding?: () => boolean;
  readonly hints?: readonly GuideHintDef[];
  /** Dialog id → number of lines; default: the content's dialogs. */
  readonly dialogLines?: ReadonlyMap<string, number>;
}

export class GuideSystem implements SimSystem {
  readonly id = GUIDE_SYSTEM_ID;
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  readonly hints: readonly GuideHintDef[];
  private readonly hintById = new Map<string, GuideHintDef>();
  private readonly dialogLines: ReadonlyMap<string, number>;
  private readonly board = new TriggerBoard();
  private readonly armedById = new Map<string, Armed>();
  private readonly said = new Set<string>();
  /** Repeating hints cooling down: id → tick they wait again. */
  private readonly cooling = new Map<string, number>();
  private readonly queues: Record<GuideChannel, Pending[]> = { funke: [], hinweis: [] };
  private readonly showing: Record<GuideChannel, Showing> = { funke: { id: null, zeile: -1, bis: 0 }, hinweis: { id: null, zeile: -1, bis: 0 } };
  private readonly lastSpoke: Record<GuideChannel, number> = { funke: NEVER_SPOKE, hinweis: NEVER_SPOKE };
  private readonly config = { funke: true, hints: true };
  private readonly world: SimTriggerWorld;
  private readonly stepDialog: (quest: string) => string | null;
  private readonly onboarding: () => boolean;
  private player = 0;
  private worldTickSeen = false;
  /** The trigger world's statistics revision at the last check (a change checks the state-like triggers). */
  private seenStatRevision = -1;
  private stepSim: Simulation | null = null;
  private readonly onEvent: <K extends keyof SimEventMap>(type: K, payload: SimEventMap[K]) => void;
  private readonly onHeld: (a: Armed) => void;

  constructor(deps: GuideSystemDeps) {
    this.world = deps.world;
    this.stepDialog = deps.stepDialog ?? (() => null);
    this.onboarding = deps.onboarding ?? (() => true);
    this.hints = deps.hints ?? CONTENT.collection('guideHints').values();
    for (const h of this.hints) this.hintById.set(h.id, h);
    this.dialogLines = deps.dialogLines ?? new Map(CONTENT.collection('dialogs').values().map((d) => [d.id, d.zeilen.length]));
    this.onEvent = (type, payload) => {
      if (type === 'worldTick') this.worldTickSeen = true;
      else if (type === 'questStarted' || type === 'questStepCompleted') this.questMoved((payload as { quest: string }).quest);
      this.board.dispatch(type, payload as object, this.player);
    };
    this.onHeld = (a) => {
      const sim = this.stepSim;
      if (sim !== null) this.held(sim, a);
    };
    this.arm(null);
    this.commands = {
      'guide.configure': (_sim, cmd) => this.configure(cmd.funke, cmd.hints),
    };
    this.save = {
      id: GUIDE_SYSTEM_ID,
      version: GUIDE_SAVE_VERSION,
      // Saves before M7: nothing said yet, both channels on.
      migrations: [{ from: 0, migrate: (): GuideSnapshot => emptyGuideSnapshot() }],
      serialize: (): GuideSnapshot => this.snapshot(),
      deserialize: (data) => this.restore(data),
    };
  }

  /** The switches (Funke, hints) and the world's onboarding. */
  configuration(out: GuideConfig): GuideConfig {
    out.funke = this.config.funke;
    out.hints = this.config.hints;
    out.onboarding = this.onboarding();
    return out;
  }

  /** Whether one-time hint `id` was said. */
  wasSaid(id: string): boolean {
    return this.said.has(id);
  }

  /** How many entries wait on `channel`. */
  waiting(channel: GuideChannel): number {
    return this.queues[channel].length;
  }

  /** Fills the held `out` with what shows now at `tick` (no allocation). */
  sample(tick: number, out: GuideSample): GuideSample {
    const f = this.showing.funke;
    const live = f.id !== null && tick < f.bis;
    out.funke = live && f.zeile < 0 ? f.id : null;
    out.dialog = live && f.zeile >= 0 ? f.id : null;
    out.dialogLine = live ? f.zeile : -1;
    out.funkeUntilTick = live ? f.bis : 0;
    const h = this.showing.hinweis;
    const hlive = h.id !== null && tick < h.bis;
    out.hint = hlive ? h.id : null;
    out.hintUntilTick = hlive ? h.bis : 0;
    out.tick = tick;
    this.configuration(out.config);
    return out;
  }

  /** Switches the channels (`guide.configure`); a channel switched off falls silent at once. */
  configure(funke: boolean, hints: boolean): void {
    if (!funke && this.config.funke) this.silence('funke');
    if (!hints && this.config.hints) this.silence('hinweis');
    this.config.funke = funke;
    this.config.hints = hints;
  }

  /** State-like triggers are due on the world tick and in a step in which a statistic counted. */
  private stateDue(): boolean {
    const rev = this.world.statRevision;
    const moved = rev !== this.seenStatRevision;
    this.seenStatRevision = rev;
    return this.worldTickSeen || moved;
  }

  observeStep(sim: Simulation, events: StepEvents): void {
    const tick = sim.eventTick;
    this.player = sim.player;
    this.worldTickSeen = false;
    this.stepSim = sim;
    events.forEach(this.onEvent);
    // Cooling is counted in seconds: the world tick re-arms what has cooled down.
    if (this.worldTickSeen) this.rearmCooled(tick);
    this.board.settle(this.world.bind(sim), this.stateDue(), this.onHeld);
    this.deliver(sim, 'funke', tick);
    this.deliver(sim, 'hinweis', tick);
    this.stepSim = null;
  }

  private channelOn(kanal: GuideChannel): boolean {
    return kanal === 'funke' ? this.config.funke : this.config.hints;
  }

  /** A hint's trigger held: into its channel's queue (or back to waiting when the channel is off). */
  private held(sim: Simulation, a: Armed): void {
    const def = this.hintById.get(a.owner);
    if (def === undefined) return;
    this.board.disarm(a);
    this.armedById.delete(def.id);
    if (!this.channelOn(def.kanal)) {
      this.rearm(def);
      return;
    }
    this.enqueue({ id: def.id, kanal: def.kanal, prio: def.prioritaet, seit: sim.eventTick, dialog: false });
  }

  /** A quest began or moved on: Funke speaks the dialog of its new step. */
  private questMoved(quest: string): void {
    const sim = this.stepSim;
    const dialog = this.stepDialog(quest);
    if (sim === null || dialog === null || !this.config.funke || !this.dialogLines.has(dialog)) return;
    this.enqueue({ id: dialog, kanal: 'funke', prio: URGENT_PRIORITY, seit: sim.eventTick, dialog: true });
  }

  private enqueue(p: Pending): void {
    const q = this.queues[p.kanal];
    const show = this.showing[p.kanal];
    if (p.dialog && show.id === p.id && show.zeile >= 0) return;
    for (let i = 0; i < q.length; i++) if ((q[i] as Pending).id === p.id) return;
    q.push(p);
    while (q.length > G.queueMax) {
      // Drop the least urgent, then the oldest; a dropped hint waits again.
      let worst = 0;
      for (let i = 1; i < q.length; i++) {
        const c = q[i] as Pending;
        const w = q[worst] as Pending;
        if (c.prio < w.prio || (c.prio === w.prio && c.seit < w.seit)) worst = i;
      }
      const [dropped] = q.splice(worst, 1);
      if (dropped !== undefined && !dropped.dialog) {
        const def = this.hintById.get(dropped.id);
        if (def !== undefined) this.rearm(def);
      }
    }
  }

  /** Shows the next entry of `kanal` when its turn has come. */
  private deliver(sim: Simulation, kanal: GuideChannel, tick: number): void {
    const show = this.showing[kanal];
    // A dialog speaks its lines one after another.
    if (kanal === 'funke' && show.id !== null && show.zeile >= 0 && tick >= show.bis) {
      const lines = this.dialogLines.get(show.id) ?? 0;
      if (show.zeile + 1 < lines) {
        this.speak(sim, kanal, show.id, show.zeile + 1, tick);
        return;
      }
      show.id = null;
      show.zeile = -1;
    }
    const q = this.queues[kanal];
    if (q.length === 0 || !this.channelOn(kanal)) return;
    let best = 0;
    for (let i = 1; i < q.length; i++) {
      const c = q[i] as Pending;
      const b = q[best] as Pending;
      if (c.prio > b.prio || (c.prio === b.prio && c.seit < b.seit)) best = i;
    }
    const next = q[best] as Pending;
    const busy = show.id !== null && tick < show.bis;
    if (busy && show.zeile >= 0) return;
    const since = tick - this.lastSpoke[kanal];
    const minSeconds = kanal === 'funke' ? (next.prio >= URGENT_PRIORITY ? G.funkeUrgentSeconds : G.funkeMinSeconds) : G.hintMinSeconds;
    if (since < minSeconds * TICK_HZ) return;
    if (busy && next.prio < URGENT_PRIORITY) return;
    q.splice(best, 1);
    if (next.dialog) {
      this.speak(sim, kanal, next.id, 0, tick);
      return;
    }
    const def = this.hintById.get(next.id) as GuideHintDef;
    this.speak(sim, kanal, def.id, -1, tick);
    if (def.einmalig) this.said.add(def.id);
    else this.cooling.set(def.id, tick + Math.round((def.abklingSekunden ?? 0) * TICK_HZ));
  }

  private speak(sim: Simulation, kanal: GuideChannel, id: string, zeile: number, tick: number): void {
    const show = this.showing[kanal];
    const seconds = zeile >= 0 ? G.dialogLineSeconds : kanal === 'funke' ? G.funkeShowSeconds : G.hintShowSeconds;
    show.id = id;
    show.zeile = zeile;
    show.bis = tick + seconds * TICK_HZ;
    this.lastSpoke[kanal] = tick;
    sim.events.push('guideHint', { hint: id, kanal, zeile, tick });
  }

  /** A channel switched off: nothing shows, what waited waits on its trigger again. */
  private silence(kanal: GuideChannel): void {
    const show = this.showing[kanal];
    show.id = null;
    show.zeile = -1;
    show.bis = 0;
    for (const p of this.queues[kanal]) {
      const def = p.dialog ? undefined : this.hintById.get(p.id);
      if (def !== undefined) this.rearm(def);
    }
    this.queues[kanal].length = 0;
  }

  /** Repeating hints whose cooling is over wait again. */
  private rearmCooled(tick: number): void {
    if (this.cooling.size === 0) return;
    for (const [id, until] of this.cooling) {
      if (tick < until) continue;
      this.cooling.delete(id);
      const def = this.hintById.get(id);
      if (def !== undefined) this.rearm(def);
    }
  }

  /** `def` waits on its trigger again (counters from now). */
  private rearm(def: GuideHintDef, counts?: readonly number[]): void {
    if (this.armedById.has(def.id) || (def.einmalig && this.said.has(def.id))) return;
    const a = new Armed(def.ausloeser, def.id, counts);
    this.armedById.set(def.id, a);
    this.board.arm(a);
  }

  private arm(saved: Readonly<Record<string, readonly number[]>> | null): void {
    this.board.clear();
    this.armedById.clear();
    const queued = new Set<string>();
    for (const k of ['funke', 'hinweis'] as const) for (const p of this.queues[k]) queued.add(p.id);
    for (const h of this.hints) {
      if (this.cooling.has(h.id) || queued.has(h.id)) continue;
      this.rearm(h, saved?.[h.id]);
    }
  }

  private snapshot(): GuideSnapshot {
    const wartend: Record<string, number[]> = {};
    for (const [id, a] of this.armedById) if (a.counts.some((c) => c > 0)) wartend[id] = a.savedCounts();
    const f = this.showing.funke;
    const h = this.showing.hinweis;
    return {
      gesagt: this.hints.filter((x) => this.said.has(x.id)).map((x) => x.id),
      abklingen: Object.fromEntries(this.cooling),
      wartend,
      warteschlange: [...this.queues.funke, ...this.queues.hinweis].map((p) => ({ hint: p.id, kanal: p.kanal, seit: p.seit, dialog: p.dialog })),
      funke: f.id === null ? null : { id: f.id, zeile: f.zeile, bis: f.bis },
      hinweis: h.id === null ? null : { id: h.id, bis: h.bis },
      zuletzt: { funke: this.lastSpoke.funke, hinweis: this.lastSpoke.hinweis },
      schalter: { funke: this.config.funke, hints: this.config.hints },
    };
  }

  private restore(data: unknown): void {
    const parsed = guideSnapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`guide snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const s = parsed.data;
    const known = (id: string, dialog: boolean): boolean => (dialog ? this.dialogLines.has(id) : this.hintById.has(id));
    for (const id of [...s.gesagt, ...Object.keys(s.abklingen), ...Object.keys(s.wartend)]) if (!known(id, false)) throw new TypeError(`guide snapshot invalid: unknown hint "${id}"`);
    for (const p of s.warteschlange) if (!known(p.hint, p.dialog)) throw new TypeError(`guide snapshot invalid: unknown ${p.dialog ? 'dialog' : 'hint'} "${p.hint}"`);
    if (s.funke !== null && !known(s.funke.id, s.funke.zeile >= 0)) throw new TypeError(`guide snapshot invalid: unknown Funke line "${s.funke.id}"`);
    if (s.hinweis !== null && !known(s.hinweis.id, false)) throw new TypeError(`guide snapshot invalid: unknown hint "${s.hinweis.id}"`);
    this.said.clear();
    for (const id of s.gesagt) this.said.add(id);
    this.cooling.clear();
    for (const [id, t] of Object.entries(s.abklingen)) this.cooling.set(id, t);
    this.queues.funke.length = 0;
    this.queues.hinweis.length = 0;
    for (const p of s.warteschlange) {
      const prio = p.dialog ? URGENT_PRIORITY : (this.hintById.get(p.hint) as GuideHintDef).prioritaet;
      this.queues[p.kanal].push({ id: p.hint, kanal: p.kanal, prio, seit: p.seit, dialog: p.dialog });
    }
    const f = this.showing.funke;
    f.id = s.funke?.id ?? null;
    f.zeile = s.funke?.zeile ?? -1;
    f.bis = s.funke?.bis ?? 0;
    const h = this.showing.hinweis;
    h.id = s.hinweis?.id ?? null;
    h.zeile = -1;
    h.bis = s.hinweis?.bis ?? 0;
    this.lastSpoke.funke = s.zuletzt.funke;
    this.lastSpoke.hinweis = s.zuletzt.hinweis;
    this.config.funke = s.schalter.funke;
    this.config.hints = s.schalter.hints;
    this.arm(s.wartend);
    // The step after loading checks state-like triggers only when the running world would: on the world tick or when a
    // statistic counts in it. The revision counter is not saved, so the last one seen is the world's current one (in a running
    // world every observer has seen it by the end of each step: \`stats\` counts first) – otherwise the first step after
    // loading checks them all and a hint, milestone or step whose condition came true since the last world tick holds a
    // world tick early (M7-41 … M7-47; docs/SPIEL.md §28).
    this.seenStatRevision = this.world.statRevision;
  }
}
