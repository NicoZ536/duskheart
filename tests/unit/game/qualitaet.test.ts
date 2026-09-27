/**
 * M4-03 Stationen-Framework (MASTERPROMPT §15.1 "Stationsstufen erhöhen Qualität, Tempo und verfügbare Rezepte",
 * §13.1 "Qualität 1–3 Sterne (aus Handwerks-Skill und Stationsstufe): +10 % bzw. +20 % auf Werte und Haltbarkeit"):
 * - Qualität: Punktzahl = Handwerk-Stufe + Qualitätspunkte der Station; ab 40 zwei, ab 80 drei Sterne; in der Hand
 *   höchstens zwei. Nur Stücke mit Haltbarkeit oder Werten haben eine Qualität.
 * - +10 %/+20 % auf Haltbarkeit (neue Stücke) und Werte (getragene Stücke) – auch auf die Kraft eines Werkzeugschlags
 *   (Review M4 #25), nie auf die Stufe dessen, was es öffnet (§13.2).
 * - Tempo: Werkbank II arbeitet ein Viertel schneller als Werkbank I.
 * - Verfügbare Rezepte: eine Station macht die Rezepte ihrer Linie bis zu ihrer Stufe; der Bronzeamboss verlangt
 *   Werkbank II, Werkbank II macht alles der Werkbank I. Die beste Station in Reichweite arbeitet.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { aggregateEquipmentStats } from '../../../src/game/equipment/formulas';
import { craftSeconds, craftTicks, hasQuality, qualityStars } from '../../../src/game/crafting/formulas';
import { hitsNeeded } from '../../../src/game/gathering/formulas';
import { hitPowerOf } from '../../../src/game/gathering/system';
import { maxDurability, qualityFactor } from '../../../src/game/items/formulas';
import { newStack } from '../../../src/game/items/stack';
import { contentStationCatalog } from '../../../src/game/stations/catalog';
import { field, gatherWorld, type GatherWorld } from './interaktion-testwelt';
import { catalog, eventsOf, rejections, stationWorld, TICK_HZ, type StationWorld } from './stationen-testwelt';

const Q = BALANCE.crafting.quality;

/** Sets the Handwerk level the crafting system sees (no bonus on time, no experience). */
function level(w: StationWorld, lvl: number): void {
  w.crafting.useSkills({ level: () => lvl, bonus: () => 0, award: () => 0, hasSource: () => true });
}

/** Crafts one piece of `recipe` and returns the finished stack of `item` in the bags. */
function craftOne(w: StationWorld, recipe: string, item: string): { qualitaet?: number; haltbarkeit?: number } {
  const r = w.crafting.recipes.get(recipe);
  const ev = w.run(Math.ceil(craftSeconds(r) * TICK_HZ) + 2, [{ type: 'craft.start', recipe, count: 1 }]);
  expect(rejections(ev)).toEqual([]);
  expect(eventsOf(ev, 'craftCompleted')).toHaveLength(1);
  const s = w.inventory.state;
  const stack = [...s.schnellleiste, ...s.inventar].find((x) => x?.item === item);
  if (stack === null || stack === undefined) throw new Error(`no ${item} made`);
  return stack;
}

