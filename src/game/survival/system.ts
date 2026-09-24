/**
 * Vitals system (MASTERPROMPT §11.1, §11.2; M3-17, M3-18): every tick it runs the survival rules for the
 * player (`formulas.ts`, `temperature.ts`) – after the player system moved the body (stamina costs of
 * sprint, roll and swimming are already spent, `swimming` and the movement mode are current):
 *
 * 1. Felt temperature = ambient (temperature field at the player's tile) + warmest heat source + room
 *    value; comfort band from insulation, cooling and wetness; the core moves by the stress.
 * 2. Wetness (swimming soaks, rain wets, fire/room/outdoors dry), satiety, thirst, exhaustion.
 * 3. Maxima (modifiers, temperature stage), stamina regeneration after 0,8 s without use.
 * 4. Damage over time (starving, dehydrating, drowning, cold, heat) – applied every tick, reported once
 *    per second per cause (`playerDamaged` at the world tick; at once when it is lethal); health
 *    regenerates only without damage for 5 s.
 * 5. Stage changes (`survivalStageChanged`): hungrig, durstig, müde, durchnässt, frierend …, ertrinkend.
 *
 * `damage()` applies instant damage (falls; later attacks) and `spendStamina()` the costs of actions.
 * Death at 0 health is the death system's (M3-26); the vitals system only reports it (`lethal`).
 * Global (no chunk state): the player is always in the active zone. Save participant `vitals`.
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import type { TemperatureStage } from '../../content/balance/survival';
import { NULL_ENTITY, isEntityHandle, type Entity } from '../../engine/ecs';
import { TILE_PX, type Layer } from '../../world/model/coords';
import { createDebugCheats, type DebugCheats } from '../cheats/state';
import type { PlayerComponents } from '../player/components';
import type { SaveParticipant } from '../participant';
import type { SimSystem, Simulation } from '../sim';
import type { MotionSystem } from '../systems/motion';
import { type SurvivalEnvironment, worldSurvivalEnvironment } from './environment';
import { BREATHING_STAGE, DROWNING_STAGE, type DamageCause, type SurvivalStat } from './events';
import {
  SWIMMING_WETNESS,
  STAT_MAX,
  clampStat,
  dehydrationDamagePerSecond,
  drowningDamagePerSecond,
  exhaustionGainPerSecond,
  exhaustionStage,
  healthRegenPerSecond,
  maxHealth,
  maxStamina,
  satietyDrainPerSecond,
  satietyStage,
  starvationDamagePerSecond,
  staminaRegenPerSecond,
  thirstDrainPerSecond,
  thirstStage,
  wetnessChangePerSecond,
  wetnessStage,
} from './formulas';
import type { PlayerInfluences } from './modifiers';
import { CONTINUOUS_DAMAGE_CAUSES, copyVitals, vitalsSchema, type ContinuousDamageCause, type Vitals } from './state';
import { comfortBand, feltTemperatureC, stageAtLeast, stepCoreTemperature, temperatureDamagePerSecond, temperatureStage, thermalStress, type ComfortBand } from './temperature';

/** Id of the vitals system and its save participant. */
export const VITALS_SYSTEM_ID = 'vitals';
/** Data version of the `vitals` participant. */
export const VITALS_SAVE_VERSION = 1;

const S = BALANCE.survival;
const TICK_HZ = BALANCE.time.tickHz;
/** Ticks after which the rest and damage-free counters stop counting (both thresholds lie below). */
const COUNTER_CAP_TICKS = Math.ceil(Math.max(S.stamina.regenDelaySeconds, S.health.regenDamageFreeSeconds) * TICK_HZ);

const vitalsSnapshotSchema = z
  .object({
    entity: z.number().int().refine((e) => e === NULL_ENTITY || isEntityHandle(e), { message: 'must be an entity handle or -1' }),
    vitals: vitalsSchema.nullable(),
  })
  .strict();

/** Dependencies of the vitals system. */
export interface VitalsSystemDeps {
  readonly components: PlayerComponents;
  readonly influences: PlayerInfluences;
  /** Owner of the shared `position` component. */
  readonly motion: MotionSystem;
  /** Surroundings (default: the simulation's world). */
  readonly environment?: SurvivalEnvironment;
  /** Debug cheats (`god`: no damage; src/game/cheats/state.ts); absent = every cheat off. */
  readonly cheats?: Readonly<DebugCheats>;
}

export class VitalsSystem implements SimSystem {
  readonly id = VITALS_SYSTEM_ID;
  readonly timeScope = 'global';
  readonly save: SaveParticipant;
  private readonly components: PlayerComponents;
  private readonly influences: PlayerInfluences;
  private readonly motion: MotionSystem;
  private readonly environment: SurvivalEnvironment;
  private readonly cheats: Readonly<DebugCheats>;
  private readonly band: ComfortBand = { low: 0, high: 0 };

