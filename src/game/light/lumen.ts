/**
 * The Lumen lantern's numbers and its aura (MASTERPROMPT §12.2 "Lumen-Laterne … Lumen-Ladung … Schattenbrut im Umkreis von
 * 2 Tiles erleidet 5 Schaden/s"; docs/SPIEL.md §22 "Lumen-Laterne (Lichtart `lumen_laterne`, Verhalten `lumen`) … Aura:
 * Schattenbrut im Umkreis 2 Kacheln nimmt 5 Schaden/s (Schadensart `licht`, über den Kampf-Anbieter `kreaturen`)"; M7-36).
 *
 * The light system (src/game/light/system.ts) keeps the charge like a torch's burn time and calls the aura once per world
 * second while the lantern glows; `creatureLumenAura` turns that into hits: every shadow brood body of the creatures'
 * combat provider within the radius takes one hit of `licht` through `CombatSystem.resolve` – the creature's resistances and
 * armour apply, the hit flashes and counts like any other, nobody's skill is trained by it (no attacker body).
 */
import { BALANCE } from '../../content/balance';
import { NULL_ENTITY, type Entity } from '../../engine/ecs';
import type { Layer } from '../../world/model/coords';
import { createCombatAttack, type CombatSystem } from '../combat/system';
import type { CombatantView, CombatTargetProvider } from '../combat/targets';
import type { Simulation } from '../sim';

/** One charge of a Lumen light [ticks] in a world whose game hour lasts `ticksPerGameHour` ticks (one Lumen shard). */
export function lumenChargeTicks(ticksPerGameHour: number): number {
  return Math.round(BALANCE.light.lumen.hoursPerShard * ticksPerGameHour);
}

/** The aura of a glowing Lumen lantern: hit the shadow brood within `radiusPx` of (x, y) on `layer` for `damage` [HP]. */
export type LumenAura = (sim: Simulation, layer: Layer, x: number, y: number, radiusPx: number, damage: number) => void;

/** Team of the creatures the aura burns (§12.2 "Schattenbrut"). */
const SHADOW_TEAM = 'schattenbrut';

/**
 * The aura over the creatures' combat provider (`kreaturen`): one hit of `licht` per shadow brood body in reach, from the
 * player's side, not blockable, never critical, no impact beyond the lightest (a flash, no knockback worth the name).
 */
export function creatureLumenAura(combat: Pick<CombatSystem, 'resolve'>, creatures: CombatTargetProvider): LumenAura {
  const found: Entity[] = [];
  const view: CombatantView = {
    entity: NULL_ENTITY,
    team: 'tier',
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
  const attack = createCombatAttack();
  attack.type = 'licht';
  attack.wucht = 1;
  attack.critChance = 0;
  attack.blockable = false;
  attack.kind = 'fernkampf';
  return (sim, layer, x, y, radiusPx, damage) => {
    found.length = 0;
    creatures.queryCircle(sim, layer, x, y, radiusPx, found);
    attack.damage = damage;
    attack.fromX = x;
    attack.fromY = y;
    for (let i = 0; i < found.length; i++) {
      const e = found[i] as Entity;
      if (!creatures.view(sim, e, view) || view.team !== SHADOW_TEAM || view.health <= 0) continue;
      combat.resolve(sim, NULL_ENTITY, e, attack);
    }
  };
}
