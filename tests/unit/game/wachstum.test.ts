/**
 * M7-19 Landwirtschaft (MASTERPROMPT §17 "Wachstum täglich um 06:00 (lazy): Stufe steigt bei Feuchte > 20, passender Jahreszeit
 * (oder Gewächshaus) und Temperatur > 2 °C. Frost tötet Nicht-Winterpflanzen im Freien"; docs/SPIEL.md §20, §28):
 * - die Hacke legt Acker an (Fruchtbarkeit und Feuchte 0–100), Beet-Bauteile sind Acker ohne Hacke; Zuschütten, Abbauen und
 *   Überbauen löschen ihn;
 * - Feuchte: Regen des Vortags → 100, sonst Austrocknen nach Wärme und Wasserbedarf; Gießkanne → 100; Wasser in der Nähe hält 60;
 * - Wachstum nur um 06:00, nach `tageJeStufe` guten Tagen eine Stufe; Feuchte ≤ 20, falsche Jahreszeit und T_min ≤ 2 °C halten
 *   an; Frost tötet Nicht-Winterpflanzen im Freien; das Gewächshaus wächst ganzjährig;
 * - Aufholen: aktiv ≡ eingefroren + aufgeholt ≡ a → b → c ≡ wechselnd, Bit für Bit, mit dem echten Wetter des Seeds und einem
 *   Zeitsprung ohne Welt-Tick (`skipTicks`).
 */
import { describe, expect, it } from 'vitest';
import { CROPS } from '../../../src/content/farming/index';
import { canCharges, dailyDrying, withCharges } from '../../../src/game/farming/index';
import { newStack } from '../../../src/game/items/stack';
import { F, FeldWelt, X0, Y0, beete, feldCatalog, reifeTage } from './feld-testwelt';

const crop = (id: string): (typeof CROPS)[number] => CROPS.find((c) => c.id === id) as (typeof CROPS)[number];
const A = { x: X0 + 3, y: Y0 + 3 };
const B = { x: X0 + 10, y: Y0 + 3 };
const C = { x: X0 + 3, y: Y0 + 12 };

describe('Acker und Beet', () => {
  it('die Hacke legt Acker an: Fruchtbarkeit 50, Startfeuchte, leer; Zuschütten löscht ihn', () => {
    const w = new FeldWelt({ wetter: 'hand' }).feld(A.x, A.y);
    const p = w.beet(A.x, A.y);
    expect([p.fertility, p.moisture, p.crop, p.stage, p.dead, p.sheltered]).toEqual([F.startFertility, F.startMoisture, '', 0, false, false]);
    expect(F.startFertility).toBe(50);
    expect(w.ereignisse('plotCreated')).toEqual([{ layer: 0, tx: A.x, ty: A.y, beet: false, tick: expect.any(Number) }]);
    w.farming.tilled(w.sim, 0, A.x, A.y, false);
    expect(w.farming.isPlot(0, A.x, A.y)).toBe(false);
    expect(w.ereignisse('plotRemoved').map((e) => e.reason)).toEqual(['zugeschuettet']);
  });

  it('ein Beet-Bauteil ist Acker ohne Hacke, Abbauen löscht es; ein anderes Bauteil überbaut einen Acker', () => {
    const w = new FeldWelt({ wetter: 'hand' });
    w.farming.partPlaced(w.sim, true, 0, A.x, A.y, 1, 1);
    expect(w.beet(A.x, A.y).fertility).toBe(F.startFertility);
    expect(w.ereignisse('plotCreated').map((e) => e.beet)).toEqual([true]);
    w.farming.partRemoved(w.sim, true, 0, A.x, A.y);
    expect(w.farming.isPlot(0, A.x, A.y)).toBe(false);
    w.feld(B.x, B.y).feld(B.x + 1, B.y);
    w.farming.useGround((_l, tx) => tx === B.x);
    w.farming.partPlaced(w.sim, false, 0, B.x, B.y, 1, 1);
    expect([w.farming.isPlot(0, B.x, B.y), w.farming.isPlot(0, B.x + 1, B.y)]).toEqual([false, true]);
    expect(w.ereignisse('plotRemoved').map((e) => e.reason)).toEqual(['abgebaut', 'ueberbaut']);
  });
});

