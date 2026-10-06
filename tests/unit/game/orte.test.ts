/**
 * The place framework (M7-07; MASTERPROMPT §21 "Jeder Ort: Name, Kartensymbol, Entdeckungs-Stinger, Chronik-Eintrag; Zustand
 * (geplündert, gereinigt) wird gespeichert. Gegner in Orten kehren nach 7 Tagen teilweise zurück, Truhen nicht"; docs/SPIEL.md
 * §18) and the effects of M7-08/M7-09: discovery once, guards and their return, chests never coming back, the shrine's
 * blessing, the tower, the note, the dig site's cache; the reasons a use is refused.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { returningGuards, returnTickOf } from '../../../src/game/places/formulas';
import type { PlacesSnapshot } from '../../../src/game/places/state';
import type { RolledDrop } from '../../../src/game/gathering/formulas';
import { OFFSET, PLACES, orteWelt, type OrteWelt } from './orte-testwelt';

const G = PLACES.gehoeft;

/** Events of type `type` in an event map. */
function events<T>(map: Map<string, unknown[]>, type: string): T[] {
  return (map.get(type) ?? []) as T[];
}

/** Discovers the farmstead (its wolves rise) and kills them; returns the tick of the cleansing. */
function cleanse(w: OrteWelt): number {
  w.goTo(G.x, G.y);
  const killed = w.run(1, [{ type: 'creature.kill', radius: 30 }]);
  const c = events<{ tick: number }>(killed, 'placeCleansed');
  expect(c).toHaveLength(1);
  return (c[0] as { tick: number }).tick;
}

describe('places: discovery', () => {
  it('discovers a place once, when the player comes within its radius, and raises its guards there', () => {
    const w = orteWelt();
    expect(w.places.isDiscovered(G.slot)).toBe(false);
    // Slot radius 7 + 4 extra tiles: 12 tiles off the centre is outside, 11 inside.
    expect(events(w.goTo(G.x, G.y + 12), 'placeDiscovered')).toHaveLength(0);
    const found = events<{ place: number; ortstyp: string }>(w.goTo(G.x, G.y + 11), 'placeDiscovered');
    expect(found).toEqual([expect.objectContaining({ place: G.slot, ortstyp: 'gehoeft', x: OFFSET + G.x, y: OFFSET + G.y })]);
    expect(w.creatures.countOwned(`ort:${G.slot}`)).toBe(2);
    // Walking around inside discovers nothing again, and raises no second pack.
    expect(events(w.goTo(G.x, G.y), 'placeDiscovered')).toHaveLength(0);
    expect(w.creatures.countOwned(`ort:${G.slot}`)).toBe(2);
    expect(w.places.isDiscovered(PLACES.schrein.slot)).toBe(false);
  });

  it('a revealed place is known without a visit; discovering it later still raises its guards', () => {
    const w = orteWelt();
    expect(w.places.reveal(w.sim, G.slot, 'kartentisch')).toBe(true);
    expect(w.places.reveal(w.sim, G.slot, 'kartentisch')).toBe(false);
    expect(w.places.isKnown(G.slot)).toBe(true);
    expect(w.places.isDiscovered(G.slot)).toBe(false);
    expect(w.places.nearestHidden('gehoeft', 0, OFFSET, OFFSET)).toBe(-1);
    expect(w.places.nearestHidden('schrein', 0, OFFSET, OFFSET)).toBe(PLACES.schrein.slot);
    w.goTo(G.x, G.y);
    expect(w.places.isDiscovered(G.slot)).toBe(true);
    expect(w.creatures.countOwned(`ort:${G.slot}`)).toBe(2);
  });
});

