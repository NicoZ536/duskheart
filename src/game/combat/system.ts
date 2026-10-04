/**
 * Combat system (docs/SPIEL.md §10; MASTERPROMPT §19.1–§19.3, §D; ADR-0080; M6-01 … M6-09).
 *
 * - **Combatants** come through `CombatTargetProvider`s (src/game/combat/targets.ts): the player's is this system's own
 *   (`playerTargets`, src/game/combat/player.ts), the creatures' belongs to the creature system; both register with
 *   `addTargetProvider` while the simulation is built. The system knows no creature internals.
 * - **`resolve(sim, attacker, target, attack)`** turns one attack into a hit: who may hit whom (`hostile`), roll and god
 *   mode (invulnerable), the parry (a block begun ≤ 9 ticks before: no damage, the attacker staggers and is marked – its
 *   next hit taken is critical), crit (stream `combat`), the dagger's backstab (the target unaware), damage × (1 −
 *   resistance) × (1 − R / (R + 50)) × crit, a block's share, conditions, stagger, knockback, hitstop by impact (2–6
 *   ticks), the axe's armour break – handed to the target's provider (`applyHit`). Events `hitLanded`, `parried`,
 *   `blocked`, `staggered`, `combatantDefeated`; the player's experience (`nahkampf_*`, `fernkampf_*`, `treffer_geblockt`,
 *   `parade`, `ausweichrolle`).
 * - **The player's attacks** (`combat.attack {on}`): a press winds up a blow with the item in the hand (the profile of
 *   src/game/combat/weapons.ts); released in time it lands as a light blow (the next step of a combo inside the combo
 *   window), held past `heavyHoldSeconds` it lands on release as the heavy attack – a harder blow, the sword's sweep, the
 *   axe's armour break, the spear's throw. A blow hits every hostile body in its reach and swing once, wears the weapon,
 *   and stops the player for the hitstop. Bows and slings draw while held and shoot on release (damage × tension, spread
 *   narrowed by aiming), a crossbow shoots its loaded bolt or reloads (1,5 s), thrown weapons fly their arc. Stamina per
 *   blow and shot; nothing while rolling, climbing, swimming, staggered, dead or asleep.
 * - **Block** (`combat.block {on}`): held with a shield, a melee weapon, a tool or the fists it blocks – effective from
 *   the tick it starts, or when an attack, a roll or a stagger that kept it off ends (a new parry window); with a ranged
 *   weapon it aims. Walking is slower while swinging, blocking or aiming (a modifier source of the player).
 * - **Aim and facing** (M6-01): the aim point is the interaction's `player.aim` (pixel-precise); while the player fights,
 *   aims or blocks (and `fightingSeconds` after), the facing follows the aim angle with hysteresis
 *   (`facingSource`, the player system's hook); otherwise the movement as before.
 * - **Hitstop in the simulation**: after a hit both bodies stand still for its ticks – the player through the player
 *   system's motion hold (`motionHold`), its attack clock here; creatures in their own system (`HitResult.hitstopTicks`).
 * - **Projectiles** (src/game/combat/projectiles.ts): ECS entities with the column store `projectile`; swept against
 *   tiles and bodies, pushed by the wind, arrows stick (a drop with a chance) or sink, glowing arrows light up for 60 s
 *   (`lightProvider`), throwables burst over a radius (conditions, knockback, the fire flask sets the ground alight).
 * Global (the player's own fight; projectiles fly in the active zone). Save participant `combat` (version 1).
 */
import { BALANCE } from '../../content/balance';
import type { HitCondition, ItemDef } from '../../content/schema/item';
import { NULL_ENTITY, type Entity } from '../../engine/ecs';
import type { Layer } from '../../world/model/coords';
import type { CommandOfType, GameCommandType } from '../commands';
import type { ConditionsSystem } from '../conditions/system';
import { createDebugCheats, type DebugCheats } from '../cheats/state';
import type { EquipmentSystem } from '../equipment/system';
import type { FireSystem } from '../fire/system';
import type { InteractionSystem } from '../interaction/system';
import { slotAt, withSlot } from '../inventory/bags';
import type { InventorySystem } from '../inventory/system';
import type { SlotRef } from '../items/slots';
import { withCount, type ItemStack } from '../items/stack';
import type { ExtraLightProvider, TwoHandedRule } from '../light/system';
import type { SaveParticipant } from '../participant';
import type { WorldCollision } from '../player/collision';
import { facingVector } from '../player/formulas';
import type { Facing } from '../player/state';
import type { PlayerSystem } from '../player/system';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import type { DropSystem } from '../drops/system';
import type { SkillsSystem } from '../skills/system';
import type { PlayerModifierSource } from '../survival/modifiers';
import { spendStamina, type VitalsSystem } from '../survival/system';
import type { MotionSystem } from '../systems/motion';
import type { CombatRejectReason } from './events';
import { FACING_ANGLE, PARRY_WINDOW_TICKS, aimAngle, blockCovers, critRoll, degToRad, facingForAngle, hitDamage, hitstopTicks, hostile, inSwing, knockbackPx, parries, secondsToTicks, tension, twoHanded } from './formulas';
import { applyBlockModifiers, applyProfileModifiers, createCombatModifiers, nearlyBeaten, restoreVitals, type CombatModifierSource, type CombatModifiers } from './perks';
import { PlayerCombatant } from './player';
import { ProjectileFlight, type ProjectileImpact, type ProjectileLaunch, worldCombatEnvironment, type CombatEnvironment } from './projectiles';
import { COMBAT_TEAMS, DAMAGE_TYPES, type CombatTargetProvider, type CombatTeam, type CombatantView, type DamageType, type HitResult } from './targets';
import { combatSnapshotSchema, createCombatState, createPlayerCombat, type CombatState, type PlayerCombat } from './state';
import { ammoClassOf, blockOf, createAttackProfile, createBlockProfile, findAmmo, resolveProfile, type AttackProfile, type BlockProfile } from './weapons';

/** Id of the combat system and its save participant. */
export const COMBAT_SYSTEM_ID = 'combat';
/** Data version of the `combat` participant. */
export const COMBAT_SAVE_VERSION = 1;
/** Random stream of the fight (crits, conditions, spread, recovered arrows). */
export const COMBAT_RNG_STREAM = 'combat';

/** Experience sources of the fight (src/content/skills.ts: nahkampf, fernkampf, verteidigung). */
export const COMBAT_XP = {
  meleeHit: 'nahkampf_treffer',
  meleeWin: 'nahkampf_sieg',
  rangedHit: 'fernkampf_treffer',
  rangedWin: 'fernkampf_sieg',
  blocked: 'treffer_geblockt',
  parry: 'parade',
  dodge: 'ausweichrolle',
} as const;

