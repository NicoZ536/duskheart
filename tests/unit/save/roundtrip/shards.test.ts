/**
 * Save roundtrip of the participant `shards` (M7-32, docs/SPIEL.md §22, §27): the shards used per kind survive save → load
 * (and with them the maximum health and stamina they give); saves before M7 load with none used.
 */
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../../src/game/setup';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { leuchtfeuerWelt, type LeuchtfeuerWelt } from '../../game/leuchtfeuer-testwelt';

function world(): LeuchtfeuerWelt {
  return leuchtfeuerWelt();
}

describe('save roundtrip: shards', () => {
  it('restores the used shards; the loaded player has the same maximum health', () => {
    const report = expectRoundtrip(world, (w) => w.shards.save.deserialize({ herz: 2, glut: 1 }), (w) => w.shards.save);
    expect(report.id).toBe('shards');
    expect(JSON.parse(report.canonical)).toEqual({ herz: 2, glut: 1 });
    const w = world();
    w.run(1);
    const base = w.vit().maxHealth;
    w.shards.save.deserialize({ herz: 2, glut: 0 });
    w.run(1);
    expect(w.vit().maxHealth).toBe(base + 20);
  });

  it('the game simulation has the participant (none used); saves before M7 migrate; bad data is refused', () => {
    const sim = createSimulation({ seed: 3 });
    expect(sim.participant('shards').serialize()).toEqual({ herz: 0, glut: 0 });
    expect(sim.participant('shards').migrations?.find((m) => m.from === 0)?.migrate(undefined)).toEqual({ herz: 0, glut: 0 });
    const w = world();
    expect(() => w.shards.save.deserialize({ herz: 1.5, glut: 0 })).toThrow(/shards snapshot invalid/);
    expect(() => w.shards.save.deserialize({ herz: 1 })).toThrow(/shards snapshot invalid/);
  });
});