describe('Feuchte', () => {
  it('trocknet je Tag um dailyDrying × Wärme × Wasserbedarf; Regen des Vortags → 100; Wasser in der Nähe hält 60', () => {
    const w = new FeldWelt({ wetter: 'hand' }).wasser(C.x + 2, C.y).feld(A.x, A.y).feld(C.x, C.y).feld(B.x, B.y).saeen(B.x, B.y, 'salat');
    w.morgen();
    const maxC = w.farming.log.maxTemperatureC(0, 'gruenhain', 0, 1);
    expect(maxC).toBeGreaterThan(F.dryingReferenceC);
    const empty = Math.round(F.startMoisture - dailyDrying(maxC, null));
    expect(w.beet(A.x, A.y).moisture).toBe(empty);
    // Salad needs much water: it dries its plot faster.
    expect(w.beet(B.x, B.y).moisture).toBe(Math.max(0, Math.round(F.startMoisture - dailyDrying(maxC, crop('salat')))));
    expect(w.beet(B.x, B.y).moisture).toBeLessThan(empty);
    expect(w.beet(C.x, C.y).moisture).toBe(F.waterNearMoisture);
    // Rain on day 2 (three hours in the afternoon): at the next dawn every plot is wet.
    w.wetter('regen', 2, 14, 3).morgen();
    expect([w.beet(A.x, A.y).moisture, w.beet(B.x, B.y).moisture, w.beet(C.x, C.y).moisture]).toEqual([100, 100, 100]);
    // Drizzle is too light to wet a field.
    w.wetter('niesel', 3, 8, 5).morgen();
    expect(w.beet(A.x, A.y).moisture).toBeLessThan(100);
  });

  it('die Gießkanne: Feuchte 100 und eine Ladung weniger; nasser Boden und leere Kanne lehnen ab', () => {
    const w = new FeldWelt({ wetter: 'hand' }).feld(A.x, A.y);
    w.tage(1);
    const full = withCharges(newStack(feldCatalog.get('giesskanne'), 1), F.canCharges);
    expect(w.farming.waterProblem(0, A.x, A.y, full)).toBeNull();
    const after = w.farming.water(w.sim, 0, A.x, A.y, full);
    expect(canCharges(after)).toBe(F.canCharges - 1);
    expect(w.beet(A.x, A.y)).toMatchObject({ moisture: 100, lastWateredDay: w.sim.clock.day });
    expect(w.farming.waterProblem(0, A.x, A.y, after)).toBe('soilWet');
    w.tage(1);
    expect(w.farming.waterProblem(0, A.x, A.y, withCharges(after, 0))).toBe('canEmpty');
    expect(w.farming.waterProblem(0, B.x, B.y, after)).toBe('noPlot');
    expect(w.ereignisse('plotWatered')).toHaveLength(1);
  });
});

