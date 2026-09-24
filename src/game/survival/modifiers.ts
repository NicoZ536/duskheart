/**
 * What other systems contribute to the player's movement and survival (docs/SPIEL.md §3; MASTERPROMPT
 * §11.1, §11.2, §11.4, §16.4): equipment (armour weight, insulation, cooling, maximum bonuses),
 * conditions (speed and regeneration factors: Knochenbruch, Ausgeruht, Erschüttert …), resting and
 * sleeping, rooms (room value, roof) and heat sources (fires, ovens).
 *
 * `PlayerInfluences` is the hub: a system registers a *modifier source* (it adjusts the neutral record
 * once per tick) or a *heat source provider* (it lists its heat sources) in `createSimulation`
 * (src/game/setup.ts). The player system refreshes the record at the start of its update; player and
 * vitals system read it in the same tick. Without sources the record is the neutral one – exactly the
 * state of a player without armour, clothing, conditions, room or fire – so the systems work before
 * equipment, conditions, sleep, rooms and fires exist and need no change when they arrive.
 */
import { BALANCE } from '../../content/balance';
import type { ArmorWeight } from '../../content/balance/player';
import { NULL_ENTITY, type Entity } from '../../engine/ecs';
import type { Layer } from '../../world/model/coords';
import type { Simulation } from '../sim';
import { clampCooling, clampInsulation, heatSourceC } from './temperature';

/** The player's modifiers of one tick (neutral: `createPlayerModifiers()`). */
export interface PlayerModifiers {
  /** Weight class of the worn armour (§11.4 "leicht 0 %, mittel −5 %, schwer −10 % Tempo"). */
  armorWeight: ArmorWeight;
  /** Clothing insulation 0–40 [°C] (§11.2); clamped after all sources ran. */
  insulation: number;
  /** Clothing cooling 0–15 [°C] (§11.2); clamped after all sources ran. */
  cooling: number;
  /** Extra maximum health [HP] (heart splinters, equipment, meals, §11.1). */
  maxHealthBonus: number;
  /** Factor on the maximum health (Erschüttert 0,85, §11.6). */
  maxHealthFactor: number;
  /** Extra maximum stamina [points] (Glutsplitter, §11.1). */
  maxStaminaBonus: number;
  /** Factor on the maximum stamina (Ausgeruht 1,1, §11.5). */
  maxStaminaFactor: number;
  /** Factor on the health regeneration. */
  healthRegenFactor: number;
  /** Factor on the stamina regeneration (Ausgeruht 1,25, §11.5). */
  staminaRegenFactor: number;
  /** Factor on every movement speed (Knochenbruch 0,6, Verlangsamt, §11.3). */
  moveSpeedFactor: number;
  /** Sitting at a fire or lying in a bed (§11.1 "×2 sitzend am Feuer oder im Bett"). */
  resting: boolean;
  /** Asleep (§11.1 satiety ×0,5, no exhaustion gain; §11.5). */
  sleeping: boolean;
  /** Fighting or mining this tick (§11.1 satiety ×1,25). */
  exertion: boolean;
  /** Under a roof (§16.4: no precipitation; §11.1 dries at 0,2 %/s). */
  indoors: boolean;
  /** Room value of §16.4 added to the felt temperature [°C]. */
  roomTemperatureC: number;
}

/** A neutral modifier record. */
export function createPlayerModifiers(): PlayerModifiers {
  const m = {} as PlayerModifiers;
  resetPlayerModifiers(m);
  return m;
}

/** Resets `m` to the neutral values (no armour, clothing, condition, room or rest). */
export function resetPlayerModifiers(m: PlayerModifiers): void {
  m.armorWeight = 'leicht';
  m.insulation = 0;
  m.cooling = 0;
  m.maxHealthBonus = 0;
  m.maxHealthFactor = 1;
  m.maxStaminaBonus = 0;
  m.maxStaminaFactor = 1;
  m.healthRegenFactor = 1;
  m.staminaRegenFactor = 1;
  m.moveSpeedFactor = 1;
  m.resting = false;
  m.sleeping = false;
  m.exertion = false;
  m.indoors = false;
  m.roomTemperatureC = 0;
}