const C = BALANCE.combat;
const HEAVY_HOLD_TICKS = secondsToTicks(C.attack.heavyHoldSeconds, 1);
const COMBO_WINDOW_TICKS = secondsToTicks(C.attack.comboWindowSeconds);
const FIGHTING_TICKS = secondsToTicks(C.aim.fightingSeconds);
const PARRY_STAGGER_TICKS = secondsToTicks(C.parry.staggerSeconds, 1);
const RIPOSTE_TICKS = secondsToTicks(C.parry.riposteSeconds, 1);
const WUCHT_TOP = C.impact.hitstopTicksByWucht.length;
/** The whole circle [°] (the sword's sweep reaches all around). */
const FULL_CIRCLE_DEG = 360;

/** Kind of an attack for the player's experience. */
export type AttackKind = 'nahkampf' | 'fernkampf';

/**
 * One attack handed to `resolve` (a held record of the caller): the attacker's side, the damage before the target, its
 * type and impact, stagger, crit chance, condition, armour break, backstab factor, whether a block can meet it, what kind
 * it is (experience), whether a projectile carried it, and where it comes from (block direction, knockback).
 */
export interface CombatAttack {
  team: CombatTeam;
  /** Damage before resistance, armour, block and crit [HP] (weapon, combo, heavy, tension already in). */
  damage: number;
  type: DamageType;
  /** Impact class 1–5 (hitstop 2–6 ticks, knockback). */
  wucht: number;
  /** Stagger of the target [s]. */
  staggerSeconds: number;
  /** Crit chance [0–1] (`BALANCE.combat.damage.critChance` for every ordinary blow). */
  critChance: number;
  condition: HitCondition | null;
  /** Armour the hit breaks [points] for `armorBreakSeconds` (the axe's heavy blow). */
  armorBreak: number;
  armorBreakSeconds: number;
  /** Damage factor when the target is not aware of the attacker (the dagger's ×3 while sneaking); 1 = none. */
  backstab: number;
  /** Whether a block or parry can meet it (bursts cannot). */
  blockable: boolean;
  kind: AttackKind;
  /** A projectile carried it (the player's damage cause `projektil`). */
  projectile: boolean;
  /** Where it comes from [world px]. */
  fromX: number;
  fromY: number;
}

/** A fresh attack record (an ordinary blunt blow of 0 damage from the player's side). */
export function createCombatAttack(): CombatAttack {
  return {
    team: 'spieler',
    damage: 0,
    type: 'wucht',
    wucht: 1,
    staggerSeconds: 0,
    critChance: C.damage.critChance,
    condition: null,
    armorBreak: 0,
    armorBreakSeconds: 0,
    backstab: 1,
    blockable: true,
    kind: 'nahkampf',
    projectile: false,
    fromX: 0,
    fromY: 0,
  };
}

/** A fresh view record. */
export function createCombatantView(): CombatantView {
  return {
    entity: NULL_ENTITY,
    team: 'feind',
    layer: 0,
    level: 0,
    x: 0,
    y: 0,
    radius: 0,
    facing: 0,
    health: 0,
    maxHealth: 0,
    armor: 0,
    resist: { hieb: 0, stich: 0, wucht: 0, feuer: 0, frost: 0, gift: 0, licht: 0, schatten: 0 },
    invulnerable: false,
    blockSinceTick: -1,
    blockPower: 0,
  };
}

/** A fresh hit record. */
export function createHitResult(): HitResult {
  return {
    attacker: NULL_ENTITY,
    attackerTeam: 'spieler',
    amount: 0,
    type: 'wucht',
    crit: false,
    parried: false,
    blocked: false,
    blockStamina: 0,
    knockback: 0,
    dirX: 0,
    dirY: 0,
    hitstopTicks: 0,
    staggerTicks: 0,
    condition: null,
    conditionSeconds: 0,
    armorBreak: 0,
    armorBreakSeconds: 0,
  };
}

/** Dependencies of the combat system (built in `createSimulation`). */
export interface CombatSystemDeps {
  readonly player: PlayerSystem;
  readonly motion: MotionSystem;
  readonly inventory: InventorySystem;
  readonly equipment: EquipmentSystem;
  readonly vitals: VitalsSystem;
  readonly collision: WorldCollision;
  /** The aimed point (`player.aim`); without it every blow goes where the player faces. */
  readonly interaction?: Pick<InteractionSystem, 'aimPoint'>;
  /** Where spent arrows, a thrown spear and throwing knives land (the drop system); without it they are lost. */
  readonly drops?: Pick<DropSystem, 'spawn'>;
  /** The fire flask sets the ground alight (the fire system); without it it only burns bodies. */
  readonly fire?: Pick<FireSystem, 'ignite'>;
  /** Debug cheats (`god`: no hit lands on the player); absent = every cheat off. */
  readonly cheats?: Readonly<DebugCheats>;
  /** The wind that pushes projectiles; default `worldCombatEnvironment()`. */
  readonly environment?: CombatEnvironment;
}

/** The life systems the fight acts through (bound after they exist): experience and conditions. */
export interface CombatLife {
  readonly skills: Pick<SkillsSystem, 'award'>;
  readonly conditions: Pick<ConditionsSystem, 'apply'>;
}

export class CombatSystem implements SimSystem {
  readonly id = COMBAT_SYSTEM_ID;
  readonly timeScope = 'global';
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  /** The player's combatant (its provider is registered first). */
  readonly playerTargets: CombatTargetProvider;

  private readonly player: PlayerSystem;
  private readonly inventory: InventorySystem;
  private readonly equipment: EquipmentSystem;
  private readonly interaction: Pick<InteractionSystem, 'aimPoint'> | null;
  private readonly cheats: Readonly<DebugCheats>;
  private readonly providers: CombatTargetProvider[] = [];
  private readonly flight: ProjectileFlight;
  private life: CombatLife | null = null;
  /** Skills and perks of the player (M6-34, `usePerks`); without them the fight runs on neutral modifiers. */
  private perks: CombatModifierSource | null = null;
  private stateValue: CombatState = createCombatState();

  // Held records (no allocation per tick or per hit).
  private readonly profile: AttackProfile = createAttackProfile();
  private readonly blockProfile: BlockProfile = createBlockProfile();
  private readonly mods: CombatModifiers = createCombatModifiers();
  private readonly attack: CombatAttack = createCombatAttack();
  private readonly hit: HitResult = createHitResult();
  private readonly riposte: HitResult = createHitResult();
  private readonly tView: CombatantView = createCombatantView();
  private readonly aView: CombatantView = createCombatantView();
  private readonly qView: CombatantView = createCombatantView();
  private readonly found: Entity[] = [];
  private readonly pos = { x: 0, y: 0 };
  private readonly aim = { x: 0, y: 0 };

