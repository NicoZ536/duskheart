/**
 * The Lumen lantern (M7-36; MASTERPROMPT §12.2 "Lumen-Laterne | 8 | Lumen-Ladung | Schattenbrut im Umkreis 2 Tiles erleidet
 * 5 Schaden/s", §12.4 "saugt Lumen-Ladungen ab"; docs/SPIEL.md §22 "Lumen-Laterne"): carried in the off hand, switched on it
 * loads a shard from the bags (refused without one), it lights eight tiles, rain does not reach it, a charge lasts
 * `hoursPerShard` game hours and the next shard loads by itself – without one it goes dark and stays in the hand; its aura
 * burns shadow brood once a world second; the light eater drains it. A new lantern comes charged: its recipe holds the shard.
 * On the light test world (licht-testwelt.ts).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { lightKind } from '../../../src/content/lights';
import { NULL_ENTITY, type Entity } from '../../../src/engine/ecs';
import { createCombatAttack, type CombatAttack } from '../../../src/game/combat/system';
import type { CombatTargetProvider, CombatantView } from '../../../src/game/combat/targets';
import { equipmentRef } from '../../../src/game/items/slots';
import { creatureLumenAura, lumenChargeTicks } from '../../../src/game/light/lumen';
import type { Simulation } from '../../../src/game/sim';
import { TILE_PX, type Layer } from '../../../src/world/model/coords';
import { eventsOf } from './kampf-testwelt';
import { lightWorld, type LightWorld } from './licht-testwelt';
import { meadow } from './spieler-testwelt';

const L = BALANCE.light.lumen;

/** A lantern in the off hand, `shards` Lumen shards in the bags. */
function world(shards: number): LightWorld {
  const w = lightWorld(meadow(30, 20));
  w.spawn(10, 10);
  w.give('lumen_laterne', 1);
  if (shards > 0) w.give('lumen_scherbe', shards);
  w.step(1, [{ type: 'inventory.move', from: w.slotOf('lumen_laterne'), to: equipmentRef('nebenhand') }]);
  return w;
}

