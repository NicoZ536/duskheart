/**
 * M7-30: water (MASTERPROMPT §18 "Wasser: Flüsse und Seen ungefiltert (Nebelmoor 50 % Fieberrisiko, sonst 10 %), Abkochen macht
 * sauber, Regensammler, … Trinkschlauch (5 Schlucke), … geschmolzener Schnee, Tees"; docs/SPIEL.md §21 "Wasser"): the water
 * skin filled at a bank keeps that water's fever risk, boiling and snow melting give clean water in the bucket, the rain
 * collector fills at 06:00 from the climate log (not under a roof; a frozen one catches up the same), sips from collector,
 * skin and bucket, the E targets, the refusals and the participant.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { sipTicks } from '../../../src/game/actions/formulas';
import { createUseOffer } from '../../../src/game/interaction/uses';
import { collectorSips, filledCollector, isVessel, mixedFever, vesselFever, vesselSips, withWater } from '../../../src/game/water/formulas';
import { WATER_SAVE_VERSION } from '../../../src/game/water/system';
import { minuteOf } from '../../../src/world/climate/gameTime';
import { WATER_DEPTH_SHALLOW, WATER_FROZEN, WATER_LAKE, WATER_SEA, WATER_SPRING } from '../../../src/world/model/chunk';
import { CHUNK_SHIFT } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { kuecheKatalog, kuecheWelt, type KuecheWelt } from './kueche-testwelt';
import { OFFSET } from './spieler-testwelt';

const W = BALANCE.water;
const HAND = { bereich: 'schnellleiste', index: 0 } as const;

function welt(): KuecheWelt {
  const w = kuecheWelt();
  w.spawn(10, 10);
  w.vit().thirst = 20;
  w.run(1);
  return w;
}

/** Water bits (and biome) on drawn tile (x, y). */
function water(w: KuecheWelt, x: number, y: number, bits: number, biome?: string): void {
  const { chunk, i } = w.chunks.at(OFFSET + x, OFFSET + y);
  chunk.water[i] = bits;
  if (biome !== undefined) chunk.biome[i] = contentWorldIdTables().biomes.runtimeId(biome);
}

/** Puts `item` into the hand (quick bar 0, selected). */
function hold(w: KuecheWelt, item: string, daten?: Record<string, number>): void {
  const st = w.stack(item);
  w.put(daten === undefined ? st : { ...st, daten }, HAND);
}

function rejected(ev: Map<string, unknown[]>): string[] {
  return ((ev.get('commandRejected') ?? []) as Array<{ reason: string }>).map((r) => r.reason);
}

describe('Wasser (reine Regeln)', () => {
  it('Regensammler: Regenminuten bis 300, ein Schluck je 15 Minuten', () => {
    expect(filledCollector(0, 120)).toBe(120);
    expect(filledCollector(250, 120)).toBe(W.collector.capacityMinutes);
    expect(collectorSips(74)).toBe(4);
    expect(collectorSips(W.collector.capacityMinutes)).toBe(20);
  });

  it('Gefäße: Trinkschlauch und Eimer abgekochten Wassers; ein voller abgekochter Eimer ohne Daten hat fünf Schlucke', () => {
    const schlauch = kuecheKatalog.get('trinkschlauch');
    const eimer = kuecheKatalog.get('wasser_abgekocht');
    expect(isVessel(schlauch) && isVessel(eimer)).toBe(true);
    expect(isVessel(kuecheKatalog.get('holzeimer'))).toBe(false);
    expect(schlauch.ladungen?.max).toBe(W.skin.sips);
    expect(vesselSips({ item: 'wasser_abgekocht', count: 1 }, eimer)).toBe(5);
    expect(vesselSips({ item: 'trinkschlauch', count: 1 }, schlauch)).toBe(0);
    const voll = withWater({ item: 'trinkschlauch', count: 1 }, 5, 0.1);
    expect([vesselSips(voll, schlauch), vesselFever(voll)]).toEqual([5, 0.1]);
    expect(vesselFever(withWater(voll, 4, 0))).toBe(0);
    // Mixing keeps the worse water: a skin with a sip of lake water topped up at a spring stays risky.
    expect(mixedFever(1, 0.1, 0)).toBe(0.1);
    expect(mixedFever(0, 0.1, 0)).toBe(0);
  });

  it('Inhalt: Abkochen am Lagerfeuer und im Kessel, Schnee schmelzen, Schnee aus dem Graben, Tees brauchen Wasser', () => {
    const recipes = CONTENT.collection('recipes').values();
    const boiled = recipes.filter((r) => r.ergebnis.item === 'wasser_abgekocht').map((r) => r.station);
    expect(boiled.sort()).toEqual(['kessel', 'lagerfeuer', 'lagerfeuer']);
    expect(recipes.find((r) => r.id === 'rezept_wasser_abgekocht_schnee')?.zutaten).toEqual([
      { item: 'holzeimer', anzahl: 1 },
      { item: 'schnee', anzahl: 4 },
    ]);
    expect(kuecheKatalog.get('schnee').quellen).toEqual(['graben:schnee']);
    for (const tee of ['kamillentee', 'schafgarbentee']) expect(recipes.find((r) => r.ergebnis.item === tee)?.umgebung, tee).toBe('wasser');
  });
});