  constructor(sim: Simulation, deps: CombatSystemDeps) {
    this.player = deps.player;
    this.inventory = deps.inventory;
    this.equipment = deps.equipment;
    this.interaction = deps.interaction ?? null;
    this.cheats = deps.cheats ?? createDebugCheats();
    const combatant = new PlayerCombatant({
      player: deps.player,
      motion: deps.motion,
      vitals: deps.vitals,
      equipment: deps.equipment,
      cheats: this.cheats,
      collision: deps.collision,
      host: {
        state: () => this.stateValue.player,
        facing: (s) => this.facingAngle(s),
        block: (s) => this.effectiveBlock(s),
        conditions: () => this.life?.conditions ?? null,
        cancelAttack: () => this.cancelAttack(),
      },
    });
    this.playerTargets = combatant;
    this.providers.push(combatant);
    this.flight = new ProjectileFlight(sim, {
      collision: deps.collision,
      inventory: deps.inventory,
      drops: deps.drops ?? null,
      fire: deps.fire ?? null,
      environment: deps.environment ?? worldCombatEnvironment(),
      host: {
        providers: this.providers,
        impact: this.impact,
        resolve: (s, attacker, target, attack) => this.resolve(s, attacker, target, attack),
        state: () => this.stateValue,
        view: (s, e, out) => this.viewOf(s, e, out) !== null,
      },
    });
    this.commands = {
      'combat.attack': (s, cmd, tick) => this.handleAttack(s, cmd, tick),
      'combat.block': (s, cmd, tick) => this.handleBlock(s, cmd, tick),
    };
    this.save = {
      id: COMBAT_SYSTEM_ID,
      version: COMBAT_SAVE_VERSION,
      // A save of an older version (before M6) has no fight: nothing in progress, no projectile in flight.
      migrations: [{ from: 0, migrate: () => this.emptySnapshot() }],
      serialize: () => this.serialize(),
      deserialize: (data) => this.deserialize(data),
    };
  }

  // -------------------------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------------------------

  /** Adds a kind of combatant (the creatures' provider). */
  addTargetProvider(provider: CombatTargetProvider): void {
    if (this.providers.some((p) => p.id === provider.id)) throw new Error(`CombatSystem: target provider "${provider.id}" is already registered`);
    this.providers.push(provider);
  }

  /**
   * Registers a creature shot (M6-15b, `ProjectileFlight.addShot`): the creature system names what its ranged attacks
   * throw – the sprite `geschoss_<name>` – and the condition a hit may cause, while the simulation is built.
   */
  addShot(id: string, condition: HitCondition | null): void {
    this.flight.addShot(id, condition);
  }

  /**
   * Launches a creature's shot (M6-15b): it flies like an arrow – swept against the tiles and the bodies hostile to
   * `launch.team`, resolved through `resolve` (kind `fernkampf`, the player's cause `projektil`; a block or a roll meets it).
   */
  fireShot(sim: Simulation, launch: Readonly<ProjectileLaunch>, tick: number): Entity {
    if (!this.flight.isShot(launch.item)) throw new RangeError(`CombatSystem.fireShot: "${launch.item}" is no registered shot`);
    return this.flight.fire(sim, launch, tick);
  }

  /** Binds the life systems: experience of the fight, conditions of hits on the player. */
  useLife(life: CombatLife): void {
    this.life = life;
  }

  /**
   * Binds the player's skills and perks (M6-34, src/game/combat/perks.ts): the hand's profile, the block, heavy blows,
   * crits, finishing blows, ripostes, full draws, saved ammunition, steady aim, the parry window, knockback and stagger
   * taken and what a kill or a dodge gives back follow the modifiers `source` fills.
   */
  usePerks(source: CombatModifierSource): void {
    this.perks = source;
  }

  /**
   * The player's perks at the impact of his projectiles (M6-45, the flight's hook `ProjectileImpact`): a throwable of his
   * bursts wider (`wurf_radius`), his spent ammunition is found more often (`pfeil_sammeln`); every other owner's projectile
   * lands with its item's own values.
   */
  readonly impact: ProjectileImpact = {
    burstRadius: (s, owner, radius) => (owner !== NULL_ENTITY && owner === s.player ? radius * Math.max(0, this.modifiers().throwRadius) : radius),
    recoverChance: (s, owner, chance) => (owner !== NULL_ENTITY && owner === s.player ? Math.min(1, Math.max(0, chance + this.modifiers().recover)) : chance),
  };

  /** The player's skill and perk modifiers now (a held record, refilled; neutral without `usePerks`). */
  modifiers(): Readonly<CombatModifiers> {
    return this.perks === null ? this.mods : this.perks.fill(this.mods);
  }

  /** Whether team `a` may hit team `b` (docs/SPIEL.md §10). */
  hostile(a: CombatTeam, b: CombatTeam): boolean {
    return hostile(a, b);
  }

  /** The saved state (read only: presentation, samples, tests). */
  get state(): Readonly<CombatState> {
    return this.stateValue;
  }

  /** The projectiles in flight (ECS column store `projectile`). */
  get projectiles(): ProjectileFlight['store'] {
    return this.flight.store;
  }

  /** Item id of a projectile's flying item. */
  projectileItem(row: number): string {
    return this.flight.itemAt(row);
  }

  /** The player's hitstop: the player system holds the body still in these ticks (`PlayerSystem.addMotionHold`). */
  readonly motionHold = (sim: Simulation): boolean => this.frozen(sim.tick);

  /**
   * The facing while fighting (`PlayerSystem.addFacingSource`, M6-01): while the player swings, draws, reloads, blocks or
   * aims – and `fightingSeconds` after the last blow, shot, block or hit – the facing follows the aim angle with
   * hysteresis from `current`; otherwise (and while rolling, jumping or climbing) `null`: the movement's facing.
   */
  readonly facingSource = (sim: Simulation, current: Facing): Facing | null => {
    const body = this.player.body(sim);
    if (body === undefined || body.rollTicks > 0 || body.transit !== 'none' || !this.fighting(sim)) return null;
    if (!this.aimVector(sim, this.aim)) return null;
    return facingForAngle(aimAngle(this.aim.x, this.aim.y), current);
  };

  /** Slower walking while swinging, blocking or aiming; fighting is exertion (§11.1 "bei Kampf/Abbau"). */
  readonly modifierSource: PlayerModifierSource = (sim, _player, out) => {
    const p = this.stateValue.player;
    if (p.phase !== 'bereit') {
      out.moveSpeedFactor *= C.attack.moveFactor;
      out.exertion = true;
    }
    const block = this.effectiveBlock(sim);
    if (block !== null) {
      out.moveSpeedFactor *= block.tempo;
      out.exertion = true;
    }
  };

  /**
   * Share of its mining power the hand strikes trees and stumps with (`GatheringSystem.setObjectPowerFactor`): a battle
   * axe fells with `BALANCE.combat.axe.fellPowerFactor` (§19.2 "fällt Bäume mit 50 %"), a real tool with its own.
   */
  readonly objectPowerFactor = (): number => {
    const s = this.inventory.selected();
    return s !== null && this.inventory.bags.catalog.get(s.item).waffe?.klasse === 'axt' ? C.axe.fellPowerFactor : 1;
  };

  /** Two-handed weapons hang the carried light on the belt (`LightSystem.addTwoHandedRule`, §12.2). */
  readonly twoHandedRule: TwoHandedRule = (def: ItemDef) => def.waffe !== undefined && twoHanded(def.waffe.klasse);

