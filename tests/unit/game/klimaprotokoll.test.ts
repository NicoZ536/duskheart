/**
 * M7-19 Klimaprotokoll (docs/SPIEL.md §20 "Klimaprotokoll", §28): die Wetterperioden einer Region, beim Entstehen gehört
 * (`WeatherSystem.addPeriodListener`), je Spieltag 06:00 → 06:00 zusammengefasst – Regen (Niederschlagsart `regen` ab
 * `rainThreshold`), Regenminuten, kleinster Temperaturversatz; T_min einer Kachel aus Biom, Höhe und Versatz; ein erzwungener
 * Zustand kürzt die laufende Periode; in kleinen Schritten gehört = in einem Sprung gehört; Tage, die kein Beet mehr braucht,
 * werden verworfen, die eines eingefrorenen Beets bleiben; Speichern und Laden.
 */
import { describe, expect, it } from 'vitest';
import { FarmClimateLog, farmDayStart } from '../../../src/game/farming/index';
import { minuteOf } from '../../../src/world/climate/gameTime';
import { biomeTemperatureC } from '../../../src/world/climate/temperature';
import { F, FeldWelt, X0, Y0 } from './feld-testwelt';

/** A log fed by hand, region 0 tracked, on the calendar of a field world. */
function handLog(): { log: FarmClimateLog; w: FeldWelt } {
  const w = new FeldWelt({ wetter: 'hand' });
  const log = w.farming.log;
  log.track(0);
  return { log, w };
}

describe('Tageszusammenfassung 06:00 → 06:00', () => {
  it('Regen, Regenminuten und kleinster Versatz der überlappenden Perioden; Niesel ist kein Feldregen', () => {
    const { log } = handLog();
    log.record(0, 'klar', minuteOf(3, 2), minuteOf(3, 8));
    log.record(0, 'regen', minuteOf(3, 8), minuteOf(3, 11));
    log.record(0, 'niesel', minuteOf(3, 11), minuteOf(3, 14));
    log.record(0, 'klar', minuteOf(3, 14), minuteOf(4, 4));
    log.record(0, 'gewitter', minuteOf(4, 4), minuteOf(4, 7));
    log.record(0, 'nebel', minuteOf(4, 7), minuteOf(4, 20));
    expect(farmDayStart(3)).toBe(minuteOf(3, 6));
    // Day 3: rain 08–11 (180 min) and the storm 04–06 of the next morning (120 min); the storm's −5 °C is the lowest offset.
    expect({ ...log.day(0, 3) }).toEqual({ region: 0, day: 3, rain: true, rainMinutes: 300, minOffsetC: -5 });
    // Day 4: the storm's last hour 06–07, then fog until 20:00; nothing is known after it.
    expect({ ...log.day(0, 4) }).toEqual({ region: 0, day: 4, rain: true, rainMinutes: 60, minOffsetC: -5 });
    expect(log.day(0, 5)).toBeUndefined();
    // Drizzle alone (precipitation 0.25 < rainThreshold) does not wet the fields.
    const { log: l2 } = handLog();
    l2.record(0, 'niesel', minuteOf(2, 6), minuteOf(3, 6));
    expect(F.rainThreshold).toBeGreaterThan(0.25);
    expect({ ...l2.day(0, 2) }).toMatchObject({ rain: false, rainMinutes: 0, minOffsetC: 0 });
  });

  it('eine nicht verfolgte Region ist unbekannt; T_min = Biom zur kältesten Stunde + Höhe + kleinster Versatz', () => {
    const { log, w } = handLog();
    expect(log.day(1, 3)).toBeUndefined();
    log.record(1, 'regen', minuteOf(3, 6), minuteOf(3, 9));
    expect(log.tracks(1)).toBe(false);
    expect(log.day(1, 3)).toBeUndefined();
    log.record(0, 'schneesturm', minuteOf(9, 22), minuteOf(10, 2));
    const season = w.calendar.seasonOfDay(9);
    expect(season).toBe('sommer');
    expect(log.minTemperatureC(0, 'gruenhain', 3, 9)).toBeCloseTo(biomeTemperatureC('gruenhain', season, F.coldestHour, { heightLevel: 3, weatherOffsetC: -10 }), 9);
    expect(log.maxTemperatureC(0, 'gruenhain', 0, 9)).toBeCloseTo(biomeTemperatureC('gruenhain', season, F.warmestHour, { heightLevel: 0, weatherOffsetC: -10 }), 9);
    // A day without a period: the biome's own night.
    expect(log.minTemperatureC(0, 'gruenhain', 0, 8)).toBeCloseTo(biomeTemperatureC('gruenhain', 'sommer', F.coldestHour), 9);
  });

  it('Regentage in Folge (Mehltau) zählen rückwärts bis zum ersten trockenen Tag', () => {
    const { log } = handLog();
    // Periods come in order (a new one drops what was told from its start on).
    for (const d of [2, 3, 4, 5, 6]) log.record(0, d === 3 ? 'klar' : 'regen', minuteOf(d, 12), minuteOf(d, 15));
    expect([log.rainStreak(0, 6, 5), log.rainStreak(0, 6, 2), log.rainStreak(0, 3, 5), log.rainStreak(0, 2, 5)]).toEqual([3, 2, 0, 1]);
  });
});

