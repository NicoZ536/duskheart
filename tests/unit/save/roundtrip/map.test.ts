/**
 * Save roundtrip of the participant `map` (M7-49; docs/SPIEL.md §27 "Aufdeckung je Ebene (RLE/Base64), eigene Marker"): the
 * revealed cells of every layer, the own markers and the next marker id survive save → load; a loaded map goes on revealing
 * and numbering exactly like the uninterrupted one. Derived markers are not part of it.
 */
import { describe, expect, it } from 'vitest';
import { countRevealed } from '../../../../src/game/map/formulas';
import type { MapSnapshot } from '../../../../src/game/map/state';
import { createSimulation } from '../../../../src/game/setup';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { karteWelt, type KarteWelt } from '../../game/karte-testwelt';

/** A walk, a tower's view, a cave layer from the console and two markers (one removed). */
function explore(w: KarteWelt): void {
  w.spawn(10, 10);
  w.run(1);
  w.run(1, [{ type: 'player.teleport', ...w.centre(60, 30), layer: 0 }]);
  w.tower.armed = { x: 400, y: 300, r: 80 };
  w.run(1);
  w.run(1, [{ type: 'map.reveal', layer: -2 }]);
  w.run(1, [{ type: 'map.mark', symbol: 'eigen_5', name: 'Turm', layer: 0, tx: 400, ty: 300 }]);
  w.run(1, [{ type: 'map.mark', symbol: 'eigen_1', name: 'weg', layer: 0, tx: 1, ty: 2 }]);
  w.run(1, [{ type: 'map.mark', symbol: 'eigen_7', name: 'Kristalle', layer: -2, tx: 500, ty: 510 }]);
  w.run(1, [{ type: 'map.unmark', id: 1 }]);
}

describe('save roundtrip: map', () => {
  it('restores the revealed cells per layer, the own markers and the next id', () => {
    const report = expectRoundtrip(() => karteWelt(), explore, (w) => w.map.save);
    expect(report.id).toBe('map');
    const data = JSON.parse(report.canonical) as MapSnapshot;
    expect(data.layers.map((l) => l.layer)).toEqual([0, -2]);
    expect(data.markers.map((m) => [m.id, m.name])).toEqual([
      [0, 'Turm'],
      [2, 'Kristalle'],
    ]);
    expect(data.nextId).toBe(3);
  });

  it('save → load → continue: the same cells, the same next marker', () => {
    const a = karteWelt();
    explore(a);
    const b = karteWelt();
    b.spawn(10, 10);
    for (const p of a.sim.participants()) if (p.id === 'map') b.map.save.deserialize(structuredClone(p.serialize()));
    expect(countRevealed(b.map.mask(0) as Uint8Array)).toBe(countRevealed(a.map.mask(0) as Uint8Array));
    expect(b.map.revealed(0, 400 + 70, 300)).toBe(true);
    expect(b.map.mask(-1)).toBeNull();
    for (const w of [a, b]) {
      w.run(1, [{ type: 'player.teleport', ...w.centre(150, 150), layer: 0 }]);
      w.run(1, [{ type: 'map.mark', symbol: 'eigen_2', name: 'neu', layer: 0, tx: 7, ty: 7 }]);
    }
    expect(b.map.save.serialize()).toEqual(a.map.save.serialize());
    expect(b.map.markers.at(-1)?.id).toBe(3);
  });

  it('refuses a raster of another world size and too many markers', () => {
    const w = karteWelt();
    const good = w.map.save.serialize() as MapSnapshot;
    expect(() => w.map.save.deserialize({ ...good, side: good.side * 2 })).toThrow(/raster/);
    const many = Array.from({ length: 65 }, (_, i) => ({ id: i, symbol: 'eigen_1', name: `m${i}`, layer: 0, tx: 0, ty: 0 }));
    expect(() => w.map.save.deserialize({ ...good, markers: many, nextId: 65 })).toThrow(/at most/);
    expect(() => w.map.save.deserialize({ ...good, markers: [{ id: 4, symbol: 'eigen_1', name: 'x', layer: 0, tx: 0, ty: 0 }], nextId: 2 })).toThrow(/next id/);
  });

  it('the game simulation has the participant (nothing revealed at the start)', () => {
    const sim = createSimulation({ seed: 7 });
    const data = sim.participant('map').serialize() as MapSnapshot;
    expect(data).toEqual({ cellTiles: 4, side: 384, layers: [], markers: [], nextId: 0 });
  });
});
