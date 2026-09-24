/**
 * M3-09: cliffs and water (§11.4). Jumping down: 1 level harmless, 2 levels damage, from 3 levels the
 * risk of a broken bone; up only over ramps, stairs and placed ladders. Swimming 2,5 tiles/s, deep water
 * costs 5 stamina/s, drowning −5 HP/s without stamina; landing in deep water is harmless.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { createCliffMove, findJumpDown, findLadderClimb, type ClimbAids } from '../../../src/game/player/cliffs';
import { fallDamage, fallOutcome, fractureChance, jumpTicks, climbTicks } from '../../../src/game/player/formulas';
import { OFFSET, T, testWorld, type TestWorld } from './spieler-testwelt';

const C = BALANCE.player.cliffs;
const TICK = BALANCE.time.tickHz;
const PUSH = Math.round(C.jumpHoldSeconds * TICK);

/**
 * A plateau of `level` in rows 0–2 whose south edge drops to level 0: the `level` face rows below it
 * (rows 3 … 2 + level), then the landing row `landing`, then grass.
 */
function southCliff(level: number, landing = '.........'): string[] {
  const top = String(level).repeat(9);
  return [top, top, top, ...Array.from({ length: level }, () => '.........'), landing, '.........', '.........'];
}

/** A plateau of `level` in columns 0–3 whose east edge is a plain step down to level 0. */
function eastStep(level: number): string[] {
  const row = `${String(level).repeat(4)}........`;
  return [row, row, row, row, row];
}

function landings(w: TestWorld, ticks: number, commands: Parameters<TestWorld['run']>[1]): Array<{ levels: number; damage: number; fracture: boolean; water: boolean }> {
  return (w.run(ticks, commands).get('playerLanded') ?? []) as Array<{ levels: number; damage: number; fracture: boolean; water: boolean }>;
}

describe('Sturz (reine Funktionen)', () => {
  it('1 level harmless, 2 levels 15 HP, every further level 15 HP more', () => {
    expect([fallDamage(0), fallDamage(1), fallDamage(2), fallDamage(3), fallDamage(4)]).toEqual([0, 0, 15, 30, 45]);
  });

  it('bone fracture risk from 3 levels: 40 %, +30 % per level, capped at 100 %', () => {
    expect([fractureChance(1), fractureChance(2)]).toEqual([0, 0]);
    expect(fractureChance(3)).toBeCloseTo(0.4, 12);
    expect(fractureChance(4)).toBeCloseTo(0.7, 12);
    expect(fractureChance(9)).toBe(1);
    expect(fallOutcome(3, false, 0.39)).toEqual({ damage: 30, fracture: true });
    expect(fallOutcome(3, false, 0.4)).toEqual({ damage: 30, fracture: false });
    expect(fallOutcome(2, false, 0)).toEqual({ damage: 15, fracture: false });
    // Deep water catches every fall.
    expect(fallOutcome(4, true, 0)).toEqual({ damage: 0, fracture: false });
  });

  it('a jump takes 0,18 s per level, a ladder 1 s per level', () => {
    expect(jumpTicks(1)).toBe(Math.round(C.jumpSecondsPerLevel * TICK));
    expect(jumpTicks(4)).toBe(Math.round(4 * C.jumpSecondsPerLevel * TICK));
    expect(climbTicks(2)).toBe(2 * TICK);
  });
});

