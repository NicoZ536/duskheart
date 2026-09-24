/**
 * Condition system (MASTERPROMPT §11.3, M3-19; docs/SPIEL.md §6): the player's conditions with icon,
 * duration, stack rule, tooltip and visible effect (content: src/content/conditions.ts).
 *
 * Every tick (after the vitals system, so the survival stages of this tick are known):
 * 1. conditions that follow a survival value (`wert`: hungry, freezing, soaked, drowning …, well fed)
 *    begin and end with their stage;
 * 2. timed conditions count down – `heiltInRuhe` times faster while resting or asleep – and end;
 *    `endetBeiNaesse` conditions go out in deep water or when soaked;
 * 3. the effects of what is active act: damage over time (per stack, reported once per second as
 *    `playerAfflicted`, at once when lethal), drains of satiety and thirst, pulses (vomiting);
 * 4. the combined effect (`effects()`) is updated: the modifier source (`conditionModifierSource`) turns it
 *    into speed, maxima, regeneration, insulation and cooling of the player; fear, skills, gathering and
 *    combat read action speed, precision, XP factor, sight and resistance from it.
 * A dead player's conditions stand still; the death system clears them (`clearAll`).
 *
 * API for other systems: `apply` (falls → Knochenbruch, water → Fieber, food → Lebensmittelvergiftung,
 * sleep → Ausgeruht, respawn → Erschüttert, rooms → Behaglich …), `cure`, `clearAll`, `has`, `active`,
 * `effects`. Commands `conditions.apply`/`conditions.cure` (debug). Global (the player is always in the
 * active zone). Save participant `conditions`.
 */
import { z } from 'zod';
import type { ConditionDef } from '../../content/conditions';
import { NULL_ENTITY, isEntityHandle, type Entity } from '../../engine/ecs';
import type { PlayerComponents } from '../player/components';
import type { SaveParticipant } from '../participant';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import { STAT_MAX, clampStat } from '../survival/formulas';
import type { PlayerInfluences } from '../survival/modifiers';
import type { Vitals } from '../survival/state';
import { contentConditionCatalog, type ConditionCatalog } from './catalog';
import type { ConditionEndReason, ConditionRejectReason } from './events';
import { secondsToTicks } from '../player/formulas';
import { aggregateEffects, applyStack, countdownStep, createConditionEffects, quenched, valueStageActive, type ApplyOutcome, type ConditionEffects, type StackResult } from './formulas';
import type { PlayerHarm } from './harm';
import { UNTIMED, activeConditionSchema, copyActive, type ActiveCondition } from './state';

/** Id of the condition system and its save participant. */
export const CONDITIONS_SYSTEM_ID = 'conditions';
/** Data version of the `conditions` participant. */
export const CONDITIONS_SAVE_VERSION = 1;

const conditionsSnapshotSchema = z
  .object({
    entity: z.number().int().refine((e) => e === NULL_ENTITY || isEntityHandle(e), { message: 'must be an entity handle or -1' }),
    active: z.array(activeConditionSchema),
  })
  .strict();

/** Result of `apply`: what the stack rule did, or why nothing happened. */
export type ConditionApplyResult = { readonly ok: true; readonly outcome: ApplyOutcome } | { readonly ok: false; readonly reason: ConditionRejectReason | 'noPlayer' };

/** Dependencies of the condition system. */
export interface ConditionsSystemDeps {
  readonly components: PlayerComponents;
  readonly influences: PlayerInfluences;
  readonly harm: PlayerHarm;
  /** Condition definitions (default: the game's content). */
  readonly catalog?: ConditionCatalog;
}

export class ConditionsSystem implements SimSystem {
  readonly id = CONDITIONS_SYSTEM_ID;
  readonly timeScope = 'global';
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  readonly catalog: ConditionCatalog;
  private readonly components: PlayerComponents;
  private readonly influences: PlayerInfluences;
  private readonly harm: PlayerHarm;
  /** Player the list belongs to (a new player entity starts without conditions). */
  private owner: Entity = NULL_ENTITY;
  /** Active conditions in content order. */
  private readonly list: ActiveCondition[] = [];
  private readonly effectsValue: ConditionEffects = createConditionEffects();
  private readonly stack: StackResult = { stacks: 0, remainingTicks: 0, outcome: 'neu' };
  private readonly defOf = (id: string): ConditionDef => this.catalog.get(id);

