/**
 * Save roundtrip of the participant `fishing` (M7-24, docs/SPIEL.md §20, §27): a line in the middle of a fight, fish traps with
 * their catch and an open ice hole survive save → load; a loaded fight goes on exactly like the one that was never saved.
 */
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../../src/game/setup';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { angelWelt, type AngelWelt } from '../../game/angel-testwelt';
import { OFFSET } from '../../game/interaktion-testwelt';

/** Traps at (8, 3) with ten days of catch, an ice hole at (7, 9), the rod hooked into a fish. */
function amAngeln(w: AngelWelt): void {
  w.eis(7, 9);
  w.spawn(8, 4);
  w.inventory.give(w.sim, 'reuse', 1);
  w.hold('reuse');
  w.run(1, [{ type: 'fishing.placeTrap', from: { bereich: 'schnellleiste', index: 0 }, tx: OFFSET + 8, ty: OFFSET + 3 }]);
  w.fishing.catchUp(w.at(8, 3).chunk, 0, 6 * w.sim.clock.ticksPerDay);
  w.place(7, 8);
  w.hold('probe_spitzhacke');
  w.run(1, [{ type: 'fishing.cutHole', tx: OFFSET + 7, ty: OFFSET + 9 }]);
  w.place(6, 5);
  w.hold('angel_holz');
  const p = w.px(10, 5);
  w.run(1, [{ type: 'fishing.cast', x: p.x, y: p.y }]);
  for (let t = 0; t < 60 * 60 && w.line().phase !== 'biss'; t++) w.run(1);
  w.run(1, [{ type: 'fishing.reel', on: true }]);
  w.run(30, [{ type: 'fishing.reel', on: false }]);
}

describe('save roundtrip: fishing', () => {
  it('restores the line in the fight, the traps with their catch and the ice hole', () => {
    const report = expectRoundtrip(angelWelt, amAngeln, (w) => w.fishing.save);
    expect(report.id).toBe('fishing');
    const data = JSON.parse(report.canonical) as { line: { phase: string; fish: string } | null; traps: { traps: { fish: string[] }[] }[]; holes: unknown[] };
    expect(data.line?.phase).toBe('drill');
    expect(data.line?.fish).not.toBe('');
    expect(data.traps[0]?.traps[0]?.fish.length).toBeGreaterThan(0);
    expect(data.holes).toHaveLength(1);
  });

  it('save → load → weiter: der Drill endet gleich', () => {
    const a = angelWelt();
    amAngeln(a);
    const b = angelWelt();
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    b.active = [...a.active];
    const end = (w: AngelWelt): string => {
      for (let t = 0; t < 60 * 60; t++) {
        const l = w.line();
        const ev = w.run(1, [{ type: 'fishing.reel', on: l.tension < 0.6 }]);
        if (ev.has('fishCaught')) return `gefangen ${String(w.sim.tick)}`;
        if (ev.has('fishLost')) return `verloren ${String(w.sim.tick)}`;
      }
      return 'offen';
    };
    expect(end(b)).toBe(end(a));
    expect(b.fishing.save.serialize()).toEqual(a.fishing.save.serialize());
  });

  it('the game simulation has the participant (empty at the start)', () => {
    const sim = createSimulation({ seed: 3 });
    expect(sim.participant('fishing').serialize()).toEqual({ line: null, traps: [], holes: [] });
  });

  it('rejects malformed snapshots: unknown fish and bait, a fight without a fish, a trap outside its chunk, two on a tile', () => {
    const w = angelWelt();
    amAngeln(w);
    const good = w.fishing.save.serialize() as { line: Record<string, unknown>; traps: { traps: Record<string, unknown>[] }[]; holes: unknown[] };
    const chunk = good.traps[0] as { traps: Record<string, unknown>[] };
    const trap = chunk.traps[0] as Record<string, unknown>;
    const bad: unknown[] = [
      null,
      { ...good, line: { ...good.line, fish: 'wal' } },
      { ...good, line: { ...good.line, fish: '' } },
      { ...good, line: { ...good.line, bait: 'stein' } },
      { ...good, line: { ...good.line, phase: 'aus' } },
      { ...good, line: { ...good.line, extra: 1 } },
      { ...good, traps: [{ ...chunk, traps: [{ ...trap, fish: ['forelle', 'forelle', 'forelle', 'forelle', 'forelle'] }] }] },
      { ...good, traps: [{ ...chunk, traps: [{ ...trap, tx: (trap.tx as number) + 64 }] }] },
      { ...good, traps: [{ ...chunk, traps: [trap, trap] }] },
      { ...good, traps: [chunk, chunk] },
      { ...good, holes: [[0, 1, 2, 0]] },
    ];
    for (const data of bad) expect(() => w.fishing.save.deserialize(data), JSON.stringify(data).slice(0, 160)).toThrow(TypeError);
  });
});
