/**
 * M7-29: spoilage (MASTERPROMPT §18 "Verderb: Frische 100 → 0 über die Haltbarkeit; Faktoren: Vorratsfass ×0,75, Lager −10 %,
 * Eiskeller ×0,2, Winter im Freien ×0,5, heißes Biom ×1,5; Stufen Frisch · Alt · Faulig · 0 → Verdorbenes (Kompost)", §16.7
 * "Vorratsfass"; docs/SPIEL.md §21 "Verderb", §28 "Aufholen"; ADR-0207): the dyadic grid (n single hours ≡ one step of n hours,
 * bit for bit), the factors in their order, the season split, the hourly pass over the bags and containers, spoiled food,
 * freezing and catching up bit-identically, the stations' slots, the debug advance and the participant.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE, type SeasonId } from '../../../src/content/balance';
import { freshnessStage } from '../../../src/game/actions/formulas';
import { quantizeFreshness } from '../../../src/game/items/formulas';
import { containerFactor, dayOfHour, hourOfTick, isHotBiome, lossOver, lossPerHour, nextDayHour, placeFactor, roomFactor, spoiledFreshness, type SpoilagePlace } from '../../../src/game/spoilage/formulas';
import { SPOILAGE_SAVE_VERSION } from '../../../src/game/spoilage/system';
import { CHUNK_SHIFT } from '../../../src/world/model/coords';
import { kuecheWelt, type KuecheWelt, type TestContainer } from './kueche-testwelt';
import { OFFSET } from './spieler-testwelt';

const S = BALANCE.spoilage;
const GRID = 2 ** S.gridBits;
const SUMMER = { seasonOfDay: (): SeasonId => 'sommer' };
const place = (base = 1, hot = false, outdoors = true): SpoilagePlace => ({ base, hot, outdoors });

/** Whether `v` lies on the freshness grid. */
const onGrid = (v: number): boolean => Number.isInteger(v * GRID);

function welt(): KuecheWelt {
  const w = kuecheWelt();
  w.spawn(10, 10);
  w.run(1);
  return w;
}

describe('Verderb (reine Regeln)', () => {
  it('Verlust je Stunde liegt auf dem Raster 2^-16: Brot (5 Tage) verliert 100/120 je Stunde', () => {
    const l = lossPerHour(5, 1);
    expect(onGrid(l)).toBe(true);
    expect(Math.abs(l - 100 / 120)).toBeLessThanOrEqual(1 / GRID);
    expect(quantizeFreshness(100 / 3)).toBe(Math.round((100 / 3) * GRID) / GRID);
  });

  it('n einzelne Stunden und ein Schritt über n Stunden sind bitgleich (Raster, auch über Jahreszeitenwechsel)', () => {
    const days = [2, 3, 5, 25, 30];
    const factors = [1, 0.75, 0.9, 0.2, 0.75 * 0.9, 0.5, 1.5, 0.75 * 0.2 * 1.5];
    const seasons = { seasonOfDay: (d: number): SeasonId => (d % 3 === 0 ? 'winter' : 'herbst') };
    for (const d of days) {
      for (const f of factors) {
        let step = 100;
        for (let h = 0; h < 100; h++) step = spoiledFreshness(step, lossOver(d, place(f, false, true), h, h + 1, seasons));
        const once = spoiledFreshness(100, lossOver(d, place(f, false, true), 0, 100, seasons));
        expect(once, `${d} d × ${f}`).toBe(step);
        expect(onGrid(once)).toBe(true);
      }
    }
  });

  it('Faktoren in fester Reihenfolge: Behälter × Raum × Umgebung (Winter im Freien 0,5, heiß 1,5)', () => {
    expect(containerFactor('vorratsfass')).toBe(0.75);
    expect(containerFactor('kiste')).toBe(1);
    expect(containerFactor('taschen')).toBe(1);
    expect([roomFactor('lager'), roomFactor('eiskeller'), roomFactor('kueche'), roomFactor(null)]).toEqual([0.9, 0.2, 1, 1]);
    expect(placeFactor(place(0.75 * 0.9, false, true), 'winter')).toBe(0.75 * 0.9 * 0.5);
    expect(placeFactor(place(0.75 * 0.9, false, false), 'winter')).toBe(0.75 * 0.9);
    expect(placeFactor(place(1, true, true), 'sommer')).toBe(1.5);
    expect(isHotBiome('glutsand')).toBe(true);
    expect(isHotBiome('gruenhain')).toBe(false);
  });

  it('Stunden und Tage: Stunde 0 beginnt um 06:00 von Tag 1, Tag 2 beginnt mit Stunde 18', () => {
    expect(hourOfTick(0, 3600)).toBe(0);
    expect(hourOfTick(3599, 3600)).toBe(0);
    expect(hourOfTick(3600, 3600)).toBe(1);
    expect(dayOfHour(0)).toBe(1);
    expect(dayOfHour(17)).toBe(1);
    expect(dayOfHour(18)).toBe(2);
    expect(nextDayHour(1)).toBe(18);
    expect(nextDayHour(2)).toBe(42);
  });

  it('Winter im Freien halbiert nur die Winterstunden', () => {
    const seasons = { seasonOfDay: (d: number): SeasonId => (d === 2 ? 'winter' : 'herbst') };
    // Hours 12–24: six autumn hours of day 1 (12…17), six winter hours of day 2 (18…23).
    const l = lossPerHour(2, 1);
    const w = lossPerHour(2, 0.5);
    expect(lossOver(2, place(), 12, 24, seasons)).toBe(6 * l + 6 * w);
    expect(lossOver(2, place(1, false, false), 12, 24, seasons)).toBe(12 * l);
    expect(lossOver(2, place(), 12, 24, SUMMER)).toBe(12 * l);
  });

  it('Stufen: frisch ≥ 60, alt ab 20, faulig darunter, 0 = verdorben', () => {
    expect([100, 60, 59.9, 20, 19.9, 0.1].map(freshnessStage)).toEqual(['frisch', 'frisch', 'alt', 'alt', 'faulig', 'faulig']);
    expect(spoiledFreshness(0.5, 1)).toBe(0);
  });
});

