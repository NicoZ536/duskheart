/**
 * M4-17 Raumtypen (MASTERPROMPT §16.4): the nine room types recognised automatically – Schlafraum, Küche,
 * Werkstatt, Lager, Speisesaal, Gewächshaus, Stall, Eiskeller, Trophäenhalle – by their rules and ranks, and the
 * effects wired in M4: the bedroom's "Ausgeruht" ×1,5 (through the bed's sleeping place), the workshop's +15 %
 * crafting tempo in the room of the station (not the player's) and the trophy hall's comfort. A light counts only
 * while it burns: the light system reports the burning ones (`addFurniture`), a lamp of the grid itself counts nothing.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { ROOM_TYPES } from '../../../src/content/roomTypes';
import { roomTypeOf, type RoomContents } from '../../../src/game/rooms/formulas';
import { restedSeconds } from '../../../src/game/sleep/formulas';
import { bauWelt, hut, type BauWelt } from './bau-testwelt';
import { meadow } from './spieler-testwelt';

/** A closed wooden house with a straw roof around the inner tiles (8, 8)–(12, 11) (20 tiles), the player inside at (10, 10). */
function house(roof: string | null = 'dach_stroh', wall = 'wand_holz'): BauWelt {
  const w = bauWelt(meadow(24, 24));
  w.spawn(10, 9);
  hut(w, 8, 8, 12, 11, wall, 'tuer_holz', roof);
  return w;
}

/** Places each part (anchor on drawn tile) and fails on a refusal. */
function furnish(w: BauWelt, ...parts: ReadonlyArray<readonly [string, number, number]>): void {
  for (const [part, x, y] of parts) {
    const r = w.build(part, x, y);
    if (r !== null) throw new Error(`${part} at ${x},${y}: ${r}`);
  }
}

/** Type id of the house's room. */
function typeOf(w: BauWelt): string | null {
  return w.roomAt(10, 9)?.type?.id ?? null;
}

/** Reports lights burning on drawn tiles, as the light system reports its burning lamps and fires (src/game/setup.ts). */
function burning(w: BauWelt, ...tiles: ReadonlyArray<readonly [number, number]>): void {
  w.rooms.addFurniture((_s, _layer, visit) => {
    for (const [x, y] of tiles) visit('licht', w.tile(x, y).tx, w.tile(x, y).ty);
  });
}

const EMPTY: RoomContents = { furniture: {}, lights: 0, temperatureC: 18, roofs: { stroh: 20 }, roofTiles: 20, animals: 0 };

describe('Regeln als Daten', () => {
  it('neun Raumtypen, nach Rang geordnet, jeder mit Text DE/EN', () => {
    expect(ROOM_TYPES.map((t) => t.id)).toEqual(['eiskeller', 'gewaechshaus', 'stall', 'kueche', 'schlafraum', 'werkstatt', 'speisesaal', 'trophaeenhalle', 'lager']);
    for (const t of ROOM_TYPES) expect(t.name.de.length * t.name.en.length * t.beschreibung.de.length * t.beschreibung.en.length, t.id).toBeGreaterThan(0);
  });

  it('jede Regel greift genau mit ihren Bedingungen (reine Funktion)', () => {
    const type = (c: Partial<RoomContents>): string | null => roomTypeOf({ ...EMPTY, ...c })?.id ?? null;
    expect(type({})).toBeNull();
    expect(type({ temperatureC: 3.9 })).toBe('eiskeller');
    expect(type({ temperatureC: 4 })).toBeNull();
    expect(type({ furniture: { beet: 1 }, roofs: { glas: 10, stroh: 10 } })).toBe('gewaechshaus');
    expect(type({ furniture: { beet: 1 }, roofs: { glas: 9, stroh: 11 } })).toBeNull();
    expect(type({ furniture: { trog: 1 }, animals: 1 })).toBe('stall');
    expect(type({ furniture: { trog: 1 } })).toBeNull();
    expect(type({ furniture: { kochstelle: 1, lager: 1, tisch: 1 } })).toBe('kueche');
    expect(type({ furniture: { kochstelle: 1, tisch: 1 } })).toBeNull();
    expect(type({ furniture: { bett: 1 }, lights: 1 })).toBe('schlafraum');
    expect(type({ furniture: { bett: 1 } })).toBeNull();
    expect(type({ furniture: { station: 3 } })).toBe('werkstatt');
    expect(type({ furniture: { station: 2 } })).toBeNull();
    expect(type({ furniture: { tisch: 1, sitz: 2 } })).toBe('speisesaal');
    expect(type({ furniture: { tisch: 1, sitz: 1 } })).toBeNull();
    expect(type({ furniture: { trophaee: 3 } })).toBe('trophaeenhalle');
    expect(type({ furniture: { lager: 4 } })).toBe('lager');
    expect(type({ furniture: { lager: 3 } })).toBeNull();
    // Rank: the more specific type wins.
    expect(type({ furniture: { lager: 4 }, temperatureC: 0 })).toBe('eiskeller');
    expect(type({ furniture: { bett: 1, tisch: 1, sitz: 2 }, lights: 1 })).toBe('schlafraum');
  });
});

