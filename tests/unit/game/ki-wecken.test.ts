/**
 * Geweckte Tagschläfer wehren sich (M6-13d; MASTERPROMPT §19.4 „Ruhen, …, Schlafen (Tagesrhythmus)“; docs/SPIEL.md §11
 * „KI“): außerhalb seiner Stunden schläft ein Wolf und sieht nichts – ein schleichender Spieler jenseits seines Gehörs geht
 * unbemerkt vorbei. Ein Treffer weckt ihn ganz (vorher jagte und umkreiste er blind und biss nie: `sees` verlangt `awake`,
 * `attackReady` verlangt `sees`): er sieht, also beißt er – binnen 5 s. Dasselbe gilt für den gehörten Spieler und den
 * Alarm des Rudels. Wach bleibt er, solange er seine Beute jagt oder ihrer frischen Spur folgt (Gedächtnis plus
 * Untersuchen); danach schläft er wieder. Kein eigener Zustand: Ziel und Ziel-Tick werden gespeichert, Speichern → Laden
 * mitten im Erwachen geht Tick für Tick gleich weiter.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import type { Entity } from '../../../src/engine/ecs';
import { NULL_ENTITY } from '../../../src/engine/ecs';
import { awakeIn } from '../../../src/game/creatures/formulas';
import type { SimEventMap } from '../../../src/game/sim';
import { TILE_PX } from '../../../src/world/model/coords';
import { eventsOf } from './kampf-testwelt';
import { kreaturWelt, meadow, probeCatalog, type KreaturWelt } from './kreatur-testwelt';

const HZ = BALANCE.time.tickHz;
const WOLF = probeCatalog().get('wolf');
type Hit = SimEventMap['hitLanded'];

/** Noon on a bright meadow (80 × 30 tiles), the player at map tile (x, y) (default: next to it); a wolf asleep at (20, 10). */
function mittag(x = 20, y = 11): { w: KreaturWelt; wolf: Entity } {
  const w = kreaturWelt(meadow(80, 30), { x, y });
  w.cenv.phase = 'tag';
  const wolf = w.creature('wolf', 20, 10);
  // Its first decisions: out of its hours with nothing around it sleeps.
  w.run(HZ);
  return { w, wolf };
}

/** One swing of the sword at creature `e` (press and release), run until the blow landed (at most 1 s). */
function swing(w: KreaturWelt, e: Entity): void {
  w.hold('probe_schwert');
  const at = w.where(e);
  const p = w.pos();
  w.aimBy(at.x - p.x, at.y - p.y);
  w.run(1, [{ type: 'combat.attack', on: true }]);
  w.run(1, [{ type: 'combat.attack', on: false }]);
  for (let i = 0; i < HZ && w.state(e).hurtTick < 0; i++) w.run(1);
}

/** Runs up to `ticks` ticks and returns the tick of the first blow of creature `e` (`creatureAttack`; −1: none). */
function firstBite(w: KreaturWelt, e: Entity, ticks: number): number {
  for (let i = 0; i < ticks; i++) {
    const blow = eventsOf<SimEventMap['creatureAttack']>(w.run(1), 'creatureAttack').find((a) => a.entity === e);
    if (blow !== undefined) return blow.tick;
  }
  return -1;
}