describe('Trinkschlauch', () => {
  it('am See gefüllt: fünf Schlucke mit 10 % Fieberrisiko; an der Quelle sauber; das Meer ist salzig, Eis gefroren', () => {
    const w = welt();
    water(w, 11, 10, WATER_LAKE | WATER_DEPTH_SHALLOW);
    water(w, 9, 10, WATER_SPRING | WATER_LAKE | WATER_DEPTH_SHALLOW);
    water(w, 10, 11, WATER_SEA | WATER_DEPTH_SHALLOW);
    water(w, 10, 9, WATER_LAKE | WATER_FROZEN | WATER_DEPTH_SHALLOW);
    hold(w, 'trinkschlauch');
    const haltbar = w.slot(HAND)?.haltbarkeit ?? 0;
    const ev = w.run(1, [{ type: 'water.fill', tx: OFFSET + 11, ty: OFFSET + 10 }]);
    expect(rejected(ev)).toEqual([]);
    expect(ev.get('vesselFilled')).toEqual([expect.objectContaining({ item: 'trinkschlauch', quelle: 'see', schlucke: 5 })]);
    const voll = w.slot(HAND);
    expect(voll?.daten).toEqual({ ladungen: 5, fieber: BALANCE.actions.water.feverChance });
    // Every filling wears the skin by one use.
    expect(voll?.haltbarkeit).toBe(haltbar - 1);
    expect(rejected(w.run(1, [{ type: 'water.fill', tx: OFFSET + 11, ty: OFFSET + 10 }]))).toEqual(['vesselFull']);
    hold(w, 'trinkschlauch');
    expect(rejected(w.run(1, [{ type: 'water.fill', tx: OFFSET + 10, ty: OFFSET + 11 }]))).toEqual(['saltWater']);
    expect(rejected(w.run(1, [{ type: 'water.fill', tx: OFFSET + 10, ty: OFFSET + 9 }]))).toEqual(['frozen']);
    expect(rejected(w.run(1, [{ type: 'water.fill', tx: OFFSET + 9, ty: OFFSET + 10 }]))).toEqual([]);
    expect(w.slot(HAND)?.daten).toEqual({ ladungen: 5 });
    expect(rejected(w.run(1, [{ type: 'water.fill', tx: OFFSET + 14, ty: OFFSET + 10 }]))).toEqual(['outOfReach']);
  });

  it('fünf Schlucke löschen Durst, dann ist er leer; Wasser aus dem Nebelmoor bringt öfter Fieber als Quellwasser (nie)', () => {
    const w = welt();
    water(w, 11, 10, WATER_LAKE | WATER_DEPTH_SHALLOW, 'nebelmoor');
    hold(w, 'trinkschlauch');
    w.run(1, [{ type: 'water.fill', tx: OFFSET + 11, ty: OFFSET + 10 }]);
    expect(w.slot(HAND)?.daten).toEqual({ ladungen: 5, fieber: 0.5 });
    let fevers = 0;
    const thirst = w.vit().thirst;
    for (let i = 0; i < 5; i++) {
      expect(w.useItem(HAND)).toBe('used');
      const ev = w.run(sipTicks() + 2);
      const sips = (ev.get('waterDrunk') ?? []) as Array<{ source: string; fever: boolean }>;
      expect(sips).toEqual([expect.objectContaining({ source: 'schlauch' })]);
      if (sips[0]?.fever === true) fevers++;
      w.life.conditions.cure(w.sim, 'fieber');
    }
    expect(w.vit().thirst).toBeGreaterThan(thirst);
    expect(vesselSips(w.slot(HAND) ?? { item: 'x', count: 1 }, kuecheKatalog.get('trinkschlauch'))).toBe(0);
    expect(w.useItem(HAND)).toEqual({ reject: 'vesselEmpty' });
    expect(fevers).toBeGreaterThan(0);
    const q = welt();
    water(q, 11, 10, WATER_SPRING | WATER_LAKE | WATER_DEPTH_SHALLOW);
    hold(q, 'trinkschlauch');
    q.run(1, [{ type: 'water.fill', tx: OFFSET + 11, ty: OFFSET + 10 }]);
    for (let i = 0; i < 5; i++) {
      q.useItem(HAND);
      const sips = (q.run(sipTicks() + 2).get('waterDrunk') ?? []) as Array<{ fever: boolean }>;
      expect(sips[0]?.fever).toBe(false);
    }
  });
});

