/**
 * The player as a combatant (docs/SPIEL.md §10 "Kampfteilnehmer"): the `CombatTargetProvider` of the one player entity.
 *
 * - `queryCircle`/`view`: its body – position (the centre of the feet), `BALANCE.combat.body.playerRadiusPx`, the facing
 *   (the aim while fighting), health from the vitals, armour from the worn equipment (`EquipmentSystem.stats().werte.ruestung`)
 *   minus what an axe broke, resistances from `feuerresistenz`, `frostresistenz`, `giftresistenz`, invulnerable while the
 *   roll's first 0,25 s last (§11.4) or in god mode (debug `god`), the block of the combat system.
 * - `aware`: the player always notices an attacker (no backstab on the player).
 * - `applyHit`: damage through `VitalsSystem.damage` with the cause `kreatur` or `projektil` (the god mode stays in force
 *   there too), every worn armour piece wears one use, a block costs stamina (at 0 the guard breaks: the block drops and the
 *   player staggers) and wears the shield, stagger interrupts the attack in progress, knockback pushes the body over a few
 *   ticks (collision like walking, never down a ledge), hitstop holds it still, a condition lands (`ConditionsSystem.apply`),
 *   an axe's heavy blow breaks armour for a while.
 */
import { BALANCE } from '../../content/balance';
import { NULL_ENTITY, type Entity } from '../../engine/ecs';
import { createMoveResult, moveCircle } from '../../world/collision/move';
import { PLAYER_RULES, type MoverRules } from '../../world/collision/tiles';
import type { Layer } from '../../world/model/coords';
import type { DebugCheats } from '../cheats/state';
import type { ConditionsSystem } from '../conditions/system';
import type { EquipmentSystem } from '../equipment/system';
import { equipmentRef, type EquipmentSlot } from '../items/slots';
import type { WorldCollision } from '../player/collision';
import type { PlayerSystem } from '../player/system';
import type { Simulation } from '../sim';
import type { DamageCause } from '../survival/events';
import { spendStamina, type VitalsSystem } from '../survival/system';
import type { MotionSystem } from '../systems/motion';
import { secondsToTicks } from './formulas';
import type { PlayerCombat } from './state';
import type { CombatTargetProvider, CombatantView, HitResult } from './targets';
import type { BlockProfile } from './weapons';

const C = BALANCE.combat;
/** Id of the player's provider. */
export const PLAYER_TARGETS_ID = 'spieler';
const GUARD_BREAK_TICKS = secondsToTicks(C.block.guardBreakSeconds, 1);
const KNOCKBACK_TICKS = Math.max(1, C.impact.knockbackTicks);
/** Worn pieces an absorbed blow wears (§13.1: armour; the off hand's shield wears by blocking). */
const ARMOR_SLOTS: readonly EquipmentSlot[] = ['kopf', 'brust', 'beine', 'fuesse', 'ruecken'];
const ARMOR_REFS = ARMOR_SLOTS.map((s) => equipmentRef(s));
const OFFHAND_REF = equipmentRef('nebenhand');
/** A knockback moves like walking, but never drops the body down a ledge (the landing belongs to the player's own steps). */
const KNOCKBACK_RULES: MoverRules = Object.freeze({ blockMask: PLAYER_RULES.blockMask, mode: 'walk', dropDown: false });

/** What the player's combatant reads of the combat system. */
export interface PlayerCombatHost {
  /** The player's combat state. */
  state(): PlayerCombat;
  /** Where the player faces [rad] (the aim while fighting). */
  facing(sim: Simulation): number;
  /** The player's block now, or `null`. */
  block(sim: Simulation): BlockProfile | null;
  /** The condition system (bound after the life systems exist), or `null`. */
  conditions(): Pick<ConditionsSystem, 'apply'> | null;
  /** Ends the attack in progress (a stagger interrupts it). */
  cancelAttack(): void;
}

/** Dependencies of the player's combatant. */
export interface PlayerCombatantDeps {
  readonly player: PlayerSystem;
  readonly motion: MotionSystem;
  readonly vitals: VitalsSystem;
  readonly equipment: EquipmentSystem;
  readonly collision: WorldCollision;
  readonly cheats: Readonly<DebugCheats>;
  readonly host: PlayerCombatHost;
}

export class PlayerCombatant implements CombatTargetProvider {
  readonly id = PLAYER_TARGETS_ID;
  /** Damage cause of the hit being applied (set by the combat system before `applyHit`). */
  cause: DamageCause = 'kreatur';
  private readonly deps: PlayerCombatantDeps;
  private readonly pos = { x: 0, y: 0 };
  private readonly moved = createMoveResult();

  constructor(deps: PlayerCombatantDeps) {
    this.deps = deps;
  }

  queryCircle(sim: Simulation, layer: number, x: number, y: number, r: number, out: Entity[]): void {
    const e = sim.player;
    const body = this.deps.player.body(sim);
    if (e === NULL_ENTITY || body === undefined || body.layer !== layer || !this.deps.player.position(sim, this.pos)) return;
    const dx = this.pos.x - x;
    const dy = this.pos.y - y;
    const reach = r + C.body.playerRadiusPx;
    if (dx * dx + dy * dy <= reach * reach) out.push(e);
  }