describe('Geweckte Tagschläfer (M6-13d)', () => {
  it('der Wolf ist mittags außerhalb seiner Stunden und schläft', () => {
    expect(WOLF.def.aktiv).not.toContain('tag');
    expect(awakeIn(WOLF.def.aktiv, 'tag')).toBe(false);
    const { w, wolf } = mittag();
    expect(w.state(wolf).state).toBe('schlafen');
    expect(w.state(wolf).target).toBe(NULL_ENTITY);
  });

  it('Wolf mittags getroffen greift binnen 5 s an', () => {
    const { w, wolf } = mittag();
    const health = w.state(wolf).health;
    swing(w, wolf);
    const hitTick = w.state(wolf).hurtTick;
    expect(hitTick).toBeGreaterThan(0);
    expect(w.state(wolf).health).toBeLessThan(health);
    const lives = w.vit().health;
    let bite = -1;
    let landed = 0;
    for (let i = 0; i < 5 * HZ && bite < 0; i++) {
      const ev = w.run(1);
      bite = eventsOf<SimEventMap['creatureAttack']>(ev, 'creatureAttack').find((a) => a.entity === wolf)?.tick ?? -1;
      landed += eventsOf<Hit>(ev, 'hitLanded').filter((h) => h.attacker === wolf && h.target === w.sim.player).length;
    }
    expect(bite).toBeGreaterThan(hitTick);
    expect(bite - hitTick).toBeLessThanOrEqual(5 * HZ);
    // The bite lands: the player bleeds.
    expect(landed).toBe(1);
    expect(w.vit().health).toBeLessThan(lives);
    expect(w.state(wolf).state).not.toBe('schlafen');
  });

  it('ein ungetroffener schlafender Wolf lässt mittags einen schleichenden Spieler vorbei', () => {
    // The player sneaks from (14, 13) to (26, 13): three tiles in front of the wolf (it faces south), in its cone and
    // well within its sight – awake it would see him. Sneaking (×0,3 of a step's 5 tiles) carries 2,4 tiles to its ears.
    const { w, wolf } = mittag(14, 13);
    expect(w.state(wolf).facing).toBeCloseTo(Math.PI / 2, 6);
    const reach = BALANCE.ai.noise.step * 0.3 * 1.6;
    expect(reach * TILE_PX).toBeLessThan(w.centre(20, 13).y - w.centre(20, 10).y);
    const goal = w.centre(26, 13).x;
    const states = new Set<string>();
    let telegraphs = 0;
    w.run(1, [{ type: 'player.sneak', on: true }]);
    for (let i = 0; i < 8 * HZ && w.pos().x < goal; i++) {
      const ev = w.run(1, i === 0 ? [{ type: 'player.move', dx: 1, dy: 0 }] : undefined);
      telegraphs += eventsOf<SimEventMap['creatureTelegraph']>(ev, 'creatureTelegraph').filter((t) => t.entity === wolf).length;
      states.add(w.state(wolf).state);
    }
    expect(w.pos().x).toBeGreaterThanOrEqual(goal);
    w.run(1, [{ type: 'player.move', dx: 0, dy: 0 }]);
    w.run(2 * HZ);
    states.add(w.state(wolf).state);
    expect([...states]).toEqual(['schlafen']);
    expect(w.state(wolf).target).toBe(NULL_ENTITY);
    expect(telegraphs).toBe(0);
  });

  it('wer ihn im Schlaf hört, weckt ihn auch: ein gehender Spieler wird gebissen', () => {
    // Walking (5 tiles × hearing 1,6 = 8 tiles) past at three tiles: it hears him, wakes and bites – no blind chase.
    const { w, wolf } = mittag(14, 13);
    w.run(1, [{ type: 'player.move', dx: 1, dy: 0 }]);
    w.run(HZ);
    w.run(1, [{ type: 'player.move', dx: 0, dy: 0 }]);
    expect(w.state(wolf).target).toBe(w.sim.player);
    expect(firstBite(w, wolf, 5 * HZ)).toBeGreaterThan(0);
  });

  it('das Rudel erwacht mit: ein Treffer auf einen Wolf weckt die anderen, und sie beißen', () => {
    const w = kreaturWelt(meadow(80, 30), { x: 20, y: 11 });
    w.cheats.god = true;
    w.cenv.phase = 'tag';
    const before = w.creatures.store.size;
    w.run(1, [{ type: 'creature.spawn', creature: 'wolf', count: 3, x: w.centre(20, 9).x, y: w.centre(20, 9).y, layer: 0 }]);
    const pack = Array.from({ length: w.creatures.store.size - before }, (_, i) => w.creatures.store.entityAt(before + i));
    expect(pack).toHaveLength(3);
    w.run(HZ);
    expect(pack.map((e) => w.state(e).state)).toEqual(['schlafen', 'schlafen', 'schlafen']);
    const nearest = [...pack].sort((a, b) => Math.hypot(w.where(a).x - w.pos().x, w.where(a).y - w.pos().y) - Math.hypot(w.where(b).x - w.pos().x, w.where(b).y - w.pos().y))[0] as Entity;
    // The player steps up to it (a teleport makes no noise): a tile south of the nearest wolf.
    const at = w.where(nearest);
    w.run(1, [{ type: 'player.teleport', x: at.x, y: at.y + TILE_PX, layer: 0 }]);
    expect(pack.map((e) => w.state(e).state)).toEqual(['schlafen', 'schlafen', 'schlafen']);
    swing(w, nearest);
    expect(w.state(nearest).hurtTick).toBeGreaterThan(0);
    const biters = new Set<Entity>();
    for (let i = 0; i < 8 * HZ; i++) for (const a of eventsOf<SimEventMap['creatureAttack']>(w.run(1), 'creatureAttack')) if (pack.includes(a.entity)) biters.add(a.entity);
    expect(pack.every((e) => w.state(e).state !== 'schlafen')).toBe(true);
    expect(biters.size).toBeGreaterThanOrEqual(2);
  });

  /** A wolf woken by a hit that bit once; then the player is gone (far beyond its sight, hearing and leash). */
  function verlassen(): { w: KreaturWelt; wolf: Entity; lastKnown: number } {
    const { w, wolf } = mittag();
    swing(w, wolf);
    expect(firstBite(w, wolf, 5 * HZ)).toBeGreaterThan(0);
    w.run(1, [{ type: 'player.teleport', x: w.centre(75, 25).x, y: w.centre(75, 25).y, layer: 0 }]);
    return { w, wolf, lastKnown: w.state(wolf).targetTick };
  }

  it('ist die Beute fort, schläft er nach Gedächtnis und Untersuchen wieder ein', () => {
    const { w, wolf, lastKnown } = verlassen();
    const awakeFor = WOLF.memoryTicks + WOLF.investigateTicks;
    // Following the trail while it is fresh …
    w.run(lastKnown + awakeFor - HZ - w.sim.tick);
    expect(w.state(wolf).state).not.toBe('schlafen');
    // … asleep once it went cold (its next decision after that).
    w.run(2 * HZ);
    expect(w.state(wolf).targetTick).toBe(lastKnown);
    expect(w.state(wolf).state).toBe('schlafen');
  });

  it('solange er der frischen Spur folgt, ist er wach: zeigt sich der Spieler wieder, sieht er ihn', () => {
    // Late in its investigation (beyond its memory, within memory + investigation) the player stands right beside it again,
    // still (no step to hear): awake it sees him at once (within 1,5 tiles whatever it faces) and takes him up again.
    const { w, wolf, lastKnown } = verlassen();
    w.run(lastKnown + WOLF.memoryTicks + Math.floor(WOLF.investigateTicks / 2) - w.sim.tick);
    expect(w.state(wolf).state).not.toBe('schlafen');
    const at = w.where(wolf);
    w.run(1, [{ type: 'player.teleport', x: at.x, y: at.y + TILE_PX, layer: 0 }]);
    const back = w.sim.tick;
    w.run(HZ);
    expect(w.state(wolf).targetTick).toBeGreaterThan(back);
    // Asleep it would not: the same moment after the trail went cold leaves it sleeping.
    const later = verlassen();
    later.w.run(later.lastKnown + WOLF.memoryTicks + WOLF.investigateTicks + HZ - later.w.sim.tick);
    expect(later.w.state(later.wolf).state).toBe('schlafen');
    const spot = later.w.where(later.wolf);
    later.w.run(1, [{ type: 'player.teleport', x: spot.x, y: spot.y + TILE_PX, layer: 0 }]);
    later.w.run(HZ);
    expect(later.w.state(later.wolf).targetTick).toBe(later.lastKnown);
    expect(later.w.state(later.wolf).state).toBe('schlafen');
  });

  it('Speichern → Laden mitten im Erwachen: Tick für Tick gleich, der Biss kommt', () => {
    const play = (): { w: KreaturWelt; wolf: Entity } => {
      const m = mittag();
      swing(m.w, m.wolf);
      m.w.run(10);
      return m;
    };
    const a = play();
    expect(a.w.state(a.wolf).target).toBe(a.w.sim.player);
    const b = mittag();
    for (const p of a.w.sim.participants()) b.w.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.w.sim.hashState()).toBe(a.w.sim.hashState());
    const biteA = firstBite(a.w, a.wolf, 5 * HZ);
    const biteB = firstBite(b.w, a.wolf, 5 * HZ);
    expect(biteA).toBeGreaterThan(0);
    expect(biteB).toBe(biteA);
    expect(b.w.sim.hashState()).toBe(a.w.sim.hashState());
  });
});