describe('Wachstum um 06:00', () => {
  it('Karotte am Wasser: eine Stufe je zwei gute Tage, reif nach acht Morgen – Stufen nur um 06:00', () => {
    const karotte = crop('karotte');
    expect([karotte.stufen, karotte.tageJeStufe, reifeTage(karotte)]).toEqual([5, 2, 8]);
    const w = new FeldWelt({ wetter: 'hand' }).wasser(A.x + 1, A.y).feld(A.x, A.y).saeen(A.x, A.y, 'karotte');
    expect(w.awarded).toEqual([F.experience.planted]);
    w.springe(w.perDay / 2);
    expect(w.beet(A.x, A.y)).toMatchObject({ crop: 'karotte', stage: 0, daysInStage: 0 });
    const stages: number[] = [];
    for (let d = 0; d < 9; d++) {
      w.morgen();
      stages.push(w.beet(A.x, A.y).stage);
      // Between two dawns nothing grows.
      w.springe(w.perDay / 3);
      expect(w.beet(A.x, A.y).stage).toBe(stages[d]);
    }
    expect(stages).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect(w.ereignisse('cropRipe').map((e) => [e.crop, e.tx])).toEqual([['karotte', A.x]]);
    expect(w.farming.harvestState(0, A.x, A.y)).toBe('ernten');
  });

  it('Feuchte ≤ 20: die Pflanze wartet; gegossen wächst sie weiter', () => {
    const w = new FeldWelt({ wetter: 'hand' }).feld(A.x, A.y).saeen(A.x, A.y, 'karotte');
    w.morgen();
    // Day 1 began moist (50): it counted; the plot dried below 20.
    expect(w.beet(A.x, A.y)).toMatchObject({ stage: 0, daysInStage: 1 });
    expect(w.beet(A.x, A.y).moisture).toBeLessThanOrEqual(F.growthMoistureAbove);
    w.morgen();
    expect(w.beet(A.x, A.y)).toMatchObject({ stage: 0, daysInStage: 1 });
    w.farming.water(w.sim, 0, A.x, A.y, withCharges(newStack(feldCatalog.get('giesskanne'), 1), 3));
    w.morgen();
    expect(w.beet(A.x, A.y)).toMatchObject({ stage: 1, daysInStage: 0 });
  });

  it('außerhalb der Jahreszeit wächst nichts – im Gewächshaus doch', () => {
    expect(crop('bohne').jahreszeiten).toEqual(['sommer']);
    const w = new FeldWelt({ wetter: 'hand' }).wasser(A.x + 1, A.y).wasser(B.x + 1, B.y).feld(A.x, A.y).feld(B.x, B.y);
    w.saeen(A.x, A.y, 'bohne').saeen(B.x, B.y, 'bohne');
    w.greenhouse.add(`${B.x},${B.y}`);
    w.farming.surroundingsChanged();
    expect(w.calendar.seasonOfDay(1)).toBe('fruehling');
    w.tage(2);
    expect([w.beet(A.x, A.y).stage, w.beet(B.x, B.y).stage]).toEqual([0, 1]);
    expect([w.beet(A.x, A.y).sheltered, w.beet(B.x, B.y).sheltered]).toEqual([false, true]);
  });

  it('T_min ≤ 2 °C hält an (Herbst-Regentag); Frost tötet Nicht-Winterpflanzen im Freien, die welke Pflanze vergeht', () => {
    const w = new FeldWelt({ wetter: 'hand' });
    w.tage(14);
    expect(w.calendar.seasonOfDay(15)).toBe('herbst');
    w.wasser(A.x + 1, A.y).feld(A.x, A.y).saeen(A.x, A.y, 'karotte');
    // A rainy autumn day: wet, but the night falls to 4.5 − 3 = 1.5 °C – no growth, no frost.
    w.wetter('regen', 15, 6, 24).morgen();
    expect(w.farming.log.minTemperatureC(0, 'gruenhain', 0, 15)).toBeCloseTo(1.5, 1);
    expect(w.beet(A.x, A.y)).toMatchObject({ moisture: 100, stage: 0, daysInStage: 0, dead: false });
    // Winter (day 22 on): T_min ≈ −5.9 °C.
    w.tage(6);
    expect(w.calendar.seasonOfDay(22)).toBe('winter');
    w.feld(B.x, B.y).feld(C.x, C.y).wasser(C.x + 1, C.y);
    const D = { x: C.x + 6, y: C.y };
    w.feld(D.x, D.y).wasser(D.x + 1, D.y);
    w.farming.clearDead(w.sim, 0, A.x, A.y, w.sim.tick);
    w.saeen(A.x, A.y, 'karotte').saeen(B.x, B.y, 'ruebe').saeen(C.x, C.y, 'karotte').saeen(D.x, D.y, 'kohl');
    w.greenhouse.add(`${C.x},${C.y}`);
    w.farming.surroundingsChanged();
    w.ereignisse('cropDied');
    w.morgen();
    expect(w.farming.log.minTemperatureC(0, 'gruenhain', 0, 22)).toBeLessThan(F.frostBelowC);
    expect(w.ereignisse('cropDied').map((e) => [e.crop, e.grund])).toEqual([['karotte', 'frost']]);
    expect(w.beet(A.x, A.y)).toMatchObject({ crop: 'karotte', dead: true });
    expect(w.farming.harvestState(0, A.x, A.y)).toBe('raeumen');
    // Winter-hardy turnip and cabbage live, but do not grow in the cold; the greenhouse carrot grows.
    expect([w.beet(B.x, B.y).dead, w.beet(B.x, B.y).daysInStage, w.beet(D.x, D.y).dead, w.beet(D.x, D.y).daysInStage]).toEqual([false, 0, false, 0]);
    expect(w.beet(C.x, C.y)).toMatchObject({ dead: false, daysInStage: 1 });
    w.tage(F.wiltedDays);
    expect(w.beet(A.x, A.y)).toMatchObject({ crop: '', dead: false });
    expect(w.beet(C.x, C.y).stage).toBe(2);
  });
});

