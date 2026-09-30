/**
 * Save roundtrip of the participant `creatures` (M6, docs/SPIEL.md §15 "creatures (aktive Kreaturen samt KI-Zustand,
 * Chunk-Bestände, Kadaver, Nachwachs-Uhren)"): a wolf pack in the middle of its hunt – with pending path requests of the
 * path service –, a deer, a carcass, a frozen chunk's stock and the Nachtmahr survive save → load, in the order they
 * update in, and a loaded world goes on exactly like the one that was never saved.
 */
import { describe, expect, it } from 'vitest';
import { NULL_ENTITY } from '../../../../src/engine/ecs';
import { createSimulation } from '../../../../src/game/setup';
import type { ChunkData } from '../../../../src/world/model/chunk';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { kreaturWelt, meadow, type KreaturWelt } from '../../game/kreatur-testwelt';

/** A world of the roundtrip: night, a dark meadow, the player in god mode. */
function world(): KreaturWelt {
  const w = kreaturWelt(meadow(60, 50), { x: 30, y: 25 });
  w.cheats.god = true;
  w.cenv.phase = 'nacht';
  w.light.ambient = 0.05;
  return w;
}

/** A hunt in full swing, a carcass, a frozen chunk's stock and the Nachtmahr. */
function hunt(w: KreaturWelt): void {
  w.run(1, [{ type: 'creature.spawn', creature: 'probe_wolf', count: 3, x: w.centre(30, 12).x, y: w.centre(30, 12).y, layer: 0 }]);
  w.creature('reh', 45, 40);
  // A hare far off: its chunk freezes and keeps it in its stock.
  const far = w.creature('hase', 90, 25);
  const s = w.state(far);
  w.creatures.zoneListener.onDeactivate(w.chunks.get(0, s.homeCx, s.homeCy) as ChunkData, w.sim.tick);
  // A hare killed next to the player: a carcass.
  w.creature('hase', 31, 26);
  w.run(1, [{ type: 'creature.kill', radius: 2 }]);
  w.run(1, [{ type: 'fear.set', value: 100 }]);
  w.run(95);
}

describe('save roundtrip: creatures', () => {
  it('restores live creatures, stocks, carcasses, the Nachtmahr and pending paths', () => {
    const report = expectRoundtrip(world, hunt, (w) => w.creatures.save);
    expect(report.id).toBe('creatures');
    const data = JSON.parse(report.canonical) as {
      creatures: { creature: string; state: string; target: number }[];
      chunks: { members: { creature: string }[] }[];
      carcasses: { creature: string }[];
      nightmare: number;
      paths: { pending: unknown[] };
    };
    // The night spawner brought shadow brood as well.
    expect(data.creatures.map((c) => c.creature)).toEqual(expect.arrayContaining(['nachtmahr', 'probe_wolf', 'probe_wolf', 'probe_wolf', 'reh', 'probe_schleicher']));
    expect(data.chunks.flatMap((c) => c.members.map((m) => m.creature))).toEqual(['hase']);
    expect(data.carcasses.map((c) => c.creature)).toEqual(['hase']);
    expect(data.nightmare).not.toBe(NULL_ENTITY);
  });

  it('save → load → continue hunts exactly like an uninterrupted run', () => {
    const a = world();
    hunt(a);
    const b = world();
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    for (let i = 0; i < 4; i++) {
      a.run(45);
      b.run(45);
      expect(b.sim.hashState()).toBe(a.sim.hashState());
    }
    expect(a.creatures.paths.stats.admitted).toBeGreaterThan(0);
  });

  it('the game simulation has the participant; a world without a zone saves no creatures', () => {
    const sim = createSimulation({ seed: 3 });
    const data = sim.participant('creatures').serialize() as { creatures: unknown[]; chunks: unknown[] };
    expect(data.creatures).toEqual([]);
    expect(data.chunks).toEqual([]);
    const migrated = sim.participant('creatures').migrations?.find((m) => m.from === 0)?.migrate(undefined);
    expect(() => sim.participant('creatures').deserialize(migrated)).not.toThrow();
  });

  it('rejects malformed snapshots, unknown creatures and entities named twice', () => {
    const w = world();
    hunt(w);
    const good = w.creatures.save.serialize() as { creatures: Record<string, unknown>[]; carcasses: Record<string, unknown>[]; nightmare: number };
    const first = good.creatures[0] as Record<string, unknown>;
    const bad: unknown[] = [
      null,
      { ...good, creatures: 1 },
      { ...good, creatures: [{ ...first, creature: 'gibtsnicht' }] },
      { ...good, creatures: [first, first] },
      { ...good, creatures: [{ ...first, extra: true }] },
      { ...good, creatures: [{ ...first, state: 'tanzen' }] },
      { ...good, nightmare: 424242 },
      { ...good, carcasses: [{ ...(good.carcasses[0] as Record<string, unknown>), creature: 'gibtsnicht' }] },
    ];
    for (const data of bad) expect(() => w.creatures.save.deserialize(data), JSON.stringify(data).slice(0, 200)).toThrow(TypeError);
    expect(w.creatures.save.serialize()).toEqual(good);
  });
});
