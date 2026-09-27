/**
 * M4-18 Behaglichkeit (MASTERPROMPT §16.4 "Behaglichkeit 0–20 aus einzigartigen Möbelkategorien, Licht, Wärme,
 * Raumgröße und Deko → Dauer von ‚Ausgeruht' und Tempo des Furchtabbaus"; §11.5 "Dauer 8 min + 1 min je
 * Behaglichkeitspunkt"; §12.3 "behaglicher Raum bis −1,5/s (skaliert mit Behaglichkeit)"): the formula and its
 * parts, and its three effects – the duration of "Ausgeruht" after sleeping in the room, the fear decay and the
 * condition "Behaglich". Lights count while they burn (the light system reports them; a cold lamp gives nothing), and
 * the player's room is described into one kept record every tick (no allocation per tick, review M4 #20).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { roomComfort, type ComfortInput } from '../../../src/game/rooms/formulas';
import { restedSeconds } from '../../../src/game/sleep/formulas';
import { bauWelt, hut, type BauWelt } from './bau-testwelt';
import { meadow } from './spieler-testwelt';

const C = BALANCE.rooms.comfort;
const BASE: ComfortInput = { categories: 0, lights: 0, temperatureC: 5, tiles: 4, decorations: 0, trophyHall: false };

describe('Formel 0–20 (§16.4)', () => {
  it('einzigartige Kategorien +1 (höchstens 8), Licht +2/+3, Wärme +3/+1, Größe +1/+2/+3, Deko +1 (höchstens 4)', () => {
    const c = (i: Partial<ComfortInput>): number => roomComfort({ ...BASE, ...i }).total;
    expect(c({})).toBe(0);
    expect(c({ categories: 5 })).toBe(5);
    expect(c({ categories: 12 })).toBe(C.maxCategories);
    expect([c({ lights: 1 }), c({ lights: 2 }), c({ lights: 7 })]).toEqual([2, 3, 3]);
    expect([c({ temperatureC: 16 }), c({ temperatureC: 24 }), c({ temperatureC: 13 }), c({ temperatureC: 27 }), c({ temperatureC: 29 })]).toEqual([3, 3, 1, 1, 0]);
    expect([c({ tiles: 5 }), c({ tiles: 6 }), c({ tiles: 12 }), c({ tiles: 24 }), c({ tiles: 400 })]).toEqual([0, 1, 2, 3, 3]);
    expect([c({ decorations: 2 }), c({ decorations: 9 })]).toEqual([2, C.maxDecoration]);
    expect(c({ trophyHall: true })).toBe(BALANCE.rooms.effects.trophyHallComfort);
  });

  it('Summe auf 20 begrenzt; die Teile bleiben lesbar (Overlay)', () => {
    const parts = roomComfort({ categories: 10, lights: 3, temperatureC: 20, tiles: 30, decorations: 6, trophyHall: true });
    expect(parts).toEqual({ categories: 8, light: 3, warmth: 3, size: 3, decoration: 4, trophyHall: 3, total: C.max });
  });
});

/** Reports lights burning on drawn tiles, as the light system reports its burning lamps (src/game/setup.ts). */
function burning(w: BauWelt, tiles: ReadonlyArray<readonly [number, number]>): void {
  w.rooms.addFurniture((_s, _layer, visit) => {
    for (const [x, y] of tiles) visit('licht', w.tile(x, y).tx, w.tile(x, y).ty);
  });
}

/** A furnished wooden house at 18 °C around (7, 7)–(12, 11) (30 tiles), the player inside; its lamps burn with `lit`. */
function cosyHouse(full: boolean, lit = true): BauWelt {
  const w = bauWelt(meadow(24, 24));
  w.env.air = 18;
  w.spawn(10, 9);
  hut(w, 7, 7, 12, 11);
  const parts: Array<[string, number, number]> = [
    ['probe_moebel_bett', 7, 7],
    ['probe_moebel_lampe', 12, 7],
  ];
  if (full) {
    parts.push(
      ['probe_moebel_tisch', 8, 11],
      ['probe_moebel_stuhl', 10, 11],
      ['probe_moebel_kiste', 12, 11],
      ['probe_moebel_schrank', 11, 7],
      ['probe_moebel_vase', 9, 7],
      ['probe_moebel_topfpflanze', 7, 10],
      ['probe_moebel_teppich', 9, 9],
      ['probe_moebel_bild', 10, 7],
      ['probe_moebel_wandlampe', 8, 7],
    );
  }
  for (const [part, x, y] of parts) {
    const r = w.build(part, x, y);
    if (r !== null) throw new Error(`${part} at ${x},${y}: ${r}`);
  }
  if (lit) burning(w, full ? [[12, 7], [8, 7]] : [[12, 7]]);
  return w;
}

