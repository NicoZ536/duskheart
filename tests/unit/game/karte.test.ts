/**
 * The map (M7-49; MASTERPROMPT §25 "Aufdeckung im Radius 20 Tiles (auf Höhen mehr), Aussichtstürme 80 … eigene (Symbol + Name)";
 * docs/SPIEL.md §18 "Karte"): the reveal around the walking player, the height bonus, a look-out tower's view (observed
 * `towerClimbed`), the console's reveal of a layer, own markers with their refusals, derived markers and the bit mask's save
 * form. On the player test world (small world, 256² cells).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { countRevealed, decodeMask, encodeMask, maskBytes, revealDisc, revealRadius } from '../../../src/game/map/formulas';
import type { MapMarkerKind } from '../../../src/game/map/types';
import { karteWelt } from './karte-testwelt';
import { meadow, OFFSET } from './spieler-testwelt';

const M = BALANCE.map;

describe('Karte: Aufdeckung', () => {
  it('deckt beim Gehen den Radius 20 auf; Aufgedecktes bleibt', () => {
    const w = karteWelt();
    w.spawn(20, 20);
    w.run(1);
    // Cells whose centre lies within 20 tiles: 18 tiles east is in, 26 tiles is out (cells of 4: the centre is ≤ 2 tiles off).
    expect(w.seen(20, 20)).toBe(true);
    expect(w.seen(38, 20)).toBe(true);
    expect(w.seen(20 + 26, 20)).toBe(false);
    expect(w.seen(20 + 17, 20 + 17)).toBe(false); // the disc is round: 24 tiles diagonally (18 east is in)
    const before = countRevealed(w.map.mask(0) as Uint8Array);
    // Walk 30 tiles east (teleport): new cells, the old ones stay.
    w.run(1, [{ type: 'player.teleport', ...w.centre(50, 20), layer: 0 }]);
    expect(w.seen(50 + 18, 20)).toBe(true);
    expect(w.seen(20, 20)).toBe(true);
    expect(countRevealed(w.map.mask(0) as Uint8Array)).toBeGreaterThan(before);
    // Standing still reveals nothing new and does not touch the version.
    const v = w.map.version;
    w.run(5);
    expect(w.map.version).toBe(v);
  });

  it('auf Höhen weiter: je Stufe heightBonusTiles mehr, unter Tage nicht', () => {
    expect(revealRadius(0, 0)).toBe(M.revealRadiusTiles);
    expect(revealRadius(0, 2)).toBe(M.revealRadiusTiles + 2 * M.heightBonusTiles);
    expect(revealRadius(-1, 3)).toBe(M.revealRadiusTiles);
    // The player on a level-2 hill sees 32 tiles: 28 tiles away is revealed (it is not from the meadow below).
    const rows = meadow(40, 40).map((r, y) => (y >= 18 && y <= 22 ? `${r.slice(0, 18)}22222${r.slice(23)}` : r));
    const hoch = karteWelt(rows);
    hoch.spawn(20, 20);
    hoch.run(1);
    expect(hoch.body().level).toBe(2);
    expect(hoch.seen(20 + 28, 20)).toBe(true);
    const flach = karteWelt();
    flach.spawn(20, 20);
    flach.run(1);
    expect(flach.seen(20 + 28, 20)).toBe(false);
  });

  it('ein Ebenenwechsel in derselben Zelle deckt die neue Ebene auf (die Höhle unter dem Spieler)', () => {
    const w = karteWelt();
    w.spawn(20, 20);
    w.run(1);
    expect(w.map.mask(-1)).toBeNull();
    w.run(1, [{ type: 'player.teleport', ...w.centre(20, 20), layer: -1 }]);
    expect(w.body().layer).toBe(-1);
    expect(w.seen(20, 20, -1)).toBe(true);
    expect(w.seen(20 + 18, 20, -1)).toBe(true);
  });

  it('ein Aussichtsturm deckt seinen Radius um den Turm auf (towerClimbed, beobachtet)', () => {
    const w = karteWelt();
    w.spawn(5, 5);
    w.run(1);
    const tx = OFFSET + 200;
    const ty = OFFSET + 120;
    expect(w.map.revealed(0, tx, ty)).toBe(false);
    w.tower.armed = { x: tx, y: ty, r: 80 };
    w.run(1);
    expect(w.map.revealed(0, tx, ty)).toBe(true);
    expect(w.map.revealed(0, tx + 77, ty)).toBe(true);
    expect(w.map.revealed(0, tx + 86, ty)).toBe(false);
    expect(w.map.revealed(0, tx + 55, ty + 55)).toBe(true);
    expect(w.map.revealed(0, tx + 60, ty + 60)).toBe(false);
  });

  it('map.reveal deckt eine ganze Ebene auf (Konsole), die anderen nicht', () => {
    const w = karteWelt();
    w.run(1, [{ type: 'map.reveal', layer: -1 }]);
    expect(countRevealed(w.map.mask(-1) as Uint8Array)).toBe(w.map.side * w.map.side);
    expect(w.map.mask(0)).toBeNull();
    w.run(1, [{ type: 'map.reveal' }]);
    for (const layer of [0, -1, -2, -3] as const) expect(countRevealed(w.map.mask(layer) as Uint8Array)).toBe(w.map.side * w.map.side);
  });
});

describe('Karte: eigene und abgeleitete Marker', () => {
  it('setzen, umbenennen, entfernen – mit Ereignissen und Ablehnungen', () => {
    const w = karteWelt();
    let ev = w.run(1, [{ type: 'map.mark', symbol: 'eigen_3', name: '  Höhle am Bach  ', layer: -1, tx: 300, ty: 410 }]);
    expect(ev.get('mapMarked')).toHaveLength(1);
    expect(w.map.markers).toEqual([{ id: 0, symbol: 'eigen_3', name: 'Höhle am Bach', layer: -1, tx: 300, ty: 410 }]);
    ev = w.run(1, [{ type: 'map.rename', id: 0, name: 'Erzhöhle' }]);
    expect(ev.get('mapRenamed')).toHaveLength(1);
    expect(w.map.markers[0]?.name).toBe('Erzhöhle');
    const reasons = (e: Map<string, unknown[]>): string[] => ((e.get('commandRejected') ?? []) as { reason: string }[]).map((r) => r.reason);
    expect(reasons(w.run(1, [{ type: 'map.rename', id: 7, name: 'x' }]))).toEqual(['unknownMarker']);
    expect(reasons(w.run(1, [{ type: 'map.mark', symbol: 'eigen_1', name: '   ', layer: 0, tx: 1, ty: 1 }]))).toEqual(['emptyName']);
    expect(reasons(w.run(1, [{ type: 'map.mark', symbol: 'eigen_1', name: 'Rand', layer: 0, tx: w.map.worldTiles, ty: 1 }]))).toEqual(['outOfWorld']);
    ev = w.run(1, [{ type: 'map.unmark', id: 0 }]);
    expect(ev.get('mapUnmarked')).toHaveLength(1);
    expect(w.map.markers).toHaveLength(0);
    expect(reasons(w.run(1, [{ type: 'map.unmark', id: 0 }]))).toEqual(['unknownMarker']);
    // At most `maxMarkers`; ids keep counting.
    for (let i = 0; i < M.maxMarkers; i++) w.run(1, [{ type: 'map.mark', symbol: 'eigen_8', name: `M${i}`, layer: 0, tx: i, ty: 0 }]);
    expect(w.map.markers).toHaveLength(M.maxMarkers);
    expect(w.map.markers[0]?.id).toBe(1);
    expect(reasons(w.run(1, [{ type: 'map.mark', symbol: 'eigen_8', name: 'zu viel', layer: 0, tx: 0, ty: 0 }]))).toEqual(['tooManyMarkers']);
  });

  it('forEachMarker: eigene der Ebene, dann die Quellen (abgeleitet, nie gespeichert)', () => {
    const w = karteWelt();
    w.run(1, [{ type: 'map.mark', symbol: 'eigen_2', name: 'Lager', layer: 0, tx: 10, ty: 11 }]);
    w.run(1, [{ type: 'map.mark', symbol: 'eigen_4', name: 'Tief', layer: -2, tx: 12, ty: 13 }]);
    w.map.addMarkerSource((_s, layer, visit) => {
      if (layer === 0) visit('ort', 'karte_ort_schrein', 'schrein', 0, 40, 41);
    });
    const seen: [MapMarkerKind, string, string, number, number][] = [];
    w.map.forEachMarker(w.sim, 0, (kind, sprite, ref, _layer, tx, ty) => seen.push([kind, sprite, ref, tx, ty]));
    expect(seen).toEqual([
      ['eigen', 'karte_eigen_2', 'Lager', 10, 11],
      ['ort', 'karte_ort_schrein', 'schrein', 40, 41],
    ]);
    const snap = w.map.save.serialize() as { markers: unknown[] };
    expect(snap.markers).toHaveLength(2);
  });
});

describe('Karte: Speicherform der Bitmaske', () => {
  it('Lauflängen + Base64: klein für wenig Aufgedecktes, verlustfrei', () => {
    const side = 384; // Mittel
    const mask = new Uint8Array(maskBytes(side));
    expect(mask.length).toBe(18432);
    revealDisc(mask, side, M.cellTiles, 700, 900, 20);
    revealDisc(mask, side, M.cellTiles, 760, 900, 80);
    const text = encodeMask(mask);
    expect(text.length).toBeLessThan(2000);
    expect(decodeMask(text, mask.length)).toEqual(mask);
    expect(() => decodeMask(text, mask.length + 1)).toThrow();
  });
});