  /** The light of glowing arrows that stuck (`LightSystem.addLightProviders`). */
  lightProvider(): ExtraLightProvider {
    return this.flight.lightProvider();
  }

  /**
   * A light blow now with the item in the hand, as a press and release of the attack button (the primary use of
   * `player.useItem` for a weapon, a tool or the empty hand, src/game/tools/system.ts).
   */
  strike(sim: Simulation, tick: number): void {
    this.handleAttack(sim, { type: 'combat.attack', on: true }, tick);
    this.handleAttack(sim, { type: 'combat.attack', on: false }, tick);
  }

  // -------------------------------------------------------------------------------------------
  // Reading the fight
  // -------------------------------------------------------------------------------------------

  /** Whether the player fights now: an attack in progress, a block or aim, or the last of them within `fightingSeconds`. */
  fighting(sim: Simulation): boolean {
    const p = this.stateValue.player;
    return p.phase !== 'bereit' || this.effectiveBlock(sim) !== null || (p.lastFightTick >= 0 && sim.tick - p.lastFightTick <= FIGHTING_TICKS);
  }

  /** Whether the player's body stands still in hitstop in tick `tick`. */
  frozen(tick: number): boolean {
    const p = this.stateValue.player;
    return p.hitstopFromTick >= 0 && tick > p.hitstopFromTick && tick <= p.hitstopFromTick + p.hitstopTicks;
  }

  /** Whether the player staggers in tick `tick`. */
  staggered(tick: number): boolean {
    return tick <= this.stateValue.player.staggerUntilTick;
  }

  /** The aim of the player as a vector from the feet to the aimed point, else the facing's unit vector; false without a player. */
  aimVector(sim: Simulation, out: { x: number; y: number }): boolean {
    const body = this.player.body(sim);
    if (body === undefined || !this.player.position(sim, this.pos)) return false;
    const a = this.interaction === null ? null : this.interaction.aimPoint;
    if (a !== null) {
      out.x = a.x - this.pos.x;
      out.y = a.y - this.pos.y;
      if (out.x !== 0 || out.y !== 0) return true;
    }
    facingVector(body.facing, out);
    return true;
  }

  /** The direction the player faces for blocks and views [rad]: the aim while fighting, else the facing. */
  facingAngle(sim: Simulation): number {
    const body = this.player.body(sim);
    if (body === undefined) return 0;
    const aimed = this.interaction === null ? null : this.interaction.aimPoint;
    if (aimed !== null && this.fighting(sim) && this.aimVector(sim, this.aim)) return aimAngle(this.aim.x, this.aim.y);
    return FACING_ANGLE[body.facing];
  }

  /** The attack profile of the hand now (a held record, valid until the next call). */
  handProfile(): AttackProfile {
    const stack = this.inventory.selected();
    return applyProfileModifiers(resolveProfile(stack === null ? null : this.inventory.bags.catalog.get(stack.item), stack, this.profile), this.modifiers());
  }

  /** The player's block now (power, stamina, tempo), or `null` while not blocking (not held, or kept off). */
  effectiveBlock(sim: Simulation): BlockProfile | null {
    const p = this.stateValue.player;
    if (p.blockSinceTick < 0 || sim.player === NULL_ENTITY) return null;
    const off = this.equipment.worn('nebenhand');
    return applyBlockModifiers(blockOf(this.handProfile(), off === null ? null : this.inventory.bags.catalog.get(off.item), off, this.blockProfile), this.mods);
  }

  // -------------------------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------------------------

  private reject(sim: Simulation, type: GameCommandType, reason: CombatRejectReason, tick: number): void {
    sim.events.push('commandRejected', { type, reason, tick });
  }

  /** Why the player cannot start an attack or a block now, or `null`. */
  private unable(sim: Simulation, tick: number): CombatRejectReason | null {
    const body = this.player.body(sim);
    if (body === undefined || sim.player === NULL_ENTITY) return 'noPlayer';
    const incapable = this.player.incapacity(sim);
    if (incapable !== null) return incapable;
    if (body.rollTicks > 0 || body.transit !== 'none') return 'busy';
    if (body.swimming) return 'swimming';
    if (this.staggered(tick)) return 'staggered';
    return null;
  }

  private handleAttack(sim: Simulation, cmd: CommandOfType<'combat.attack'>, tick: number): void {
    const p = this.stateValue.player;
    if (!cmd.on) {
      if (!p.attackHeld) return;
      p.attackHeld = false;
      this.release(sim, tick);
      return;
    }
    const reason = this.unable(sim, tick);
    if (reason !== null) {
      this.reject(sim, cmd.type, reason, tick);
      return;
    }
    // A press while an attack runs does nothing (no buffer, docs/SPIEL.md §10): the next blow waits for the recovery.
    if (p.phase !== 'bereit') return;
    const v = this.player.vitalsOf(sim.player);
    if (v === undefined || !(v.stamina > 0)) {
      this.reject(sim, cmd.type, 'noStamina', tick);
      return;
    }
    const prof = this.handProfile();
    const ammo = ammoClassOf(prof.klasse);
    if (ammo !== null && !(prof.klasse === 'armbrust' && p.loaded !== '') && findAmmo(this.inventory.state, this.inventory.bags.catalog, ammo) === null) {
      this.reject(sim, cmd.type, 'noAmmo', tick);
      return;
    }
    // The combo goes on with the same weapon inside its window; anything else begins it anew.
    const sameWeapon = p.item === (prof.item ?? '');
    p.attackHeld = true;
    p.pressTick = tick;
    p.item = prof.item ?? '';
    p.heavy = false;
    p.lastFightTick = tick;
    if (prof.mode === 'nahkampf') {
      p.combo = prof.combo.length > 0 && sameWeapon && tick <= p.comboUntilTick && p.combo > 0 ? (p.combo % prof.combo.length) + 1 : 1;
      this.enter(p, 'ausholen', prof.windupTicks);
      sim.events.push('attackWindup', { entity: sim.player, klasse: prof.klasse, schwer: false, ticks: prof.windupTicks, tick });
      return;
    }
    p.combo = 1;
    if (prof.klasse === 'armbrust') {
      if (p.loaded !== '') this.shoot(sim, prof, 1, tick);
      else {
        this.enter(p, 'nachladen', prof.reloadTicks);
        sim.events.push('attackWindup', { entity: sim.player, klasse: prof.klasse, schwer: false, ticks: prof.reloadTicks, tick });
      }
      return;
    }
    this.enter(p, 'spannen', 0);
    sim.events.push('attackWindup', { entity: sim.player, klasse: prof.klasse, schwer: false, ticks: prof.drawTicks, tick });
  }

  /** The attack button was let go: a charged blow lands (heavy past the hold), a drawn shot or throw leaves. */
  private release(sim: Simulation, tick: number): void {
    const p = this.stateValue.player;
    if (p.phase === 'aufladen') {
      const prof = this.handProfile();
      this.blow(sim, prof, tick - p.pressTick >= HEAVY_HOLD_TICKS, tick);
    } else if (p.phase === 'spannen') {
      const prof = this.handProfile();
      this.shoot(sim, prof, tension(p.phaseTicks, prof.drawTicks), tick);
    }
  }

