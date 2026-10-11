/**
 * Save roundtrip of the participant `stats` (M7-47, docs/SPIEL.md §27 "Zähler/Meilensteine"): counters with their keys, the
 * milestones reached, the counters of those still waiting and the last position of the walked distance survive save → load;
 * saves before M7 load with everything at 0; bad data is refused.
 */
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../../src/game/setup';
import { StatsSystem } from '../../../../src/game/stats/system';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { chronikWelt, steps, type Feeder } from '../../game/chronik-testwelt';
import type { Simulation } from '../../../../src/game/sim';

function world(): { sim: Simulation; feeder: Feeder; stats: StatsSystem } {
  const w = chronikWelt();
  w.sim.setPlayer(5);
  const at = { x: 32, y: 48 };
  const stats = w.sim.addSystem(new StatsSystem({ world: w.world, playerAt: (_s, out) => ((out.x = at.x), (out.y = at.y), (out.layer = 0), true) }));
  return { sim: w.sim, feeder: w.feeder, stats };
}

describe('save roundtrip: stats', () => {
  it('restores counters per key, milestones, waiting counters and the last position', () => {
    const report = expectRoundtrip(
      world,
      (w) => {
        w.feeder.push(
          ['creatureDied', { entity: 1, creature: 'wolf', by: 5, carcass: 0, loot: true, facing: 0, variant: -1, layer: 0, x: 0, y: 0 }],
          ['craftCompleted', { recipe: 'rezept_steinaxt', item: 'steinaxt', count: 1 }],
          ['beaconLit', { beacon: 1, biome: 'gruenhain', x: 0, y: 0 }],
        );
        steps(w.sim, 61);
      },
      (w) => w.stats.save,
    );
    expect(report.id).toBe('stats');
    const data = JSON.parse(report.canonical) as { werte: Record<string, { summe: number; schluessel?: Record<string, number> }>; meilensteine: Record<string, number>; letzte: unknown };
    expect(data.werte.kills).toEqual({ summe: 1, schluessel: { wolf: 1 } });
    expect(data.werte.spielzeit?.summe).toBe(61);
    expect(Object.keys(data.meilensteine).sort()).toEqual(['m_lf1', 'm_steinaxt']);
    expect(data.letzte).toEqual({ x: 32, y: 48, layer: 0 });
  });

  it('the game simulation has the participant; saves before M7 migrate to nothing; bad data is refused', () => {
    const sim = createSimulation({ seed: 3 });
    expect(sim.participant('stats').migrations?.find((m) => m.from === 0)?.migrate(undefined)).toEqual({ werte: {}, meilensteine: {}, wartend: {}, letzte: null });
    const w = world();
    expect(() => w.stats.save.deserialize({ werte: { erfunden: { summe: 1 } }, meilensteine: {}, wartend: {}, letzte: null })).toThrow(/unknown statistic/);
    expect(() => w.stats.save.deserialize({ werte: {}, meilensteine: { m_nie: 3 }, wartend: {}, letzte: null })).toThrow(/unknown milestone/);
    expect(() => w.stats.save.deserialize({ werte: { kills: { summe: -1 } }, meilensteine: {}, wartend: {}, letzte: null })).toThrow(/stats snapshot invalid/);
  });
});
