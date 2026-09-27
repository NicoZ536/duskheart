/**
 * M4-20 Herdfeuer (MASTERPROMPT §16.5 "Pro Basis ein Herdfeuer, höchstens 3 Basen. Radius 12 Tiles, mit Glutkernen …
 * bis 40 Tiles aufrüstbar. Brennstoff: Holzscheite (1 je Spielstunde), Holzkohle (1 je 3 h) …; Vorratsfach 40. Solange
 * es brennt: keine Schattenbrut-Spawns im Radius, Lagerübersicht aller Kisten, Wiedereinstiegspunkt, Schnellreiseziel.
 * Erlischt es, entfällt der Schutz."):
 * - the hearth is an item with a recipe, placed on the build grid (3 × 3 stone), one per base, three bases at most;
 * - fuel store of 40, logs burn a game hour, charcoal three; it goes out when the store is empty;
 * - while it burns: spawn protection in its radius, respawn point, overview of the base's chests, travel target,
 *   warmth and light; out: none of that;
 * - ember cores widen the radius from 12 to 40 tiles;
 * - a lit or filled hearth is not taken down;
 * - fuel burning in a frozen chunk catches up to exactly the state of a ticking one (2 game hours).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { advanceHearth, hearthFuelTicks, radiusForCores } from '../../../src/game/hearth/formulas';
import type { Hearth } from '../../../src/game/hearth/state';
import { CHUNK_SHIFT, TILE_PX } from '../../../src/world/model/coords';
import { lagerWelt, px, type LagerWelt } from './lager-testwelt';
import { OFFSET, meadow } from './spieler-testwelt';

const H = BALANCE.hearth;

/** A meadow, the player on (10, 10), a hearth anchored on (12, 9) (centre (13.5, 10.5)). */
function world(): LagerWelt & { readonly id: number } {
  const w = lagerWelt(meadow(40, 20), { x: 10, y: 10 });
  const r = w.build('herdfeuer', 12, 9);
  if (r !== null) throw new Error(`hearth refused: ${r}`);
  const id = w.hearth.hearths[0]?.id ?? 0;
  return Object.assign(w, { id });
}

function goTo(w: LagerWelt, x: number, y: number): void {
  const p = px(x, y);
  w.act({ type: 'player.teleport', x: p.x, y: p.y, layer: 0 });
}

function hearthOf(w: LagerWelt & { readonly id: number }): Readonly<Hearth> {
  const h = w.hearth.hearth(w.id);
  if (h === undefined) throw new Error('no hearth');
  return h;
}

function fuel(w: LagerWelt & { readonly id: number }, item: string, count: number): string | null {
  w.give(item, count);
  return w.rejection(w.act({ type: 'hearth.fuel', hearth: w.id, from: w.slotOf(item), count }));
}

describe('Herdfeuer als Bauteil (§16.5)', () => {
  it('Werte: 3 Basen, Radius 12 … 40, Scheit 1 h, Holzkohle 3 h, Vorrat 40; Item, Rezept, 3 × 3-Steinring', () => {
    expect(H.maxBases).toBe(3);
    expect([radiusForCores(0), radiusForCores(6)]).toEqual([12, 40]);
    expect(H.radiusByCores).toHaveLength(7);
    for (let k = 1; k < H.radiusByCores.length; k++) expect(H.radiusByCores[k]).toBeGreaterThan(H.radiusByCores[k - 1] as number);
    expect(H.fuelGameHours).toEqual({ holz: 1, holzkohle: 3 });
    expect(H.storePieces).toBe(40);
    expect(CONTENT.collection('recipes').get('rezept_herdfeuer').station).toBe('steinmetzbank');
    expect(CONTENT.collection('buildParts').get('herdfeuer')).toMatchObject({ art: 'moebel', material: 'stein', groesse: { b: 3, t: 3 } });
    for (const f of Object.keys(H.fuelGameHours)) expect(CONTENT.collection('items').has(f), f).toBe(true);
  });

  it('eine Basis je Herdfeuer (24 Tiles Abstand), höchstens drei; die Vorschau nennt den Grund', () => {
    const w = world();
    expect(w.hearth.hearths).toHaveLength(1);
    expect(hearthOf(w)).toMatchObject({ tx: OFFSET + 12, ty: OFFSET + 9, w: 3, h: 3, lit: false });
    expect(w.build('herdfeuer', 16, 13)).toBe('hearthTooClose');
    expect(w.building.preview(w.sim, 'herdfeuer', OFFSET + 16, OFFSET + 13)).toBe('hearthTooClose');
    goTo(w, 40, 10);
    expect(w.build('herdfeuer', 40, 12)).toBeNull();
    goTo(w, 70, 10);
    expect(w.build('herdfeuer', 70, 12)).toBeNull();
    goTo(w, 100, 10);
    expect(w.build('herdfeuer', 100, 12)).toBe('hearthLimit');
    expect(w.hearth.hearths).toHaveLength(3);
  });
});