describe('Regensammler', () => {
  /** A world with a collector on (11, 10) and `minutes` of rain on farm day 1 (06:00 day 1 → 06:00 day 2) in region 0. */
  function regen(minutes: number, roofed = false): KuecheWelt {
    const w = welt();
    if (roofed) w.roof(11, 10);
    w.water.placed(w.sim, 'regensammler', 0, OFFSET + 11, OFFSET + 10);
    w.climate.track(0);
    const start = minuteOf(1, 8);
    w.climate.record(0, 'klar', minuteOf(1, 0), start);
    w.climate.record(0, 'regen', start, start + minutes);
    w.climate.record(0, 'klar', start + minutes, minuteOf(3, 0));
    w.run(61);
    return w;
  }

  it('füllt sich um 06:00 mit dem Regen des vergangenen Tages (höchstens 300 Minuten); unter einem Dach nicht', () => {
    const w = regen(120);
    expect([...w.water.all][0]?.fill).toBe(0);
    w.water.dailyTick(w.sim, 2);
    expect([...w.water.all][0]?.fill).toBe(120);
    const voll = regen(500);
    voll.water.dailyTick(voll.sim, 2);
    expect([...voll.water.all][0]?.fill).toBe(W.collector.capacityMinutes);
    const dach = regen(120, true);
    dach.water.dailyTick(dach.sim, 2);
    expect([...dach.water.all][0]?.fill).toBe(0);
  });

  it('ein eingefrorener Sammler holt die Tage beim Aufwachen auf – wie einer, der aktiv blieb', () => {
    const live = regen(90);
    live.water.dailyTick(live.sim, 2);
    const frozen = regen(90);
    const chunk = frozen.chunks.get(0, (OFFSET + 11) >> CHUNK_SHIFT, (OFFSET + 10) >> CHUNK_SHIFT);
    if (chunk === undefined) throw new Error('no chunk');
    frozen.frozen.add(`0:${chunk.cx}:${chunk.cy}`);
    frozen.water.dailyTick(frozen.sim, 2);
    expect([...frozen.water.all][0]?.fill).toBe(0);
    frozen.water.catchUp(chunk, 0, frozen.sim.clock.ticksPerDay + 10);
    expect([...frozen.water.all][0]).toEqual([...live.water.all][0]);
  });

  it('E: Trinken am Sammler (sauber, ein Schluck weniger), Füllen des Schlauchs, ein leerer Eimer wird zu abgekochtem Wasser', () => {
    const w = regen(300);
    w.water.dailyTick(w.sim, 2);
    const c = [...w.water.all][0];
    if (c === undefined) throw new Error('no collector');
    const offer = createUseOffer();
    expect(w.waterUses.offer(w.sim, 0, OFFSET + 11, OFFSET + 10, offer)).toBe(true);
    expect(offer).toMatchObject({ action: 'trinken', subject: 'regensammler', block: null });
    w.waterUses.use(w.sim, 0, OFFSET + 11, OFFSET + 10, w.sim.tick);
    const ev = w.run(sipTicks() + 2);
    expect(ev.get('waterDrunk')).toEqual([expect.objectContaining({ source: 'regensammler', fever: false })]);
    expect(c.fill).toBe(300 - W.collector.minutesPerSip);
    hold(w, 'trinkschlauch');
    expect(w.waterUses.offer(w.sim, 0, OFFSET + 11, OFFSET + 10, offer)).toBe(true);
    expect(offer).toMatchObject({ action: 'fuellen', subject: 'trinkschlauch', block: null });
    expect(rejected(w.run(1, [{ type: 'water.fill', tx: OFFSET + 11, ty: OFFSET + 10 }]))).toEqual([]);
    expect(w.slot(HAND)?.daten).toEqual({ ladungen: 5 });
    expect(c.fill).toBe(300 - 6 * W.collector.minutesPerSip);
    expect(w.waterUses.offer(w.sim, 0, OFFSET + 11, OFFSET + 10, offer) && offer.block).toBe('gefaessVoll');
    hold(w, 'holzeimer');
    expect(rejected(w.run(1, [{ type: 'water.fill', tx: OFFSET + 11, ty: OFFSET + 10 }]))).toEqual([]);
    expect(w.slot(HAND)).toMatchObject({ item: 'wasser_abgekocht', daten: { ladungen: 5 } });
  });

  it('ein trockener Sammler: Trinken und Füllen abgelehnt (collectorEmpty), der Hinweis nennt sammlerLeer', () => {
    const w = regen(0);
    w.water.dailyTick(w.sim, 2);
    const offer = createUseOffer();
    w.waterUses.offer(w.sim, 0, OFFSET + 11, OFFSET + 10, offer);
    expect(offer.block).toBe('sammlerLeer');
    expect(rejected(w.run(1, [{ type: 'water.drink', tx: OFFSET + 11, ty: OFFSET + 10 }]))).toEqual(['collectorEmpty']);
    hold(w, 'holzeimer');
    expect(rejected(w.run(1, [{ type: 'water.fill', tx: OFFSET + 11, ty: OFFSET + 10 }]))).toEqual(['collectorEmpty']);
  });

  it('der Eimer abgekochten Wassers: fünf saubere Schlucke, dann wieder ein leerer Holzeimer mit seiner Haltbarkeit', () => {
    const w = welt();
    const eimer = w.stack('wasser_abgekocht');
    w.put({ ...eimer, haltbarkeit: 17 }, HAND);
    for (let i = 0; i < 5; i++) {
      expect(w.useItem(HAND)).toBe('used');
      const sips = (w.run(sipTicks() + 2).get('waterDrunk') ?? []) as Array<{ source: string; fever: boolean }>;
      expect(sips).toEqual([expect.objectContaining({ source: 'eimer', fever: false })]);
    }
    expect(w.slot(HAND)).toMatchObject({ item: 'holzeimer', haltbarkeit: 17 });
  });

  it('Teilnehmer water: Sammler mit Wasser, Dach und nächstem Tag; ein Schluck unterwegs; Fehler bei doppeltem Platz', () => {
    const w = regen(60);
    w.water.dailyTick(w.sim, 2);
    w.waterUses.use(w.sim, 0, OFFSET + 11, OFFSET + 10, w.sim.tick);
    w.run(1);
    const data = JSON.parse(JSON.stringify(w.water.save.serialize())) as { sammler: unknown[]; schluck: unknown };
    expect(w.water.save.version).toBe(WATER_SAVE_VERSION);
    expect(data).toEqual({ sammler: [[0, OFFSET + 11, OFFSET + 10, 60, false, 2]], schluck: [0, OFFSET + 11, OFFSET + 10] });
    const v = welt();
    v.water.save.deserialize(data);
    expect(v.water.save.serialize()).toEqual(data);
    expect(() => v.water.save.deserialize({ sammler: [data.sammler[0], data.sammler[0]], schluck: null })).toThrow(/two collectors/);
    expect(() => v.water.save.deserialize({ sammler: [], schluck: [0, 1, 1] })).toThrow(/not there/);
    expect(w.water.save.migrations?.[0]?.migrate({})).toEqual({ sammler: [], schluck: null });
  });
});
