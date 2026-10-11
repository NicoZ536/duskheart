/**
 * M7-26: meal effects (MASTERPROMPT §18 "Mahlzeit-Effekte: höchstens 2 verschiedene gleichzeitig; Überdruss: dieselbe Speise
 * 3× an einem Tag → −50 % Nährwert, klingt über 2 Tage ab; Salz → Durst", §12.3 "Wohlfühlessen", §16.4 "Küche … +10 %
 * Mahlzeitwirkung", "Speisesaal … Essen senkt Furcht zusätzlich"; docs/SPIEL.md §21): the pure rules of src/game/meals/formulas.ts,
 * then the meals system on the life test world – eating through `action.eat` with the eat hook.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { consumeTicks } from '../../../src/game/actions/formulas';
import type { Nutrition } from '../../../src/game/actions/hooks';
import { bored, comfortOf, countsForBoredom, decayedBoredom, effectSeconds, fromKitchen, isRawMeat, mealNutrition } from '../../../src/game/meals/formulas';
import { MEALS_SAVE_VERSION } from '../../../src/game/meals/system';
import { kuecheKatalog, kuecheWelt, type KuecheWelt } from './kueche-testwelt';

const M = BALANCE.meals;
const INV0 = { bereich: 'inventar', index: 0 } as const;
const items = kuecheKatalog;

function nutrition(satiety: number, thirst: number, fearRelief = 0): Nutrition {
  return { satiety, thirst, fearRelief };
}

function welt(): KuecheWelt {
  const w = kuecheWelt();
  w.spawn(10, 10);
  w.vit().satiety = 10;
  w.vit().thirst = 50;
  return w;
}

/** Eats one piece of `item` (from a fresh stack in inventar 0, `daten` optional) and returns the events of the meal. */
function eat(w: KuecheWelt, item: string, daten?: Record<string, boolean>): Map<string, unknown[]> {
  const st = w.stack(item, 1);
  w.put(daten === undefined ? st : { ...st, daten });
  const def = items.get(item);
  const ticks = consumeTicks(def.kategorie as Parameters<typeof consumeTicks>[0]);
  return w.run(ticks + 2, [{ type: 'action.eat', from: INV0 }]);
}

function eaten(ev: Map<string, unknown[]>): { satiety: number; thirst: number } {
  const e = (ev.get('itemEaten') ?? []) as Array<{ satiety: number; thirst: number }>;
  if (e.length !== 1) throw new Error(`expected one itemEaten, got ${e.length}`);
  return e[0] as { satiety: number; thirst: number };
}

function meal(ev: Map<string, unknown[]>): { item: string; effekte: string[]; ueberdruss: number; kueche: boolean; roh: boolean } {
  const e = (ev.get('mealEaten') ?? []) as Array<{ item: string; effekte: string[]; ueberdruss: number; kueche: boolean; roh: boolean }>;
  if (e.length !== 1) throw new Error(`expected one mealEaten, got ${e.length}`);
  return e[0] as { item: string; effekte: string[]; ueberdruss: number; kueche: boolean; roh: boolean };
}