describe('Verderb im Spiel', () => {
  it('in den Taschen: Brot verliert stündlich; nach fünf Tagen ist es Verdorbenes (gleiche Stückzahl, foodSpoiled)', () => {
    const w = welt();
    w.put(w.stack('brot', 3));
    const l = lossPerHour(5, 1);
    w.hours(24);
    expect(w.slot()?.frische).toBe(100 - 24 * l);
    w.hours(4 * 24 - 1);
    expect(w.slot()?.item).toBe('brot');
    const before = w.slot()?.frische ?? 0;
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThanOrEqual(l + 1e-9);
    w.sim.skipTicks(w.sim.clock.ticksPerGameHour);
    const ev = w.run(1);
    expect(w.slot()).toMatchObject({ item: 'verdorbenes', count: 3 });
    expect(w.slot()?.frische).toBeUndefined();
    expect(ev.get('foodSpoiled')).toEqual([expect.objectContaining({ item: 'brot', count: 3, behaelter: 'taschen' })]);
  });

  it('Vorratsfass ×0,75, Lager ×0,9, Eiskeller ×0,2, heißes Biom ×1,5 – an Kisten derselben Welt', () => {
    const w = welt();
    const kiste = w.container('kiste', 3, 3);
    const fass = w.container('vorratsfass', 4, 3);
    const lager = w.container('kiste', 5, 3);
    const keller = w.container('kiste', 6, 3);
    w.room(5, 3, 'lager');
    w.room(6, 3, 'eiskeller');
    for (const c of [kiste, fass, lager, keller]) c.slots[0] = w.stack('eintopf', 1);
    w.hours(10);
    const lost = (c: TestContainer): number => 100 - (c.slots[0]?.frische ?? 100);
    expect(lost(kiste)).toBe(10 * lossPerHour(2, 1));
    expect(lost(fass)).toBe(10 * lossPerHour(2, 0.75));
    expect(lost(lager)).toBe(10 * lossPerHour(2, 0.9));
    expect(lost(keller)).toBe(10 * lossPerHour(2, 0.2));
    const h = welt();
    h.biome('glutsand');
    const heiss = h.container('kiste', 3, 3);
    heiss.slots[0] = h.stack('eintopf', 1);
    h.hours(10);
    expect(100 - (heiss.slots[0]?.frische ?? 100)).toBe(10 * lossPerHour(2, 1.5));
  });

  it('Einfrieren und Aufholen: bitgleich mit einer Kiste, die aktiv blieb (Raum und Behälter gemerkt)', () => {
    const run = (freeze: boolean): number[] => {
      const w = welt();
      const fass = w.container('vorratsfass', 3, 3, 3);
      w.room(3, 3, 'lager');
      fass.slots[0] = w.stack('eintopf', 2);
      fass.slots[1] = w.stack('brot', 1);
      fass.slots[2] = w.stack('trockenfleisch', 4);
      w.hours(5);
      if (freeze) {
        const chunk = w.chunks.get(0, (OFFSET + 3) >> CHUNK_SHIFT, (OFFSET + 3) >> CHUNK_SHIFT);
        if (chunk === undefined) throw new Error('no chunk');
        const from = w.sim.tick;
        w.frozen.add(`0:${chunk.cx}:${chunk.cy}`);
        w.spoilage.zoneListener.onDeactivate?.(chunk, from);
        // While frozen the room is gone (rooms exist only in the active zone): the kept place must decide.
        w.rooms.clear();
        w.hours(31);
        w.hours(7);
        w.spoilage.catchUp(chunk, from, w.sim.tick);
        w.frozen.clear();
        w.room(3, 3, 'lager');
        w.hours(2);
      } else {
        w.hours(38);
        w.hours(2);
      }
      return fass.slots.map((s) => s?.frische ?? -1);
    };
    const live = run(false);
    expect(run(true)).toEqual(live);
    expect(live.every((f) => f > 0 && onGrid(f))).toBe(true);
  });

  it('Stationsplätze verderben stündlich zwischen den Chargen – live und eingefroren bitgleich', () => {
    const run = (freeze: boolean): Array<number | null> => {
      const w = welt();
      const id = w.stations.placeAt(w.sim, 'raeucherkammer', 0, OFFSET + 3, OFFSET + 3);
      if (typeof id !== 'number') throw new Error(String(id));
      w.room(3, 3, 'eiskeller');
      const p = w.stations.placed.find((s) => s.id === id);
      const proc = p?.proc as { eingang: Array<{ item: string; count: number; frische?: number } | null> };
      // Fish without salt: no batch runs, the fish lies in the input slot and spoils.
      proc.eingang[0] = w.stack('forelle', 2);
      w.hours(3);
      if (freeze) {
        const chunk = w.chunks.get(0, (OFFSET + 3) >> CHUNK_SHIFT, (OFFSET + 3) >> CHUNK_SHIFT);
        if (chunk === undefined) throw new Error('no chunk');
        const from = w.sim.tick;
        w.frozen.add(`0:${chunk.cx}:${chunk.cy}`);
        w.spoilage.zoneListener.onDeactivate?.(chunk, from);
        w.rooms.clear();
        w.hours(20);
        w.stations.catchUp(chunk, from, w.sim.tick);
        w.spoilage.catchUp(chunk, from, w.sim.tick);
        w.frozen.clear();
        w.room(3, 3, 'eiskeller');
        w.hours(1);
      } else w.hours(21);
      return proc.eingang.map((s) => s?.frische ?? null);
    };
    const live = run(false);
    expect(live[0]).toBe(100 - 24 * lossPerHour(2, 0.2));
    expect(run(true)).toEqual(live);
  });

  it('Debug: spoilage.advance lässt alles in Taschen und aktiver Zone n Stunden altern', () => {
    const w = welt();
    w.put(w.stack('apfel', 2));
    const kiste = w.container('kiste', 3, 3);
    kiste.slots[0] = w.stack('brot', 1);
    w.run(1, [{ type: 'spoilage.advance', hours: 12 }]);
    expect(w.slot()?.frische).toBe(100 - 12 * lossPerHour(shelfDays(w, 'apfel'), 1));
    expect(kiste.slots[0]?.frische).toBe(100 - 12 * lossPerHour(5, 1));
  });

  it('Teilnehmer spoilage: Stempel, eingefrorene Chunks mit Plätzen und Vorlauf überstehen Speichern und Laden', () => {
    const w = welt();
    const fass = w.container('vorratsfass', 3, 3);
    fass.slots[0] = w.stack('eintopf', 1);
    w.hours(2);
    const chunk = w.chunks.get(0, (OFFSET + 3) >> CHUNK_SHIFT, (OFFSET + 3) >> CHUNK_SHIFT);
    if (chunk === undefined) throw new Error('no chunk');
    w.frozen.add(`0:${chunk.cx}:${chunk.cy}`);
    w.spoilage.zoneListener.onDeactivate?.(chunk, w.sim.tick);
    const data = JSON.parse(JSON.stringify(w.spoilage.save.serialize())) as { lastHour: number; frozen: unknown[]; ahead: unknown[] };
    expect(w.spoilage.save.version).toBe(SPOILAGE_SAVE_VERSION);
    expect(data.lastHour).toBe(w.spoilage.stamp);
    expect(data.frozen).toEqual([{ layer: 0, cx: chunk.cx, cy: chunk.cy, stamp: w.spoilage.stamp, behaelter: [[`test:0`, 0.75, false, true]] }]);
    const v = welt();
    v.spoilage.save.deserialize(data);
    expect(v.spoilage.save.serialize()).toEqual(data);
    expect(() => v.spoilage.save.deserialize({ ...data, frozen: [data.frozen[0], data.frozen[0]] })).toThrow(/twice/);
    const migrated = w.spoilage.save.migrations?.[0]?.migrate({});
    expect(migrated).toEqual({ lastHour: -1, frozen: [], ahead: [] });
  });
});

/** Shelf life of `item` [game days] (the content). */
function shelfDays(w: KuecheWelt, item: string): number {
  const days = w.inventory.bags.catalog.get(item).frische;
  if (days === undefined) throw new Error(`${item} does not spoil`);
  return days;
}