describe('Brennstoff (§16.5: Scheit 1 je Spielstunde, Holzkohle 1 je 3 h, Vorratsfach 40)', () => {
  it('Vorrat fasst 40; nur Scheite und Holzkohle; ohne Brennstoff kein Entzünden', () => {
    const w = world();
    expect(w.rejection(w.act({ type: 'hearth.ignite', hearth: w.id }))).toBe('noFuel');
    w.give('stein', 3);
    expect(w.rejection(w.act({ type: 'hearth.fuel', hearth: w.id, from: w.slotOf('stein') }))).toBe('notFuel');
    expect(fuel(w, 'holz', 30)).toBeNull();
    expect(fuel(w, 'holzkohle', 10)).toBeNull();
    expect(fuel(w, 'holz', 5)).toBe('storeFull');
    expect(hearthOf(w).vorrat.map((s) => [s.item, s.count])).toEqual([
      ['holz', 30],
      ['holzkohle', 10],
    ]);
    const ev = w.act({ type: 'hearth.take', hearth: w.id, index: 1, count: 4 });
    expect(ev.get('hearthFuelTaken')?.[0]).toMatchObject({ item: 'holzkohle', count: 4, stored: 36 });
  });

  it('ein Scheit brennt eine Spielstunde, Holzkohle drei; leer erlischt es', () => {
    const w = world();
    const hour = w.sim.clock.ticksPerGameHour;
    fuel(w, 'holz', 2);
    fuel(w, 'holzkohle', 1);
    const lit = w.act({ type: 'hearth.ignite', hearth: w.id });
    expect(lit.get('hearthIgnited')?.[0]).toMatchObject({ hearth: w.id, radiusTiles: 12 });
    expect(hearthOf(w)).toMatchObject({ lit: true, rest: hour - 1 });
    w.run(hour);
    expect(hearthOf(w).vorrat.map((s) => [s.item, s.count])).toEqual([['holzkohle', 1]]);
    w.run(hour);
    expect(hearthOf(w).vorrat).toEqual([]);
    expect(hearthOf(w).voll).toBe(3 * hour);
    const ev = w.run(3 * hour);
    expect(ev.get('hearthOut')?.[0]).toMatchObject({ reason: 'brennstoff' });
    expect(hearthOf(w).lit).toBe(false);
    expect(hearthFuelTicks('holz', hour)).toBe(hour);
    expect(hearthFuelTicks('holzkohle', hour)).toBe(3 * hour);
  });

  it('löschen behält den Rest des Scheits; neu entzündet brennt er weiter', () => {
    const w = world();
    fuel(w, 'holz', 1);
    w.act({ type: 'hearth.ignite', hearth: w.id });
    w.run(100);
    expect(w.act({ type: 'hearth.douse', hearth: w.id }).get('hearthOut')?.[0]).toMatchObject({ reason: 'geloescht' });
    const rest = hearthOf(w).rest;
    w.run(500);
    expect(hearthOf(w).rest).toBe(rest);
    expect(w.rejection(w.act({ type: 'hearth.douse', hearth: w.id }))).toBe('notBurning');
    expect(w.rejection(w.act({ type: 'hearth.ignite', hearth: w.id }))).toBeNull();
    expect(w.rejection(w.act({ type: 'hearth.ignite', hearth: w.id }))).toBe('burning');
  });
});