describe('Mahlzeiten (reine Regeln)', () => {
  it('Überdruss ab dem dritten Stück: Zähler ≥ 2 vor dem Essen, je Morgen −1,5, nie unter 0', () => {
    expect([0, 1, 1.5, 2, 3].map(bored)).toEqual([false, false, false, true, true]);
    expect([3, 2, 1.5, 1, 0].map(decayedBoredom)).toEqual([1.5, 0.5, 0, 0, 0]);
    // §18 "klingt über 2 Tage ab": the three pieces of a greedy day are forgotten after the second dawn.
    expect(decayedBoredom(decayedBoredom(3))).toBe(0);
  });

  it('Überdruss halbiert Sättigung und positiven Durst, nie den Durst, den Salz nimmt', () => {
    const eintopf = items.get('eintopf');
    expect(mealNutrition(eintopf, true, false, false, nutrition(38, 12))).toEqual(nutrition(19, 6, 10));
    const trocken = items.get('trockenfleisch');
    // −2 thirst of the dish stays (no halving of a loss), salt takes 6 more.
    expect(mealNutrition(trocken, true, false, false, nutrition(18, -2))).toEqual(nutrition(9, -8, 10));
  });

  it('Küche: +10 % Sättigung, Durst und Trost; Speisesaal: +5 Furchtlinderung', () => {
    const kuchen = items.get('beerenkuchen');
    const n = mealNutrition(kuchen, false, true, false, nutrition(26, 2));
    expect(n.satiety).toBeCloseTo(26 * M.kitchen.effect, 12);
    expect(n.thirst).toBeCloseTo(2 * M.kitchen.effect, 12);
    expect(n.fearRelief).toBeCloseTo(20 * M.kitchen.effect, 12);
    expect(mealNutrition(kuchen, false, false, true, nutrition(26, 2)).fearRelief).toBe(20 + M.diningHallComfort);
    expect(effectSeconds(600, true)).toBeCloseTo(660, 9);
    expect(effectSeconds(600, false)).toBe(600);
  });

  it('Wohlfühlessen: der größere Wert aus Gerichtstrost und eigenem wohlfuehl; Tränke zählen nicht zum Überdruss', () => {
    expect(comfortOf(items.get('beerenkuchen'))).toBe(20);
    expect(comfortOf(items.get('eintopf'))).toBe(10);
    expect(countsForBoredom(items.get('eintopf'))).toBe(true);
    expect(countsForBoredom(items.get('apfel'))).toBe(true);
    expect(countsForBoredom(items.get('heiltrank'))).toBe(false);
    expect(isRawMeat('wildfleisch_roh')).toBe(true);
    expect(isRawMeat('forelle')).toBe(true);
    expect(isRawMeat('gebratenes_fleisch')).toBe(false);
    expect(fromKitchen({ daten: { kueche: true } })).toBe(true);
    expect(fromKitchen({})).toBe(false);
  });
});

