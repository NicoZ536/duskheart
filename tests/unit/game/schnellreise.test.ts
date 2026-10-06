/**
 * Fast travel (M7-37; MASTERPROMPT §25 "Schnellreise zwischen entzündeten Leuchtfeuern, Herdfeuern und Wegsteinen (Lumen-Kosten
 * nach Distanz). Option „Logistik-Realismus“: Erze und Barren nicht teleportierbar"; docs/SPIEL.md §22 "Schnellreise"): the
 * travel points (lit beacons, burning hearths, way stones of the build grid with their names), E at a point opens the screen,
 * the trip costs ⌈distance / 200⌉ Lumen shards (at least one) and puts the player in front of the destination; refused away
 * from a point, without Lumen, in a fight, with a boss awake, with ores or bars under logistics realism. On the drawn world of
 * leuchtfeuer-testwelt.ts (the beacon lit by debug, a hearth stand-in, way stones through the part listener).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { cargoItems, travelCost, waystoneName } from '../../../src/game/travel/formulas';
import type { TravelSample } from '../../../src/game/travel/types';
import { waystoneUses } from '../../../src/game/travel/uses';
import { createUseOffer } from '../../../src/game/interaction/uses';
import type { PartDef } from '../../../src/world/structures/catalog';
import { TILE_PX } from '../../../src/world/model/coords';
import { eventsOf } from './kampf-testwelt';
import { ARENA, leuchtfeuerWelt, OFFSET, SITE, type LeuchtfeuerWelt } from './leuchtfeuer-testwelt';

const T = BALANCE.travel;
const HEARTH = { x: 6, y: 8 } as const;
const STONE = { x: 50, y: 30 } as const;
const WEGSTEIN = { id: 'wegstein' } as PartDef;

/** The beacon lit (debug), a burning hearth on drawn tile `HEARTH`, a way stone on `STONE`; the player at the beacon. */
function world(): LeuchtfeuerWelt {
  const w = leuchtfeuerWelt();
  w.run(1, [{ type: 'beacon.debug', beacon: 1, aktion: 'entzuenden' }]);
  const c = w.centre(HEARTH.x, HEARTH.y);
  w.hearths.push({ hearth: 7, x: c.x, y: c.y, layer: 0 });
  w.travel.partListener().placed?.(w.sim, WEGSTEIN, 0, OFFSET + STONE.x, OFFSET + STONE.y);
  w.goTo(SITE.x, SITE.y + 2);
  return w;
}

function sample(): TravelSample {
  return { from: '', points: [], costs: [], blocked: null };
}

describe('Schnellreise: Regeln', () => {
  it('Kosten ⌈Distanz / 200⌉ Lumen-Scherben, mindestens 1', () => {
    expect(travelCost(0, 0)).toBe(T.minCost);
    expect(travelCost(3, 4)).toBe(1);
    expect(travelCost(200, 0)).toBe(1);
    expect(travelCost(201, 0)).toBe(2);
    expect(travelCost(300, 400)).toBe(3);
    expect(T.currency).toBe('lumen_scherbe');
  });

  it('Fracht unter Logistik-Realismus: jedes Erz und jeder Barren des Contents, sonst nichts', () => {
    const cargo = cargoItems(CONTENT.collection('items').values(), CONTENT.collection('ores').values());
    for (const id of ['kupfererz', 'zinnerz', 'sternenerz', 'kupferbarren', 'zinnbarren', 'bronzebarren']) expect(cargo.has(id), id).toBe(true);
    for (const id of ['stein', 'holz', 'lumen_scherbe', 'herzsplitter', 'kernholz']) expect(cargo.has(id), id).toBe(false);
  });

  it('Wegstein-Namen: getrimmt, Leerraum gefaltet, nie leer, höchstens 24 Zeichen', () => {
    expect(waystoneName('  Alte   Mühle ')).toBe('Alte Mühle');
    expect(waystoneName('   ')).toBeNull();
    expect(waystoneName('x'.repeat(T.nameMaxLength))).toHaveLength(T.nameMaxLength);
    expect(waystoneName('x'.repeat(T.nameMaxLength + 1))).toBeNull();
  });
});