describe('Qualitätsformel', () => {
  it('Sterne aus Handwerk-Stufe und Stationsstufe; in der Hand höchstens zwei', () => {
    expect(Q.thresholds).toEqual([40, 80]);
    expect(qualityStars(1, null)).toBe(1);
    expect(qualityStars(39, null)).toBe(1);
    expect(qualityStars(40, null)).toBe(2);
    expect(qualityStars(100, null)).toBe(Q.handMaxStars);
    expect(qualityStars(79, 0)).toBe(2);
    expect(qualityStars(80, 0)).toBe(3);
    // Werkbank II and the bronze anvil (+20): each star 20 levels earlier.
    const stations = contentStationCatalog();
    expect(stations.stage('werkbank').qualitaet).toBe(0);
    expect(stations.stage('werkbank_2').qualitaet).toBe(20);
    expect(stations.stage('amboss_bronze').qualitaet).toBe(20);
    expect(qualityStars(20, 20)).toBe(2);
    expect(qualityStars(60, 20)).toBe(3);
    expect(qualityStars(59, 20)).toBe(2);
  });

  it('+10 % / +20 % auf Haltbarkeit und Werte', () => {
    expect([1, 2, 3].map(qualityFactor)).toEqual([1, 1.1, 1.2]);
    const axe = catalog.get('bronzeaxt');
    expect(axe.haltbarkeit).toBe(150);
    expect([1, 2, 3].map((q) => newStack(axe, 1, { qualitaet: q }).haltbarkeit)).toEqual([150, 165, 180]);
    expect(maxDurability(60, 3)).toBe(72);
    const spear = catalog.get('steinspeer');
    const dmg = (q: number): number => aggregateEquipmentStats([{ def: spear, stack: newStack(spear, 1, { qualitaet: q }) }]).werte.schaden;
    expect(dmg(2) / dmg(1)).toBeCloseTo(1.1, 10);
    expect(dmg(3) / dmg(1)).toBeCloseTo(1.2, 10);
  });

  it('nur Stücke mit Haltbarkeit oder Werten haben eine Qualität', () => {
    expect(hasQuality(catalog.get('bronzeaxt'))).toBe(true);
    expect(hasQuality(catalog.get('steinspeer'))).toBe(true);
    expect(hasQuality(catalog.get('brett'))).toBe(false);
    expect(hasQuality(catalog.get('werkbank'))).toBe(false);
  });
});

/** Puts one `item` of `stars` into the first hotbar slot and selects it. */
function holdQuality(w: GatherWorld, item: string, stars: number): void {
  w.inventory.give(w.sim, item, 1, stars === 1 ? {} : { qualitaet: stars });
  const slot = w.inventory.state.inventar.findIndex((s) => s?.item === item);
  if (slot >= 0) w.run(1, [{ type: 'inventory.move', from: { bereich: 'inventar', index: slot }, to: { bereich: 'schnellleiste', index: 0 } }]);
  w.run(1, [{ type: 'player.selectHotbar', index: 0 }]);
  if (w.inventory.selected()?.item !== item) throw new Error(`could not hold ${item}`);
}

describe('Qualität der Werkzeuge beim Sammeln (§13.1 „+10 % bzw. +20 % auf Werte“)', () => {
  it('ein Drei-Sterne-Werkzeug schlägt 20 % kräftiger: der große Feldstein (10 HP) fällt nach 9 statt 10 Schlägen', () => {
    const hits = (stars: number): number => {
      // A large fieldstone (10 HP, hardness 1) at map (5, 5), the player below it.
      const w = gatherWorld(field(14, 12, ['', '', '', '', '', '.....G']));
      w.spawn(5, 7);
      holdQuality(w, 'probe_spitzhacke', stars);
      const held = w.interaction.heldTool();
      expect(held?.power).toBe(1);
      expect(held === null ? 0 : hitPowerOf(held)).toBeCloseTo(qualityFactor(stars), 12);
      w.run(1, [{ type: 'player.interact', on: true }]);
      const total = w.interaction.focus.hitsTotal;
      w.run(1, [{ type: 'player.interact', on: false }]);
      return total;
    };
    expect([hits(1), hits(2), hits(3)]).toEqual([10, hitsNeeded(10, qualityFactor(2)), 9]);
  });

  it('die Qualität hebt nie die Stufe: eine Drei-Sterne-Bronzespitzhacke (Kraft 2) öffnet keinen Eiskristall (Härte 3)', () => {
    const w = gatherWorld(field(14, 12, ['', '', '', '', '', '.....X']));
    w.spawn(5, 7);
    holdQuality(w, 'probe_bronzespitzhacke', 3);
    expect(w.interaction.heldTool()).toMatchObject({ power: 2, qualityFactor: qualityFactor(3) });
    w.run(1, [{ type: 'player.interact', on: true }]);
    expect(w.interaction.focus.tooWeak).toBe(true);
    w.run(1, [{ type: 'player.interact', on: false }]);
  });
});