  constructor(deps: VitalsSystemDeps) {
    this.components = deps.components;
    this.influences = deps.influences;
    this.motion = deps.motion;
    this.environment = deps.environment ?? worldSurvivalEnvironment();
    this.cheats = deps.cheats ?? createDebugCheats();
    this.save = {
      id: VITALS_SYSTEM_ID,
      version: VITALS_SAVE_VERSION,
      // The store holds at most the player's vitals (exactly one player, docs/SPIEL.md §3).
      serialize: () => {
        const store = this.components.vitals;
        return store.size === 0 ? { entity: NULL_ENTITY, vitals: null } : { entity: store.entityAt(0), vitals: copyVitals(store.valueAt(0)) };
      },
      deserialize: (data) => {
        const parsed = vitalsSnapshotSchema.safeParse(data);
        if (!parsed.success) throw new TypeError(`vitals snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        const store = this.components.vitals;
        store.clear();
        const { entity, vitals } = parsed.data;
        if ((entity === NULL_ENTITY) !== (vitals === null)) throw new TypeError('vitals snapshot: entity and vitals must be given together');
        if (vitals !== null) store.add(entity, copyVitals(vitals));
      },
    };
  }

  /** Vitals of the player, if there is one. */
  vitalsOf(sim: Simulation): Vitals | undefined {
    const e = sim.player;
    return e === NULL_ENTITY ? undefined : this.components.vitals.get(e);
  }

  /**
   * Instant damage to the player [HP] (falls; attacks later): health falls (not below 0), the 5 s of
   * §11.1 before regeneration start again, and `playerDamaged` reports it. Returns the damage dealt (none
   * in god mode).
   */
  damage(sim: Simulation, amount: number, cause: DamageCause): number {
    const e = sim.player;
    const v = e === NULL_ENTITY ? undefined : this.components.vitals.get(e);
    if (v === undefined || !(amount > 0) || this.cheats.god) return 0;
    const dealt = Math.min(amount, v.health);
    v.health -= dealt;
    v.damageFreeTicks = 0;
    sim.events.push('playerDamaged', { entity: e, cause, amount: dealt, health: v.health, lethal: v.health <= 0, tick: sim.eventTick });
    return dealt;
  }

  update(sim: Simulation, dt: number): void {
    const e = sim.player;
    if (e === NULL_ENTITY) return;
    const v = this.components.vitals.get(e);
    const body = this.components.body.get(e);
    const row = this.motion.position.indexOf(e);
    if (v === undefined || body === undefined || row < 0) return;
    const mods = this.influences.ensureFresh(sim, e);
    const x = this.motion.position.columns.x[row] as number;
    const y = this.motion.position.columns.y[row] as number;
    const layer = body.layer;
    const tx = Math.floor(x / TILE_PX);
    const ty = Math.floor(y / TILE_PX);

    // 1. Wetness first: it lowers the insulation of this tick's comfort band.
    v.heatC = this.influences.heatAt(sim, layer, x, y);
    if (body.swimming) v.wetness = SWIMMING_WETNESS;
    else {
      const rain = mods.indoors ? 0 : this.environment.rain(sim, layer, tx, ty);
      v.wetness = clampStat(v.wetness + wetnessChangePerSecond({ rain, nearFire: v.heatC > 0, indoors: mods.indoors }) * dt, STAT_MAX);
    }

    // 2. Temperature (§11.2).
    this.temperature(sim, v, mods.insulation, mods.cooling, mods.roomTemperatureC, layer, tx, ty, dt);
    const stage = temperatureStage(v.coreC);
    const coldStress = v.feltC < v.bandLowC;
    const heatStress = v.feltC > v.bandHighC;

    // 3. Satiety, thirst, exhaustion (§11.1).
    v.satiety = clampStat(v.satiety - satietyDrainPerSecond({ sprinting: body.state === 'sprint', exertion: mods.exertion, coldStress, sleeping: mods.sleeping }) * dt, STAT_MAX);
    v.thirst = clampStat(v.thirst - thirstDrainPerSecond(heatStress, stage) * dt, STAT_MAX);
    v.exhaustion = clampStat(v.exhaustion + exhaustionGainPerSecond(mods.sleeping) * dt, STAT_MAX);

    // 4. Maxima and stamina.
    v.maxHealth = maxHealth(mods.maxHealthBonus, mods.maxHealthFactor);
    v.maxStamina = maxStamina(mods.maxStaminaBonus, mods.maxStaminaFactor, stage);
    const regen = staminaRegenPerSecond({ satiety: v.satiety, exhaustion: v.exhaustion, temperature: stage, restSeconds: v.staminaRestTicks / TICK_HZ, factor: mods.staminaRegenFactor });
    v.stamina = clampStat(v.stamina + regen * dt, v.maxStamina);
    if (v.staminaRestTicks < COUNTER_CAP_TICKS) v.staminaRestTicks++;
    if (v.sprintLocked && v.stamina >= S.stamina.sprintResumeStamina) v.sprintLocked = false;

    // 5. Damage over time and health (a player at 0 health is the death system's, M3-26: no damage, no regeneration).
    if (v.health > 0) {
      const drowning = drowningDamagePerSecond(body.swimming, v.stamina);
      const temp = temperatureDamagePerSecond(stage);
      const cold = stageAtLeast(stage, 'frierend') ? temp : 0;
      const heat = cold > 0 ? 0 : temp;
      const hurt = this.addDamage(v, 'hunger', starvationDamagePerSecond(v.satiety) * dt) + this.addDamage(v, 'durst', dehydrationDamagePerSecond(v.thirst) * dt) + this.addDamage(v, 'ertrinken', drowning * dt) + this.addDamage(v, 'kaelte', cold * dt) + this.addDamage(v, 'hitze', heat * dt);
      if (hurt > 0) {
        v.health = Math.max(0, v.health - hurt);
        v.damageFreeTicks = 0;
      } else {
        v.health += healthRegenPerSecond({ satiety: v.satiety, thirst: v.thirst, damageFreeSeconds: v.damageFreeTicks / TICK_HZ, resting: mods.resting, factor: mods.healthRegenFactor }) * dt;
        if (v.damageFreeTicks < COUNTER_CAP_TICKS) v.damageFreeTicks++;
      }
      v.health = clampStat(v.health, v.maxHealth);
      // Lethal damage over time is reported at once, not at the next world tick.
      if (v.health <= 0) this.reportDamage(sim, e, v);
    }

    // 6. Stages.
    this.stages(sim, e, v, stage, body.swimming && v.stamina <= 0);
  }

  /** Reports the damage over time of the last second, per cause. */
  worldTick(sim: Simulation): void {
    const e = sim.player;
    if (e === NULL_ENTITY) return;
    const v = this.components.vitals.get(e);
    if (v !== undefined) this.reportDamage(sim, e, v);
  }

  /** Temperature model of this tick into `v` (§11.2); the heat of the sources is already in `v.heatC`. */
  private temperature(sim: Simulation, v: Vitals, insulation: number, cooling: number, roomC: number, layer: Layer, tx: number, ty: number, dt: number): void {
    v.ambientC = this.environment.ambientC(sim, layer, tx, ty);
    v.roomC = roomC;
    v.feltC = feltTemperatureC(v.ambientC, v.heatC, v.roomC);
    const band = comfortBand(insulation, cooling, v.wetness, this.band);
    v.bandLowC = band.low;
    v.bandHighC = band.high;
    const before = v.coreC;
    v.coreC = stepCoreTemperature(before, thermalStress(v.feltC, band.low, band.high), dt);
    v.coreRateCps = (v.coreC - before) / dt;
  }

  /** Books damage over time of one cause; returns it. */
  private addDamage(v: Vitals, cause: ContinuousDamageCause, amount: number): number {
    if (amount <= 0 || this.cheats.god) return 0;
    v.pendingDamage[cause] += amount;
    return amount;
  }

  /** Reports and clears the booked damage over time. */
  private reportDamage(sim: Simulation, e: Entity, v: Vitals): void {
    for (const cause of CONTINUOUS_DAMAGE_CAUSES) {
      const amount = v.pendingDamage[cause];
      if (amount <= 0) continue;
      v.pendingDamage[cause] = 0;
      sim.events.push('playerDamaged', { entity: e, cause, amount, health: v.health, lethal: v.health <= 0, tick: sim.eventTick });
    }
  }

  /** Updates the stages and reports every change. */
  private stages(sim: Simulation, e: Entity, v: Vitals, temperature: TemperatureStage, drowning: boolean): void {
    const satiety = satietyStage(v.satiety);
    if (satiety !== v.satietyStage) this.stageChanged(sim, e, 'satiety', satiety, v.satietyStage);
    v.satietyStage = satiety;
    const thirst = thirstStage(v.thirst);
    if (thirst !== v.thirstStage) this.stageChanged(sim, e, 'thirst', thirst, v.thirstStage);
    v.thirstStage = thirst;
    const exhaustion = exhaustionStage(v.exhaustion);
    if (exhaustion !== v.exhaustionStage) this.stageChanged(sim, e, 'exhaustion', exhaustion, v.exhaustionStage);
    v.exhaustionStage = exhaustion;
    const wetness = wetnessStage(v.wetness);
    if (wetness !== v.wetnessStage) this.stageChanged(sim, e, 'wetness', wetness, v.wetnessStage);
    v.wetnessStage = wetness;
    if (temperature !== v.temperatureStage) this.stageChanged(sim, e, 'temperature', temperature, v.temperatureStage);
    v.temperatureStage = temperature;
    if (drowning !== v.drowning) this.stageChanged(sim, e, 'drowning', drowning ? DROWNING_STAGE : BREATHING_STAGE, drowning ? BREATHING_STAGE : DROWNING_STAGE);
    v.drowning = drowning;
  }

  private stageChanged(sim: Simulation, e: Entity, stat: SurvivalStat, stage: string, previous: string): void {
    sim.events.push('survivalStageChanged', { entity: e, stat, stage, previous, tick: sim.eventTick });
  }
}

/** Spends `amount` stamina of `v` (not below 0) and restarts the pause before regeneration (§11.1 "nach 0,8 s Pause"). */
export function spendStamina(v: Vitals, amount: number): void {
  if (!(amount > 0)) return;
  v.stamina = Math.max(0, v.stamina - amount);
  v.staminaRestTicks = 0;
}

