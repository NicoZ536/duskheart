/**
 * The health a heart shard fills at once (MASTERPROMPT §20.2 "Herzsplitter (+10 max. Leben)"; M7-32): the player's
 * modifiers are read anew – the shard just used already counts – so the maximum grows before the health is added, and a
 * full player stays full at the new maximum. Nothing for a dead player (the death screen's respawn sets the health).
 */
import { NULL_ENTITY } from '../../engine/ecs';
import type { PlayerComponents } from '../player/components';
import type { Simulation } from '../sim';
import { maxHealth } from '../survival/formulas';
import type { PlayerInfluences } from '../survival/modifiers';

/** A `ShardsSystemDeps.heal` over the player's vitals and modifiers. */
export function vitalsHealer(components: Pick<PlayerComponents, 'vitals'>, influences: Pick<PlayerInfluences, 'refresh'>): (sim: Simulation, amount: number) => void {
  return (sim, amount) => {
    const e = sim.player;
    if (e === NULL_ENTITY) return;
    const v = components.vitals.get(e);
    if (v === undefined || v.health <= 0) return;
    const mods = influences.refresh(sim, e);
    v.maxHealth = maxHealth(mods.maxHealthBonus, mods.maxHealthFactor);
    v.health = Math.min(v.maxHealth, v.health + amount);
  };
}
