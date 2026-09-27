/**
 * Stationen aufwerten, abbauen, spiegeln (Review M4 #2, #3, #4, #14, #15; MASTERPROMPT §15.1, §16.4, §16.6, §23.2):
 * - Werkbank I → II: einzeln (`upgradeOnce`), nur an der Stufe darunter (`alreadyUpgraded`; `upgrade` verlangt genau die
 *   nächste Stufe), die Station bleibt stehen, solange an ihr gearbeitet wird (`inUse`), und ist sie doch fort, kommen
 *   die Zutaten zurück – nie Werkbank II als Item (vorher: `werkbank 2, werkbank_2 1` nach Strg+Z).
 * - Handwerk-EP für eine Station erst, wenn sie die Frist des vollen Abbaus überstanden hat: Aufstellen und
 *   Zurücknehmen lehrt nichts (vorher: 300 Zyklen in 10 s hoben Handwerk von Stufe 1 auf 8), auch nicht über Laden.
 * - Abbauen wie Bauteile: in den ersten 30 s das Item, danach 60 % der Materialien aller Stufen (gerundet wie Bauteile,
 *   `MaterialBook.refund`); Spiegeln (`mirror`) wird gespeichert; Werkbank II ist `nurAufwerten`.
 * - Werkstatt: das Tempo kommt aus dem Raum der Station, nicht des Spielers; Verarbeitungsstationen ohne eigene
 *   Fertigkeit bekommen es auch, festgehalten beim Beschicken (Aufholen bleibt exakt).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { stationSchema, STATIONS } from '../../../src/content/stations';
import { MaterialBook } from '../../../src/game/building/materials';
import { craftSeconds, craftTicks } from '../../../src/game/crafting/formulas';
import type { GameCommand } from '../../../src/game/commands';
import { STATION_BUILT_XP_SOURCE } from '../../../src/game/stations/system';
import { batchTicks } from '../../../src/game/stations/formulas';
import { stationsSnapshotSchema } from '../../../src/game/stations/state';
import { OFFSET } from './spieler-testwelt';
import { eventsOf, rejections, stationWorld, TICK_HZ, type StationWorld } from './stationen-testwelt';

const WINDOW = BALANCE.building.refund.fullSeconds * TICK_HZ;
const UPGRADE = 'rezept_werkbank_2';
const PIECE = BALANCE.crafting.durationSeconds.gross * TICK_HZ;

/** The ingredients of the Werkbank II upgrade into the bags. */
function upgradeMaterials(w: StationWorld, pieces = 1): void {
  w.give('brett', 8 * pieces);
  w.give('balken', 2 * pieces);
  w.give('kupferbarren', 2 * pieces);
  w.give('faserseil', 4 * pieces);
  w.run(1);
}

/** Sets up `item` from the bags with its north-west corner on drawn tile (x, y); returns its id. */
function setUp(w: StationWorld, item: string, x: number, y: number, extra: Partial<GameCommand> = {}): number {
  w.give(item, 1);
  const ev = w.run(1, [{ type: 'station.place', from: w.slotOf(item), tx: OFFSET + x, ty: OFFSET + y, ...extra } as GameCommand]);
  expect(rejections(ev)).toEqual([]);
  const placed = eventsOf<{ id: number }>(ev, 'stationPlaced')[0];
  if (placed === undefined) throw new Error(`${item} not set up`);
  return placed.id;
}

/** What the materials book of the station system gives for `pieces` of each part at the late share (the build rule). */
function lateShare(w: StationWorld, parts: readonly string[]): Map<string, number> {
  const r = w.crafting.recipes;
  const book = new MaterialBook(r.list.map((x) => ({ id: x.id, product: x.ergebnis.item, pieces: x.ergebnis.anzahl, inputs: r.ingredients(x.id).map((z) => ({ item: z.items[0] as string, count: z.anzahl })) })));
  return new Map(book.refund(parts.map((part) => ({ part, pieces: 1 })), BALANCE.building.refund.lateShare).map((a) => [a.item, a.count]));
}