describe('Erkennung im gebauten Haus (alle 9 Regeln)', () => {
  it('Schlafraum: Bett und Licht – eine Lampe erst, wenn sie brennt (Review M4 #13), oder ein anderes brennendes Licht', () => {
    const w = house();
    furnish(w, ['probe_moebel_bett', 8, 8]);
    expect(typeOf(w)).toBeNull();
    // A cold (or empty) lamp lights no bedroom; burning, the light system reports it.
    furnish(w, ['probe_moebel_lampe', 12, 8]);
    expect(typeOf(w)).toBeNull();
    expect(w.roomAt(10, 9)?.contents.lights).toBe(0);
    expect(w.roomAt(10, 9)?.contents.furniture.licht ?? 0).toBe(0);
    burning(w, [12, 8]);
    expect(typeOf(w)).toBe('schlafraum');
    const lit = house();
    furnish(lit, ['probe_moebel_bett', 8, 8]);
    lit.rooms.addFurniture((_s, _layer, visit) => visit('licht', lit.tile(12, 11).tx, lit.tile(12, 11).ty));
    expect(typeOf(lit)).toBe('schlafraum');
  });

  it('Küche: Kochstelle, Vorrat und Tisch', () => {
    const w = house();
    furnish(w, ['probe_moebel_kessel', 8, 8], ['probe_moebel_tisch', 11, 8]);
    expect(typeOf(w)).toBeNull();
    furnish(w, ['probe_moebel_kiste', 8, 11]);
    expect(typeOf(w)).toBe('kueche');
  });

  it('Werkstatt: mindestens drei Stationen (auch vom Stationssystem gemeldet)', () => {
    const w = house();
    furnish(w, ['probe_moebel_station', 8, 8], ['probe_moebel_station', 11, 8]);
    expect(typeOf(w)).toBeNull();
    furnish(w, ['probe_moebel_station', 8, 11]);
    expect(typeOf(w)).toBe('werkstatt');
    const hooked = house();
    hooked.rooms.addFurniture((_s, _layer, visit) => {
      for (const x of [8, 10, 12]) visit('station', hooked.tile(x, 11).tx, hooked.tile(x, 11).ty);
    });
    expect(typeOf(hooked)).toBe('werkstatt');
  });

  it('Lager: mindestens vier Kisten', () => {
    const w = house();
    furnish(w, ['probe_moebel_kiste', 8, 8], ['probe_moebel_kiste', 9, 8], ['probe_moebel_kiste', 12, 8]);
    expect(typeOf(w)).toBeNull();
    furnish(w, ['probe_moebel_kiste', 12, 11]);
    expect(typeOf(w)).toBe('lager');
  });

  it('Speisesaal: Tisch und mindestens zwei Stühle', () => {
    const w = house();
    furnish(w, ['probe_moebel_tisch', 8, 11], ['probe_moebel_stuhl', 8, 10]);
    expect(typeOf(w)).toBeNull();
    furnish(w, ['probe_moebel_stuhl', 9, 10]);
    expect(typeOf(w)).toBe('speisesaal');
  });

  it('Gewächshaus: Glasdach (mindestens die Hälfte) und Beete', () => {
    const w = house('dach_glas');
    expect(typeOf(w)).toBeNull();
    furnish(w, ['probe_moebel_beet', 8, 8]);
    expect(typeOf(w)).toBe('gewaechshaus');
    const straw = house();
    furnish(straw, ['probe_moebel_beet', 8, 8]);
    expect(typeOf(straw)).toBeNull();
  });

  it('Stall: Trog und Tiere (die Tiere von M7 melden sich über den Haken)', () => {
    const w = house();
    furnish(w, ['probe_moebel_trog', 8, 8]);
    expect(typeOf(w)).toBeNull();
    w.rooms.addAnimals((_s, _layer, visit) => visit(w.tile(12, 11).tx, w.tile(12, 11).ty));
    expect(typeOf(w)).toBe('stall');
  });

  it('Eiskeller: unter 4 °C (Palisade und Glasdach bei Frost), vor dem Lager', () => {
    const w = bauWelt(meadow(24, 24));
    w.env.air = -10;
    w.spawn(10, 9);
    hut(w, 8, 8, 12, 11, 'wand_palisade', 'tuer_holz', 'dach_glas');
    furnish(w, ['probe_moebel_kiste', 8, 8], ['probe_moebel_kiste', 9, 8], ['probe_moebel_kiste', 11, 8], ['probe_moebel_kiste', 12, 8]);
    expect(w.roomAt(10, 9)?.temperatureC).toBeLessThan(4);
    expect(typeOf(w)).toBe('eiskeller');
    w.env.air = 10;
    expect(typeOf(w)).toBe('lager');
  });

  it('Trophäenhalle: mindestens drei Trophäen an den Wänden', () => {
    const w = house();
    furnish(w, ['probe_moebel_trophaee', 8, 8], ['probe_moebel_trophaee', 10, 8]);
    expect(typeOf(w)).toBeNull();
    furnish(w, ['probe_moebel_trophaee', 12, 8]);
    expect(typeOf(w)).toBe('trophaeenhalle');
  });

  it('kein Typ ohne Innenraum: dasselbe ohne Dach bleibt ohne Typ', () => {
    const w = house(null);
    furnish(w, ['probe_moebel_bett', 8, 8], ['probe_moebel_lampe', 12, 8]);
    burning(w, [12, 8]);
    expect(w.roomAt(10, 9)?.region.interior).toBe(false);
    expect(typeOf(w)).toBeNull();
  });
});