/** Adjusts the modifier record of `player` for this tick (read-only on the simulation). */
export type PlayerModifierSource = (sim: Simulation, player: Entity, out: PlayerModifiers) => void;

/** Insulation of the castaway's own clothes [°C] (`BALANCE.survival.temperature.ownClothing`: linen tunic and trousers). */
export const OWN_CLOTHING_INSULATION_C = BALANCE.survival.temperature.ownClothing.tunicInsulationC + BALANCE.survival.temperature.ownClothing.trousersInsulationC;

/**
 * The castaway's own clothes (§8, §11.2 "Kleidung liefert Isolation"): the linen tunic and trousers the
 * player always wears under armour add their insulation. Registered first in `createSimulation`, so worn
 * equipment adds on top (and the clamp to 0–40 °C applies to the sum).
 */
export function ownClothingModifierSource(): PlayerModifierSource {
  return (_sim, _player, out) => {
    out.insulation += OWN_CLOTHING_INSULATION_C;
  };
}

/** A heat source (§11.2): full `coreHeatC` within `coreRadiusPx` of (x, y), linearly less to 0 at `radiusPx`. */
export interface HeatSource {
  readonly x: number;
  readonly y: number;
  readonly layer: Layer;
  readonly coreHeatC: number;
  readonly coreRadiusPx: number;
  readonly radiusPx: number;
}

/** Lists the heat sources a system owns (its own records; read-only for the caller). */
export type HeatSourceProvider = (sim: Simulation) => readonly HeatSource[];

/** Registry of the player's modifier sources and heat source providers (see module comment). */
export class PlayerInfluences {
  /** The modifiers of the current tick (refreshed by the player system at the start of its update). */
  readonly current: PlayerModifiers = createPlayerModifiers();
  private readonly sources: PlayerModifierSource[] = [];
  private readonly heatProviders: HeatSourceProvider[] = [];
  /** Tick and player `current` was computed for (−1: never). */
  private refreshedTick = -1;
  private refreshedFor: Entity = NULL_ENTITY;

  /** Adds a modifier source (applied in registration order). */
  addModifierSource(source: PlayerModifierSource): void {
    this.sources.push(source);
  }

  /** Adds a heat source provider. */
  addHeatSources(provider: HeatSourceProvider): void {
    this.heatProviders.push(provider);
  }

  /** Recomputes `current` for `player`: neutral values, every source in order, insulation and cooling clamped. Returns `current`. */
  refresh(sim: Simulation, player: Entity): PlayerModifiers {
    const m = this.current;
    resetPlayerModifiers(m);
    for (let i = 0; i < this.sources.length; i++) (this.sources[i] as PlayerModifierSource)(sim, player, m);
    m.insulation = clampInsulation(m.insulation);
    m.cooling = clampCooling(m.cooling);
    this.refreshedTick = sim.tick;
    this.refreshedFor = player;
    return m;
  }

  /** `current` for `player` in this tick: refreshed unless that already happened in this tick. */
  ensureFresh(sim: Simulation, player: Entity): PlayerModifiers {
    return this.refreshedTick === sim.tick && this.refreshedFor === player ? this.current : this.refresh(sim, player);
  }

  /**
   * Warmth at world px (x, y) on `layer` [°C]: the warmest heat source there (standing between two fires
   * does not add them up, it is as warm as the nearer one).
   */
  heatAt(sim: Simulation, layer: Layer, x: number, y: number): number {
    let best = 0;
    for (let p = 0; p < this.heatProviders.length; p++) {
      const list = (this.heatProviders[p] as HeatSourceProvider)(sim);
      for (let i = 0; i < list.length; i++) {
        const s = list[i] as HeatSource;
        if (s.layer !== layer) continue;
        const dx = s.x - x;
        const dy = s.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= s.radiusPx * s.radiusPx) continue;
        const heat = heatSourceC(Math.sqrt(d2), s.coreHeatC, s.coreRadiusPx, s.radiusPx);
        if (heat > best) best = heat;
      }
    }
    return best;
  }
}