describe('Herunter: Stufen und Klippen', () => {
  it('steps off a 1-level ledge harmlessly', () => {
    const w = testWorld(eastStep(1));
    w.spawn(1, 2);
    const land = landings(w, TICK, [{ type: 'player.move', dx: 1, dy: 0 }]);
    expect(land).toEqual([expect.objectContaining({ levels: 1, damage: 0, fracture: false, water: false })]);
    expect(w.vit().health).toBe(100);
    expect(w.body().level).toBe(0);
  });

  it('a 2-level drop costs 15 HP and restarts the 5 s before regeneration', () => {
    const w = testWorld(eastStep(2));
    w.spawn(1, 2);
    const events = w.run(TICK, [{ type: 'player.move', dx: 1, dy: 0 }]);
    expect(events.get('playerLanded')).toEqual([expect.objectContaining({ levels: 2, damage: 15, fracture: false })]);
    expect(events.get('playerDamaged')).toEqual([expect.objectContaining({ cause: 'sturz', amount: 15, health: 85, lethal: false })]);
    expect(w.vit().health).toBe(85);
    expect(w.vit().damageFreeTicks).toBeLessThan(TICK);
  });

  it('from 3 levels a bone may break: the fracture hook sees it, depending on the seed', () => {
    const outcomes: boolean[] = [];
    for (let seed = 1; seed <= 24; seed++) {
      const w = testWorld(eastStep(3), undefined, seed);
      const broken: number[] = [];
      w.player.onFracture((_sim, e) => broken.push(e));
      w.spawn(1, 2);
      const [land] = landings(w, TICK, [{ type: 'player.move', dx: 1, dy: 0 }]);
      expect(land?.levels).toBe(3);
      expect(land?.damage).toBe(30);
      expect(broken.length).toBe(land?.fracture === true ? 1 : 0);
      outcomes.push(land?.fracture === true);
    }
    // 40 %: across 24 seeds both outcomes occur.
    expect(outcomes).toContain(true);
    expect(outcomes).toContain(false);
    // Same seed, same outcome.
    const again = testWorld(eastStep(3), undefined, 1);
    again.spawn(1, 2);
    expect(landings(again, TICK, [{ type: 'player.move', dx: 1, dy: 0 }])[0]?.fracture).toBe(outcomes[0]);
  });

  it('a cliff face blocks; pushing against it from the edge for 0,2 s jumps down the face', () => {
    const w = testWorld(southCliff(2));
    w.spawn(4, 1);
    // Walk south to the edge (19 px, 16 ticks): the face (rows 3–4) stops the player on the plateau.
    w.run(18, [{ type: 'player.move', dx: 0, dy: 1 }]);
    const edge = w.pos();
    expect(edge.y).toBeCloseTo((OFFSET + 3) * T - BALANCE.player.movement.colliderRadiusPx, 2);
    expect(w.body().level).toBe(2);
    expect(w.body().transit).toBe('none');
    // Push on: after the hold time the jump starts; it flies (input no longer matters) and lands below the two faces.
    const push = w.run(PUSH);
    expect(w.body().transit).toBe('jump');
    expect(push.get('playerStateChanged')).toEqual([expect.objectContaining({ state: 'jump', previous: 'walk' })]);
    const flight = w.run(jumpTicks(2), [{ type: 'player.move', dx: 0, dy: 0 }]);
    expect(flight.get('playerStateChanged')).toEqual([expect.objectContaining({ state: 'idle', previous: 'jump' })]);
    expect(flight.get('playerLanded')).toEqual([expect.objectContaining({ levels: 2, damage: 15, water: false })]);
    expect(w.body().level).toBe(0);
    expect(w.body().transit).toBe('none');
    expect(w.pos().y).toBeGreaterThan((OFFSET + 5) * T);
    expect(w.pos().x).toBe(edge.x);
    expect(w.vit().health).toBe(85);
  });

  it('brushing along the edge or pushing only briefly does not jump', () => {
    const w = testWorld(southCliff(1));
    w.spawn(1, 2);
    // Walking east along the edge with a slight southward drift.
    w.run(40, [{ type: 'player.move', dx: 0.95, dy: 0.3 }]);
    expect(w.body().level).toBe(1);
    expect(w.body().transit).toBe('none');
    // A short push (less than the hold time), then letting go.
    w.run(PUSH - 2, [{ type: 'player.move', dx: 0, dy: 1 }]);
    w.run(20, [{ type: 'player.move', dx: 0, dy: 0 }]);
    expect(w.body().level).toBe(1);
    expect(w.body().transit).toBe('none');
  });

  it('a jump into deep water is harmless and ends swimming', () => {
    // The three faces of a 3-level drop are rows 3–5, the lake starts in row 6.
    const water = testWorld(southCliff(3, 'wwwwwwwww'));
    water.spawn(4, 1);
    water.run(18 + PUSH, [{ type: 'player.move', dx: 0, dy: 1 }]);
    expect(water.body().transit).toBe('jump');
    const events = water.run(jumpTicks(3) + 1, [{ type: 'player.move', dx: 0, dy: 0 }]);
    expect(events.get('playerLanded')).toEqual([expect.objectContaining({ levels: 3, damage: 0, fracture: false, water: true })]);
    expect(water.vit().health).toBe(100);
    expect(water.body().swimming).toBe(true);
    expect(water.body().state).toBe('swim');
  });
});