describe('Qualität im Spiel', () => {
  it('Bronzeaxt am Bronzeamboss: Stufe 1 ⇒ 1 Stern, 20 ⇒ 2, 60 ⇒ 3 Sterne mit 180 Nutzungen', () => {
    for (const [lvl, stars, durability] of [
      [1, 1, 150],
      [20, 2, 165],
      [60, 3, 180],
    ] as const) {
      const w = stationWorld();
      w.place('amboss_bronze', 5, 4);
      w.give('bronzebarren', 3);
      w.give('holz', 2);
      w.run(1);
      level(w, lvl);
      const axe = craftOne(w, 'rezept_bronzeaxt', 'bronzeaxt');
      expect(axe.qualitaet ?? 1, `Stufe ${lvl}`).toBe(stars);
      expect(axe.haltbarkeit, `Stufe ${lvl}`).toBe(durability);
    }
  });

  it('in der Hand erreicht auch ein Meister nur zwei Sterne; Bretter haben nie eine Qualität', () => {
    const w = stationWorld();
    w.give('zweig', 2);
    w.give('stein', 2);
    w.give('faserseil', 1);
    w.run(1);
    level(w, 100);
    const axe = craftOne(w, 'rezept_steinaxt', 'steinaxt');
    expect(axe.qualitaet).toBe(2);
    expect(axe.haltbarkeit).toBe(66);
    const v = stationWorld();
    v.place('saegebock', 5, 4);
    v.give('holz', 1);
    v.run(1);
    level(v, 100);
    const plank = craftOne(v, 'rezept_brett', 'brett');
    expect(plank.qualitaet).toBeUndefined();
  });

  it('die echte Handwerk-Stufe zählt: freigeschaltet (Stufe 100) an der Werkbank ⇒ 3 Sterne', () => {
    const w = stationWorld();
    w.place('werkbank', 5, 4);
    w.life.skills.unlock(w.sim, 'handwerk');
    w.give('brett', 4);
    w.give('faserseil', 1);
    w.give('harz', 1);
    w.run(1);
    expect(w.life.skills.level('handwerk')).toBe(100);
    const bucket = craftOne(w, 'rezept_holzeimer_werkbank', 'holzeimer');
    expect(bucket.qualitaet).toBe(3);
    expect(bucket.haltbarkeit).toBe(maxDurability(BALANCE.items.durabilityByTier[0] as number, 3));
  });
});

describe('Tempo und verfügbare Rezepte je Stufe', () => {
  it('Werkbank II arbeitet ein Viertel schneller als Werkbank I', () => {
    expect(contentStationCatalog().stage('werkbank_2').tempo).toBe(1.25);
    const ticksAt = (station: string): number => {
      const w = stationWorld();
      w.place(station, 5, 4);
      w.give('lehm', 2);
      w.give('sand', 1);
      w.give('strohbuendel', 1);
      w.run(1);
      const ev = w.run(1, [{ type: 'craft.start', recipe: 'rezept_lehmputz', count: 1 }]);
      return eventsOf<{ ticks: number }>(ev, 'craftStarted')[0]?.ticks ?? 0;
    };
    const base = Math.ceil(BALANCE.crafting.durationSeconds.handgriff * TICK_HZ);
    expect(ticksAt('werkbank')).toBe(base);
    expect(ticksAt('werkbank_2')).toBe(craftTicks(BALANCE.crafting.durationSeconds.handgriff, 0, 1.25));
    expect(ticksAt('werkbank_2')).toBeLessThan(base);
  });

  it('der Bronzeamboss verlangt Werkbank II; Werkbank II macht auch, was Werkbank I macht; die beste Station arbeitet', () => {
    const w = stationWorld();
    w.place('werkbank', 5, 4);
    w.give('bronzebarren', 6);
    w.give('steinblock', 2);
    w.give('balken', 1);
    w.run(1);
    w.crafting.meetStation(w.sim, 'werkbank_2');
    expect(w.crafting.isVisible('rezept_amboss_bronze')).toBe(true);
    expect(rejections(w.run(1, [{ type: 'craft.start', recipe: 'rezept_amboss_bronze', count: 1 }]))).toEqual(['noStation']);
    w.place('werkbank_2', 5, 6);
    expect(rejections(w.run(1, [{ type: 'craft.start', recipe: 'rezept_amboss_bronze', count: 1 }]))).toEqual([]);
    expect(w.crafting.orders[0]?.station).toBe('werkbank_2');
    // A Werkbank I recipe with both benches in reach: the better one works it.
    expect(w.crafting.stationAtHand(w.sim, 'werkbank')?.station).toBe('werkbank_2');
    expect(CONTENT.collection('stations').get('werkbank_2').linie).toBe('werkbank');
  });
});
