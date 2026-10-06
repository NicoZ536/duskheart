/**
 * The unlock registry and LF1 (M7-36; MASTERPROMPT §23.1 "Leuchtfeuer-Wissen", §15.1 "Baupläne"; docs/SPIEL.md §22
 * "Freischaltungen"): every row of §23.1 as content (LF1 playable, LF2–6 with their task), grants with tick and source,
 * recipes with `freischaltung` hidden and refused until granted – and LF1 playable: the Lumen workbench made at Werkbank II,
 * set up, the Lumen lantern and the waystone made at it; the ember core fits the first niche of a hearth. On the drawn
 * station world (stationen-testwelt.ts) with the registry wired as in `createSimulation`.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { lightKindOfItem } from '../../../src/content/lights';
import { UNLOCK_SOURCE_PATTERN } from '../../../src/game/unlocks/state';
import { UnlocksSystem } from '../../../src/game/unlocks/system';
import { eventsOf, stationWorld, TICK_HZ, type StationWorld } from './stationen-testwelt';

/** The station world with the unlock registry wired as in `createSimulation`. */
function world(): StationWorld & { unlocks: UnlocksSystem } {
  const w = stationWorld();
  const unlocks = w.sim.addSystem(new UnlocksSystem());
  w.crafting.useUnlocks(unlocks);
  unlocks.onGrant((s) => w.crafting.unlocksChanged(s));
  return Object.assign(w, { unlocks });
}

