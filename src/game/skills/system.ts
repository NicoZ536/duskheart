/**
 * Skill system (MASTERPROMPT §23.2 "Learning by Doing", M3-32): the twelve skills of the player
 * (src/content/skills.ts) with level 1–100, XP curve `50 × stufe^1,6`, +0,5 % effect per level
 * (`bonus`), perk choices at 30/60/90 and the death penalty.
 *
 * - XP sources: every action names its experience source id (`award`): gathering systems report felled
 *   trees and mined rock, crafting reports made items, … The survival sources are this system's own:
 *   sneaking, swimming and enduring cold or heat give XP per second (`schleichen`, `schwimmen`,
 *   `temperatur_ertragen`), every morning the player lives to see gives `nacht_ueberstanden`.
 *   The conditions' XP factor (Ausgeruht +5 %, Morgenrot +10 %) multiplies every gain.
 * - Level-ups raise `skillLevelUp`; reaching a perk level opens a choice (`perkChoiceOpened`), taken with
 *   `skills.choosePerk`.
 * - Death: `loseProgress(share)` takes a share of the progress within each level (25 % on Normal, §29).
 * Global. Save participant `skills`.
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import { CONTENT } from '../../content/index';
import type { SkillDef } from '../../content/skills';
import { NULL_ENTITY } from '../../engine/ecs';
import type { ConditionsSystem } from '../conditions/system';
import type { SaveParticipant } from '../participant';
import type { PlayerComponents } from '../player/components';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import { thermalStress } from '../survival/temperature';
import { addXp, deathXpLoss, perkLevelsReached, skillBonus, totalXpForLevel } from './formulas';
import { copySkillState, createSkillState, skillStateSchema, type SkillState } from './state';

/** Id of the skill system and its save participant. */
export const SKILLS_SYSTEM_ID = 'skills';
/** Data version of the `skills` participant. */
export const SKILLS_SAVE_VERSION = 1;

/** Survival sources this system reports itself (ids of src/content/skills.ts). */
export const SURVIVAL_XP_SOURCES = { sneak: 'schleichen', swim: 'schwimmen', endure: 'temperatur_ertragen', night: 'nacht_ueberstanden' } as const;

const K = BALANCE.skills;

/** Where an experience source belongs. */
interface SourceInfo {
  readonly skill: string;
  readonly xp: number;
  readonly perSecond: boolean;
}

/** Dependencies of the skill system. */
export interface SkillsSystemDeps {
  readonly components: PlayerComponents;
  readonly conditions: ConditionsSystem;
  /** Skill definitions (default: the game's content). */
  readonly skills?: readonly SkillDef[];
}

export class SkillsSystem implements SimSystem {
  readonly id = SKILLS_SYSTEM_ID;
  readonly timeScope = 'global';
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  /** Skill definitions in content order. */
  readonly defs: readonly SkillDef[];
  private readonly components: PlayerComponents;
  private readonly conditions: ConditionsSystem;
  private readonly sources = new Map<string, SourceInfo>();
  private readonly skillsById = new Map<string, SkillState>();

