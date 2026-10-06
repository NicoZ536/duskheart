/**
 * Save roundtrip of the participant `travel` (M7-37, docs/SPIEL.md §22, §27): the waystones (number, place, name) and the
 * next number survive save → load; saves before M7 load with none.
 */
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../../src/game/setup';
import type { PartDef } from '../../../../src/world/structures/catalog';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { leuchtfeuerWelt, OFFSET, type LeuchtfeuerWelt } from '../../game/leuchtfeuer-testwelt';

const WEGSTEIN = { id: 'wegstein' } as PartDef;

function world(): LeuchtfeuerWelt {
  return leuchtfeuerWelt();
}

/** Two waystones, the first named, the second torn down again, a third set. */
function stones(w: LeuchtfeuerWelt): void {
  const l = w.travel.partListener();
  l.placed?.(w.sim, WEGSTEIN, 0, OFFSET + 5, OFFSET + 5);
  l.placed?.(w.sim, WEGSTEIN, 0, OFFSET + 9, OFFSET + 5);
  w.run(1, [{ type: 'travel.rename', wegstein: 1, name: 'Mühle' }]);
  l.removed?.(w.sim, WEGSTEIN, 0, OFFSET + 9, OFFSET + 5, 'abgebaut');
  l.placed?.(w.sim, WEGSTEIN, 0, OFFSET + 12, OFFSET + 8);
}

describe('save roundtrip: travel', () => {
  it('restores the waystones with their names and the next number', () => {
    const report = expectRoundtrip(world, stones, (w) => w.travel.save);
    expect(report.id).toBe('travel');
    expect(JSON.parse(report.canonical)).toEqual({
      nextWaystone: 4,
      waystones: [
        { id: 1, layer: 0, tx: OFFSET + 5, ty: OFFSET + 5, name: 'Mühle' },
        { id: 3, layer: 0, tx: OFFSET + 12, ty: OFFSET + 8, name: '' },
      ],
    });
  });

  it('the game simulation has the participant (none); saves before M7 migrate; bad data is refused', () => {
    const sim = createSimulation({ seed: 3 });
    expect(sim.participant('travel').serialize()).toEqual({ nextWaystone: 1, waystones: [] });
    expect(sim.participant('travel').migrations?.find((m) => m.from === 0)?.migrate(undefined)).toEqual({ nextWaystone: 1, waystones: [] });
    const w = world();
    const s = { id: 1, layer: 0, tx: 3, ty: 3, name: '' };
    expect(() => w.travel.save.deserialize({ nextWaystone: 1, waystones: [s] })).toThrow(/travel snapshot invalid/);
    expect(() => w.travel.save.deserialize({ nextWaystone: 3, waystones: [s, { ...s, id: 2 }] })).toThrow(/travel snapshot invalid/);
    expect(() => w.travel.save.deserialize({ nextWaystone: 3, waystones: [s, s] })).toThrow(/travel snapshot invalid/);
  });
});
