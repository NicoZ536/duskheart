/**
 * Der Erfolg „Gewölbe bezwungen“ ist erreichbar (M7-100; docs/SPIEL.md §19, §23, §29; ADR-0263): auf dem echten Weg eines Gewölbes
 * – hinabsteigen, die Wächter samt Mini-Boss besiegen, die Truhen öffnen – meldet das Gewölbe `vaultCompleted` (erst wenn der
 * Mini-Boss gefallen und die Endtruhe offen ist), die Quelle `gewoelbe_abgeschlossen_gewoelbe` zählt die Statistik
 * `gewoelbe_abgeschlossen`, und der Erfolg `gewoelbe_bezwungen` schaltet frei; jedes gelöste Rätsel zählt `raetsel_geloest` je
 * Rätselart.
 */
import { describe, expect, it } from 'vitest';
import { AchievementsSystem } from '../../../src/game/achievements/system';
import { StatsSystem } from '../../../src/game/stats/system';
import { SimTriggerWorld } from '../../../src/game/triggers/world';
import { TILE_PX } from '../../../src/world/model/coords';
import { gewoelbeWelt, VAULT_SLOT, type GewoelbeWelt } from './gewoelbe-testwelt';

function events<T>(map: Map<string, unknown[]>, type: string): T[] {
  return (map.get(type) ?? []) as T[];
}

/** The vault world with the observers of the chronicle (statistics, achievements) on one trigger world. */
function welt(): { w: GewoelbeWelt; stats: StatsSystem; ach: AchievementsSystem } {
  const w = gewoelbeWelt();
  const world = new SimTriggerWorld();
  const stats = w.sim.addSystem(new StatsSystem({ world }));
  const ach = w.sim.addSystem(new AchievementsSystem({ world }));
  return { w, stats, ach };
}

/** Kills every guard of the vault where it stands (the debug kill around the player, as the console's `kill`). */
function killGuards(w: GewoelbeWelt): Map<string, unknown[]>[] {
  const out: Map<string, unknown[]>[] = [];
  const p = { x: 0, y: 0 };
  for (let round = 0; round < 40; round++) {
    let target: { x: number; y: number } | null = null;
    for (let i = 0; i < w.creatures.store.size && target === null; i++) {
      const s = w.creatures.store.valueAt(i);
      if (s.health > 0 && s.besitzer === `gewoelbe:${VAULT_SLOT}` && w.creatures.positionOf(w.creatures.store.entityAt(i), p)) target = { x: p.x, y: p.y };
    }
    if (target === null) break;
    w.goToTile(Math.floor(target.x / TILE_PX), Math.floor(target.y / TILE_PX) + 1);
    out.push(w.run(1, [{ type: 'creature.kill', radius: 2 }]));
  }
  return out;
}

describe('Erfolg „Gewölbe bezwungen“ (M7-100)', () => {
  it('Mini-Boss besiegt und Endtruhe offen → vaultCompleted → Statistik → Erfolg; vorher nicht', () => {
    const { w, stats, ach } = welt();
    expect(w.plan.guards.some((g) => g.boss)).toBe(true);
    w.goToTile(w.plan.entrance.tx, w.plan.entrance.ty + 1, 0);
    w.run(1, [{ type: 'vault.enter', vault: VAULT_SLOT }]);
    // The chests first: the end chest open without the mini-boss defeated completes nothing.
    let completed = 0;
    for (const c of w.plan.chests) {
      if (c.mimic) continue;
      completed += events(w.useAt(c.tx, c.ty), 'vaultCompleted').length;
    }
    expect(completed).toBe(0);
    expect(stats.value('gewoelbe_abgeschlossen')).toBe(0);
    expect(ach.has('gewoelbe_bezwungen')).toBe(false);
    // The guards fall, the mini-boss among them: now the vault is conquered – once.
    const kills = killGuards(w);
    const done = kills.flatMap((ev) => events<{ vault: number; biome: string }>(ev, 'vaultCompleted'));
    expect(done).toEqual([expect.objectContaining({ vault: VAULT_SLOT, biome: 'gruenhain' })]);
    w.run(2);
    expect(stats.value('gewoelbe_abgeschlossen')).toBe(1);
    expect(ach.has('gewoelbe_bezwungen')).toBe(true);
    // Never twice.
    w.run(120);
    expect(stats.value('gewoelbe_abgeschlossen')).toBe(1);
    expect(ach.unlocked().filter((a) => a.id === 'gewoelbe_bezwungen')).toHaveLength(1);
  });

  it('jedes gelöste Rätsel zählt `raetsel_geloest` je Rätselart', () => {
    const { w, stats } = welt();
    w.goToTile(w.plan.entrance.tx, w.plan.entrance.ty + 1, 0);
    w.run(1, [{ type: 'vault.enter', vault: VAULT_SLOT }]);
    const solved = w.run(1, [{ type: 'vault.solve', vault: VAULT_SLOT }]);
    const types = events<{ typ: string }>(solved, 'puzzleSolved').map((p) => p.typ);
    expect(types.length).toBe(w.plan.puzzles.length);
    w.run(1);
    expect(stats.value('raetsel_geloest')).toBe(types.length);
    for (const t of new Set(types)) expect(stats.value('raetsel_geloest', t)).toBe(types.filter((x) => x === t).length);
  });
});