describe('Freischaltungs-Registry (§23.1)', () => {
  it('alle Zeilen von §23.1: LF1 umgesetzt, LF2–6 mit ihrer Aufgabe; Ids lf<n>_<ziel>', () => {
    const all = CONTENT.collection('unlocks').values();
    const byBeacon = new Map<number, string[]>();
    for (const u of all) {
      const n = Number(/^lf(\d)_/.exec(u.id)?.[1]);
      byBeacon.set(n, [...(byBeacon.get(n) ?? []), u.id]);
      if (n === 1) expect(u.umgesetzt, u.id).toBe(true);
      else expect(u.umgesetzt, u.id).toEqual({ task: expect.stringMatching(/^M\d+-\d+/) });
    }
    expect([...byBeacon.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(byBeacon.get(1)).toEqual(['lf1_lumen_werkbank', 'lf1_lumen_laterne', 'lf1_wegsteine', 'lf1_glutkern']);
    // Each beacon names its unlocks; each recipe waiting for one names an existing unlock.
    for (const b of CONTENT.collection('beacons').values()) for (const id of b.freischaltungen) expect(id.startsWith(`lf${b.nummer}_`), id).toBe(true);
    const waiting = CONTENT.collection('recipes').values().filter((r) => r.freischaltung !== undefined);
    expect(waiting.map((r) => [r.id, r.freischaltung])).toEqual([
      ['rezept_lumen_werkbank', 'lf1_lumen_werkbank'],
      ['rezept_lumen_laterne', 'lf1_lumen_laterne'],
      ['rezept_wegstein', 'lf1_wegsteine'],
    ]);
  });

  it('gewähren: einmal, mit Tick und Quelle; Debug-Befehl lehnt Unbekanntes und Doppeltes ab', () => {
    const w = world();
    let told = 0;
    w.unlocks.onGrant(() => told++);
    expect(w.unlocks.has('lf1_wegsteine')).toBe(false);
    expect(w.unlocks.recipeAllowed('rezept_wegstein')).toBe(false);
    expect(w.unlocks.recipeAllowed('rezept_werkbank_2')).toBe(true);
    const ev = w.run(1, [{ type: 'unlock.grant', unlock: 'lf1_wegsteine' }]);
    expect(eventsOf(ev, 'unlockGranted')).toEqual([expect.objectContaining({ unlock: 'lf1_wegsteine', quelle: 'debug' })]);
    expect(w.unlocks.granted()).toEqual([{ id: 'lf1_wegsteine', tick: expect.any(Number), source: 'debug' }]);
    expect(w.unlocks.recipeAllowed('rezept_wegstein')).toBe(true);
    expect(told).toBe(1);
    expect(w.refused({ type: 'unlock.grant', unlock: 'lf1_wegsteine' })).toEqual(['alreadyUnlocked']);
    expect(w.refused({ type: 'unlock.grant', unlock: 'lf9_nichts' })).toEqual(['unknownUnlock']);
    expect(w.unlocks.grant(w.sim, 'lf1_wegsteine', 'leuchtfeuer:1')).toBe(false);
    for (const s of ['leuchtfeuer:1', 'bauplan:kompass', 'forschung:relikt_1', 'haendlerin', 'debug']) expect(UNLOCK_SOURCE_PATTERN.test(s), s).toBe(true);
    for (const s of ['leuchtfeuer:7', 'bauplan:', 'zufall']) expect(UNLOCK_SOURCE_PATTERN.test(s), s).toBe(false);
  });
});

describe('LF1 spielbar (M7-36)', () => {
  it('Lumen-Werkbank: verborgen und abgelehnt bis zur Freischaltung, danach an Werkbank II herstellbar', () => {
    const w = world();
    w.place('werkbank_2', 6, 4);
    const recipe = CONTENT.collection('recipes').get('rezept_lumen_werkbank');
    for (const z of recipe.zutaten) w.give((z as { item: string }).item, (z as { anzahl: number }).anzahl);
    w.run(1);
    expect(w.crafting.isVisible('rezept_lumen_werkbank')).toBe(false);
    expect(w.refused({ type: 'craft.start', recipe: 'rezept_lumen_werkbank', count: 1 })).toEqual(['recipeHidden']);
    const ev = w.run(1, [{ type: 'unlock.grant', unlock: 'lf1_lumen_werkbank' }]);
    expect(eventsOf(ev, 'recipeDiscovered')).toEqual([expect.objectContaining({ recipe: 'rezept_lumen_werkbank' })]);
    const made = w.run(BALANCE.crafting.durationSeconds.gross * TICK_HZ + 2, [{ type: 'craft.start', recipe: 'rezept_lumen_werkbank', count: 1 }]);
    expect(eventsOf(made, 'craftCompleted')).toEqual([expect.objectContaining({ item: 'lumen_werkbank' })]);
    expect(w.has('lumen_werkbank')).toBe(1);
  });

  it('an der Lumen-Werkbank: Lumen-Laterne und Wegstein nach ihren Freischaltungen; der Glutkern passt in die erste Herdnische', () => {
    const w = world();
    w.place('lumen_werkbank', 6, 4);
    for (const id of ['rezept_lumen_laterne', 'rezept_wegstein']) for (const z of CONTENT.collection('recipes').get(id).zutaten) w.give((z as { item: string }).item, (z as { anzahl: number }).anzahl);
    w.run(1);
    expect(w.crafting.isVisible('rezept_lumen_laterne')).toBe(false);
    expect(w.crafting.isVisible('rezept_wegstein')).toBe(false);
    w.run(1, [{ type: 'unlock.grant', unlock: 'lf1_lumen_laterne' }]);
    w.run(1, [{ type: 'unlock.grant', unlock: 'lf1_wegsteine' }]);
    const lantern = w.run(BALANCE.crafting.durationSeconds.werkzeug * TICK_HZ + 2, [{ type: 'craft.start', recipe: 'rezept_lumen_laterne', count: 1 }]);
    expect(eventsOf(lantern, 'craftCompleted')).toEqual([expect.objectContaining({ item: 'lumen_laterne' })]);
    const stone = w.run(BALANCE.crafting.durationSeconds.gross * TICK_HZ + 2, [{ type: 'craft.start', recipe: 'rezept_wegstein', count: 1 }]);
    expect(eventsOf(stone, 'craftCompleted')).toEqual([expect.objectContaining({ item: 'wegstein' })]);
    expect(w.has('lumen_laterne')).toBe(1);
    expect(w.has('wegstein')).toBe(1);
    // The waystone is a part of the build grid (a travel point once set up, schnellreise.test.ts); the lantern a Lumen light.
    expect(CONTENT.collection('buildParts').get('wegstein').art).toBe('moebel');
    expect(lightKindOfItem('lumen_laterne')?.verhalten).toBe('lumen');
    // lf1_glutkern: the ember core of the first beacon is the first niche's core of the hearth (herdfeuer.test.ts sets it).
    expect(BALANCE.hearth.coreItems[0]).toBe('glutkern_1');
    expect(CONTENT.collection('items').get('glutkern_1').quellen).toEqual(['leuchtfeuer:leuchtfeuer_1']);
  });

  it('nach dem Laden sind die freigeschalteten Rezepte wieder sichtbar', () => {
    const w = world();
    w.run(1, [{ type: 'unlock.grant', unlock: 'lf1_lumen_laterne' }]);
    expect(w.crafting.isVisible('rezept_lumen_laterne')).toBe(true);
    const v = world();
    for (const p of w.sim.participants()) v.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(v.unlocks.has('lf1_lumen_laterne')).toBe(true);
    expect(v.crafting.isVisible('rezept_lumen_laterne')).toBe(true);
    expect(v.crafting.isVisible('rezept_wegstein')).toBe(false);
  });
});
