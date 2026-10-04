/**
 * The armour a blow on the player meets (M6-33 "Treffer je Material"): `hitLanded` names the player's body as flesh; the
 * clang or slap of what it wears comes from the piece on its chest – its weight class (§11.4, `ruestungsgewicht`) says
 * metal plates, hardened leather or cloth. Read from the equipment like the renderer reads it
 * (src/audio/eventMap.ts `EventSfxContext.playerArmour`).
 */
import type { ArmorWeightClass } from '../content/schema/item';
import { EquipmentSystem } from '../game/equipment/system';
import type { Simulation } from '../game/sim';

/** Finds the weight class of the player's chest armour (the equipment system is looked up once per simulation). */
export class ArmourProbe {
  private sim: Simulation | null = null;
  private equipment: EquipmentSystem | null = null;

  /** Weight class of the armour worn on the chest, or null when the chest is bare (or the piece is not armour). */
  chestOf(sim: Simulation): ArmorWeightClass | null {
    if (this.sim !== sim) {
      this.sim = sim;
      this.equipment = null;
      for (const s of sim.systems) if (s instanceof EquipmentSystem) this.equipment = s;
    }
    const e = this.equipment;
    const worn = e?.worn('brust') ?? null;
    if (e === null || worn === null) return null;
    return e.bags.catalog.find(worn.item)?.ruestungsgewicht ?? null;
  }
}