describe('Mahlzeiten im Spiel', () => {
  it('dieselbe Speise dreimal an einem Tag: das dritte Stück sättigt halb; nach zwei Morgen wieder voll', () => {
    const w = welt();
    const first = eaten(eat(w, 'brot'));
    const second = eaten(eat(w, 'brot'));
    const ev = eat(w, 'brot');
    const third = eaten(ev);
    expect(first.satiety).toBe(22);
    expect(second.satiety).toBe(22);
    expect(third.satiety).toBe(11);
    expect(meal(ev).ueberdruss).toBe(0.5);
    expect(w.meals.boredom('brot')).toBe(3);
    // Another dish is not affected.
    expect(eaten(eat(w, 'gebratener_fisch')).satiety).toBe(24);
    w.meals.dailyTick();
    expect(w.meals.boredom('brot')).toBe(1.5);
    w.meals.dailyTick();
    expect(w.meals.boredom('brot')).toBe(0);
    expect(eaten(eat(w, 'brot')).satiety).toBe(22);
  });

  it('höchstens zwei Mahlzeit-Effekte: der dritte verdrängt den ältesten', () => {
    const w = welt();
    expect(meal(eat(w, 'eintopf')).effekte).toEqual(['gestaerkt']);
    expect(meal(eat(w, 'fischsuppe')).effekte).toEqual(['ausdauernd']);
    const ev = eat(w, 'pilzragout');
    expect(meal(ev).effekte).toEqual(['nachtsicht']);
    const removed = (ev.get('conditionRemoved') ?? []) as Array<{ id: string; reason: string }>;
    expect(removed).toEqual([expect.objectContaining({ id: 'gestaerkt', reason: 'verdraengt' })]);
    expect(w.life.conditions.has('gestaerkt')).toBe(false);
    expect(w.life.conditions.has('ausdauernd')).toBe(true);
    expect(w.life.conditions.has('nachtsicht')).toBe(true);
    // A potion's condition is no meal effect: it joins without pushing one out.
    eat(w, 'waermetrank');
    expect(w.life.conditions.has('gewaermt')).toBe(true);
    expect(w.life.conditions.has('ausdauernd') && w.life.conditions.has('nachtsicht')).toBe(true);
  });

  it('Salz nimmt Durst: Trockenfleisch −2 und −6 Salz', () => {
    const w = welt();
    expect(eaten(eat(w, 'trockenfleisch')).thirst).toBe(-8);
  });

  it('Wohlfühlessen lindert Furcht: Beerenkuchen −20, aus der Küche −22, im Speisesaal 5 mehr', () => {
    /** The fear the meal itself calmed (`fearChanged` of the comfort food; the day's own decay runs beside it). */
    const calmed = (w: KuecheWelt, daten?: Record<string, boolean>): number => {
      w.life.fear.spike(w.sim, 60, 'nahrung');
      const ev = eat(w, 'beerenkuchen', daten);
      const c = ((ev.get('fearChanged') ?? []) as Array<{ amount: number; reason: string }>).filter((e) => e.reason === 'wohlfuehlessen');
      expect(c).toHaveLength(1);
      return -(c[0] as { amount: number }).amount;
    };
    expect(calmed(welt())).toBe(20);
    expect(calmed(welt(), { kueche: true })).toBeCloseTo(20 * M.kitchen.effect, 9);
    const d = welt();
    d.room(10, 10, 'speisesaal');
    expect(calmed(d)).toBe(20 + M.diningHallComfort);
  });

  it('Gericht aus der Küche: +10 % Sättigung und +10 % Dauer des Zustands', () => {
    const w = welt();
    const ev = eat(w, 'eintopf', { kueche: true });
    expect(eaten(ev).satiety).toBeCloseTo(38 * M.kitchen.effect, 9);
    expect(meal(ev).kueche).toBe(true);
    const left = w.life.conditions.remainingSeconds('gestaerkt', BALANCE.time.tickHz) ?? 0;
    expect(left).toBeGreaterThan(600);
    expect(left).toBeLessThanOrEqual(660);
  });

  it('rohes Fleisch vergiftet zu 30 % (Strom meals), gebratenes nie', () => {
    const w = welt();
    let roh = 0;
    const n = 40;
    for (let i = 0; i < n; i++) {
      const m = meal(eat(w, 'wildfleisch_roh'));
      if (m.roh) roh++;
      w.life.conditions.cure(w.sim, 'lebensmittelvergiftung');
      w.vit().satiety = 10;
    }
    expect(roh / n).toBeGreaterThan(0.1);
    expect(roh / n).toBeLessThan(0.5);
    const g = welt();
    for (let i = 0; i < 10; i++) {
      expect(meal(eat(g, 'gebratenes_fleisch')).roh).toBe(false);
      g.vit().satiety = 10;
    }
    expect(g.life.conditions.has('lebensmittelvergiftung')).toBe(false);
  });

  it('Teilnehmer meals: Überdruss-Zähler sortiert gespeichert, unbekannte oder ungeordnete Gerichte abgelehnt', () => {
    const w = welt();
    eat(w, 'brot');
    eat(w, 'brot');
    eat(w, 'apfelkuchen');
    const data = w.meals.save.serialize();
    expect(data).toEqual({ ueberdruss: [['apfelkuchen', 1], ['brot', 2]] });
    expect(w.meals.save.version).toBe(MEALS_SAVE_VERSION);
    const v = welt();
    v.meals.save.deserialize(JSON.parse(JSON.stringify(data)));
    expect(v.meals.boredom('brot')).toBe(2);
    expect(() => v.meals.save.deserialize({ ueberdruss: [['gibtsnicht', 1]] })).toThrow(/unknown dish/);
    expect(() => v.meals.save.deserialize({ ueberdruss: [['brot', 1], ['apfelkuchen', 1]] })).toThrow(/ascending/);
    expect(() => v.meals.save.deserialize({ ueberdruss: [['brot', 0.3]] })).toThrow(/multiple of 0.5/);
    expect(v.meals.boredom('brot')).toBe(2);
  });
});