describe('Wirkungen (M4-17)', () => {
  it('Schlafraum: das Bett meldet Behaglichkeit und Schlafraum – „Ausgeruht“ hält ×1,5', () => {
    const w = house();
    furnish(w, ['probe_moebel_bett', 8, 8], ['probe_moebel_lampe', 12, 8]);
    burning(w, [12, 8]);
    const place = w.life.sleep.placeAt(w.sim, 0, w.tile(8, 9).tx, w.tile(8, 9).ty);
    expect(place).toMatchObject({ kind: 'bett', bedroom: true, x: (w.tile(8, 8).tx + 0.5) * 16, y: (w.tile(8, 8).ty + 1) * 16 });
    expect(place?.comfort).toBe(w.roomAt(10, 9)?.comfort.total);
    expect(restedSeconds(place?.comfort ?? 0, true)).toBe(restedSeconds(place?.comfort ?? 0, false) * BALANCE.sleep.rested.bedroomFactor);
    // Without the lamp it is no bedroom.
    const dark = house();
    furnish(dark, ['probe_moebel_bett', 8, 8]);
    expect(dark.life.sleep.placeAt(dark.sim, 0, dark.tile(8, 8).tx, dark.tile(8, 8).ty)?.bedroom).toBe(false);
  });

  it('Werkstatt: +15 % Tempo für die Arbeit im Raum – an jeder Kachel des Raums, wo der Spieler auch steht', () => {
    // Review M4 #14: the tempo is the room's where the work happens (the crafting system asks the room of the station,
    // src/game/setup.ts `useWorkshops`); the player's own room only for work in the hand.
    const w = house();
    furnish(w, ['probe_moebel_station', 8, 8], ['probe_moebel_station', 11, 8], ['probe_moebel_station', 8, 11]);
    const inside = w.tile(10, 10);
    const outside = w.tile(20, 20);
    expect(w.rooms.craftTempo(w.sim)).toBe(BALANCE.rooms.effects.workshopTempo);
    expect(w.rooms.craftTempoAt(w.sim, 0, inside.tx, inside.ty)).toBe(BALANCE.rooms.effects.workshopTempo);
    expect(w.rooms.craftTempoAt(w.sim, 0, outside.tx, outside.ty)).toBe(0);
    w.run(1, [{ type: 'player.teleport', x: w.px(20, 20).x, y: w.px(20, 20).y, layer: 0 }]);
    expect(w.rooms.craftTempo(w.sim)).toBe(0);
    expect(w.rooms.craftTempoAt(w.sim, 0, inside.tx, inside.ty)).toBe(BALANCE.rooms.effects.workshopTempo);
  });

  it('Trophäenhalle: Behaglichkeit +3', () => {
    const w = house();
    furnish(w, ['probe_moebel_trophaee', 8, 8], ['probe_moebel_trophaee', 10, 8], ['probe_moebel_trophaee', 12, 8]);
    expect(w.roomAt(10, 9)?.comfort.trophyHall).toBe(BALANCE.rooms.effects.trophyHallComfort);
  });
});