describe('Hinauf: nur Rampen, Treppen, Leitern', () => {
  it('a step or a cliff face cannot be walked up; a ramp can', () => {
    const w = testWorld(eastStep(1));
    w.spawn(8, 2);
    w.run(TICK, [{ type: 'player.move', dx: -1, dy: 0 }]);
    expect(w.body().level).toBe(0);
    expect(w.pos().x).toBeGreaterThanOrEqual((OFFSET + 4) * T);
    const cliff = testWorld(southCliff(1));
    cliff.spawn(4, 6);
    cliff.run(2 * TICK, [{ type: 'player.move', dx: 0, dy: -1 }]);
    expect(cliff.body().level).toBe(0);
    expect(cliff.pos().y).toBeGreaterThan((OFFSET + 4) * T);
    const ramp = testWorld(['11111111', '11111111', '11111111', '111R1111', '...r....', '........', '........']);
    ramp.spawn(3, 6);
    // 4,5 tiles north: up the ramp column onto the plateau (before its north edge).
    ramp.run(TICK, [{ type: 'player.move', dx: 0, dy: -1 }]);
    expect(ramp.body().level).toBe(1);
    expect(ramp.pos().y).toBeLessThan((OFFSET + 3) * T);
    expect(ramp.vit().health).toBe(100);
  });

  it('climbs a placed ladder up a cliff face and onto a step', () => {
    const ladders = new Set<string>();
    const aids: ClimbAids = { ladderAt: (_layer, tx, ty) => ladders.has(`${tx},${ty}`) };
    const w = testWorld(southCliff(2));
    w.player.addClimbAids(aids);
    w.spawn(4, 6);
    // Without a ladder the face stops the player.
    w.run(TICK, [{ type: 'player.move', dx: 0, dy: -1 }]);
    expect(w.body().level).toBe(0);
    // A ladder on the face tile right above the foot (row 4).
    ladders.add(`${OFFSET + 4},${OFFSET + 4}`);
    const events = w.run(PUSH + climbTicks(2) + 2);
    expect(events.get('playerClimbed')).toEqual([expect.objectContaining({ levels: 2 })]);
    expect(w.body().level).toBe(2);
    expect(w.pos().y).toBeLessThan((OFFSET + 3) * T);
    expect(w.vit().health).toBe(100);
    // Onto a step: a ladder on the higher tile beside the player.
    const step = testWorld(eastStep(1));
    step.player.addClimbAids(aids);
    ladders.add(`${OFFSET + 3},${OFFSET + 2}`);
    step.spawn(6, 2);
    step.run(TICK + PUSH + climbTicks(1), [{ type: 'player.move', dx: -1, dy: 0 }]);
    expect(step.body().level).toBe(1);
  });

  it('finds jump and ladder targets on the grid directly', () => {
    const w = testWorld(southCliff(2));
    const grid = w.collision.grid;
    grid.beginQuery();
    const out = createCliffMove();
    expect(findJumpDown(grid, 0, OFFSET + 4, OFFSET + 2, 2, out)).toBe(true);
    expect(out).toEqual({ tx: OFFSET + 4, ty: OFFSET + 5, toLevel: 0, levels: 2, water: false });
    // Not from a tile that is not the edge, not for another level.
    expect(findJumpDown(grid, 0, OFFSET + 4, OFFSET + 1, 2, out)).toBe(false);
    expect(findJumpDown(grid, 0, OFFSET + 4, OFFSET + 2, 1, out)).toBe(false);
    const aids: ClimbAids = { ladderAt: (_l, tx, ty) => tx === OFFSET + 4 && ty === OFFSET + 4 };
    expect(findLadderClimb(grid, 0, OFFSET + 4, OFFSET + 5, 0, -1, 0, aids, out)).toBe(true);
    expect(out).toEqual({ tx: OFFSET + 4, ty: OFFSET + 2, toLevel: 2, levels: 2, water: false });
    expect(findLadderClimb(grid, 0, OFFSET + 5, OFFSET + 5, 0, -1, 0, aids, out)).toBe(false);
  });
});

