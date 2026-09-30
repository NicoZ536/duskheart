/**
 * M6-12 Rüstung T0–T1 und M6-31 Leder-Verarbeitung (MASTERPROMPT §13.1, §11.2, §11.4, §15.1 "Gerbrahmen", §15.2, §D
 * "Rüstungswert je Set: T0 6 · T1 12"; docs/SPIEL.md §14 "Rüstung", "Stationen"): the twelve armour pieces in their sets
 * with armour values, weights and durability by tier; the stations loom, tailor's table and tanning frame and their
 * recipes; leather comes from hunting and carving (the hide's source is a creature's loot); the tanning frame is a
 * processing station without fuel that catches up in unloaded chunks exactly as if it had ticked; the leather backpack.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { buildItemIndex } from '../../../src/content/items/usage';
import { RECIPES } from '../../../src/content/recipes/index';
import { RUESTUNGSSETS } from '../../../src/content/ruestungssets';
import { contentItemCatalog } from '../../../src/game/items/catalog';
import { copyStationsState, type StationsState } from '../../../src/game/stations/state';
import { CHUNK_SHIFT } from '../../../src/world/model/coords';
import { eventsOf, stationWorld, TICK_HZ, type StationWorld } from './stationen-testwelt';

const catalog = contentItemCatalog();
const SETS = {
  faser: ['faserkappe', 'faserhemd', 'faserhose', 'faserschuhe'],
  leder: ['lederkappe', 'lederwams', 'lederhose', 'lederstiefel'],
  bronze: ['bronzehelm', 'bronzebrustpanzer', 'bronzebeinschienen', 'bronzestiefel'],
} as const;

function sum(ids: readonly string[], stat: 'ruestung' | 'isolation'): number {
  return ids.reduce((n, id) => n + (catalog.get(id).werte?.[stat] ?? 0), 0);
}

describe('Rüstungsteile und Sets', () => {
  it('drei Sets mit je vier Teilen (docs/SPIEL.md §14); der Validator zählt 12 Rüstungsteile und 3 Sets', () => {
    expect(RUESTUNGSSETS.map((s) => [s.id, s.teile])).toEqual(Object.entries(SETS));
    const counts = CONTENT.countsByCategory();
    expect(counts.armor).toBe(12);
    expect(counts.armorSets).toBe(3);
  });

  it('Rüstungswerte nach §D: Faser 6 (T0), Bronze 12 (T1), Leder 10 + 2 mit dem vollen Set; Gewicht leicht/mittel/schwer', () => {
    expect(sum(SETS.faser, 'ruestung')).toBe(6);
    expect(sum(SETS.bronze, 'ruestung')).toBe(12);
    expect(sum(SETS.leder, 'ruestung')).toBe(10);
    const lederBonus = RUESTUNGSSETS.find((s) => s.id === 'leder')?.boni.reduce((n, b) => n + (b.werte.ruestung ?? 0), 0);
    expect(sum(SETS.leder, 'ruestung') + (lederBonus ?? 0)).toBe(12);
    for (const [set, weight, tier] of [
      ['faser', 'leicht', 0],
      ['leder', 'mittel', 1],
      ['bronze', 'schwer', 1],
    ] as const) {
      for (const id of SETS[set]) {
        expect(catalog.get(id), id).toMatchObject({ kategorie: 'ruestung', ruestungsgewicht: weight, stufe: tier, haltbarkeit: BALANCE.items.durabilityByTier[tier] });
      }
    }
    // Leather is the warmest, bronze gives no warmth.
    expect(sum(SETS.leder, 'isolation')).toBeGreaterThan(sum(SETS.faser, 'isolation'));
    expect(sum(SETS.bronze, 'isolation')).toBe(0);
  });

  it('der Lederrucksack gibt 8 Plätze', () => {
    expect(catalog.get('lederrucksack')).toMatchObject({ kategorie: 'rucksack', rucksack: { plaetze: 8 } });
  });
});

describe('Stationen und Rezepte der Rüstkammer', () => {
  const recipeOf = (id: string) => RECIPES.find((r) => r.ergebnis.item === id);

  it('Webstuhl und Schneidertisch sind Handwerksstationen, der Gerbrahmen verarbeitet ohne Brennstoff; der Validator zählt 15 Stationen', () => {
    const stations = CONTENT.collection('stations');
    expect(stations.find('webstuhl')).toMatchObject({ art: 'handwerk', stufe: 1 });
    expect(stations.find('schneidertisch')).toMatchObject({ art: 'handwerk', stufe: 1 });
    expect(stations.find('gerbrahmen')).toMatchObject({ art: 'verarbeitung', verarbeitung: { eingang: 2, brennstoff: false } });
    expect(CONTENT.countsByCategory().stations).toBe(15);
    for (const id of ['webstuhl', 'schneidertisch', 'gerbrahmen']) expect(recipeOf(id)?.station, id).toBe('werkbank');
  });

  it('Fasergewebe am Webstuhl; Fasergewand und Leder am Schneidertisch; Bronze am Amboss; Leder aus Fell und Rinde am Gerbrahmen', () => {
    expect(recipeOf('fasergewebe')?.station).toBe('webstuhl');
    for (const id of [...SETS.faser, ...SETS.leder, 'lederrucksack']) expect(recipeOf(id)?.station, id).toBe('schneidertisch');
    for (const id of SETS.bronze) expect(recipeOf(id)?.station, id).toBe('amboss_bronze');
    expect(recipeOf('leder')).toMatchObject({ station: 'gerbrahmen', dauer: 'gerben', zutaten: [{ item: 'fell', anzahl: 1 }, { item: 'rinde', anzahl: 2 }] });
    expect(BALANCE.crafting.durationSeconds.gerben).toBe(240);
  });

  it('Erreichbarkeit: das Fell stammt aus Jagen & Zerlegen (Beute einer Kreatur)', () => {
    const sources = buildItemIndex(CONTENT).sources.get('fell') ?? [];
    expect(sources.some((s) => s.startsWith('drop:'))).toBe(true);
    expect(buildItemIndex(CONTENT).sources.get('leder')).toEqual(['rezept:rezept_leder']);
  });
});

describe('Gerbrahmen: Verarbeitung mit Zeitstempel-Aufholen', () => {
  const BATCH = BALANCE.crafting.durationSeconds.gerben * TICK_HZ;

  function tanning(): { w: StationWorld; frame: number } {
    const w = stationWorld();
    const frame = w.place('gerbrahmen', 6, 4);
    w.give('fell', 2);
    w.give('rinde', 4);
    for (const item of ['fell', 'rinde']) expect(w.refused({ type: 'station.put', station: frame, from: w.slotOf(item), bereich: 'eingang' }), item).toEqual([]);
    return { w, frame };
  }

  it('zwei Felle mit Rinde werden in zweimal 240 s zu zwei Leder; ohne Fell steht der Rahmen', () => {
    const { w, frame } = tanning();
    const first = w.run(BATCH);
    expect(eventsOf(first, 'stationProduced')).toEqual([expect.objectContaining({ station: 'gerbrahmen', recipe: 'rezept_leder', item: 'leder', count: 1 })]);
    const second = w.run(BATCH);
    expect(eventsOf(second, 'stationStopped')).toEqual([expect.objectContaining({ reason: 'eingang' })]);
    expect(w.st(frame).proc?.ausgang[0]).toEqual({ item: 'leder', count: 2 });
  });

  it('eingefroren und beim Aktivieren aufgeholt = durchgehend tickend (auch in zwei Schritten, mit Restfortschritt)', () => {
    const span = Math.round(BATCH * 1.5);
    const snapshot = (w: StationWorld): StationsState => copyStationsState(w.stations.save.serialize() as StationsState);
    const ticking = tanning();
    ticking.w.run(span);
    const expected = snapshot(ticking.w);
    expect(expected.placed[0]?.proc?.ausgang[0]).toEqual({ item: 'leder', count: 1 });
    expect(expected.placed[0]?.proc?.fortschritt).toBeGreaterThan(0);
    for (const parts of [1, 2]) {
      const { w } = tanning();
      w.active = false;
      const placed = w.stations.placed[0];
      if (placed === undefined) throw new Error('no tanning frame');
      const chunk = { layer: 0 as const, cx: placed.tx >> CHUNK_SHIFT, cy: placed.ty >> CHUNK_SHIFT };
      let from = w.sim.tick;
      for (let i = 0; i < parts; i++) {
        w.sim.skipTicks(i === parts - 1 ? span - Math.floor(span / parts) * (parts - 1) : Math.floor(span / parts));
        w.stations.catchUp(chunk, from, w.sim.tick);
        from = w.sim.tick;
      }
      expect(w.sim.tick, `${parts}`).toBe(ticking.w.sim.tick);
      expect(snapshot(w), `${parts}`).toEqual(expected);
    }
  });
});