  private handleBlock(sim: Simulation, cmd: CommandOfType<'combat.block'>, tick: number): void {
    const p = this.stateValue.player;
    if (!cmd.on) {
      p.blockHeld = false;
      p.blockSinceTick = -1;
      return;
    }
    const body = this.player.body(sim);
    if (body === undefined) {
      this.reject(sim, cmd.type, 'noPlayer', tick);
      return;
    }
    const incapable = this.player.incapacity(sim);
    if (incapable !== null) {
      this.reject(sim, cmd.type, incapable, tick);
      return;
    }
    p.blockHeld = true;
    // Effective at once when nothing keeps it off – the parry window counts from this tick (docs/SPIEL.md §10).
    if (p.blockSinceTick < 0 && this.blockPossible(sim, tick)) {
      p.blockSinceTick = tick;
      p.lastFightTick = tick;
    }
  }

  /** Whether a held block works now: no melee attack in progress, not rolling, climbing, swimming or staggered. */
  private blockPossible(sim: Simulation, tick: number): boolean {
    const body = this.player.body(sim);
    if (body === undefined || body.rollTicks > 0 || body.transit !== 'none' || body.swimming || this.staggered(tick)) return false;
    if (this.player.incapacity(sim) !== null) return false;
    const p = this.stateValue.player;
    // A ranged weapon aims while it draws; a melee blow drops the guard until it recovered.
    return p.phase === 'bereit' || this.handProfile().mode !== 'nahkampf';
  }

  // -------------------------------------------------------------------------------------------
  // Ticks
  // -------------------------------------------------------------------------------------------

  update(sim: Simulation): void {
    const tick = sim.tick;
    const p = this.stateValue.player;
    if (sim.player === NULL_ENTITY || this.player.body(sim) === undefined) {
      if (p.phase !== 'bereit' || p.blockHeld) this.stateValue.player = createPlayerCombat();
    } else this.updatePlayer(sim, p, tick);
    this.flight.update(sim);
    this.expire(sim, tick);
  }

  private updatePlayer(sim: Simulation, p: PlayerCombat, tick: number): void {
    // Dead, asleep, rolling, climbing, swimming or staggered: the attack in progress ends, the guard drops.
    const body = this.player.body(sim);
    const stopped = body === undefined || this.player.incapacity(sim) !== null || body.rollTicks > 0 || body.transit !== 'none' || body.swimming || this.staggered(tick);
    if (stopped && p.phase !== 'bereit' && p.phase !== 'erholung') this.cancelAttack();
    // Another item in the hand ends the attack in progress (its profile would be another weapon's).
    if (p.phase !== 'bereit' && p.phase !== 'erholung' && (this.handProfile().item ?? '') !== p.item) this.cancelAttack();
    if (!this.frozen(tick)) {
      this.knockback(sim, p);
      this.advance(sim, p, tick);
    }
    // The block holds while it is possible; kept off, it starts again (a new parry window) once it is.
    if (p.blockHeld) {
      const possible = this.blockPossible(sim, tick);
      if (!possible) p.blockSinceTick = -1;
      else if (p.blockSinceTick < 0) {
        p.blockSinceTick = tick;
        p.lastFightTick = tick;
      }
    }
    if (p.armorBreakUntilTick >= 0 && tick > p.armorBreakUntilTick) {
      p.armorBreak = 0;
      p.armorBreakUntilTick = -1;
    }
  }

  /** One tick of the attack clock. */
  private advance(sim: Simulation, p: PlayerCombat, tick: number): void {
    switch (p.phase) {
      case 'bereit':
        return;
      case 'ausholen':
        p.phaseTicks++;
        if (p.phaseTicks < p.phaseTotal) return;
        if (p.attackHeld) {
          const prof = this.handProfile();
          this.enter(p, 'aufladen', 0);
          sim.events.push('attackWindup', { entity: sim.player, klasse: prof.klasse, schwer: true, ticks: Math.max(0, HEAVY_HOLD_TICKS - (tick - p.pressTick)), tick });
        } else this.blow(sim, this.handProfile(), false, tick);
        return;
      case 'aufladen':
      case 'spannen':
        p.phaseTicks++;
        return;
      case 'nachladen': {
        p.phaseTicks++;
        if (p.phaseTicks < p.phaseTotal) return;
        const prof = this.handProfile();
        const ammo = ammoClassOf(prof.klasse);
        const bolt = ammo === null ? null : findAmmo(this.inventory.state, this.inventory.bags.catalog, ammo);
        if (bolt !== null && (this.savesAmmo(sim) || this.inventory.take(sim, bolt, 1) !== null)) p.loaded = bolt;
        this.enter(p, 'bereit', 0);
        return;
      }
      case 'erholung':
        p.phaseTicks++;
        if (p.phaseTicks < p.phaseTotal) return;
        this.enter(p, 'bereit', 0);
        p.comboUntilTick = tick + COMBO_WINDOW_TICKS;
        return;
    }
  }

  private enter(p: PlayerCombat, phase: PlayerCombat['phase'], total: number): void {
    p.phase = phase;
    p.phaseTicks = 0;
    p.phaseTotal = total;
  }

  /** Ends the attack in progress without a blow (a hit, a roll, another item, death). */
  private cancelAttack(): void {
    const p = this.stateValue.player;
    if (p.phase === 'bereit') return;
    this.enter(p, 'bereit', 0);
    p.attackHeld = false;
    p.heavy = false;
  }

  /** Moves the player by the knockback of this tick (collision as walking, no drop down a ledge). */
  private knockback(sim: Simulation, p: PlayerCombat): void {
    if (p.knockTicks <= 0) return;
    p.knockTicks--;
    (this.playerTargets as PlayerCombatant).push(sim, p.knockX, p.knockY);
    if (p.knockTicks === 0) {
      p.knockX = 0;
      p.knockY = 0;
    }
  }

  private expire(sim: Simulation, tick: number): void {
    const marks = this.stateValue.marks;
    for (let i = marks.length - 1; i >= 0; i--) if ((marks[i] as { untilTick: number }).untilTick < tick) marks.splice(i, 1);
    this.flight.expireGlows(sim, tick);
  }

  // -------------------------------------------------------------------------------------------
  // Blows and shots
  // -------------------------------------------------------------------------------------------