describe('Werkbank I → II ohne Verdopplung (Review M4 #2)', () => {
  it('Strg+Z während der Aufwertung wird abgelehnt (`inUse`): am Ende steht Werkbank II, kein Item doppelt', () => {
    const w = stationWorld();
    const bench = setUp(w, 'werkbank', 6, 4);
    upgradeMaterials(w);
    expect(rejections(w.run(2, [{ type: 'craft.start', recipe: UPGRADE, count: 1 }]))).toEqual([]);
    expect(w.crafting.orders[0]?.platz).toBe(bench);
    // The undo of the build mode sends `station.remove` within 10 s.
    expect(w.refused({ type: 'station.remove', station: bench })).toEqual(['inUse']);
    const ev = w.run(PIECE + 2);
    expect(eventsOf(ev, 'stationUpgraded')).toEqual([expect.objectContaining({ id: bench, from: 'werkbank', to: 'werkbank_2' })]);
    expect([w.has('werkbank'), w.has('werkbank_2')]).toEqual([0, 0]);
    expect(w.stations.placed.map((p) => p.station)).toEqual(['werkbank_2']);
    // Nothing is worked at it any more: now it can be taken down.
    expect(w.refused({ type: 'station.remove', station: bench })).toEqual([]);
  });

  it('auch an einer normalen Arbeit: die Station bleibt, bis das Stück fertig oder der Auftrag abgebrochen ist', () => {
    const w = stationWorld();
    const bench = setUp(w, 'werkbank', 6, 4);
    w.give('holz', 8);
    w.give('zweig', 4);
    w.give('faserseil', 2);
    w.run(2, [{ type: 'craft.start', recipe: 'rezept_saegebock', count: 1 }]);
    expect(w.refused({ type: 'station.remove', station: bench })).toEqual(['inUse']);
    w.run(1, [{ type: 'craft.cancel', index: 0 }]);
    expect(w.refused({ type: 'station.remove', station: bench })).toEqual([]);
    expect(w.has('werkbank')).toBe(1);
  });

  it('ist die Station beim Fertigstellen fort (mit ihrem Bauteil abgebaut), kommen die Zutaten zurück – kein Werkbank-II-Item', () => {
    const w = stationWorld();
    w.place('werkbank', 6, 4);
    upgradeMaterials(w);
    w.run(2, [{ type: 'craft.start', recipe: UPGRADE, count: 1 }]);
    // The build grid takes a station part down (`detach`), whatever the station system refuses.
    expect(w.stations.detach(w.sim, 0, OFFSET + 6, OFFSET + 4)).toBe(true);
    const ev = w.run(PIECE + 2);
    expect(eventsOf(ev, 'craftCompleted')).toEqual([]);
    expect(eventsOf(ev, 'craftCancelled')).toEqual([expect.objectContaining({ recipe: UPGRADE, pieces: 1, reason: 'stationWeg' })]);
    expect([w.has('werkbank_2'), w.has('brett'), w.has('balken'), w.has('kupferbarren'), w.has('faserseil')]).toEqual([0, 8, 2, 2, 4]);
    expect(w.crafting.orders).toHaveLength(0);
  });

  it('eine Aufwertung ist ein Stück: `count` 2 wird abgelehnt (`upgradeOnce`), nichts wird genommen', () => {
    const w = stationWorld();
    w.place('werkbank', 6, 4);
    upgradeMaterials(w, 2);
    expect(w.refused({ type: 'craft.start', recipe: UPGRADE, count: 2 })).toEqual(['upgradeOnce']);
    expect([w.has('brett'), w.crafting.orders.length]).toEqual([16, 0]);
  });
});

