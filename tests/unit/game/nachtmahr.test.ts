/**
 * Der Nachtmahr und die Trugbilder (M6-29, MASTERPROMPT §12.3 „ab 60 Trugbilder (verschwinden bei Treffer oder Licht) …
 * ab 80 können Trugbilder echten Schaden anrichten · bei 100 erscheint ein Nachtmahr, der dich jagt, bis du gleißendes Licht
 * erreichst oder ihn besiegst“; docs/SPIEL.md §11):
 * - Furcht 100 ruft ihn über `FearSystem.onNightmare` in die dunkelste von acht Richtungen, 14 Kacheln vom Spieler; er
 *   kennt seine Beute und jagt sie;
 * - gleißendes Licht am Spieler beendet die Jagd: er verblasst ohne Beute; besiegt endet sie mit `besiegt` und
 *   Lumen-Scherben, und die Furcht fällt um `defeatFearRelief` (ADR-0111) – ohne dass der Test sie senkt, kommt kein
 *   neuer Nachtmahr (M6-29c); stirbt der Spieler, verblasst er;
 * - Trugbilder ab Furcht 80 verletzen, darunter nicht; ein Schlag des Spielers löst ein Trugbild in seiner Reichweite auf.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { NULL_ENTITY } from '../../../src/engine/ecs';
import type { SimEventMap } from '../../../src/game/sim';
import type { Hallucination } from '../../../src/game/fear/state';
import { TILE_PX } from '../../../src/world/model/coords';
import { eventsOf } from './kampf-testwelt';
import { kreaturWelt, meadow, type KreaturWelt } from './kreatur-testwelt';

const HZ = BALANCE.time.tickHz;
const N = BALANCE.creatures.nightmare;

/** A dark night on an open field; fear 100 summons the Nachtmahr. Returns the world and its entity. */
function summoned(setup: (w: KreaturWelt) => void = () => undefined): { w: KreaturWelt; mare: number; events: Map<string, unknown[]> } {
  const w = kreaturWelt(meadow(60, 50), { x: 30, y: 25 });
  w.cenv.phase = 'nacht';
  w.light.ambient = 0.05;
  setup(w);
  const events = w.run(2, [{ type: 'fear.set', value: BALANCE.fear.max }]);
  const mare = w.creatures.nightmareEntity;
  return { w, mare, events };
}