  /** The player's blow lands now: every hostile body in reach and swing is hit once. */
  private blow(sim: Simulation, prof: AttackProfile, heavy: boolean, tick: number): void {
    const p = this.stateValue.player;
    const v = this.player.vitalsOf(sim.player);
    const body = this.player.body(sim);
    if (v === undefined || body === undefined || !this.player.position(sim, this.pos) || !this.aimVector(sim, this.aim)) {
      this.cancelAttack();
      return;
    }
    const H = C.attack.heavy;
    spendStamina(v, prof.stamina * (heavy ? H.staminaFactor : 1));
    p.heavy = heavy;
    p.lastFightTick = tick;
    const step = heavy ? 1 : p.combo;
    // A heavy blow ends the combo: the next light blow is its first again.
    if (heavy) p.combo = 0;
    const angle = aimAngle(this.aim.x, this.aim.y);
    const len = Math.sqrt(this.aim.x * this.aim.x + this.aim.y * this.aim.y);
    const fx = this.aim.x / len;
    const fy = this.aim.y / len;
    const sweep = heavy && prof.heavy === 'rundumhieb';
    const arc = sweep ? FULL_CIRCLE_DEG : prof.arcDeg;
    sim.events.push('attackStarted', { entity: sim.player, klasse: prof.klasse, schwer: heavy, kombo: step, angle, reichweite: prof.reach, bogen: arc, item: prof.item, layer: body.layer, x: this.pos.x, y: this.pos.y, tick });
    this.enter(p, 'erholung', heavy ? Math.round(prof.recoveryTicks * H.recoveryFactor) : prof.recoveryTicks);
    if (heavy && prof.heavy === 'wurf') {
      this.throwHeld(sim, prof, fx, fy, tick);
      return;
    }
    const a = this.attack;
    a.team = 'spieler';
    a.damage = prof.damage * (heavy ? H.damageFactor * this.mods.heavyDamage : (prof.combo[step - 1] ?? 1));
    a.type = prof.art;
    a.wucht = Math.min(WUCHT_TOP, prof.wucht + (heavy ? H.wuchtBonus : 0));
    a.staggerSeconds = prof.staggerSeconds * (heavy ? H.staggerFactor : 1);
    a.critChance = C.damage.critChance + this.mods.meleeCrit;
    a.condition = prof.condition;
    a.armorBreak = heavy && prof.heavy === 'ruestungsbruch' ? C.axe.armorBreakPoints : 0;
    a.armorBreakSeconds = heavy && prof.heavy === 'ruestungsbruch' ? C.axe.armorBreakSeconds : 0;
    a.backstab = prof.klasse === 'dolch' && body.sneakHeld ? C.dagger.backstabFactor : 1;
    a.blockable = true;
    a.kind = 'nahkampf';
    a.projectile = false;
    a.fromX = this.pos.x;
    a.fromY = this.pos.y;
    const cosHalf = arc >= FULL_CIRCLE_DEG ? -1 : Math.cos(degToRad(arc / 2));
    const px = this.pos.x;
    const py = this.pos.y;
    const layer = body.layer;
    const level = body.level;
    let landed = 0;
    let stop = 0;
    const found = this.found;
    for (let k = 0; k < this.providers.length; k++) {
      const provider = this.providers[k] as CombatTargetProvider;
      found.length = 0;
      provider.queryCircle(sim, layer, px, py, prof.reach, found);
      for (let i = 0; i < found.length; i++) {
        const e = found[i] as Entity;
        if (e === sim.player || !this.viewWith(provider, sim, e, this.qView)) continue;
        const q = this.qView;
        if (q.layer !== layer || q.level !== level || q.health <= 0 || !hostile('spieler', q.team)) continue;
        if (!inSwing(fx, fy, q.x - px, q.y - py, q.radius, prof.reach, cosHalf)) continue;
        const h = this.resolve(sim, sim.player, e, a);
        if (h === null) continue;
        landed++;
        if (h.hitstopTicks > stop) stop = h.hitstopTicks;
      }
    }
    if (landed === 0) return;
    // The blow cost the weapon one use (§D) – the fist has none to lose.
    if (prof.item !== null) this.equipment.wear(sim, { bereich: 'schnellleiste', index: this.inventory.state.auswahl }, C.wear.perStrike);
    this.hitstop(tick, stop);
  }

  /** The spear's heavy attack: the spear leaves the hand as a projectile and lands as an item. */
  private throwHeld(sim: Simulation, prof: AttackProfile, fx: number, fy: number, tick: number): void {
    const stack = this.takeFromHand(sim, prof.item, tick);
    if (stack === null) return;
    const launch = this.flight.launch;
    this.fillLaunch(launch, sim, prof, stack.item, fx, fy, 1);
    launch.speed = C.spear.throwSpeedPxPerSecond;
    launch.range = C.spear.throwRangePx;
    launch.damage = prof.damage * C.attack.heavy.damageFactor * this.mods.heavyDamage;
    launch.carried = stack;
    launch.arc = false;
    this.flight.fire(sim, launch, tick);
  }

  /** A shot (bow, crossbow, sling) or a throw leaves at tension `t`. */
  private shoot(sim: Simulation, prof: AttackProfile, t: number, tick: number): void {
    const p = this.stateValue.player;
    const v = this.player.vitalsOf(sim.player);
    const body = this.player.body(sim);
    if (v === undefined || body === undefined || !this.player.position(sim, this.pos) || !this.aimVector(sim, this.aim)) {
      this.cancelAttack();
      return;
    }
    const catalog = this.inventory.bags.catalog;
    let item: string;
    let carried: ItemStack | null = null;
    if (prof.mode === 'wurf') {
      const stack = this.takeFromHand(sim, prof.item, tick);
      if (stack === null) {
        this.cancelAttack();
        return;
      }
      item = stack.item;
      carried = prof.throwEffect === 'einzel' ? stack : null;
    } else if (prof.klasse === 'armbrust') {
      item = p.loaded;
      p.loaded = '';
    } else {
      const ammo = ammoClassOf(prof.klasse);
      const found = ammo === null ? null : findAmmo(this.inventory.state, catalog, ammo);
      if (found === null || (!this.savesAmmo(sim) && this.inventory.take(sim, found, 1) === null)) {
        this.cancelAttack();
        this.reject(sim, 'combat.attack', 'noAmmo', tick);
        return;
      }
      item = found;
    }
    spendStamina(v, prof.stamina);
    p.lastFightTick = tick;
    const len = Math.sqrt(this.aim.x * this.aim.x + this.aim.y * this.aim.y);
    const fx = this.aim.x / len;
    const fy = this.aim.y / len;
    sim.events.push('attackStarted', { entity: sim.player, klasse: prof.klasse, schwer: false, kombo: 1, angle: aimAngle(fx, fy), reichweite: prof.reach, bogen: prof.arcDeg, item: prof.item, layer: body.layer, x: this.pos.x, y: this.pos.y, tick });
    this.enter(p, 'erholung', prof.recoveryTicks);
    const launch = this.flight.launch;
    this.fillLaunch(launch, sim, prof, item, fx, fy, t);
    // Fernkampf's skill bonus on the whole shot, weapon and ammunition; „Kraftschuss“ on a full draw (M6-34).
    if (prof.mode === 'munition') launch.damage *= this.mods.rangedDamage * (t >= 1 ? this.mods.fullDraw : 1);
    launch.carried = carried;
    launch.aiming = p.blockSinceTick >= 0 || this.mods.steady;
    if (prof.mode === 'wurf' && prof.throwEffect !== 'einzel') {
      launch.arc = true;
      launch.range = Math.max(C.throw.minRangePx, Math.min(len, prof.reach * t));
    }
    this.flight.fire(sim, launch, tick);
  }