  view(sim: Simulation, entity: Entity, out: CombatantView): boolean {
    const d = this.deps;
    const body = d.player.body(sim);
    const v = d.player.vitalsOf(entity);
    if (entity === NULL_ENTITY || entity !== sim.player || body === undefined || v === undefined || !d.player.position(sim, this.pos)) return false;
    const p = d.host.state();
    const werte = d.equipment.stats().werte;
    out.entity = entity;
    out.team = 'spieler';
    out.layer = body.layer;
    out.level = body.level;
    out.x = this.pos.x;
    out.y = this.pos.y;
    out.radius = C.body.playerRadiusPx;
    out.facing = d.host.facing(sim);
    out.health = v.health;
    out.maxHealth = v.maxHealth;
    out.armor = werte.ruestung - p.armorBreak;
    const r = out.resist;
    r.hieb = 0;
    r.stich = 0;
    r.wucht = 0;
    r.feuer = werte.feuerresistenz;
    r.frost = werte.frostresistenz;
    r.gift = werte.giftresistenz;
    r.licht = 0;
    r.schatten = 0;
    out.invulnerable = d.cheats.god || d.player.isInvulnerable(sim);
    const block = d.host.block(sim);
    out.blockSinceTick = block === null || block.kind !== 'block' ? -1 : p.blockSinceTick;
    out.blockPower = block === null || block.kind !== 'block' ? 0 : block.power;
    out.blockStaminaPerDamage = block === null ? undefined : block.staminaPerDamage;
    out.material = 'fleisch';
    return true;
  }

  aware(): boolean {
    return true;
  }

  applyHit(sim: Simulation, entity: Entity, hit: HitResult): void {
    const d = this.deps;
    const v = d.player.vitalsOf(entity);
    if (entity !== sim.player || v === undefined) return;
    const p = d.host.state();
    const tick = sim.eventTick;
    p.lastFightTick = tick;
    if (hit.amount > 0) {
      d.vitals.damage(sim, hit.amount, this.cause);
      for (const ref of ARMOR_REFS) d.equipment.wear(sim, ref, C.wear.perHitTaken);
    }
    if (hit.blocked) {
      const shield = d.host.block(sim)?.shield ?? null;
      if (shield !== null) d.equipment.wear(sim, OFFHAND_REF, C.wear.perBlock);
      if (hit.blockStamina > 0) {
        spendStamina(v, hit.blockStamina);
        if (v.stamina <= 0) {
          // Guard break: the block drops (pressed again it counts anew) and the player staggers.
          p.blockHeld = false;
          p.blockSinceTick = -1;
          this.stagger(p, tick + GUARD_BREAK_TICKS);
        }
      }
    }
    if (hit.staggerTicks > 0) this.stagger(p, tick + hit.staggerTicks);
    if (hit.knockback > 0) {
      p.knockX = (hit.dirX * hit.knockback) / KNOCKBACK_TICKS;
      p.knockY = (hit.dirY * hit.knockback) / KNOCKBACK_TICKS;
      p.knockTicks = KNOCKBACK_TICKS;
    }
    if (hit.hitstopTicks > 0 && !(p.hitstopFromTick >= 0 && p.hitstopFromTick + p.hitstopTicks >= tick + hit.hitstopTicks)) {
      p.hitstopFromTick = tick;
      p.hitstopTicks = hit.hitstopTicks;
    }
    if (hit.condition !== null) d.host.conditions()?.apply(sim, hit.condition, hit.conditionSeconds);
    if (hit.armorBreak > 0) {
      p.armorBreak = hit.armorBreak;
      p.armorBreakUntilTick = tick + secondsToTicks(hit.armorBreakSeconds, 1);
    }
  }

  /** Moves the player's body by (dx, dy) [px] (a knockback step): collision as walking, never down a ledge. */
  push(sim: Simulation, dx: number, dy: number): void {
    const d = this.deps;
    const body = d.player.body(sim);
    const e = sim.player;
    if (body === undefined || e === NULL_ENTITY) return;
    const row = d.motion.position.indexOf(e);
    if (row < 0) return;
    const cols = d.motion.position.columns;
    const r = moveCircle(d.collision.grid, body.layer as Layer, cols.x[row] as number, cols.y[row] as number, BALANCE.player.movement.colliderRadiusPx, dx, dy, KNOCKBACK_RULES, this.moved);
    cols.x[row] = r.x;
    cols.y[row] = r.y;
    body.level = r.level;
  }

  private stagger(p: PlayerCombat, untilTick: number): void {
    if (untilTick > p.staggerUntilTick) p.staggerUntilTick = untilTick;
    if (p.phase !== 'bereit' && p.phase !== 'erholung') this.deps.host.cancelAttack();
  }
}