  constructor(deps: ConditionsSystemDeps) {
    this.components = deps.components;
    this.influences = deps.influences;
    this.harm = deps.harm;
    this.catalog = deps.catalog ?? contentConditionCatalog();
    this.commands = {
      'conditions.apply': (sim, cmd, tick) => {
        const r = this.apply(sim, cmd.id, cmd.seconds);
        if (!r.ok) sim.events.push('commandRejected', { type: cmd.type, reason: r.reason, tick });
      },
      'conditions.cure': (sim, cmd, tick) => {
        const reason = this.cureReason(sim, cmd.id);
        if (reason !== null) sim.events.push('commandRejected', { type: cmd.type, reason, tick });
        else this.cure(sim, cmd.id);
      },
    };
    this.save = {
      id: CONDITIONS_SYSTEM_ID,
      version: CONDITIONS_SAVE_VERSION,
      serialize: () => ({ entity: this.owner, active: this.list.map(copyActive) }),
      deserialize: (data) => {
        const parsed = conditionsSnapshotSchema.safeParse(data);
        if (!parsed.success) throw new TypeError(`conditions snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        const { entity, active } = parsed.data;
        let last = -1;
        for (const c of active) {
          const at = this.catalog.indexOf(c.id);
          if (at < 0) throw new TypeError(`conditions snapshot invalid: unknown condition "${c.id}"`);
          if (at <= last) throw new TypeError('conditions snapshot invalid: conditions must be unique and in content order');
          last = at;
          const timed = this.catalog.get(c.id).dauer.art === 'zeit';
          if (timed !== (c.remainingTicks !== UNTIMED)) throw new TypeError(`conditions snapshot invalid: "${c.id}" ${timed ? 'needs' : 'has no'} remaining time`);
        }
        if (entity === NULL_ENTITY && active.length > 0) throw new TypeError('conditions snapshot invalid: conditions without a player');
        this.owner = entity;
        this.list.length = 0;
        for (const c of active) this.list.push(copyActive(c));
        this.refreshEffects();
      },
    };
  }

  /** Active conditions of the player in content order (read-only for callers). */
  active(): readonly ActiveCondition[] {
    return this.list;
  }

  /** Whether condition `id` is active. */
  has(id: string): boolean {
    return this.find(id) !== undefined;
  }

  /** Remaining time of `id` [s]; `null` when not active or without an end of its own. */
  remainingSeconds(id: string, tickHz: number): number | null {
    const c = this.find(id);
    return c === undefined || c.remainingTicks === UNTIMED ? null : c.remainingTicks / tickHz;
  }

  /** Combined effect of the active conditions (read-only for callers; updated every tick). */
  effects(): Readonly<ConditionEffects> {
    return this.effectsValue;
  }

  /**
   * Applies condition `id` to the player under its stack rule, for its own duration or `seconds`
   * (`zeit` conditions; `heilung` conditions last until cured). `wert` conditions cannot be applied.
   */
  apply(sim: Simulation, id: string, seconds?: number): ConditionApplyResult {
    const def = this.catalog.find(id);
    if (def === undefined) return { ok: false, reason: 'unknownCondition' };
    if (def.dauer.art === 'wert') return { ok: false, reason: 'derivedCondition' };
    const e = this.playerOf(sim);
    if (e === NULL_ENTITY) return { ok: false, reason: 'noPlayer' };
    const duration = def.dauer.art === 'zeit' ? secondsToTicks(seconds ?? def.dauer.sekunden) : UNTIMED;
    const current = this.find(id) ?? null;
    const r = applyStack(def, current, duration, this.stack);
    if (current === null) this.insert({ id, stacks: r.stacks, remainingTicks: r.remainingTicks, pulseTicks: 0, pendingDamage: 0 });
    else {
      current.stacks = r.stacks;
      current.remainingTicks = r.remainingTicks;
    }
    this.refreshEffects();
    sim.events.push('conditionApplied', { entity: e, id, outcome: r.outcome, stacks: r.stacks, remainingTicks: r.remainingTicks, tick: sim.eventTick });
    return { ok: true, outcome: r.outcome };
  }

  /** Ends the active condition `id` as a cure does (bandage, splint, antidote); false when nothing was cured. */
  cure(sim: Simulation, id: string): boolean {
    if (this.cureReason(sim, id) !== null) return false;
    this.remove(sim, id, 'geheilt');
    this.refreshEffects();
    return true;
  }

  /** Ends every condition (death); `wert` conditions return with their stages. */
  clearAll(sim: Simulation, reason: ConditionEndReason): void {
    while (this.list.length > 0) this.remove(sim, (this.list[0] as ActiveCondition).id, reason);
    this.refreshEffects();
  }

  update(sim: Simulation, dt: number): void {
    const e = this.playerOf(sim);
    if (e === NULL_ENTITY) return;
    const v = this.components.vitals.get(e);
    const body = this.components.body.get(e);
    if (v === undefined || body === undefined || v.health <= 0) return;
    const mods = this.influences.ensureFresh(sim, e);
    const resting = mods.resting || mods.sleeping;
    const soaked = v.wetnessStage === 'durchnaesst';

    // 1. Conditions of the survival values follow their stages.
    const defs = this.catalog.list;
    for (let i = 0; i < defs.length; i++) {
      const def = defs[i] as ConditionDef;
      if (def.dauer.art !== 'wert') continue;
      const on = valueStageActive(def, v);
      const current = this.find(def.id);
      if (on && current === undefined) {
        this.insert({ id: def.id, stacks: 1, remainingTicks: UNTIMED, pulseTicks: 0, pendingDamage: 0 });
        sim.events.push('conditionApplied', { entity: e, id: def.id, outcome: 'neu', stacks: 1, remainingTicks: UNTIMED, tick: sim.eventTick });
      } else if (!on && current !== undefined) this.remove(sim, def.id, 'stufe');
    }

    // 2. Timers, water, 3. effects.
    for (let i = 0; i < this.list.length; ) {
      const c = this.list[i] as ActiveCondition;
      const def = this.catalog.get(c.id);
      const w = def.wirkung;
      if (quenched(w, body.swimming, soaked)) {
        this.remove(sim, c.id, 'geloescht');
        continue;
      }
      if (c.remainingTicks !== UNTIMED) {
        c.remainingTicks -= countdownStep(w, resting);
        if (c.remainingTicks <= 0) {
          this.remove(sim, c.id, 'abgelaufen');
          continue;
        }
      }
      this.act(sim, e, v, c, def, dt);
      i++;
    }
    this.refreshEffects();
  }

  /** Reports the damage over time of the last second, per condition. */
  worldTick(sim: Simulation): void {
    const e = this.playerOf(sim);
    if (e === NULL_ENTITY) return;
    const v = this.components.vitals.get(e);
    if (v === undefined) return;
    for (const c of this.list) this.report(sim, e, v, c);
  }

  // -------------------------------------------------------------------------------------------

  /** Effects of one active condition in this tick: damage, drains, pulses. */
  private act(sim: Simulation, e: Entity, v: Vitals, c: ActiveCondition, def: ConditionDef, dt: number): void {
    const w = def.wirkung;
    if (w.schadenProSekunde !== undefined && v.health > 0) {
      c.pendingDamage += this.harm.hurt(v, w.schadenProSekunde * c.stacks * dt);
      if (v.health <= 0) {
        this.harm.markLethal(sim, c.id);
        this.report(sim, e, v, c);
      }
    }
    if (w.saettigungProSekunde !== undefined) v.satiety = clampStat(v.satiety + w.saettigungProSekunde * dt, STAT_MAX);
    if (w.durstProSekunde !== undefined) v.thirst = clampStat(v.thirst + w.durstProSekunde * dt, STAT_MAX);
    if (w.schub !== undefined) {
      c.pulseTicks++;
      if (c.pulseTicks >= secondsToTicks(w.schub.alleSekunden)) {
        c.pulseTicks = 0;
        v.satiety = clampStat(v.satiety + w.schub.saettigung, STAT_MAX);
        v.thirst = clampStat(v.thirst + w.schub.durst, STAT_MAX);
        sim.events.push('conditionPulse', { entity: e, id: c.id, satiety: w.schub.saettigung, thirst: w.schub.durst, tick: sim.eventTick });
      }
    }
  }

  /** Reports and clears the pending damage of `c`. */
  private report(sim: Simulation, e: Entity, v: Vitals, c: ActiveCondition): void {
    if (c.pendingDamage <= 0) return;
    const amount = c.pendingDamage;
    c.pendingDamage = 0;
    sim.events.push('playerAfflicted', { entity: e, source: 'zustand', id: c.id, amount, health: v.health, lethal: v.health <= 0, tick: sim.eventTick });
  }

  /** Why `cure(id)` would do nothing, or `null`. */
  private cureReason(sim: Simulation, id: string): ConditionRejectReason | 'noPlayer' | null {
    const def = this.catalog.find(id);
    if (def === undefined) return 'unknownCondition';
    if (def.dauer.art === 'wert') return 'derivedCondition';
    if (this.playerOf(sim) === NULL_ENTITY) return 'noPlayer';
    return this.has(id) ? null : 'notActive';
  }

  /** The player, resetting the list when a new player entity took over. */
  private playerOf(sim: Simulation): Entity {
    const e = sim.player;
    if (e !== this.owner) {
      this.owner = e;
      this.list.length = 0;
      this.refreshEffects();
    }
    return e;
  }

  private find(id: string): ActiveCondition | undefined {
    for (let i = 0; i < this.list.length; i++) if ((this.list[i] as ActiveCondition).id === id) return this.list[i];
    return undefined;
  }

  /** Inserts `c` at its place in content order. */
  private insert(c: ActiveCondition): void {
    const at = this.catalog.indexOf(c.id);
    let i = 0;
    while (i < this.list.length && this.catalog.indexOf((this.list[i] as ActiveCondition).id) < at) i++;
    this.list.splice(i, 0, c);
  }

  /** Removes `id` (reporting its pending damage first) and raises `conditionRemoved`. */
  private remove(sim: Simulation, id: string, reason: ConditionEndReason): void {
    const i = this.list.findIndex((c) => c.id === id);
    if (i < 0) return;
    const c = this.list[i] as ActiveCondition;
    const v = this.components.vitals.get(this.owner);
    if (v !== undefined) this.report(sim, this.owner, v, c);
    this.list.splice(i, 1);
    sim.events.push('conditionRemoved', { entity: this.owner, id, reason, tick: sim.eventTick });
  }

  private refreshEffects(): void {
    aggregateEffects(this.list, this.defOf, this.effectsValue);
  }
}