describe('Aufholen: aktiv ≡ eingefroren + aufgeholt ≡ a → b → c', () => {
  const DAYS = 40;

  /** A field of every crop, some at water, a greenhouse bed, a fenced bed and a scarecrow; the real weather of the seed. */
  function feld(): FeldWelt {
    const w = new FeldWelt();
    w.wasser(X0 + 20, Y0 + 2);
    CROPS.forEach((c, k) => {
      const tx = X0 + 2 + (k % 9) * 2;
      const ty = Y0 + 2 + Math.floor(k / 9) * 6;
      w.feld(tx, ty).saeen(tx, ty, c.id);
    });
    w.feld(X0 + 2, Y0 + 20).saeen(X0 + 2, Y0 + 20, 'tomate');
    w.feld(X0 + 6, Y0 + 20).saeen(X0 + 6, Y0 + 20, 'kohl');
    w.feld(X0 + 10, Y0 + 20).feld(X0 + 12, Y0 + 20);
    w.greenhouse.add(`${X0 + 2},${Y0 + 20}`);
    w.enclosed.add(`${X0 + 6},${Y0 + 20}`);
    w.scarecrows.add(`${X0 + 4},${Y0 + 2}`);
    w.farming.surroundingsChanged();
    w.farming.worldTick(w.sim);
    w.ereignisse('plotCreated');
    return w;
  }

  function aktiv(): FeldWelt {
    return feld().tage(DAYS);
  }

  /** Frozen in `pieces` jumps (each ending at a tick inside a day, the last on dawn `DAYS`), caught up after each. */
  function eingefroren(pieces: readonly number[]): FeldWelt {
    const w = feld();
    const end = DAYS * w.perDay;
    for (const p of pieces) {
      w.einfrieren().springe(Math.min(p, end - w.sim.tick)).aufwachen();
    }
    w.einfrieren().springe(end - w.sim.tick).aufwachen();
    return w;
  }

  it('40 Tage mit allen 18 Pflanzen, Regen, Frost und Schädlingen: dieselben Beete Bit für Bit', () => {
    const a = aktiv();
    const expected = beete(a);
    const events = { ripe: a.ereignisse('cropRipe').length };
    expect(a.sim.tick).toBe(DAYS * a.perDay);
    // Something happened: crops ripened, the winter came, rain fell.
    expect(events.ripe).toBeGreaterThan(5);
    let rainy = 0;
    for (let d = 1; d <= DAYS; d++) if (a.farming.log.day(0, d)?.rain === true) rainy++;
    expect(rainy).toBeGreaterThan(0);

    const once = eingefroren([]);
    expect(beete(once)).toEqual(expected);
    // Catching up is silent: nothing ripened with a sound in the frozen chunk.
    expect(once.ereignisse('cropRipe')).toEqual([]);

    const T = once.perDay;
    const abc = eingefroren([13 * T + 5_000, 11 * T + 77]);
    expect(beete(abc)).toEqual(expected);
  });

  it('wechselnd aktiv und eingefroren (Stücke quer über die Morgen) = durchgehend aktiv', () => {
    const expected = beete(aktiv());
    const w = feld();
    const end = DAYS * w.perDay;
    let on = true;
    let k = 0;
    while (w.sim.tick < end) {
      const piece = Math.min(end - w.sim.tick, Math.round(w.perDay * (0.7 + (k++ % 5) * 0.45)));
      if (on) {
        // Active: every dawn of the piece is lived at the dawn.
        const target = w.sim.tick + piece;
        while (w.sim.tick + (w.perDay - (w.sim.tick % w.perDay)) <= target) w.morgen();
        w.springe(target - w.sim.tick);
        w.einfrieren();
      } else {
        w.springe(piece).aufwachen();
      }
      on = !on;
    }
    if (!w.active) w.aufwachen();
    expect(beete(w)).toEqual(expected);
  });

  it('skipTicks ohne Welt-Tick: das Wetter läuft nicht mit, das Aufholen holt es nach (ensureUntil)', () => {
    const w = feld();
    const heard = w.farming.log.periodCount;
    w.einfrieren().springe(DAYS * w.perDay - w.sim.tick);
    // The jump ran no world tick: the log has heard nothing new yet.
    expect(w.farming.log.periodCount).toBe(heard);
    w.aufwachen();
    expect(w.farming.log.periodCount).toBeGreaterThan(heard + DAYS);
    expect(beete(w)).toEqual(beete(aktiv()));
  });
});