describe('Wasser', () => {
  /** A lake (rows 0–2 from column 2) with a shallow shore (rows 3–4). */
  const lake = ['..wwwwwwwwwwwwwwwwwwwwww', '..wwwwwwwwwwwwwwwwwwwwww', '..wwwwwwwwwwwwwwwwwwwwww', 'ssssssssssssssssssssssss', 'ssssssssssssssssssssssss'];

  it('wades through shallow water at walking speed; swims in deep water, soaked, 5 stamina/s', () => {
    const w = testWorld(lake);
    w.spawn(4, 4);
    const a = w.pos();
    w.run(TICK, [{ type: 'player.move', dx: 1, dy: 0 }]);
    expect(w.body().swimming).toBe(false);
    expect((w.pos().x - a.x) / T).toBeCloseTo(BALANCE.player.movement.walkTilesPerSecond, 2);
    // Into the lake.
    const events = w.run(TICK, [{ type: 'player.move', dx: 0, dy: -1 }]);
    expect(events.get('playerStateChanged')).toContainEqual(expect.objectContaining({ state: 'swim', previous: 'walk' }));
    expect(w.body().swimming).toBe(true);
    expect(w.vit().wetness).toBe(100);
    const s0 = w.vit().stamina;
    w.run(TICK, [{ type: 'player.move', dx: 0, dy: 0 }]);
    // Treading water costs stamina too.
    expect(s0 - w.vit().stamina).toBeCloseTo(BALANCE.survival.stamina.swimPerSecond, 6);
    // A roll is not possible in the water.
    const roll = w.run(1, [{ type: 'player.roll', dx: 1, dy: 0 }]);
    expect(roll.get('commandRejected')).toEqual([expect.objectContaining({ type: 'player.roll', reason: 'busy' })]);
  });

  it('drowns without stamina at 5 HP/s, reported once per second; leaving the water ends it', () => {
    const w = testWorld(lake);
    w.spawn(6, 4);
    w.run(70, [{ type: 'player.move', dx: 0, dy: -1 }]);
    w.run(30, [{ type: 'player.move', dx: 0, dy: 0 }]);
    expect(w.body().swimming).toBe(true);
    w.vit().stamina = 0.01;
    const drowning = w.run(2 * TICK);
    expect(drowning.get('survivalStageChanged')).toContainEqual(expect.objectContaining({ stat: 'drowning', stage: 'ertrinkend', previous: 'atmend' }));
    const hits = (drowning.get('playerDamaged') ?? []) as Array<{ cause: string; amount: number }>;
    expect(hits.length).toBe(2);
    expect(hits.every((h) => h.cause === 'ertrinken')).toBe(true);
    expect(100 - w.vit().health).toBeCloseTo(BALANCE.survival.drowning.damagePerSecond * 2, 1);
    // Out of the water (south, the shallow row): breathing again, no more damage.
    const out = w.run(TICK, [{ type: 'player.move', dx: 0, dy: 1 }]);
    expect(w.body().swimming).toBe(false);
    expect(out.get('survivalStageChanged')).toContainEqual(expect.objectContaining({ stat: 'drowning', stage: 'atmend' }));
  });
});
