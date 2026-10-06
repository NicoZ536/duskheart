/**
 * Save roundtrip of the participant `farming` (M7-19 … M7-23, docs/SPIEL.md §20, §27): plots of every kind – sown, half grown,
 * ripe, dead, mildewed, in a greenhouse, a garden bed, a plot in a chunk outside the zone – and the climate log survive
 * save → load; a loaded field grows on exactly like the one that was never saved.
 */
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../../src/game/setup';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { FeldWelt, X0, Y0, beete } from '../../game/feld-testwelt';

/** The world around the plots (not the participant's: a lake tile and a greenhouse). */
function umgebung(w: FeldWelt): void {
  w.wasser(X0 + 9, Y0 + 3);
  w.greenhouse.add(`${X0 + 3},${Y0 + 8}`);
  w.farming.surroundingsChanged();
}

/** Plots of every kind after ten days of the seed's weather. */
function bestellt(w: FeldWelt): void {
  umgebung(w);
  w.feld(X0 + 3, Y0 + 3).saeen(X0 + 3, Y0 + 3, 'salat');
  w.feld(X0 + 5, Y0 + 3).saeen(X0 + 5, Y0 + 3, 'karotte');
  w.feld(X0 + 7, Y0 + 3).saeen(X0 + 7, Y0 + 3, 'erdbeere');
  w.feld(X0 + 8, Y0 + 3);
  w.farming.partPlaced(w.sim, true, 0, X0 + 3, Y0 + 8, 1, 1);
  w.saeen(X0 + 3, Y0 + 8, 'bohne');
  w.feld(6 * 32 + 4, 6 * 32 + 4).saeen(6 * 32 + 4, 6 * 32 + 4, 'kohl');
  w.farming.surroundingsChanged();
  w.tage(10);
  const mildew = w.farming.chunkAt(0, 4, 4);
  if (mildew !== undefined) {
    const i = (3 << 5) | 8;
    mildew.crop[i] = 2;
    mildew.pest[i] = 3;
    mildew.pestDays[i] = 1;
  }
}

describe('save roundtrip: farming', () => {
  it('restores plots, their surroundings bits and the climate log', () => {
    const report = expectRoundtrip(
      () => new FeldWelt(),
      bestellt,
      (w) => w.farming.save,
    );
    expect(report.id).toBe('farming');
    const data = JSON.parse(report.canonical) as { plots: { cx: number; plots: unknown[][] }[]; climate: { regions: { periods: unknown[] }[] }; listening: boolean };
    expect(data.plots.map((c) => [c.cx, c.plots.length])).toEqual([
      [4, 5],
      [6, 1],
    ]);
    expect(data.plots[0]?.plots.map((p) => p[4])).toEqual(expect.arrayContaining(['salat', 'karotte', 'erdbeere', 'bohne', 'kartoffel']));
    expect(data.plots[0]?.plots.some((p) => p[8] === 'mehltau')).toBe(true);
    expect(data.climate.regions[0]?.periods.length).toBeGreaterThan(0);
    expect(data.listening).toBe(true);
  });

  it('save → load → weiter: zehn weitere Tage wachsen gleich (aktiv und eingefroren)', () => {
    const a = new FeldWelt();
    bestellt(a);
    const b = new FeldWelt();
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    umgebung(b);
    expect(beete(b)).toEqual(beete(a));
    a.tage(4);
    b.tage(4);
    a.einfrieren().springe(6 * a.perDay).aufwachen();
    b.einfrieren().springe(6 * b.perDay).aufwachen();
    expect(beete(b)).toEqual(beete(a));
    expect(b.farming.log.serialize()).toEqual(a.farming.log.serialize());
  });

  it('the game simulation has the participant (empty at the start)', () => {
    const sim = createSimulation({ seed: 3 });
    expect(sim.participant('farming').serialize()).toEqual({ plots: [], climate: { regions: [] }, listening: false });
  });

  it('rejects malformed snapshots: unknown crops, stages beyond ripe, two plots on a tile, missing flags', () => {
    const w = new FeldWelt();
    bestellt(w);
    const good = w.farming.save.serialize() as { plots: { plots: unknown[][] }[]; climate: unknown; listening: boolean };
    const chunk = good.plots[0] as { plots: unknown[][] };
    const first = chunk.plots[0] as unknown[];
    const withPlot = (plot: unknown[]): unknown => ({ ...good, plots: [{ ...chunk, plots: [plot] }] });
    const bad: unknown[] = [
      null,
      { ...good, listening: 'ja' },
      withPlot(first.map((v, k) => (k === 4 ? 'tulpe' : v))),
      withPlot(first.map((v, k) => (k === 4 ? 'salat' : k === 5 ? 9 : v))),
      withPlot(first.map((v, k) => (k === 4 ? '' : k === 5 ? 1 : v))),
      withPlot(first.map((v, k) => (k === 1 ? 2 : v))),
      withPlot(first.map((v, k) => (k === 2 ? 101 : v))),
      withPlot(first.map((v, k) => (k === 8 ? 'blattlaeuse' : v))),
      { ...good, plots: [{ ...chunk, plots: [first, first] }] },
      { ...good, plots: [{ ...chunk, plots: [] }] },
      { ...good, plots: [{ ...chunk, layer: 7 }] },
      { ...good, climate: { regions: [{ region: 0, periods: [[0, 10, 'hagel']] }] } },
    ];
    for (const data of bad) expect(() => w.farming.save.deserialize(data), JSON.stringify(data).slice(0, 160)).toThrow(TypeError);
  });
});