describe('gehört vom Wetterautomaten', () => {
  it('in kleinen Schritten (jede Spielstunde) gehört = in einem Sprung gehört (advanceTo)', () => {
    const steps = new FeldWelt();
    const jump = new FeldWelt();
    for (const w of [steps, jump]) w.farming.log.track(0);
    const days = 20;
    const hour = steps.perDay / 24;
    for (let h = 0; h < days * 24; h++) {
      steps.springe(hour);
      steps.weather?.worldTick();
    }
    jump.springe(days * jump.perDay);
    jump.farming.log.ensureUntil(jump.sim, farmDayStart(days + 1));
    expect(jump.farming.log.serialize()).toEqual(steps.farming.log.serialize());
    expect(jump.farming.log.periodCount).toBeGreaterThan(days);
    for (let d = 1; d <= days; d++) expect({ ...jump.farming.log.day(0, d) }, `Tag ${d}`).toEqual({ ...steps.farming.log.day(0, d) });
  });

  it('ein erzwungener Zustand (Konsole „weather“) kürzt die laufende Periode und zählt ab seinem Beginn', () => {
    const w = new FeldWelt();
    w.farming.log.track(0);
    w.springe(w.perDay / 4);
    w.weather?.worldTick();
    const now = Math.floor(w.weather?.nowMinute() ?? 0);
    w.weather?.force(0, 'schneesturm');
    const periods = w.farming.log.serialize().regions[0]?.periods ?? [];
    const last = periods[periods.length - 1];
    const before = periods[periods.length - 2];
    expect(last?.[0]).toBe(now);
    expect(last?.[2]).toBe('schneesturm');
    expect(before?.[1]).toBe(now);
    expect(w.farming.log.day(0, 1)?.minOffsetC).toBe(-10);
  });
});

describe('Verwerfen und Speichern', () => {
  it('Tage, die kein Beet mehr braucht, fallen weg – die eines eingefrorenen Beets bleiben', () => {
    const w = new FeldWelt().feld(X0 + 3, Y0 + 3);
    w.tage(30);
    const kept = w.farming.log.serialize().regions[0]?.periods ?? [];
    // Only the days the mildew streak still looks back on (and one spare day) remain.
    const oldest = farmDayStart(31 - 1 - F.pests.mildewRainDays - F.climateSpareDays);
    expect(kept.length).toBeGreaterThan(0);
    for (const [, end] of kept) expect(end).toBeGreaterThan(oldest);
    const bounded = w.farming.log.periodCount;
    expect(bounded).toBeLessThan(30);

    // A plot in a chunk outside the zone (chunk (6, 6)) waits since day 31: its days stay while the drawn chunk lives on.
    const far = { x: 6 * 32 + 4, y: 6 * 32 + 4 };
    w.feld(far.x, far.y);
    w.tage(10);
    const all = w.farming.log.serialize().regions[0]?.periods ?? [];
    expect(all.some(([s, e]) => s <= farmDayStart(31) && e > farmDayStart(31))).toBe(true);
    expect(w.farming.log.periodCount).toBeGreaterThan(bounded);
  });

  it('Speichern und Laden: dasselbe Protokoll, dieselben Tage', () => {
    const w = new FeldWelt().feld(X0 + 3, Y0 + 3);
    w.tage(12);
    const saved = w.farming.log.serialize();
    const copy = new FarmClimateLog({ seasonOfDay: (d) => w.calendar.seasonOfDay(d) });
    copy.restore(JSON.parse(JSON.stringify(saved)) as typeof saved);
    expect(copy.serialize()).toEqual(saved);
    for (let d = 8; d <= 12; d++) expect({ ...copy.day(0, d) }).toEqual({ ...w.farming.log.day(0, d) });
  });
});