describe('places: guards come back after 7 days, partly – chests never', () => {
  it('formulas: half of the guards rounded up, at least one, after returnDays', () => {
    expect(BALANCE.places.returnDays).toBe(7);
    expect(returningGuards(0)).toBe(0);
    expect(returningGuards(1)).toBe(1);
    expect(returningGuards(2)).toBe(1);
    expect(returningGuards(3)).toBe(2);
    expect(returnTickOf(100, 1000)).toBe(100 + 7 * 1000);
  });

  it('cleansed when the last guard falls; part of the guards return on the 7th day, the opened chest stays open', () => {
    const w = orteWelt();
    const cleansedAt = cleanse(w);
    expect(w.places.isCleansed(G.slot)).toBe(true);
    expect(w.creatures.countOwned(`ort:${G.slot}`)).toBe(0);
    const chest = w.markerIndex(G.slot, 'truhe', 1);
    const m = w.placements[G.slot]?.markers[chest] as { tx: number; ty: number };
    const opened = w.use(G.slot, chest);
    expect(events(opened, 'placeChestOpened')).toEqual([expect.objectContaining({ place: G.slot, stufe: 1 })]);
    expect(w.objectAt(m.tx, m.ty)).toBe('ort_truhe_offen');
    expect(w.dropped.length).toBeGreaterThan(0);
    // The return is due exactly 7 days after the cleansing.
    const tpd = w.sim.clock.ticksPerDay;
    const snap = w.places.save.serialize() as PlacesSnapshot;
    expect(snap.places.find((p) => p.slot === G.slot)?.returnTick).toBe(cleansedAt + 7 * tpd);
    // Away from the place; a minute before the day nothing comes back.
    w.goTo(30, 50);
    w.sim.skipTicks(cleansedAt + 7 * tpd - w.sim.tick - 120);
    expect(events(w.run(60), 'placeGuardsReturned')).toHaveLength(0);
    expect(w.places.isCleansed(G.slot)).toBe(true);
    const back = events<{ anzahl: number }>(w.run(120), 'placeGuardsReturned');
    expect(back).toEqual([expect.objectContaining({ place: G.slot, anzahl: 1 })]);
    expect(w.creatures.countOwned(`ort:${G.slot}`)).toBe(1);
    expect(w.places.isCleansed(G.slot)).toBe(false);
    // The chest did not come back.
    expect(w.objectAt(m.tx, m.ty)).toBe('ort_truhe_offen');
    const before = w.dropped.length;
    expect(w.rejections(w.use(G.slot, chest))).toEqual(['chestOpen']);
    expect(w.dropped.length).toBe(before);
    // The returned guard falling cleanses the place again; the next return is 7 days later.
    const again = w.run(1, [{ type: 'creature.kill', radius: 64 }]);
    expect(events(again, 'placeCleansed')).toHaveLength(1);
  });

  it('the last chest plunders the place; the loot is the same for the same world', () => {
    const loot = (w: OrteWelt): string => {
      for (let n = 0; n < 2; n++) w.use(G.slot, w.markerIndex(G.slot, 'truhe', n));
      return w.dropped.map((d) => `${d.stack.item}×${d.stack.count}`).join(',');
    };
    const a = orteWelt();
    cleanse(a);
    const first = a.use(G.slot, a.markerIndex(G.slot, 'truhe', 0));
    expect(events(first, 'placeLooted')).toHaveLength(0);
    const last = a.use(G.slot, a.markerIndex(G.slot, 'truhe', 1));
    expect(events(last, 'placeLooted')).toEqual([expect.objectContaining({ place: G.slot })]);
    expect(a.places.isLooted(G.slot)).toBe(true);
    const b = orteWelt();
    cleanse(b);
    const c = orteWelt({ seed: 2 });
    cleanse(c);
    const lb = loot(b);
    expect(lb).toContain('setzling_apfelbaum');
    expect(loot(orteWelt())).toBe(lb);
    expect(loot(c)).not.toBe(lb);
  });
});

describe('places: effects and refusals', () => {
  it('the shrine blesses, then rests for its days', () => {
    const w = orteWelt();
    const S = PLACES.schrein;
    const altar = w.markerIndex(S.slot, 'altar');
    const blessed = events<{ zustand: string; sekunden: number }>(w.use(S.slot, altar), 'shrineBlessed');
    expect(blessed).toEqual([expect.objectContaining({ zustand: 'gesegnet', sekunden: 600 })]);
    expect(w.life.conditions.has('gesegnet')).toBe(true);
    expect(w.places.isDiscovered(S.slot)).toBe(true);
    expect(w.rejections(w.use(S.slot, altar))).toEqual(['blessingCooling']);
    w.sim.skipTicks(3 * w.sim.clock.ticksPerDay);
    expect(events(w.use(S.slot, altar), 'shrineBlessed')).toHaveLength(1);
  });

  it('the tower shows 80 tiles around it; the farmer’s note is read at its post', () => {
    const w = orteWelt();
    const A = PLACES.aussichtsturm;
    const climbed = events<{ radiusTiles: number }>(w.use(A.slot, w.markerIndex(A.slot, 'aussicht')), 'towerClimbed');
    expect(climbed).toEqual([expect.objectContaining({ place: A.slot, radiusTiles: 80 })]);
    const read = events(w.use(G.slot, w.markerIndex(G.slot, 'tafel')), 'placeNoteRead');
    expect(read).toEqual([expect.objectContaining({ place: G.slot, ortstyp: 'gehoeft' })]);
  });

  it('refuses: out of reach, a mark without a use, an unknown place or mark', () => {
    const w = orteWelt();
    const chest = w.markerIndex(G.slot, 'truhe');
    w.goTo(30, 50);
    expect(w.rejections(w.run(1, [{ type: 'place.use', place: G.slot, marker: chest }]))).toEqual(['outOfReach']);
    expect(w.rejections(w.use(G.slot, w.markerIndex(G.slot, 'waechter')))).toEqual(['nothingThere']);
    expect(w.rejections(w.run(1, [{ type: 'place.use', place: 9, marker: 0 }]))).toEqual(['unknownPlace']);
    expect(w.rejections(w.run(1, [{ type: 'place.use', place: G.slot, marker: 99 }]))).toEqual(['unknownMark']);
  });

  it('the dig site gives its cache to the shovel once, with the guaranteed shard', () => {
    const w = orteWelt();
    const B = PLACES.buddelstelle;
    const m = w.placements[B.slot]?.markers[w.markerIndex(B.slot, 'buddel')] as { tx: number; ty: number };
    const finds = w.places.digFinds();
    expect(finds.claims(0, m.tx, m.ty)).toBe(true);
    expect(finds.claims(0, m.tx + 1, m.ty)).toBe(false);
    expect(finds.claims(-1, m.tx, m.ty)).toBe(false);
    const out: RolledDrop[] = [];
    finds.dig(w.sim, 0, m.tx, m.ty, out);
    expect(out.some((d) => d.item === 'lumen_scherbe')).toBe(true);
    expect(w.places.isDiscovered(B.slot)).toBe(true);
    expect(finds.claims(0, m.tx, m.ty)).toBe(false);
    const more: RolledDrop[] = [];
    finds.dig(w.sim, 0, m.tx, m.ty, more);
    expect(more).toHaveLength(0);
  });
});