  private fillLaunch(launch: ProjectileLaunch, sim: Simulation, prof: AttackProfile, item: string, fx: number, fy: number, t: number): void {
    const body = this.player.body(sim);
    const ammo = this.inventory.bags.catalog.get(item).munition;
    launch.owner = sim.player;
    launch.team = 'spieler';
    launch.klasse = prof.klasse;
    launch.item = item;
    launch.layer = body?.layer ?? 0;
    launch.level = body?.level ?? 0;
    launch.x = this.pos.x;
    launch.y = this.pos.y;
    launch.dirX = fx;
    launch.dirY = fy;
    launch.tension = t;
    launch.speed = prof.speed;
    launch.range = prof.reach;
    launch.damage = (prof.damage + (ammo?.schaden ?? 0)) * t;
    launch.art = ammo?.schadensart ?? prof.art;
    launch.wucht = ammo?.wucht ?? prof.wucht;
    launch.staggerSeconds = prof.staggerSeconds;
    launch.arc = false;
    launch.aiming = false;
    launch.carried = null;
  }

  /** Whether a perk saves the ammunition of this shot (`fernkampf_sparen`; the stream `combat` draws only with the perk). */
  private savesAmmo(sim: Simulation): boolean {
    const chance = this.mods.ammoSave;
    return chance > 0 && sim.rng.stream(COMBAT_RNG_STREAM).next() < chance;
  }

  /** Takes one piece of `item` out of the hand (a throw); `null` when the hand no longer holds it. */
  private takeFromHand(sim: Simulation, item: string | null, tick: number): ItemStack | null {
    const state = this.inventory.state;
    const ref: SlotRef = { bereich: 'schnellleiste', index: state.auswahl };
    const s = slotAt(state, ref);
    if (s === null || item === null || s.item !== item) return null;
    this.inventory.bags.replace(withSlot(state, ref, s.count > 1 ? withCount(s, s.count - 1) : null));
    sim.events.push('inventoryChanged', { change: 'remove', tick });
    return withCount(s, 1);
  }

  /** Starts the player's hitstop of `ticks` after tick `tick` (a longer one running stays). */
  private hitstop(tick: number, ticks: number): void {
    const p = this.stateValue.player;
    if (ticks <= 0) return;
    if (this.frozen(tick + 1) && p.hitstopFromTick + p.hitstopTicks >= tick + ticks) return;
    p.hitstopFromTick = tick;
    p.hitstopTicks = ticks;
  }

  // -------------------------------------------------------------------------------------------
  // Resolving hits
  // -------------------------------------------------------------------------------------------

  /** Fills `out` with the view of `e` and returns the provider that owns it, or `null`. */
  viewOf(sim: Simulation, e: Entity, out: CombatantView): CombatTargetProvider | null {
    if (e === NULL_ENTITY) return null;
    for (let k = 0; k < this.providers.length; k++) {
      const provider = this.providers[k] as CombatTargetProvider;
      if (this.viewWith(provider, sim, e, out)) return provider;
    }
    return null;
  }

  private viewWith(provider: CombatTargetProvider, sim: Simulation, e: Entity, out: CombatantView): boolean {
    out.blockStaminaPerDamage = undefined;
    out.material = undefined;
    return provider.view(sim, e, out);
  }

