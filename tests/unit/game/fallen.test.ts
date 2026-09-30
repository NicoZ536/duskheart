/**
 * Fallen (M6-30, MASTERPROMPT §14 „Fallen (Schlinge, Kastenfalle)“; docs/SPIEL.md §11 „Beute, Jagen, Fallen“):
 * - aufstellen aus einem Taschenplatz in Reichweite auf freien Boden – nichts, was keine Falle ist, nicht zu weit, nicht auf
 *   Fels oder einer anderen Falle;
 * - ein fangbares Tier, das auf die Falle tritt, wird mit ihrer Chance gefangen (einmal je Betreten); zu große und nicht
 *   fangbare nicht;
 * - E nimmt die Falle zurück, der Fang bleibt als Kadaver liegen; volle Taschen verhindern es;
 * - in einem eingefrorenen Chunk fängt die Falle aus seinem Bestand (Aufholen).
 */
import { describe, expect, it } from 'vitest';
import { TRAPS } from '../../../src/content/creatures/fallen';
import { CREATURES } from '../../../src/content/creatures/kreaturen';
import { NULL_ENTITY, type Entity } from '../../../src/engine/ecs';
import { trapUses } from '../../../src/game/creatures/uses';
import { createUseOffer } from '../../../src/game/interaction/uses';
import { withSlot } from '../../../src/game/inventory/bags';
import { newStack } from '../../../src/game/items/stack';
import type { SimEventMap } from '../../../src/game/sim';
import type { ChunkData } from '../../../src/world/model/chunk';
import { TILE_PX } from '../../../src/world/model/coords';
import { eventsOf, kampfCatalog } from './kampf-testwelt';
import { OFFSET, kreaturWelt, meadow, tileOf, type KreaturWelt } from './kreatur-testwelt';

const HOTBAR = { bereich: 'schnellleiste', index: 0 } as const;

function place(w: KreaturWelt, item: string, dx: number, dy: number): SimEventMap['commandRejected'][] {
  w.hold(item);
  const { tx, ty } = tileOf(w.pos());
  return eventsOf(w.run(1, [{ type: 'trap.place', from: HOTBAR, tx: tx + dx, ty: ty + dy }]), 'commandRejected');
}

/** Sends creature `e` walking straight over map tile (x, y) to two tiles beyond it. */
function walkOver(w: KreaturWelt, e: Entity, x: number, y: number): void {
  const s = w.state(e);
  const c = w.centre(x, y);
  const from = w.where(e);
  const len = Math.hypot(c.x - from.x, c.y - from.y);
  s.state = 'umherstreifen';
  s.stateUntilTick = w.sim.tick + 600;
  s.goalX = c.x + ((c.x - from.x) / len) * 2 * TILE_PX;
  s.goalY = c.y + ((c.y - from.y) / len) * 2 * TILE_PX;
}

describe('Fallen aufstellen (M6-30)', () => {
  it('aus dem Taschenplatz auf freien Boden in Reichweite', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    expect(place(w, 'kastenfalle', 1, 0)).toEqual([]);
    expect(w.traps.traps).toHaveLength(1);
    expect(w.traps.traps[0]).toMatchObject({ item: 'kastenfalle', caught: null, tx: OFFSET + 21, ty: OFFSET + 15 });
    expect(w.inventory.state.schnellleiste[0]).toBeNull();
  });

  it('abgelehnt: keine Falle, zu weit, Fels, belegt, leerer Platz', () => {
    const rows = meadow(40, 30).map((row, y) => (y === 15 ? row.slice(0, 22) + '#' + row.slice(23) : row));
    const w = kreaturWelt(rows, { x: 20, y: 15 });
    expect(place(w, 'probe_schwert', 1, 0).map((r) => r.reason)).toEqual(['notATrap']);
    expect(place(w, 'schlinge', 5, 0).map((r) => r.reason)).toEqual(['tooFar']);
    expect(place(w, 'schlinge', 2, 0).map((r) => r.reason)).toEqual(['blocked']);
    expect(place(w, 'schlinge', 0, 1)).toEqual([]);
    expect(place(w, 'schlinge', 0, 1).map((r) => r.reason)).toEqual(['blocked']);
    w.inventory.bags.replace(withSlot(w.inventory.state, HOTBAR, null));
    expect(eventsOf<SimEventMap['commandRejected']>(w.run(1, [{ type: 'trap.place', from: HOTBAR, tx: 0, ty: 0 }]), 'commandRejected')[0]?.reason).toBe('noItem');
  });
});