describe('Aufwerten nur an der Stufe darunter (Review M4 #4)', () => {
  it('an einer Werkbank II wird das Aufwertungsrezept abgelehnt (`alreadyUpgraded`), die Zutaten bleiben', () => {
    const w = stationWorld();
    w.place('werkbank', 6, 4);
    upgradeMaterials(w);
    w.stations.upgrade(w.sim, w.stations.placed[0]?.id as number, 'werkbank_2');
    expect(w.refused({ type: 'craft.start', recipe: UPGRADE, count: 1 })).toEqual(['alreadyUpgraded']);
    expect([w.has('brett'), w.has('kupferbarren')]).toEqual([8, 2]);
  });

  it('stehen Werkbank I und II in Reichweite, wird Werkbank I aufgewertet (nicht II in sich selbst)', () => {
    const w = stationWorld();
    const one = w.place('werkbank', 6, 4);
    const two = w.place('werkbank', 2, 6);
    w.stations.upgrade(w.sim, two, 'werkbank_2');
    upgradeMaterials(w);
    const ev = w.run(PIECE + 4, [{ type: 'craft.start', recipe: UPGRADE, count: 1 }]);
    expect(eventsOf(ev, 'stationUpgraded')).toEqual([expect.objectContaining({ id: one, from: 'werkbank', to: 'werkbank_2' })]);
    expect(w.stations.placed.map((p) => p.station)).toEqual(['werkbank_2', 'werkbank_2']);
  });

  it('ein zweiter wartender Auftrag verliert nichts: er wartet (`alreadyUpgraded`), Abbrechen erstattet alles', () => {
    const w = stationWorld();
    w.place('werkbank', 6, 4);
    upgradeMaterials(w, 2);
    w.run(1, [{ type: 'craft.start', recipe: UPGRADE, count: 1 }]);
    w.run(1, [{ type: 'craft.start', recipe: UPGRADE, count: 1 }]);
    const ev = w.run(2 * PIECE + 4);
    expect(eventsOf(ev, 'stationUpgraded')).toHaveLength(1);
    expect(w.crafting.orders).toHaveLength(1);
    expect(w.crafting.blocked).toBe('alreadyUpgraded');
    w.run(1, [{ type: 'craft.cancel', index: 0 }]);
    expect([w.has('brett'), w.has('balken'), w.has('kupferbarren'), w.has('faserseil')]).toEqual([8, 2, 2, 4]);
  });

  it('`upgrade` verlangt genau die nächste Stufe der Linie', () => {
    const w = stationWorld();
    const bench = w.place('werkbank', 6, 4);
    const saw = w.place('saegebock', 6, 7);
    expect(w.stations.upgrade(w.sim, bench, 'werkbank')).toBe(false);
    expect(w.stations.upgrade(w.sim, saw, 'werkbank_2')).toBe(false);
    expect(w.stations.upgrade(w.sim, bench, 'werkbank_2')).toBe(true);
    expect(w.stations.upgrade(w.sim, bench, 'werkbank_2')).toBe(false);
    expect(w.st(bench).station).toBe('werkbank_2');
  });
});

describe('Handwerk-EP für Stationen einmal je Aufstellen, das steht (Review M4 #3)', () => {
  it('300 × aufstellen und zurücknehmen in der Frist: keine Erfahrung, der Sägebock bleibt einer', () => {
    const w = stationWorld();
    w.give('saegebock', 1);
    const xp = w.life.skills.skill('handwerk').xp;
    for (let i = 0; i < 300; i++) {
      w.run(1, [{ type: 'station.place', from: w.slotOf('saegebock'), tx: OFFSET + 6, ty: OFFSET + 4 }]);
      const id = w.stations.placed[0]?.id;
      if (id === undefined) throw new Error(`not placed in round ${i}`);
      w.run(1, [{ type: 'station.remove', station: id }]);
    }
    expect(w.life.skills.skill('handwerk').xp).toBe(xp);
    expect(w.life.skills.level('handwerk')).toBe(1);
    expect(w.has('saegebock')).toBe(1);
  });

  it('eine stehende Station gibt die Erfahrung einmal – auch über Speichern und Laden, auch beim späten Abbauen nicht noch einmal', () => {
    const w = stationWorld();
    setUp(w, 'saegebock', 6, 4);
    // Saved and loaded within the window: the window travels with it.
    const saved = w.stations.save.serialize();
    expect(stationsSnapshotSchema.parse(saved).placed[0]?.gesetzt).toBeDefined();
    const b = stationWorld();
    b.stations.save.deserialize(saved);
    b.sim.skipTicks(w.sim.tick - b.sim.tick);
    const ev = b.run(WINDOW + 2);
    expect(eventsOf<{ source: string }>(ev, 'xpGained').map((e) => e.source)).toEqual([STATION_BUILT_XP_SOURCE]);
    const removed = b.run(1, [{ type: 'station.remove', station: b.stations.placed[0]?.id as number }]);
    expect(eventsOf(removed, 'xpGained')).toEqual([]);
  });

  it('eine Aufwertung in der Frist macht die Station endgültig: die Erfahrung kommt dann, einmal', () => {
    const w = stationWorld();
    const bench = setUp(w, 'werkbank', 6, 4);
    expect(eventsOf(w.run(1), 'xpGained')).toEqual([]);
    w.stations.upgrade(w.sim, bench, 'werkbank_2');
    expect(w.st(bench).gesetzt).toBeUndefined();
    expect(eventsOf<{ source: string }>(w.run(1), 'xpGained').map((e) => e.source)).toEqual([STATION_BUILT_XP_SOURCE]);
    expect(eventsOf(w.run(WINDOW + 2), 'xpGained')).toEqual([]);
  });
});