describe('Lumen-Laterne', () => {
  it('Lichtart: getragen, Verhalten lumen, Radius 8, Farbe aus der Palette; die Ladung hält hoursPerShard Spielstunden', () => {
    const k = lightKind('lumen_laterne');
    expect(k).toMatchObject({ verhalten: 'lumen', getragen: true, gegenstand: 'lumen_laterne' });
    expect(L.radiusTiles).toBe(8);
    expect(lumenChargeTicks(100)).toBe(Math.round(L.hoursPerShard * 100));
  });

  it('neu geladen; leer ohne Scherbe abgelehnt (noLumen); mit Scherbe lädt sie, die Scherbe ist fort, sie leuchtet 8 Kacheln weit', () => {
    const w = world(0);
    w.step(1, [{ type: 'light.toggle' }]);
    expect(eventsOf(w.last, 'lightIgnited')).toHaveLength(1);
    expect(eventsOf(w.last, 'lumenCharged')).toHaveLength(0);
    // Drained empty (the light eater), switched off: switching on again needs a shard.
    const p = w.pos();
    w.light.drainLumenNear(w.sim, 0, p.x, p.y, TILE_PX, 1);
    w.step(1);
    w.step(1, [{ type: 'light.toggle' }]);
    expect(eventsOf<{ reason: string }>(w.last, 'commandRejected').map((r) => r.reason)).toEqual(['noLumen']);
    w.give('lumen_scherbe', 1);
    w.step(1, [{ type: 'light.toggle' }]);
    expect(eventsOf(w.last, 'lumenCharged')).toEqual([expect.objectContaining({ item: 'lumen_laterne', charges: 1 })]);
    expect(eventsOf(w.last, 'lightIgnited')).toHaveLength(1);
    expect(w.inventory.count('lumen_scherbe')).toBe(0);
    expect(w.light.state.carried?.burn.lit).toBe(true);
    const carried = w.light.sources(w.sim).find((l) => l.kind === 'lumen_laterne');
    expect(carried?.radius).toBe(L.radiusTiles * TILE_PX);
    expect(carried?.farbe).toBe(L.farbe);
  });

  it('Regen löscht sie nicht; leer lädt sie die nächste Scherbe selbst, ohne Scherbe erlischt sie und bleibt in der Hand', () => {
    const w = world(1);
    w.step(1, [{ type: 'light.toggle' }]);
    w.lenv.precipitation = 1;
    w.step(3 * BALANCE.time.tickHz);
    expect(w.light.state.carried?.burn.lit).toBe(true);
    const charge = lumenChargeTicks(w.sim.clock.ticksPerGameHour);
    w.step(charge);
    expect(w.inventory.count('lumen_scherbe')).toBe(0);
    expect(w.light.state.carried?.burn.lit).toBe(true);
    w.step(charge);
    expect(w.light.state.carried?.burn.lit).toBe(false);
    expect(w.light.state.carried?.item).toBe('lumen_laterne');
  });

  it('der Lichtfresser saugt Ladung: eine Scherbe weniger, leer geht sie aus (Grund lichtfresser)', () => {
    const w = world(1);
    w.step(1, [{ type: 'light.toggle' }]);
    const p = w.pos();
    expect(w.light.drainLumenNear(w.sim, 0, p.x + 200, p.y, 4 * TILE_PX, 1)).toBe(0);
    expect(w.light.drainLumenNear(w.sim, 0, p.x + 20, p.y, 4 * TILE_PX, 1)).toBe(1);
    // The lantern came charged, the shard in the bags stays there: one drain empties the charge.
    const ev = w.step(1);
    expect(w.light.state.carried?.burn.lit).toBe(false);
    expect(eventsOf<{ reason: string }>(ev, 'lightExtinguished').map((e) => e.reason)).toEqual(['lichtfresser']);
    expect(w.inventory.count('lumen_scherbe')).toBe(1);
    w.step(1, [{ type: 'light.toggle' }]);
    expect(w.light.state.carried?.burn.lit).toBe(true);
  });

  it('Aura: einmal je Weltsekunde 5 Schaden im Umkreis von 2 Kacheln, solange sie leuchtet', () => {
    const w = world(1);
    const calls: { r: number; dmg: number }[] = [];
    w.light.useLumenAura((_s, _layer, _x, _y, r, dmg) => calls.push({ r, dmg }));
    w.step(2 * BALANCE.time.tickHz);
    expect(calls).toHaveLength(0);
    w.step(1, [{ type: 'light.toggle' }]);
    w.step(3 * BALANCE.time.tickHz);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.length).toBeLessThanOrEqual(4);
    expect(calls[0]).toEqual({ r: L.auraRadiusTiles * TILE_PX, dmg: L.auraDamagePerSecond });
  });

  it('die Aura über den Kampf-Anbieter: nur Schattenbrut im Kreis, Schadensart licht, nicht blockbar, nie kritisch', () => {
    const bodies = [
      { e: 11 as Entity, team: 'schattenbrut', x: 10, y: 0 },
      { e: 12 as Entity, team: 'tier', x: 5, y: 0 },
      { e: 13 as Entity, team: 'schattenbrut', x: 100, y: 0 },
    ] as const;
    const provider: CombatTargetProvider = {
      id: 'probe',
      queryCircle: (_s: Simulation, _l: Layer, x: number, y: number, r: number, out: Entity[]) => {
        for (const b of bodies) if (Math.hypot(b.x - x, b.y - y) <= r) out.push(b.e);
      },
      view: (_s: Simulation, e: Entity, out: CombatantView) => {
        const b = bodies.find((x) => x.e === e);
        if (b === undefined) return false;
        out.team = b.team;
        out.health = 10;
        return true;
      },
      aware: () => true,
      applyHit: () => undefined,
    };
    const hits: { target: Entity; a: CombatAttack }[] = [];
    const combat = {
      resolve: (_s: Simulation, attacker: Entity, target: Entity, a: CombatAttack) => {
        expect(attacker).toBe(NULL_ENTITY);
        hits.push({ target, a: { ...a } });
        return null;
      },
    };
    creatureLumenAura(combat, provider)({} as Simulation, 0, 0, 0, 2 * TILE_PX, 5);
    expect(hits.map((h) => h.target)).toEqual([11]);
    expect(hits[0]?.a).toMatchObject({ ...createCombatAttack(), type: 'licht', damage: 5, critChance: 0, blockable: false, kind: 'fernkampf', wucht: 1 });
  });
});