describe('Fangen (M6-30)', () => {
  it('ein Hase, der über die Kastenfalle läuft, wird gefangen; ein Reh nicht', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 4, y: 4 });
    // The trap at map (20, 15), set from beside it.
    w.run(1, [{ type: 'player.teleport', x: w.centre(19, 15).x, y: w.centre(19, 15).y, layer: 0 }]);
    expect(place(w, 'kastenfalle', 1, 0)).toEqual([]);
    w.run(1, [{ type: 'player.teleport', x: w.centre(4, 4).x, y: w.centre(4, 4).y, layer: 0 }]);
    const deer = w.creature('reh', 20, 10);
    walkOver(w, deer, 20, 15);
    w.run(120);
    expect(w.creatures.store.has(deer)).toBe(true);
    expect(w.traps.traps[0]?.caught).toBeNull();
    const hare = w.creature('hase', 26, 15);
    walkOver(w, hare, 20, 15);
    let sprung: SimEventMap['trapSprung'][] = [];
    for (let i = 0; i < 240 && sprung.length === 0; i++) sprung = eventsOf(w.run(1), 'trapSprung');
    expect(sprung[0]).toMatchObject({ creature: 'hase', item: 'kastenfalle' });
    expect(w.creatures.store.has(hare)).toBe(false);
    expect(w.traps.traps[0]?.caught).toBe('hase');
    expect(CREATURES.find((c) => c.id === 'reh')?.fangbar).toBe(false);
  });

  it('E nimmt die Falle zurück, der Fang bleibt als Kadaver; volle Taschen verhindern es', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    expect(place(w, 'schlinge', 1, 0)).toEqual([]);
    const trap = w.traps.traps[0];
    w.traps.spring(w.sim, trap?.id ?? 0, 'hase', w.sim.tick);
    // Full bags: every slot holds a sword.
    const catalog = kampfCatalog();
    const saved = w.inventory.state;
    let full = saved;
    for (const area of ['inventar', 'schnellleiste'] as const) for (let i = 0; i < full[area].length; i++) full = withSlot(full, { bereich: area, index: i }, newStack(catalog.get('probe_schwert'), 1));
    w.inventory.bags.replace(full);
    const offer = createUseOffer();
    expect(trapUses(w.traps).offer(w.sim, 0, trap?.tx ?? 0, trap?.ty ?? 0, offer)).toBe(true);
    expect(offer).toMatchObject({ action: 'nehmen', subject: 'schlinge', block: 'bagsFull' });
    expect(eventsOf<SimEventMap['commandRejected']>(w.run(1, [{ type: 'trap.take', trap: trap?.id ?? 0 }]), 'commandRejected')[0]?.reason).toBe('bagsFull');
    w.inventory.bags.replace(saved);
    trapUses(w.traps).use(w.sim, 0, trap?.tx ?? 0, trap?.ty ?? 0, w.sim.eventTick);
    expect(w.traps.traps).toEqual([]);
    expect(w.inventory.count('schlinge')).toBe(1);
    const carcass = w.creatures.carcassAt(0, trap?.tx ?? 0, trap?.ty ?? 0);
    expect(carcass).not.toBe(NULL_ENTITY);
    expect(w.creatures.carcasses.get(carcass)?.creature).toBe('hase');
    expect(eventsOf<SimEventMap['commandRejected']>(w.run(1, [{ type: 'trap.take', trap: 99 }]), 'commandRejected')[0]?.reason).toBe('noTrap');
  });

  it('eingefroren fängt die Falle aus dem Bestand ihres Chunks', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    const hare = w.creature('hase', 24, 16);
    expect(place(w, 'kastenfalle', 1, 0)).toEqual([]);
    const s = w.state(hare);
    const chunk = w.chunks.get(0, s.homeCx, s.homeCy) as ChunkData;
    const trapChunk = w.traps.traps[0];
    expect(trapChunk !== undefined && trapChunk.tx >> 5 === s.homeCx && trapChunk.ty >> 5 === s.homeCy).toBe(true);
    const tick = w.sim.tick;
    w.creatures.zoneListener.onDeactivate(chunk, tick);
    expect(w.creatures.population.find(0, s.homeCx, s.homeCy)?.members.map((m) => m.creature)).toEqual(['hase']);
    expect(w.traps.traps[0]?.catchTick).toBeGreaterThan(tick);
    const day = Math.round(24 * w.sim.clock.ticksPerGameHour);
    w.creatures.catchUp(chunk, tick, tick + 3 * day);
    expect(w.traps.traps[0]?.caught).toBe('hase');
    expect(w.creatures.population.find(0, s.homeCx, s.homeCy)?.members.some((m) => m.serial === s.serial)).toBe(false);
    expect(TRAPS.map((t) => t.id).sort()).toEqual(['kastenfalle', 'schlinge']);
  });
});