describe('Solange es brennt (§16.5)', () => {
  it('Spawnverbot im Radius, Wiedereinstieg, Schnellreiseziel, Wärme und Licht – erloschen nichts davon', () => {
    const w = world();
    const centre = { x: (OFFSET + 13.5) * TILE_PX, y: (OFFSET + 10.5) * TILE_PX };
    const inside = { x: centre.x + 11 * TILE_PX, y: centre.y };
    const outside = { x: centre.x + 13 * TILE_PX, y: centre.y };
    expect(w.hearth.spawnBlocked(w.sim, 0, inside.x, inside.y)).toBe(false);
    fuel(w, 'holz', 1);
    w.act({ type: 'hearth.ignite', hearth: w.id });
    expect(w.hearth.spawnBlocked(w.sim, 0, inside.x, inside.y)).toBe(true);
    expect(w.hearth.spawnBlocked(w.sim, 0, outside.x, outside.y)).toBe(false);
    expect(w.hearth.spawnBlocked(w.sim, -1, inside.x, inside.y)).toBe(false);
    expect(w.hearth.respawnSpots(w.sim)).toHaveLength(1);
    expect(w.hearth.travelTargets(w.sim)).toEqual([{ hearth: w.id, x: centre.x, y: centre.y, layer: 0 }]);
    expect(w.hearth.heatSources()(w.sim)).toHaveLength(1);
    const lights: number[] = [];
    w.hearth.lightProvider()(w.sim, (_id, kind, _farbe, _layer, x, _y, _h, radius) => {
      expect(kind).toBe('herdfeuer');
      lights.push(x, radius);
    });
    expect(lights).toEqual([centre.x, H.light.radiusTiles * TILE_PX]);
    w.act({ type: 'hearth.douse', hearth: w.id });
    expect(w.hearth.spawnBlocked(w.sim, 0, inside.x, inside.y)).toBe(false);
    expect(w.hearth.respawnSpots(w.sim)).toEqual([]);
    expect(w.hearth.heatSources()(w.sim)).toHaveLength(0);
  });

  it('der Tod: „Am Herdfeuer erwachen“ vor dem brennenden Herdfeuer', () => {
    const w = world();
    fuel(w, 'holz', 5);
    w.act({ type: 'hearth.ignite', hearth: w.id });
    goTo(w, 30, 10);
    const died = w.act({ type: 'death.kill' });
    expect(died.get('playerDied')?.[0]).toMatchObject({ spots: ['herdfeuer', 'strand'] });
    const back = w.act({ type: 'death.respawn', at: 'herdfeuer' });
    expect(w.rejection(back)).toBeNull();
    expect(back.get('playerRespawned')?.[0]).toMatchObject({ at: 'herdfeuer' });
    const p = w.pos();
    expect(Math.hypot(p.x - (OFFSET + 13.5) * TILE_PX, p.y - (OFFSET + 12.5) * TILE_PX)).toBeLessThan(3 * TILE_PX);
  });

  it('Lagerübersicht aller Kisten im Radius – nur solange es brennt', () => {
    const w = world();
    expect(w.build('kiste_holz', 9, 12)).toBeNull();
    const chest = w.storage.chests[0]?.id ?? 0;
    w.give('kupfererz', 7);
    w.act({ type: 'storage.put', chest, from: w.slotOf('kupfererz') });
    expect(w.hearth.overview(w.sim, w.id)).toBeNull();
    fuel(w, 'holz', 1);
    w.act({ type: 'hearth.ignite', hearth: w.id });
    const o = w.hearth.overview(w.sim, w.id);
    expect(o?.chests.map((c) => c.id)).toEqual([chest]);
    expect([...(o?.totals ?? [])]).toEqual([['kupfererz', 7]]);
  });
});