describe('Abbauen wie Bauteile, Spiegeln, Werkbank II nur an Ort und Stelle (Review M4 #15)', () => {
  it('in den ersten 30 s das ganze Item, danach 60 % der Materialien (gerundet wie Bauteile)', () => {
    const w = stationWorld();
    const early = setUp(w, 'werkbank', 6, 4);
    w.run(WINDOW - 2);
    w.run(1, [{ type: 'station.remove', station: early }]);
    expect(w.has('werkbank')).toBe(1);
    const late = w.run(1, [{ type: 'station.place', from: w.slotOf('werkbank'), tx: OFFSET + 6, ty: OFFSET + 4 }]);
    const id = eventsOf<{ id: number }>(late, 'stationPlaced')[0]?.id as number;
    w.run(WINDOW + 1);
    w.run(1, [{ type: 'station.remove', station: id }]);
    const expected = lateShare(w, ['werkbank']);
    // Werkbank I: 10 wood, 4 stone, 2 rope – 6 wood and 2 stone either way the build rule rounds.
    expect([expected.get('holz'), expected.get('stein')]).toEqual([6, 2]);
    expect(w.has('werkbank')).toBe(0);
    for (const [item, count] of expected) expect(w.has(item), item).toBe(count);
  });

  it('eine aufgewertete Werkbank gibt nie ein Item zurück, sondern 60 % aus Werkbank I und der Aufwertung', () => {
    const w = stationWorld();
    const bench = setUp(w, 'werkbank', 6, 4);
    upgradeMaterials(w);
    w.run(PIECE + 4, [{ type: 'craft.start', recipe: UPGRADE, count: 1 }]);
    expect(w.st(bench).station).toBe('werkbank_2');
    // Still within 30 s of setting Werkbank I up: an upgraded station is no longer the item that was placed.
    expect(w.sim.tick).toBeLessThan(WINDOW);
    w.run(1, [{ type: 'station.remove', station: bench }]);
    expect([w.has('werkbank'), w.has('werkbank_2')]).toEqual([0, 0]);
    const expected = lateShare(w, ['werkbank', 'werkbank_2']);
    expect([expected.get('holz'), expected.get('kupferbarren'), expected.get('balken')]).toEqual([6, 1, 1]);
    for (const [item, count] of expected) expect(w.has(item), item).toBe(count);
  });

  it('`mirror` stellt die Station gespiegelt auf und wird gespeichert; ohne `mirror` bleibt das Feld weg', () => {
    const w = stationWorld();
    const mirrored = setUp(w, 'saegebock', 6, 4, { mirror: true });
    const plain = setUp(w, 'saegebock', 6, 7);
    expect([w.st(mirrored).gespiegelt, w.st(plain).gespiegelt]).toEqual([true, undefined]);
    const saved = stationsSnapshotSchema.parse(JSON.parse(JSON.stringify(w.stations.save.serialize())));
    expect(saved.placed.map((p) => p.gespiegelt)).toEqual([true, undefined]);
    const b = stationWorld();
    b.stations.save.deserialize(saved);
    expect(b.stations.station(mirrored)?.gespiegelt).toBe(true);
    expect(b.stations.station(plain)?.gespiegelt).toBeUndefined();
  });

  it('Werkbank II ist `nurAufwerten`: kein Rezept macht ihr Item, das Aufwertungsrezept schon; eine erste Stufe darf es nicht sein', () => {
    expect(STATIONS.filter((s) => s.nurAufwerten === true).map((s) => s.id)).toEqual(['werkbank_2']);
    const recipes = [...CONTENT.collection('recipes').values()].filter((r) => r.ergebnis.item === 'werkbank_2');
    expect(recipes.map((r) => r.aufwerten)).toEqual([true]);
    const bench = STATIONS.find((s) => s.id === 'werkbank');
    expect(stationSchema.safeParse({ ...bench, nurAufwerten: true }).success).toBe(false);
  });
});

