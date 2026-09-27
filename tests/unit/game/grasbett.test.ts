/**
 * M4-34 Grasbett aufstellen (ADR-0031: "Bett und Grasbett setzen den Wiedereinstiegspunkt … aufgestellt wird es mit dem
 * Bau-Raster (M4-11), das die Schlafplätze meldet"; MASTERPROMPT §11.5, §11.6): the grass bed made by hand is set up on
 * the build grid, reports itself as a sleeping place, lets the player sleep from 19:00 through to 06:00, sets the
 * respawn point – after a death the player wakes at the grass bed. Taking the bed down takes the respawn point along.
 * The bed and the respawn point survive saving and loading.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { footprintCovers } from '../../../src/game/building/beds';
import { TILE_PX } from '../../../src/world/model/coords';
import { lagerWelt, px, type LagerWelt } from './lager-testwelt';
import { OFFSET, meadow } from './spieler-testwelt';

const TICK_HZ = BALANCE.time.tickHz;

function world(): LagerWelt {
  return lagerWelt(meadow(30, 20), { x: 9, y: 10 });
}

/** Runs until the player wakes (or `limit` ticks); returns the events of the whole sleep. */
function sleepThrough(w: LagerWelt, limit: number): Map<string, unknown[]> {
  const all = new Map<string, unknown[]>();
  for (let i = 0; i < limit && w.life.sleep.asleep; i++) {
    for (const [k, v] of w.run(1)) all.set(k, [...(all.get(k) ?? []), ...v]);
  }
  return all;
}

/** Crafts a grass bed by hand (§15.1: no station). */
function craftBed(w: LagerWelt): void {
  w.give('fasern', 12);
  w.give('laub', 10);
  w.give('zweig', 4);
  w.run(1);
  expect(w.rejection(w.act({ type: 'craft.start', recipe: 'rezept_grasbett', count: 1 }))).toBeNull();
  w.run(BALANCE.crafting.durationSeconds.gross * TICK_HZ + 10);
  expect(w.count('grasbett')).toBe(1);
}

describe('Grasbett: herstellen, aufstellen, schlafen, erwachen (M4-34)', () => {
  it('das Grasbett ist ein Bauteil (Schlafplatz „grasbett“, 1 × 2 Stroh) und wird aus den Taschen aufgestellt', () => {
    expect(CONTENT.collection('buildParts').get('grasbett')).toMatchObject({ art: 'moebel', material: 'stroh', groesse: { b: 1, t: 2 }, kategorie: 'bett', schlafplatz: 'grasbett' });
    const w = world();
    craftBed(w);
    const ev = w.act({ type: 'build.place', part: 'grasbett', tx: OFFSET + 10, ty: OFFSET + 9 });
    expect(w.rejection(ev)).toBeNull();
    expect(ev.get('partPlaced')?.[0]).toMatchObject({ part: 'grasbett', ebene: 'objekt' });
    expect(w.count('grasbett')).toBe(0);
    expect(w.life.sleep.placeAt(w.sim, 0, OFFSET + 10, OFFSET + 10)).toMatchObject({ kind: 'grasbett', x: (OFFSET + 10.5) * TILE_PX, y: (OFFSET + 10) * TILE_PX });
  });

  it('ab 19 Uhr schlafen bis 06:00, der Wiedereinstieg liegt am Grasbett; nach dem Tod erwacht man dort', () => {
    const w = world();
    craftBed(w);
    w.act({ type: 'build.place', part: 'grasbett', tx: OFFSET + 10, ty: OFFSET + 9 });
    const bed = { tx: OFFSET + 10, ty: OFFSET + 10 };
    w.jumpToHour(15);
    expect(w.rejection(w.act({ type: 'sleep.start', ...bed }))).toBe('tooEarly');
    w.jumpToHour(19);
    const start = w.act({ type: 'sleep.start', ...bed });
    expect(start.get('sleepStarted')).toEqual([expect.objectContaining({ place: 'grasbett', nap: false })]);
    expect(start.get('respawnPointSet')).toEqual([expect.objectContaining({ kind: 'grasbett' })]);
    const night = sleepThrough(w, 12 * w.sim.clock.ticksPerGameHour);
    expect(night.get('sleepEnded')).toEqual([expect.objectContaining({ reason: 'morgen' })]);
    expect(w.sim.clock.hour).toBe(6);
    // Far away, the light goes out; the default respawn is the grass bed.
    const away = px(25, 3);
    w.act({ type: 'player.teleport', x: away.x, y: away.y, layer: 0 });
    const died = w.act({ type: 'death.kill' });
    expect(died.get('playerDied')?.[0]).toMatchObject({ spots: ['bett', 'strand'] });
    const back = w.act({ type: 'death.respawn' });
    expect(back.get('playerRespawned')?.[0]).toMatchObject({ at: 'bett' });
    const p = w.pos();
    expect(Math.hypot(p.x - (OFFSET + 10.5) * TILE_PX, p.y - (OFFSET + 10) * TILE_PX)).toBeLessThan(3 * TILE_PX);
  });

  it('wird das Grasbett abgebaut, verschwindet der Wiedereinstiegspunkt mit ihm', () => {
    const w = world();
    craftBed(w);
    w.act({ type: 'build.place', part: 'grasbett', tx: OFFSET + 10, ty: OFFSET + 9 });
    w.jumpToHour(20);
    w.act({ type: 'sleep.start', tx: OFFSET + 10, ty: OFFSET + 9 });
    w.act({ type: 'sleep.wake' });
    expect(w.life.death.state.respawn).toMatchObject({ kind: 'grasbett' });
    // Another piece of furniture going does not touch it.
    expect(w.build('kiste_holz', 12, 9)).toBeNull();
    w.act({ type: 'build.remove', tx: OFFSET + 12, ty: OFFSET + 9 });
    expect(w.life.death.state.respawn).not.toBeNull();
    const ev = w.act({ type: 'build.remove', tx: OFFSET + 10, ty: OFFSET + 10 });
    expect(ev.get('partRemoved')?.[0]).toMatchObject({ part: 'grasbett' });
    expect(w.life.death.state.respawn).toBeNull();
    expect(w.act({ type: 'death.kill' }).get('playerDied')?.[0]).toMatchObject({ spots: ['strand'] });
    expect(footprintCovers({ w: 1, h: 2 }, 10, 9, 10.5 * TILE_PX, 10 * TILE_PX)).toBe(true);
    expect(footprintCovers({ w: 1, h: 2 }, 10, 9, 12.5 * TILE_PX, 10 * TILE_PX)).toBe(false);
  });

  it('Speichern und Laden: das aufgestellte Grasbett und der Wiedereinstieg bleiben (Roundtrip)', () => {
    const a = world();
    craftBed(a);
    a.act({ type: 'build.place', part: 'grasbett', tx: OFFSET + 10, ty: OFFSET + 9 });
    a.jumpToHour(20);
    a.act({ type: 'sleep.start', tx: OFFSET + 10, ty: OFFSET + 9 });
    a.act({ type: 'sleep.wake' });
    const b = world();
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.sim.hashState()).toBe(a.sim.hashState());
    expect(b.life.sleep.placeAt(b.sim, 0, OFFSET + 10, OFFSET + 10)).toMatchObject({ kind: 'grasbett' });
    expect(b.life.death.state.respawn).toMatchObject({ kind: 'grasbett', layer: 0 });
  });
});
