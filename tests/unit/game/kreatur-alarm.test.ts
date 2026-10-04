/**
 * Alarm über das Gehör und der Ruf als Geräusch (M6-Gate; MASTERPROMPT §19.4 „Gehör (Geräuschereignisse mit Radius …)“,
 * „Gruppentaktik: Rudel …“; docs/SPIEL.md §11 „Wahrnehmung (M6-14)“; `BALANCE.ai.noise.call`, `packAlertTiles`):
 * - Wer den Spieler hört, hat ihn bemerkt wie mit den Augen: beim ersten Mal ruft er (`creatureCall` 'alarm') und sein
 *   Rudel innerhalb von `packAlertTiles` kennt das Ziel – vorher rechnete `think` „hatte schon ein Ziel“ aus dem Stand
 *   nach dem Hören, und der Alarm kam nur über die Augen (nachts × 0,25) oder einen Treffer.
 * - Der Ruf ist ein Geräusch von `noise.call` Kacheln (× Gehör × Regen): Kreaturen seiner Art, die ihn hören, kennen das
 *   Ziel des Rufers – unabhängig von ihrer Reihenfolge in der Komponente; andere Arten folgen ihm nicht.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { NULL_ENTITY, type Entity } from '../../../src/engine/ecs';
import { hearingRadiusTiles } from '../../../src/game/creatures/formulas';
import type { SimEventMap } from '../../../src/game/sim';
import type { GameCommand } from '../../../src/game/commands';
import { TILE_PX } from '../../../src/world/model/coords';
import { eventsOf } from './kampf-testwelt';
import { kreaturWelt, meadow, probeCatalog, type KreaturWelt } from './kreatur-testwelt';

type Call = SimEventMap['creatureCall'];

const N = BALANCE.ai.noise;
const WOLF_HEARING = probeCatalog().get('probe_wolf').profile.gehoer;
const SPRINT: GameCommand[] = [
  { type: 'player.sprint', on: true },
  { type: 'player.move', dx: -1, dy: 0 },
];

/** A dark meadow (ambient 0,05: sight × 0,25), the player at map tile (30, 54), `rain` [0–1]. */
function nacht(rain = 0): KreaturWelt {
  const w = kreaturWelt(meadow(60, 64), { x: 30, y: 54 });
  w.cheats.god = true;
  w.light.ambient = 0.05;
  w.cenv.rain = rain;
  return w;
}

/**
 * Moves creature `e` (and its home) to map tile (x, y) and lets it rest there (an idle state that does not run out): the
 * distances of a test stay what they are until something calls it.
 */
function place(w: KreaturWelt, e: Entity, x: number, y: number): void {
  const row = w.motion.position.indexOf(e);
  const c = w.centre(x, y);
  w.motion.position.columns.x[row] = c.x;
  w.motion.position.columns.y[row] = c.y;
  const s = w.state(e);
  s.homeX = c.x;
  s.homeY = c.y;
  s.state = 'ruhen';
  s.stateUntilTick = Number.MAX_SAFE_INTEGER;
  s.goalX = Number.NaN;
  s.goalY = Number.NaN;
}

/** A resting probe creature `id` at map tile (x, y) (alone: no pack). */
function alone(w: KreaturWelt, id: string, x: number, y: number): Entity {
  const e = w.creature(id, x, y);
  place(w, e, x, y);
  return e;
}

/** A pack of two probe wolves: A at map tile (30, ay), B at (30, by). */
function rudel(w: KreaturWelt, ay: number, by: number): { a: Entity; b: Entity } {
  const c = w.centre(30, ay);
  w.run(1, [{ type: 'creature.spawn', creature: 'probe_wolf', count: 2, x: c.x, y: c.y, layer: 0 }]);
  const a = w.creatures.store.entityAt(w.creatures.store.size - 2) as Entity;
  const b = w.creatures.store.entityAt(w.creatures.store.size - 1) as Entity;
  expect(w.state(a).pack).not.toBe(0);
  expect(w.state(a).pack).toBe(w.state(b).pack);
  place(w, a, 30, ay);
  place(w, b, 30, by);
  return { a, b };
}

/** Calls `alarm` of creature `e` among the events. */
function alarms(ev: Map<string, unknown[]>, e: Entity): Call[] {
  return eventsOf<Call>(ev, 'creatureCall').filter((c) => c.entity === e && c.reason === 'alarm');
}