  constructor(deps: SkillsSystemDeps) {
    this.components = deps.components;
    this.conditions = deps.conditions;
    this.defs = deps.skills ?? CONTENT.collection('skills').values();
    for (const def of this.defs) {
      this.skillsById.set(def.id, createSkillState());
      for (const q of def.quellen) {
        if (this.sources.has(q.id)) throw new Error(`Skills: experience source "${q.id}" belongs to two skills`);
        this.sources.set(q.id, { skill: def.id, xp: q.ep, perSecond: q.proSekunde === true });
      }
    }
    this.commands = {
      'skills.choosePerk': (sim, cmd, tick) => {
        const s = this.skillsById.get(cmd.skill);
        if (s === undefined) {
          sim.events.push('commandRejected', { type: cmd.type, reason: 'unknownSkill', tick });
          return;
        }
        const open = s.perks.find((p) => p.level === cmd.level && p.choice === null);
        if (open === undefined) {
          sim.events.push('commandRejected', { type: cmd.type, reason: 'noPerkChoice', tick });
          return;
        }
        open.choice = cmd.choice;
        sim.events.push('perkChosen', { skill: cmd.skill, level: cmd.level, choice: cmd.choice, tick });
      },
    };
    const snapshotSchema = z.object({ skills: z.object(Object.fromEntries(this.defs.map((d) => [d.id, skillStateSchema])) as Record<string, typeof skillStateSchema>).strict() }).strict();
    this.save = {
      id: SKILLS_SYSTEM_ID,
      version: SKILLS_SAVE_VERSION,
      serialize: () => ({ skills: Object.fromEntries(this.defs.map((d) => [d.id, copySkillState(this.skillOf(d.id))])) }),
      deserialize: (data) => {
        const parsed = snapshotSchema.safeParse(data);
        if (!parsed.success) throw new TypeError(`skills snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        for (const def of this.defs) {
          const s = parsed.data.skills[def.id];
          if (s === undefined) throw new TypeError(`skills snapshot invalid: skill "${def.id}" missing`);
          const expected = perkLevelsReached(K.minLevel - 1, s.level);
          if (s.perks.length !== expected.length || s.perks.some((p, i) => p.level !== expected[i])) throw new TypeError(`skills snapshot invalid: perk choices of "${def.id}" do not match level ${s.level}`);
          this.skillsById.set(def.id, copySkillState(s));
        }
      },
    };
  }

  /** The skill `id` (read-only for callers); throws `RangeError` for an unknown skill. */
  skill(id: string): Readonly<SkillState> {
    return this.skillOf(id);
  }

  /** Level of skill `id`. */
  level(id: string): number {
    return this.skillOf(id).level;
  }

  /** Effect bonus of skill `id` [fraction] (§D "Skillbonus": +0,5 % per level). */
  bonus(id: string): number {
    return skillBonus(this.skillOf(id).level);
  }

  /** Whether `sourceId` is an experience source. */
  hasSource(sourceId: string): boolean {
    return this.sources.has(sourceId);
  }

  /**
   * Gives the XP of experience source `sourceId` (`times` actions, or seconds for per-second sources),
   * multiplied by the conditions' XP factor; returns the XP gained. A dead player learns nothing. Throws
   * `RangeError` for an unknown source (sources are content ids, a typo is a bug).
   */
  award(sim: Simulation, sourceId: string, times = 1): number {
    const source = this.sources.get(sourceId);
    if (source === undefined) throw new RangeError(`Skills: unknown experience source "${sourceId}"`);
    if (!this.playerAlive(sim) || !(times > 0)) return 0;
    const amount = source.xp * times * this.conditions.effects().xp;
    const s = this.skillOf(source.skill);
    const before = s.level;
    const gained = addXp(s, amount);
    if (!source.perSecond) sim.events.push('xpGained', { skill: source.skill, amount, source: sourceId, tick: sim.eventTick });
    if (gained > 0) {
      sim.events.push('skillLevelUp', { skill: source.skill, level: s.level, tick: sim.eventTick });
      for (const level of perkLevelsReached(before, s.level)) {
        s.perks.push({ level, choice: null });
        sim.events.push('perkChoiceOpened', { skill: source.skill, level, tick: sim.eventTick });
      }
    }
    return amount;
  }

  /**
   * Debug `unlock` (M3-35, src/game/cheats/system.ts): skill `id` reaches its highest level at once, with the
   * level-up and the perk choices it opens reported like learning (`skillLevelUp`, `perkChoiceOpened`).
   * Nothing happens at the highest level already. Throws `RangeError` for an unknown skill.
   */
  unlock(sim: Simulation, id: string): void {
    const s = this.skillOf(id);
    const before = s.level;
    if (before >= K.maxLevel) return;
    // Exactly the XP still missing (whole points per level), plus one: what exceeds the last level is dropped.
    addXp(s, totalXpForLevel(K.maxLevel) - totalXpForLevel(before) - s.xp + 1);
    sim.events.push('skillLevelUp', { skill: id, level: s.level, tick: sim.eventTick });
    for (const level of perkLevelsReached(before, s.level)) {
      s.perks.push({ level, choice: null });
      sim.events.push('perkChoiceOpened', { skill: id, level, tick: sim.eventTick });
    }
  }

  /** Death: every skill loses `share` of its progress within the current level (never a level). */
  loseProgress(sim: Simulation, share: number): void {
    for (const def of this.defs) {
      const s = this.skillOf(def.id);
      const loss = deathXpLoss(s.xp, share);
      if (!(loss > 0)) continue;
      s.xp -= loss;
      sim.events.push('skillProgressLost', { skill: def.id, amount: loss, tick: sim.eventTick });
    }
  }

  /** The survival sources of this tick: sneaking, swimming, enduring cold or heat. */
  update(sim: Simulation, dt: number): void {
    const e = sim.player;
    if (e === NULL_ENTITY) return;
    const body = this.components.body.get(e);
    const v = this.components.vitals.get(e);
    if (body === undefined || v === undefined || v.health <= 0) return;
    if (body.state === 'sneak') this.award(sim, SURVIVAL_XP_SOURCES.sneak, dt);
    if (body.state === 'swim') this.award(sim, SURVIVAL_XP_SOURCES.swim, dt);
    if (Math.abs(thermalStress(v.feltC, v.bandLowC, v.bandHighC)) >= K.enduredStressC) this.award(sim, SURVIVAL_XP_SOURCES.endure, dt);
  }

  /** Every morning the player is alive to see (§23.2 "Überleben"). */
  dailyTick(sim: Simulation): void {
    if (this.playerAlive(sim)) this.award(sim, SURVIVAL_XP_SOURCES.night);
  }

  private playerAlive(sim: Simulation): boolean {
    const e = sim.player;
    const v = e === NULL_ENTITY ? undefined : this.components.vitals.get(e);
    return v !== undefined && v.health > 0;
  }

  private skillOf(id: string): SkillState {
    const s = this.skillsById.get(id);
    if (s === undefined) throw new RangeError(`Unknown skill "${id}"`);
    return s;
  }
}