  /**
   * Resolves `attack` of `attacker` (its side `attack.team`; `NULL_ENTITY` for a body gone, e.g. the owner of a projectile)
   * against `target` and hands the hit to the target's provider. Returns the hit (a held record, valid until the next
   * call), or `null` when nothing landed: target gone or dead, not hostile, invulnerable (a roll through the blow is
   * experience for the player).
   */
  resolve(sim: Simulation, attacker: Entity, target: Entity, attack: Readonly<CombatAttack>): HitResult | null {
    const t = this.tView;
    const provider = this.viewOf(sim, target, t);
    if (provider === null || t.health <= 0 || !hostile(attack.team, t.team)) return null;
    const tick = sim.eventTick;
    const player = sim.player;
    const m = this.modifiers();
    if (t.invulnerable) {
      if (target === player && !this.cheats.god && this.player.isInvulnerable(sim)) {
        this.xp(sim, COMBAT_XP.dodge);
        this.restorePlayer(sim, m.dodgeStamina, 0);
      }
      return null;
    }
    let dx = t.x - attack.fromX;
    let dy = t.y - attack.fromY;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0) {
      dx /= len;
      dy /= len;
    } else {
      dx = 1;
      dy = 0;
    }
    const wucht = attack.wucht;
    const stop = hitstopTicks(wucht);
    const h = this.hit;
    h.attacker = attacker;
    h.attackerTeam = attack.team;
    h.type = attack.type;
    h.dirX = dx;
    h.dirY = dy;
    h.hitstopTicks = stop;
    const covered = attack.blockable && t.blockSinceTick >= 0 && blockCovers(t.facing, attack.fromX - t.x, attack.fromY - t.y);
    if (covered && parries(t.blockSinceTick, tick, target === player ? PARRY_WINDOW_TICKS + m.parryTicks : PARRY_WINDOW_TICKS)) return this.parry(sim, attacker, attacker === NULL_ENTITY ? null : this.viewOf(sim, attacker, this.aView), target, provider, attack, h, tick);
    const rng = sim.rng.stream(COMBAT_RNG_STREAM);
    const marked = this.consumeMark(target);
    const crit = marked || critRoll(rng.next(), attack.critChance);
    const unaware = attack.backstab > 1 && attacker !== NULL_ENTITY && !provider.aware(sim, target, attacker);
    let base = attack.damage * (unaware ? attack.backstab : 1);
    // The player's perks on the hit (M6-34): the riposte on a parried foe, the finishing blow on one nearly beaten.
    if (attacker === player && player !== NULL_ENTITY) {
      if (marked) base *= 1 + m.riposte;
      if (attack.kind === 'nahkampf' && m.finisher > 0 && nearlyBeaten(t.health, t.maxHealth)) base *= 1 + m.finisher;
    }
    const blockPower = covered ? t.blockPower : 0;
    const resist = t.resist[attack.type];
    const amount = hitDamage(base, resist, t.armor, crit, blockPower);
    const blocked = blockPower > 0;
    const absorbed = blocked ? hitDamage(base, resist, t.armor, crit, 0) - amount : 0;
    const cond = attack.condition;
    const landsCondition = !blocked && cond !== null && rng.next() < cond.chance;
    h.amount = amount;
    h.crit = crit;
    h.parried = false;
    h.blocked = blocked;
    h.blockStamina = absorbed * (t.blockStaminaPerDamage ?? C.block.staminaPerDamage);
    h.knockback = blocked ? knockbackPx(wucht) / 2 : knockbackPx(wucht);
    h.staggerTicks = blocked ? 0 : secondsToTicks(attack.staggerSeconds);
    h.condition = landsCondition && cond !== null ? cond.id : null;
    h.conditionSeconds = landsCondition && cond !== null ? cond.sekunden : 0;
    h.armorBreak = blocked ? 0 : attack.armorBreak;
    h.armorBreakSeconds = blocked ? 0 : attack.armorBreakSeconds;
    if (target === player) {
      // „Standfest“ (M6-34): the player is thrown back and staggers less.
      h.knockback *= m.taken;
      h.staggerTicks = Math.round(h.staggerTicks * m.taken);
    }
    const healthBefore = t.health;
    const x = t.x;
    const y = t.y;
    const layer = t.layer as Layer;
    const material = t.material ?? 'fleisch';
    // What met the blow (the view just refilled the player's block and hand profile): the shield, else the item in the hand.
    const blockedWith = blocked && target === player ? (this.blockProfile.shield ?? this.profile.item) : null;
    (this.playerTargets as PlayerCombatant).cause = attack.projectile ? 'projektil' : 'kreatur';
    provider.applyHit(sim, target, h);
    sim.events.push('hitLanded', { attacker, target, targetTeam: t.team, amount, art: attack.type, crit, wucht, hitstopTicks: stop, knockback: h.knockback, material, backstab: unaware, layer, x, y, tick });
    if (blocked) {
      const broken = target === player && this.stateValue.player.blockSinceTick < 0;
      sim.events.push('blocked', { entity: target, attacker, absorbed, amount, guardBroken: broken, mit: blockedWith, layer, x, y, tick });
      if (target === player) this.xp(sim, COMBAT_XP.blocked);
    }
    if (h.staggerTicks > 0) sim.events.push('staggered', { entity: target, ticks: h.staggerTicks, tick });
    if (attacker === player && player !== NULL_ENTITY) {
      this.xp(sim, attack.kind === 'nahkampf' ? COMBAT_XP.meleeHit : COMBAT_XP.rangedHit);
      this.stateValue.player.lastFightTick = tick;
    }
    if (target === player) this.stateValue.player.lastFightTick = tick;
    // Defeated: health went from above 0 to 0 (or the body is gone).
    if (healthBefore > 0 && (this.viewWith(provider, sim, target, this.qView) ? this.qView.health <= 0 : true)) {
      sim.events.push('combatantDefeated', { entity: target, by: attacker, layer, x, y, tick });
      if (attacker === player && player !== NULL_ENTITY) {
        this.xp(sim, attack.kind === 'nahkampf' ? COMBAT_XP.meleeWin : COMBAT_XP.rangedWin);
        if (attack.kind === 'nahkampf') this.restorePlayer(sim, m.killStamina, m.killHealth);
      }
    }
    return h;
  }

  /** Gives the player back stamina and health (perks „Blutrausch“, „Ausweichkünstler“). */
  private restorePlayer(sim: Simulation, stamina: number, health: number): void {
    if (!(stamina > 0) && !(health > 0)) return;
    const v = this.player.vitalsOf(sim.player);
    if (v !== undefined) restoreVitals(v, stamina, health);
  }

  /** The blow met a block begun inside the parry window: no damage; the attacker staggers and is marked. */
  private parry(sim: Simulation, attacker: Entity, attackerProvider: CombatTargetProvider | null, target: Entity, provider: CombatTargetProvider, attack: Readonly<CombatAttack>, h: HitResult, tick: number): HitResult {
    const t = this.tView;
    h.amount = 0;
    h.crit = false;
    h.parried = true;
    h.blocked = false;
    h.blockStamina = 0;
    h.knockback = 0;
    h.staggerTicks = 0;
    h.condition = null;
    h.conditionSeconds = 0;
    h.armorBreak = 0;
    h.armorBreakSeconds = 0;
    const x = t.x;
    const y = t.y;
    const layer = t.layer as Layer;
    provider.applyHit(sim, target, h);
    sim.events.push('parried', { entity: target, attacker, layer, x, y, tick });
    if (attackerProvider !== null) {
      const r = this.riposte;
      r.attacker = target;
      r.attackerTeam = t.team;
      r.amount = 0;
      r.type = attack.type;
      r.crit = false;
      r.parried = true;
      r.blocked = false;
      r.blockStamina = 0;
      r.knockback = 0;
      r.dirX = -h.dirX;
      r.dirY = -h.dirY;
      r.hitstopTicks = h.hitstopTicks;
      r.staggerTicks = PARRY_STAGGER_TICKS;
      r.condition = null;
      r.conditionSeconds = 0;
      r.armorBreak = 0;
      r.armorBreakSeconds = 0;
      attackerProvider.applyHit(sim, attacker, r);
      sim.events.push('staggered', { entity: attacker, ticks: PARRY_STAGGER_TICKS, tick });
      this.mark(attacker, tick + RIPOSTE_TICKS);
    }
    if (target === sim.player) {
      this.xp(sim, COMBAT_XP.parry);
      this.stateValue.player.lastFightTick = tick;
    }
    return h;
  }

  private mark(e: Entity, untilTick: number): void {
    const marks = this.stateValue.marks;
    for (const m of marks) {
      if (m.entity === e) {
        m.untilTick = untilTick;
        return;
      }
    }
    marks.push({ entity: e, untilTick });
  }

  /** Whether `e` carries a parry mark; the mark is used up. */
  private consumeMark(e: Entity): boolean {
    const marks = this.stateValue.marks;
    for (let i = 0; i < marks.length; i++) {
      if ((marks[i] as { entity: Entity }).entity === e) {
        marks.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  private xp(sim: Simulation, source: string): void {
    this.life?.skills.award(sim, source);
  }

  // -------------------------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------------------------

  private emptySnapshot(): unknown {
    return { player: createPlayerCombat(), marks: [], glows: [], serial: 0, projectiles: [] };
  }

  private serialize(): unknown {
    const s = this.stateValue;
    return {
      player: { ...s.player },
      marks: s.marks.map((m) => ({ ...m })),
      glows: s.glows.map((g) => ({ ...g })),
      serial: s.serial,
      projectiles: this.flight.serialize(),
    };
  }

  private deserialize(data: unknown): void {
    const parsed = combatSnapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`combat snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const d = parsed.data;
    const catalog = this.inventory.bags.catalog;
    for (const item of [d.player.item, d.player.loaded]) if (item !== '' && !catalog.has(item)) throw new TypeError(`combat snapshot invalid: unknown item "${item}"`);
    this.flight.validate(d.projectiles);
    const state = createCombatState();
    state.player = { ...d.player };
    state.marks = d.marks.map((m) => ({ ...m }));
    state.glows = d.glows.map((g) => ({ ...g, layer: g.layer as Layer }));
    state.serial = d.serial;
    this.stateValue = state;
    this.flight.deserialize(d.projectiles, state);
  }
}

/** Index of a damage type in `DAMAGE_TYPES` (projectile column `art`). */
export function damageTypeIndex(type: DamageType): number {
  return DAMAGE_TYPES.indexOf(type);
}

/** Index of a team in `COMBAT_TEAMS` (projectile column `team`). */
export function teamIndex(team: CombatTeam): number {
  return COMBAT_TEAMS.indexOf(team);
}