describe('Werkstatt-Tempo aus dem Raum der Station (Review M4 #14)', () => {
  /** The workshop stand-in: tiles left of drawn x = 7 lie in a workshop. */
  function workshop(w: StationWorld): void {
    w.crafting.useWorkshops((_s, _layer, tx) => (tx < OFFSET + 7 ? BALANCE.rooms.effects.workshopTempo : 0));
  }

  it('die Werkbank in der Werkstatt, der Spieler davor: +15 %; die Werkbank draußen, der Spieler in der Werkstatt: nicht', () => {
    const recipe = 'rezept_saegebock';
    const ticks = (benchX: number, playerX: number): number => {
      const w = stationWorld();
      workshop(w);
      w.place('werkbank', benchX, 4);
      w.run(1, [{ type: 'player.teleport', x: w.centre(playerX, 4).x, y: w.centre(playerX, 5).y, layer: 0 }]);
      w.give('holz', 8);
      w.give('zweig', 4);
      w.give('faserseil', 2);
      const ev = w.run(2, [{ type: 'craft.start', recipe, count: 1 }]);
      const started = eventsOf<{ ticks: number }>(ev, 'craftStarted')[0];
      if (started === undefined) throw new Error(`no piece began: ${rejections(ev).join(', ')}`);
      return started.ticks;
    };
    const seconds = craftSeconds(stationWorld().crafting.recipes.get(recipe));
    expect(ticks(4, 8)).toBe(craftTicks(seconds, BALANCE.rooms.effects.workshopTempo, 1));
    expect(ticks(8, 5)).toBe(craftTicks(seconds, 0, 1));
  });

  it('eine Verarbeitungsstation ohne eigene Fertigkeit arbeitet in der Werkstatt 15 % schneller, festgehalten beim Beschicken', () => {
    const batch = (x: number): { bonus: number | undefined; ticks: number } => {
      const w = stationWorld();
      workshop(w);
      const rack = w.place('trockengestell', x, 4);
      w.run(1, [{ type: 'player.teleport', x: w.centre(x, 5).x, y: w.centre(x, 5).y, layer: 0 }]);
      w.give('fasern', 6);
      const ev = w.run(2, [{ type: 'station.put', station: rack, from: w.slotOf('fasern'), bereich: 'eingang' }]);
      expect(rejections(ev)).toEqual([]);
      const started = eventsOf<{ ticks: number }>(ev, 'stationBatchStarted')[0];
      if (started === undefined) throw new Error('no batch began');
      return { bonus: w.st(rack).tempoBonus, ticks: started.ticks };
    };
    const inside = batch(3);
    const outside = batch(9);
    const drying = BALANCE.crafting.durationSeconds.trocknen;
    expect(inside.bonus).toBe(BALANCE.rooms.effects.workshopTempo);
    expect(outside.bonus).toBeUndefined();
    expect([inside.ticks, outside.ticks]).toEqual([batchTicks(drying, 1 + BALANCE.rooms.effects.workshopTempo), batchTicks(drying, 1)]);
  });
});