describe('Der Nachtmahr (M6-29)', () => {
  it('Furcht 100 ruft ihn in die dunkelste Richtung, 14 Kacheln weit; er jagt den Spieler', () => {
    const { w, mare, events } = summoned((x) => {
      const p = x.pos();
      // Ein Licht im Osten, wo er zuerst gesucht würde.
      x.light.discs.push({ x: p.x + N.spawnDistanceTiles * TILE_PX, y: p.y, radius: 6, level: 0.3 });
    });
    expect(eventsOf(events, 'nightmareSummoned')).toHaveLength(1);
    expect(mare).not.toBe(NULL_ENTITY);
    expect(w.state(mare).creature).toBe(N.creature);
    const p = w.pos();
    const at = w.where(mare);
    const d = Math.hypot(at.x - p.x, at.y - p.y) / TILE_PX;
    expect(d).toBeGreaterThan(N.spawnDistanceTiles - 7);
    expect(d).toBeLessThanOrEqual(N.spawnDistanceTiles + 1);
    expect(w.light.levelAt(null, 0, at.x, at.y)).toBeLessThan(0.1);
    expect(w.state(mare).target).toBe(w.sim.player);
    w.cheats.god = true;
    w.run(HZ);
    expect(['jagen', 'angreifen']).toContain(w.state(mare).state);
  });

  it('nie im Radius eines brennenden Herdes (§16.5): er erscheint außerhalb; ist überall Herdzone, kommt er nicht – bis sie erlischt', () => {
    // A hearth zone of 12 tiles around a point 8 tiles east of the player: the eastern places lie in it.
    const zone = { x: 0, y: 0, r: 12 * TILE_PX, burning: true };
    const blocked: { x: number; y: number }[] = [];
    const { w, mare } = summoned((x) => {
      const p = x.pos();
      zone.x = p.x + 8 * TILE_PX;
      zone.y = p.y;
      // The darkest place lies east, inside the zone: a light in the west.
      x.light.discs.push({ x: p.x - N.spawnDistanceTiles * TILE_PX, y: p.y, radius: 4, level: 0.04 });
      x.creatures.useHearth({
        spawnBlocked: (_s, _l, bx, by) => {
          const inside = zone.burning && Math.hypot(bx - zone.x, by - zone.y) <= zone.r;
          if (inside) blocked.push({ x: bx, y: by });
          return inside;
        },
      });
    });
    expect(blocked.length).toBeGreaterThan(0);
    expect(mare).not.toBe(NULL_ENTITY);
    const at = w.where(mare);
    expect(Math.hypot(at.x - zone.x, at.y - zone.y)).toBeGreaterThan(zone.r);
    // Everywhere a hearth's zone: no Nachtmahr – a second later it tries again, and once the fire is out it comes.
    const all = kreaturWelt(meadow(60, 50), { x: 30, y: 25 });
    all.cenv.phase = 'nacht';
    all.light.ambient = 0.05;
    let burning = true;
    all.creatures.useHearth({ spawnBlocked: () => burning });
    const ev = all.run(2, [{ type: 'fear.set', value: BALANCE.fear.max }]);
    // The fear calls it (`nightmareSummoned`), but it finds no place outside the hearth's zone.
    expect(eventsOf(ev, 'nightmareSummoned')).toHaveLength(1);
    expect(eventsOf<SimEventMap['creatureSpawned']>(ev, 'creatureSpawned').filter((c) => c.creature === N.creature)).toEqual([]);
    expect(all.creatures.nightmareEntity).toBe(NULL_ENTITY);
    all.run(2 * HZ);
    expect(all.creatures.nightmareEntity).toBe(NULL_ENTITY);
    burning = false;
    all.run(2 * HZ);
    expect(all.creatures.nightmareEntity).not.toBe(NULL_ENTITY);
  });

  it(`nie auf hellem Licht (§12.4 „Licht < ${BALANCE.spawn.shadowBrood.maxLight}“): ist jede Richtung hell, kommt er nicht – bis es dunkel wird`, () => {
    const w = kreaturWelt(meadow(60, 50), { x: 30, y: 25 });
    w.cenv.phase = 'nacht';
    w.light.ambient = 0.05;
    const p = w.pos();
    // A ring of light around the player at the Nachtmahr's distances (8 … 14 tiles): every place it would take is bright.
    const ring = { x: p.x, y: p.y, radius: N.spawnDistanceTiles + 1, level: 0.3 };
    const hole = { x: p.x, y: p.y, radius: 6, level: -0.3 };
    w.light.discs.push(ring, hole);
    expect(w.light.levelAt(null, 0, p.x, p.y)).toBeLessThan(0.1);
    w.run(2, [{ type: 'fear.set', value: BALANCE.fear.max }]);
    expect(w.creatures.nightmareEntity).toBe(NULL_ENTITY);
    w.run(2 * HZ);
    expect(w.creatures.nightmareEntity).toBe(NULL_ENTITY);
    // The ring goes out: a second later it comes, on a dark tile.
    w.light.discs.length = 0;
    w.run(2 * HZ);
    const mare = w.creatures.nightmareEntity;
    expect(mare).not.toBe(NULL_ENTITY);
    const at = w.where(mare);
    expect(w.light.levelAt(null, 0, at.x, at.y)).toBeLessThan(BALANCE.spawn.shadowBrood.maxLight);
  });

  it('gleißendes Licht am Spieler beendet die Jagd: er verblasst ohne Beute', () => {
    const { w, mare } = summoned();
    const p = w.pos();
    w.light.discs.push({ x: p.x, y: p.y, radius: 3, level: 0.95 });
    const ev = w.run(2);
    expect(eventsOf<SimEventMap['nightmareEnded']>(ev, 'nightmareEnded')[0]?.reason).toBe('licht');
    expect(eventsOf<SimEventMap['creatureFaded']>(ev, 'creatureFaded')[0]).toMatchObject({ entity: mare, reason: 'licht' });
    w.run(Math.round(BALANCE.creatures.shadowBrood.fadeSeconds * HZ) + 2);
    expect(w.creatures.store.has(mare)).toBe(false);
    expect(w.spilled).toEqual([]);
    expect(w.life.fear.pursued).toBe(false);
  });

  it('besiegt endet die Jagd mit „besiegt“, und er lässt Lumen-Scherben; die Furcht fällt, er kommt nicht gleich wieder', () => {
    const { w, mare } = summoned();
    // The kill alone: its defeat lowers the fear (ADR-0111), nothing else touches it.
    const ev = w.run(1, [{ type: 'creature.kill', radius: 30 }]);
    expect(eventsOf<SimEventMap['creatureDied']>(ev, 'creatureDied').map((d) => d.entity)).toContain(mare);
    expect(eventsOf<SimEventMap['nightmareEnded']>(ev, 'nightmareEnded')[0]?.reason).toBe('besiegt');
    expect(w.life.fear.pursued).toBe(false);
    expect(w.creatures.nightmareEntity).toBe(NULL_ENTITY);
    expect(w.spilled.map((s) => s.stack.item)).toEqual(['lumen_scherbe']);
    expect(w.spilled[0]?.stack.count).toBeGreaterThanOrEqual(4);
    const after = BALANCE.fear.max - N.defeatFearRelief;
    expect(w.life.fear.state.value).toBeCloseTo(after, 0);
    // Below 100 the fear system calls no new one: ten seconds later the player is still left alone.
    const later = w.run(10 * HZ);
    expect(eventsOf(later, 'nightmareSummoned')).toEqual([]);
    expect(w.creatures.nightmareEntity).toBe(NULL_ENTITY);
    expect(w.life.fear.state.value).toBeLessThan(BALANCE.fear.max);
  });

  it('stirbt der Spieler, verblasst er', () => {
    const { w, mare } = summoned();
    const ev = w.run(2, [{ type: 'death.kill' }]);
    expect(eventsOf<SimEventMap['creatureFaded']>(ev, 'creatureFaded')[0]).toMatchObject({ entity: mare, reason: 'tod' });
  });
});