describe('Schnellreise zur Laufzeit (M7-37)', () => {
  it('Reisepunkte: entzündete Leuchtfeuer, brennende Herdfeuer, Wegsteine; ein abgebauter Wegstein ist keiner mehr', () => {
    const w = world();
    expect(w.travel.points(w.sim).map((p) => [p.id, p.kind, p.tx - OFFSET, p.ty - OFFSET])).toEqual([
      ['leuchtfeuer:1', 'leuchtfeuer', SITE.x, SITE.y],
      ['herdfeuer:7', 'herdfeuer', HEARTH.x, HEARTH.y],
      ['wegstein:1', 'wegstein', STONE.x, STONE.y],
    ]);
    w.travel.partListener().removed?.(w.sim, WEGSTEIN, 0, OFFSET + STONE.x, OFFSET + STONE.y, 'abgebaut');
    expect(w.travel.points(w.sim).map((p) => p.id)).toEqual(['leuchtfeuer:1', 'herdfeuer:7']);
    // A dark beacon is no point.
    w.run(1, [{ type: 'beacon.debug', beacon: 1, aktion: 'loeschen' }]);
    expect(w.travel.points(w.sim).map((p) => p.id)).toEqual(['herdfeuer:7']);
  });

  it('E am Reisepunkt öffnet den Bildschirm; abseits abgelehnt; die Liste nennt Ziele und Preise', () => {
    const w = world();
    expect(eventsOf(w.run(1, [{ type: 'travel.open' }]), 'travelOpened')).toEqual([expect.objectContaining({ von: 'leuchtfeuer:1', kind: 'leuchtfeuer' })]);
    const s = w.travel.sample(w.sim, sample());
    expect(s.from).toBe('leuchtfeuer:1');
    expect(s.points.map((p) => p.id)).toEqual(['herdfeuer:7', 'wegstein:1']);
    expect(s.costs).toEqual([1, 1]);
    expect(s.blocked).toBeNull();
    w.goTo(ARENA.x, ARENA.y + 12);
    expect(w.rejections(w.run(1, [{ type: 'travel.open' }]))).toEqual(['notAtPoint']);
    expect(w.travel.sample(w.sim, s)).toMatchObject({ from: '', points: [], costs: [], blocked: 'notAtPoint' });
  });

  it('Reisen: Lumen nach Distanz weg, der Spieler steht vor dem Ziel; ohne Lumen abgelehnt', () => {
    const w = world();
    expect(w.rejections(w.run(1, [{ type: 'travel.go', ziel: 'herdfeuer:7' }]))).toEqual(['notEnoughLumen']);
    w.inventory.give(w.sim, 'lumen_scherbe', 3);
    const ev = w.run(1, [{ type: 'travel.go', ziel: 'herdfeuer:7' }]);
    expect(eventsOf(ev, 'travelled')).toEqual([expect.objectContaining({ von: 'leuchtfeuer:1', nach: 'herdfeuer:7', kind: 'herdfeuer', kosten: 1, layer: 0 })]);
    expect(w.inventory.count('lumen_scherbe')).toBe(2);
    const p = w.pos();
    const dx = p.x / TILE_PX - (OFFSET + HEARTH.x + 0.5);
    const dy = p.y / TILE_PX - (OFFSET + HEARTH.y + 0.5);
    expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(T.arrivalOffsetTiles + 1.5);
    // From the hearth on to the way stone, and back to the beacon.
    expect(eventsOf(w.run(1, [{ type: 'travel.go', ziel: 'wegstein:1' }]), 'travelled')).toHaveLength(1);
    expect(eventsOf(w.run(1, [{ type: 'travel.go', ziel: 'leuchtfeuer:1' }]), 'travelled')).toHaveLength(1);
    expect(w.inventory.count('lumen_scherbe')).toBe(0);
  });

  it('abgelehnt: dasselbe Ziel, unbekanntes Ziel, im Kampf, mit erwachtem Boss, mit Erz unter Logistik-Realismus', () => {
    const w = world();
    w.inventory.give(w.sim, 'lumen_scherbe', 9);
    expect(w.rejections(w.run(1, [{ type: 'travel.go', ziel: 'leuchtfeuer:1' }]))).toEqual(['samePoint']);
    expect(w.rejections(w.run(1, [{ type: 'travel.go', ziel: 'wegstein:9' }]))).toEqual(['unknownPoint']);
    // A blow taken: five seconds of fight.
    w.strikePlayer(w.dummy(20, 0), { damage: 1 });
    expect(w.rejections(w.run(1, [{ type: 'travel.go', ziel: 'herdfeuer:7' }]))).toEqual(['inFight']);
    w.run(Math.round(T.combatLockSeconds * BALANCE.time.tickHz) + 1);
    // Ores are no problem – until logistics realism is on.
    w.inventory.give(w.sim, 'kupfererz', 1);
    w.logistics = true;
    expect(w.rejections(w.run(1, [{ type: 'travel.go', ziel: 'herdfeuer:7' }]))).toEqual(['cargoNotTeleportable']);
    expect(w.travel.sample(w.sim, sample()).blocked).toBe('cargoNotTeleportable');
    w.logistics = false;
    expect(eventsOf(w.run(1, [{ type: 'travel.go', ziel: 'herdfeuer:7' }]), 'travelled')).toHaveLength(1);
    // A boss awake: no trip, not even from a way stone someone set up inside its arena.
    w.travel.partListener().placed?.(w.sim, WEGSTEIN, 0, OFFSET + ARENA.x + 3, OFFSET + ARENA.y + 3);
    w.goTo(ARENA.x + 3, ARENA.y + 4);
    expect(w.bosses.awake()).toBe('borkenvater');
    expect(w.rejections(w.run(1, [{ type: 'travel.go', ziel: 'leuchtfeuer:1' }]))).toEqual(['bossAwake']);
  });

  it('Wegsteine benennen; der Name bleibt beim Speichern; E am Wegstein bietet „Reisen“', () => {
    const w = world();
    const ev = w.run(1, [{ type: 'travel.rename', wegstein: 1, name: '  Am   Fluss ' }]);
    expect(eventsOf(ev, 'travelPointRenamed')).toEqual([expect.objectContaining({ wegstein: 1, name: 'Am Fluss' })]);
    expect(w.travel.points(w.sim).find((p) => p.id === 'wegstein:1')?.name).toBe('Am Fluss');
    expect(w.rejections(w.run(1, [{ type: 'travel.rename', wegstein: 1, name: '   ' }]))).toEqual(['nameInvalid']);
    expect(w.rejections(w.run(1, [{ type: 'travel.rename', wegstein: 5, name: 'X' }]))).toEqual(['unknownWaystone']);
    const saved = w.travel.save.serialize();
    expect(saved).toEqual({ nextWaystone: 2, waystones: [{ id: 1, layer: 0, tx: OFFSET + STONE.x, ty: OFFSET + STONE.y, name: 'Am Fluss' }] });
    const uses = waystoneUses(w.travel, { partAt: (_l, _e, tx, ty) => (tx === OFFSET + STONE.x && ty === OFFSET + STONE.y ? WEGSTEIN : undefined) });
    const offer = createUseOffer();
    expect(uses.offer(w.sim, 0, OFFSET + STONE.x, OFFSET + STONE.y, offer)).toBe(true);
    expect(offer).toMatchObject({ action: 'reisen', subject: 'wegstein', block: null });
    expect(uses.offer(w.sim, 0, OFFSET + STONE.x + 1, OFFSET + STONE.y, offer)).toBe(false);
  });

  it('tot reist niemand', () => {
    const w = world();
    w.inventory.give(w.sim, 'lumen_scherbe', 2);
    w.run(1, [{ type: 'death.kill' }]);
    expect(w.rejections(w.run(1, [{ type: 'travel.go', ziel: 'herdfeuer:7' }]))).toEqual(['dead']);
  });
});