describe('Glutkerne (§16.5 "bis 40 Tiles aufrüstbar")', () => {
  it('Nische n nimmt Glutkern n; der Radius wächst bis 40; Kerne kommen zurück', () => {
    const w = world();
    w.give('stein', 1);
    expect(w.rejection(w.act({ type: 'hearth.core', hearth: w.id, from: w.slotOf('stein') }))).toBe('notACore');
    for (let n = 1; n <= 6; n++) {
      w.give(`glutkern_${n}`, 1);
      const ev = w.act({ type: 'hearth.core', hearth: w.id, from: w.slotOf(`glutkern_${n}`) });
      expect(ev.get('hearthCoreSet')?.[0]).toMatchObject({ index: n - 1, core: `glutkern_${n}`, radiusTiles: H.radiusByCores[n] });
    }
    expect(w.hearth.radiusTiles(hearthOf(w))).toBe(40);
    w.give('glutkern_3', 1);
    expect(w.rejection(w.act({ type: 'hearth.core', hearth: w.id, from: w.slotOf('glutkern_3') }))).toBe('coreSet');
    const ev = w.act({ type: 'hearth.uncore', hearth: w.id, index: 2 });
    expect(ev.get('hearthCoreTaken')?.[0]).toMatchObject({ core: 'glutkern_3', radiusTiles: H.radiusByCores[5] });
    expect(w.count('glutkern_3')).toBe(2);
    expect(w.rejection(w.act({ type: 'hearth.uncore', hearth: w.id, index: 2 }))).toBe('noCore');
    // The base (the chests' search, trees that do not grow back) follows the radius, lit or not.
    expect(w.hearth.inBase(0, OFFSET + 13 + 30, OFFSET + 10)).toBe(true);
    expect(w.hearth.inBase(0, OFFSET + 13 + 40, OFFSET + 10)).toBe(false);
  });
});

describe('Abbauen', () => {
  it('brennend oder gefüllt nicht; leer und aus ja', () => {
    const w = world();
    fuel(w, 'holz', 2);
    w.act({ type: 'hearth.ignite', hearth: w.id });
    const at = { type: 'build.remove' as const, tx: OFFSET + 13, ty: OFFSET + 10 };
    expect(w.rejection(w.act(at))).toBe('burning');
    w.act({ type: 'hearth.douse', hearth: w.id });
    expect(w.rejection(w.act(at))).toBe('notEmpty');
    w.act({ type: 'hearth.take', hearth: w.id, index: 0 });
    const ev = w.act(at);
    expect(w.rejection(ev)).toBeNull();
    expect(ev.get('hearthRemoved')?.[0]).toMatchObject({ hearth: w.id, spilled: 0 });
    expect(w.hearth.hearths).toEqual([]);
  });
});

describe('Aufholen in entladenen Chunks (M4-20 Akzeptanz)', () => {
  it('2 Spielstunden eingefroren + aufgeholt = durchgehend brennend; in zwei Schritten ebenso', () => {
    const setUp = (): LagerWelt & { readonly id: number } => {
      const w = world();
      fuel(w, 'holz', 1);
      fuel(w, 'holzkohle', 1);
      w.act({ type: 'hearth.ignite', hearth: w.id });
      w.run(123);
      return w;
    };
    const ticking = setUp();
    const frozen = setUp();
    const split = setUp();
    const hours = 2 * ticking.sim.clock.ticksPerGameHour;
    ticking.run(hours);
    frozen.active = false;
    split.active = false;
    const from = frozen.sim.tick;
    frozen.run(hours);
    split.run(hours);
    const h = hearthOf(frozen);
    const chunk = { layer: 0 as const, cx: h.tx >> CHUNK_SHIFT, cy: h.ty >> CHUNK_SHIFT };
    frozen.hearth.catchUp(chunk, from, frozen.sim.tick);
    split.hearth.catchUp(chunk, from, from + 4321);
    split.hearth.catchUp(chunk, from + 4321, split.sim.tick);
    expect(frozen.hearth.save.serialize()).toEqual(ticking.hearth.save.serialize());
    expect(split.hearth.save.serialize()).toEqual(ticking.hearth.save.serialize());
    // The charcoal burns on: the hearth is lit after 2 h; what it would be after catching up, it answers before.
    expect(hearthOf(ticking)).toMatchObject({ lit: true, vorrat: [] });
  });

  it('die reine Brennformel ist zerlegbar und erlischt genau am Ende des Brennstoffs', () => {
    const make = (): Hearth => ({ id: 1, layer: 0, tx: 0, ty: 0, w: 3, h: 3, lit: true, rest: 10, voll: 50, vorrat: [{ item: 'holz', count: 2 }], kerne: [null, null, null, null, null, null], bis: 0 });
    const ticks = (item: string): number => (item === 'holz' ? 30 : 0);
    const a = make();
    const outs: number[] = [];
    advanceHearth(a, 100, ticks, (t) => outs.push(t));
    expect(outs).toEqual([70]);
    expect(a).toMatchObject({ lit: false, rest: 0, vorrat: [] });
    const b = make();
    for (let t = 1; t <= 100; t++) advanceHearth(b, t, ticks);
    expect(b).toEqual(a);
  });
});