describe('Trugbilder (M6-29)', () => {
  /** Runs `seconds` in the dark at fear `value`; returns what hallucinations did to the player. */
  function haunted(value: number, seconds: number): { afflicted: SimEventMap['playerAfflicted'][]; appeared: number } {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    w.light.ambient = 0.05;
    const afflicted: SimEventMap['playerAfflicted'][] = [];
    let appeared = 0;
    for (let s = 0; s < seconds; s++) {
      const ev = w.run(HZ, [{ type: 'fear.set', value }]);
      afflicted.push(...eventsOf<SimEventMap['playerAfflicted']>(ev, 'playerAfflicted').filter((a) => a.source === 'trugbild'));
      appeared += eventsOf(ev, 'hallucinationAppeared').length;
    }
    return { afflicted, appeared };
  }

  it('ab Furcht 80 verletzen sie, darunter nicht', () => {
    const harmful = haunted(85, 40);
    expect(harmful.appeared).toBeGreaterThan(0);
    expect(harmful.afflicted.length).toBeGreaterThan(0);
    expect(harmful.afflicted[0]?.amount).toBe(BALANCE.fear.hallucinations.damage);
    const harmless = haunted(70, 40);
    expect(harmless.appeared).toBeGreaterThan(0);
    expect(harmless.afflicted).toEqual([]);
  });

  it('ein Schlag des Spielers löst ein Trugbild in seiner Reichweite auf', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    w.light.ambient = 0.05;
    w.hold('probe_schwert');
    w.run(1, [{ type: 'fear.set', value: 65 }]);
    // A hallucination a tile and a third north of the player (the touch reaches 0,75 tiles, the sword 20 px).
    const p = w.pos();
    const list = w.life.fear.state.hallucinations as Hallucination[];
    list.length = 0;
    list.push({ id: 900, x: p.x, y: p.y - 1.3 * TILE_PX, layer: 0, harmful: false, ageTicks: 0 });
    w.aimBy(0, -40);
    const vanished: SimEventMap['hallucinationVanished'][] = [];
    vanished.push(...eventsOf<SimEventMap['hallucinationVanished']>(w.run(1, [{ type: 'combat.attack', on: true }]), 'hallucinationVanished'));
    for (let i = 0; i < 30 && !vanished.some((v) => v.id === 900); i++) vanished.push(...eventsOf<SimEventMap['hallucinationVanished']>(w.run(1, i === 0 ? [{ type: 'combat.attack', on: false }] : undefined), 'hallucinationVanished'));
    expect(vanished.find((v) => v.id === 900)?.reason).toBe('treffer');
  });
});