describe('Behaglichkeit eines gebauten Raums', () => {
  it('Bett und Lampe in einem warmen Haus: Kategorien 2, Licht 2, Wärme 3, Größe 3', () => {
    const w = cosyHouse(false);
    expect(w.roomAt(10, 9)?.comfort).toEqual({ categories: 2, light: 2, warmth: 3, size: 3, decoration: 0, trophyHall: 0, total: 10 });
  });

  it('eine kalte Lampe gibt weder Licht noch eine Kategorie (Review M4 #13)', () => {
    const w = cosyHouse(false, false);
    expect(w.roomAt(10, 9)?.comfort).toEqual({ categories: 1, light: 0, warmth: 3, size: 3, decoration: 0, trophyHall: 0, total: 7 });
  });

  it('der Raum des Spielers ist ein gehaltener Datensatz: je Tick neu gefüllt, nicht neu angelegt (Review M4 #20)', () => {
    const w = cosyHouse(false, false);
    const before = w.rooms.playerRoom(w.sim);
    expect(before?.comfort.light).toBe(0);
    w.run(1);
    const lamps: Array<readonly [number, number]> = [];
    burning(w, lamps);
    lamps.push([12, 7]);
    w.run(1);
    const after = w.rooms.playerRoom(w.sim);
    expect(after).toBe(before);
    expect(after?.comfort).toEqual({ categories: 2, light: 2, warmth: 3, size: 3, decoration: 0, trophyHall: 0, total: 10 });
    // A room asked for by tile is the caller's to keep.
    expect(w.roomAt(10, 9)).not.toBe(after);
    expect(w.roomAt(10, 9)?.comfort).toEqual(after?.comfort);
  });

  it('voll eingerichtet: 8 Kategorien, 2 Lichter, Deko (Vase, Pflanze, Teppich, Bild) – gedeckelt bei 20', () => {
    const w = cosyHouse(true);
    const comfort = w.roomAt(10, 9)?.comfort;
    expect(comfort).toMatchObject({ categories: 8, light: 3, warmth: 3, size: 3, decoration: 4 });
    expect(comfort?.total).toBe(C.max);
  });

  it('Wärme zählt mit: dasselbe Haus bei Frost ist weniger behaglich', () => {
    const w = cosyHouse(false);
    w.env.air = -15;
    expect(w.roomAt(10, 9)?.comfort.warmth).toBe(0);
    expect(w.roomAt(10, 9)?.comfort.total).toBe(7);
  });
});

describe('Wirkungen', () => {
  it('„Ausgeruht“ nach dem Schlaf im Bett dauert 8 min + 1 min je Behaglichkeitspunkt, im Schlafraum ×1,5', () => {
    const w = cosyHouse(true);
    const comfort = w.roomAt(10, 9)?.comfort.total ?? 0;
    w.jumpToHour(5);
    w.run(1, [{ type: 'player.teleport', x: w.px(8, 9).x, y: w.px(8, 9).y, layer: 0 }]);
    const started = w.run(1, [{ type: 'sleep.start', tx: w.tile(7, 8).tx, ty: w.tile(7, 8).ty }]);
    expect(started.get('commandRejected')).toBeUndefined();
    w.run(w.sim.clock.ticksPerGameHour + 60);
    expect(w.life.sleep.asleep).toBe(false);
    const expected = restedSeconds(comfort, true);
    expect(expected).toBe((BALANCE.sleep.rested.baseSeconds + BALANCE.sleep.rested.perComfortSeconds * comfort) * BALANCE.sleep.rested.bedroomFactor);
    const left = w.life.conditions.remainingSeconds('ausgeruht', BALANCE.time.tickHz) ?? 0;
    expect(left).toBeGreaterThan(expected - 2);
    expect(left).toBeLessThanOrEqual(expected);
  });

  it('Furchtabbau im behaglichen Raum bis −1,5/s (bei Behaglichkeit 20)', () => {
    const w = cosyHouse(true);
    // Dim light: neither dark (no rise) nor bright (its −0,5/s would be the calmer place otherwise).
    w.env.light = 0.3;
    w.run(1, [{ type: 'fear.set', value: 50 }]);
    const before = w.life.fear.state.value;
    w.run(BALANCE.time.tickHz);
    expect(before - w.life.fear.state.value).toBeCloseTo(BALANCE.fear.decay.roomMaxPerSecond, 1);
    // Outside the house (same light) fear stands still.
    w.run(1, [{ type: 'player.teleport', x: w.px(20, 20).x, y: w.px(20, 20).y, layer: 0 }]);
    const outside = w.life.fear.state.value;
    w.run(BALANCE.time.tickHz);
    expect(w.life.fear.state.value).toBeCloseTo(outside, 6);
  });

  it('„Behaglich“ ab Behaglichkeit 6, erneuert je Welt-Tick, endet bald nach dem Verlassen', () => {
    const w = cosyHouse(false);
    w.run(2 * BALANCE.time.tickHz);
    expect(w.life.conditions.has('behaglich')).toBe(true);
    w.run(1, [{ type: 'player.teleport', x: w.px(20, 20).x, y: w.px(20, 20).y, layer: 0 }]);
    w.run((C.cosySeconds + 2) * BALANCE.time.tickHz);
    expect(w.life.conditions.has('behaglich')).toBe(false);
    // A bare hut (comfort below 6) does not make the player cosy.
    const bare = bauWelt(meadow(24, 24));
    bare.env.air = 5;
    bare.spawn(10, 10);
    hut(bare, 9, 9, 11, 11, 'wand_palisade');
    bare.run(2 * BALANCE.time.tickHz);
    expect(bare.roomAt(10, 10)?.comfort.total).toBeLessThan(C.cosyFrom);
    expect(bare.life.conditions.has('behaglich')).toBe(false);
  });
});