describe('Alarm über das Gehör', () => {
  it('der Wolf hört den sprintenden Spieler im Dunkeln: er ruft einmal Alarm, sein Rudel jenseits des Gehörs kennt das Ziel', () => {
    const w = nacht();
    const { a, b } = rudel(w, 48, 36);
    w.run(30);
    // Nothing seen, nothing heard yet.
    expect(w.state(a).target).toBe(NULL_ENTITY);
    expect(w.state(b).target).toBe(NULL_ENTITY);
    const ev = w.run(40, SPRINT);
    expect(w.state(a).target).toBe(w.sim.player);
    expect(alarms(ev, a)).toHaveLength(1);
    // B (18 tiles from the player) did not hear the steps itself; it knows from its pack.
    expect(alarms(ev, b)).toHaveLength(0);
    expect(w.state(b).target).toBe(w.sim.player);
  });

  it('im Sturm trägt der Ruf nicht so weit wie das Rudel: der Gefährte erfährt es über das Rudel, ein Fremder seiner Art nicht', () => {
    // Rain halves every noise: the call reaches 12 × 1,5 × 0,5 = 9 tiles, the pack 16.
    const w = nacht(1);
    const callTiles = hearingRadiusTiles(N.call, WOLF_HEARING, 1);
    expect(callTiles).toBeCloseTo(9, 6);
    const { a, b } = rudel(w, 51, 38);
    const stranger = alone(w, 'probe_wolf', 31, 38);
    expect(w.state(stranger).pack).toBe(0);
    w.run(30);
    const ev = w.run(40, SPRINT);
    expect(alarms(ev, a)).toHaveLength(1);
    expect(w.state(b).target).toBe(w.sim.player);
    expect(w.state(stranger).target).toBe(NULL_ENTITY);
  });
});

describe('Der Ruf als Geräusch (noise.call)', () => {
  it('ein einzelner Wolf ohne Rudel hört den Ruf eines anderen und kennt dessen Ziel', () => {
    const w = nacht();
    const a = alone(w, 'probe_wolf', 30, 48);
    // 11 tiles from A: within the call (12 × 1,5 = 18), beyond the player's sprint (5 × 1,5 × 1,5 ≈ 11 from the player).
    const b = alone(w, 'probe_wolf', 30, 37);
    expect(w.state(a).pack).toBe(0);
    expect(w.state(b).pack).toBe(0);
    w.run(30);
    const ev = w.run(40, SPRINT);
    expect(alarms(ev, a)).toHaveLength(1);
    expect(w.state(b).target).toBe(w.sim.player);
    // It learned from the call, not from the steps: the player stayed out of its own hearing.
    const p = w.pos();
    const q = w.where(b);
    expect(Math.hypot(p.x - q.x, p.y - q.y) / TILE_PX).toBeGreaterThan(hearingRadiusTiles(N.step * BALANCE.player.movement.noise.sprint, WOLF_HEARING, 0));
  });

  it('eine andere Art folgt dem Ruf nicht, und jenseits seines Radius hört ihn auch die eigene Art nicht', () => {
    const w = nacht();
    const a = alone(w, 'probe_wolf', 30, 48);
    const other = alone(w, 'probe_brecher', 29, 38);
    // 20 tiles from A: beyond the call's 18.
    const far = alone(w, 'probe_wolf', 30, 28);
    w.run(30);
    const ev = w.run(40, SPRINT);
    expect(alarms(ev, a)).toHaveLength(1);
    expect(w.state(other).target).toBe(NULL_ENTITY);
    expect(w.state(far).target).toBe(NULL_ENTITY);
  });

  it('wer den Ruf hört, hängt nicht von der Reihenfolge der Komponente ab', () => {
    // The listener spawned first (it ticks before the caller) learns the target in the same tick as the one after it.
    const w = nacht();
    const before = alone(w, 'probe_wolf', 30, 37);
    const a = alone(w, 'probe_wolf', 30, 48);
    const after = alone(w, 'probe_wolf', 31, 37);
    w.run(30);
    let called = -1;
    for (let i = 0; i < 40 && called < 0; i++) {
      const ev = w.run(1, i === 0 ? SPRINT : []);
      const c = alarms(ev, a);
      if (c.length > 0) called = (c[0] as Call).tick;
    }
    expect(called).toBeGreaterThan(0);
    expect(w.state(before).target).toBe(w.sim.player);
    expect(w.state(after).target).toBe(w.sim.player);
    expect(w.state(before).targetTick).toBe(called);
    expect(w.state(after).targetTick).toBe(called);
  });
});
