/**
 * M3-08: the player entity, its spawn on the start beach and the steering of §11.4 – walk 4,5, sprint 7,
 * sneak 2,5 (noise −70 %), roll 3 tiles with 0,25 s invulnerability, swim 2,5, armour weight
 * 0/−5/−10 % –, input acting in the next tick, and movement through `moveCircle` against the world's
 * memoised collision grid (invalidated when a tile changes).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CommandRecorder } from '../../../src/engine/commands';
import { NULL_ENTITY } from '../../../src/engine/ecs';
import type { GameCommand } from '../../../src/game/commands';
import { WORLD_COLLISION_SYSTEM_ID, type WorldCollision } from '../../../src/game/player/collision';
import { armorSpeedFactor, clampInput, facingFor, moveSpeedTilesPerSecond, movementNoise, rollSpeedTilesPerSecond, steeredMode } from '../../../src/game/player/formulas';
import type { PlayerSystem } from '../../../src/game/player/system';
import { GameSession } from '../../../src/game/session';
import { createSimulation } from '../../../src/game/setup';
import type { Simulation } from '../../../src/game/sim';
import { BLOCK_DEEP_WATER, PLAYER_RULES } from '../../../src/world/collision/tiles';
import { TILE_PX, tileToChunk } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { OFFSET, T, meadow, testWorld } from './spieler-testwelt';

const M = BALANCE.player.movement;
const TICK = BALANCE.time.tickHz;
const CONFIG = { seed: 20260924, worldSize: 'small', dayLengthMinutes: 12 } as const;

/** Tiles per second covered by the player over `ticks` ticks after `commands` (open meadow). */
function measuredSpeed(commands: GameCommand[], ticks: number, setup?: (w: ReturnType<typeof testWorld>) => void): number {
  const w = testWorld(meadow(80, 20));
  w.spawn(4, 10);
  setup?.(w);
  const a = w.pos();
  w.run(ticks, commands);
  const b = w.pos();
  return Math.hypot(b.x - a.x, b.y - a.y) / T / (ticks / TICK);
}

describe('Tempi (§11.4) als reine Funktionen', () => {
  it('walk 4,5 · sprint 7 · sneak 2,5 · swim 2,5 tiles/s; armour light 0 %, medium −5 %, heavy −10 %', () => {
    expect(moveSpeedTilesPerSecond('walk', 'leicht', 1)).toBe(4.5);
    expect(moveSpeedTilesPerSecond('sprint', 'leicht', 1)).toBe(7);
    expect(moveSpeedTilesPerSecond('sneak', 'leicht', 1)).toBe(2.5);
    expect(moveSpeedTilesPerSecond('swim', 'leicht', 1)).toBe(2.5);
    expect([armorSpeedFactor('leicht'), armorSpeedFactor('mittel'), armorSpeedFactor('schwer')]).toEqual([1, 0.95, 0.9]);
    expect(moveSpeedTilesPerSecond('walk', 'mittel', 1)).toBeCloseTo(4.275, 12);
    expect(moveSpeedTilesPerSecond('sprint', 'schwer', 1)).toBeCloseTo(6.3, 12);
    // Conditions multiply (e.g. a broken bone, §11.3 "−40 % Tempo").
    expect(moveSpeedTilesPerSecond('walk', 'leicht', 0.6)).toBeCloseTo(2.7, 12);
    for (const s of ['idle', 'roll', 'jump', 'climb'] as const) expect(moveSpeedTilesPerSecond(s, 'leicht', 1)).toBe(0);
    // The roll: 3 tiles in 0,4 s.
    expect(rollSpeedTilesPerSecond() * BALANCE.player.roll.durationSeconds).toBeCloseTo(3, 12);
  });

  it('mode: deep water swims, sneaking beats sprinting, a sprint needs stamina, no input stands', () => {
    expect(steeredMode(true, true, true, true, true)).toBe('swim');
    expect(steeredMode(false, true, false, false, true)).toBe('swim');
    expect(steeredMode(false, false, true, true, true)).toBe('idle');
    expect(steeredMode(true, false, true, true, true)).toBe('sneak');
    expect(steeredMode(true, false, false, true, true)).toBe('sprint');
    expect(steeredMode(true, false, false, true, false)).toBe('walk');
    expect(steeredMode(true, false, false, false, true)).toBe('walk');
  });

  it('sneaking makes 30 % of the walking noise (§11.4 "Geräusch −70 %"), standing none', () => {
    expect(movementNoise('sneak') / movementNoise('walk')).toBeCloseTo(0.3, 12);
    expect(movementNoise('idle')).toBe(0);
  });

  it('input is clamped to length 1, facing follows the larger axis with hysteresis near the diagonal', () => {
    const o = { x: 0, y: 0 };
    expect(clampInput(1, 1, o).x).toBeCloseTo(Math.SQRT1_2, 12);
    expect(clampInput(0.3, -0.4, o)).toEqual({ x: 0.3, y: -0.4 });
    expect(facingFor(1, 0, 'down')).toBe('right');
    expect(facingFor(0, -1, 'right')).toBe('up');
    expect(facingFor(0, 0, 'left')).toBe('left');
    expect(facingFor(Math.SQRT1_2, Math.SQRT1_2, 'right')).toBe('right');
    expect(facingFor(Math.SQRT1_2, Math.SQRT1_2, 'down')).toBe('down');
    expect(facingFor(Math.SQRT1_2, Math.SQRT1_2, 'up')).toBe('down');
    expect(facingFor(0.8, 0.6, 'down')).toBe('right');
  });
});

describe('Tempi im Spiel (gemessen über die Kollision)', () => {
  it('walks 4,5, sprints 7, sneaks 2,5 tiles/s on open ground', () => {
    expect(measuredSpeed([{ type: 'player.move', dx: 1, dy: 0 }], TICK)).toBeCloseTo(M.walkTilesPerSecond, 2);
    expect(measuredSpeed([{ type: 'player.move', dx: 1, dy: 0 }, { type: 'player.sprint', on: true }], TICK)).toBeCloseTo(M.sprintTilesPerSecond, 2);
    expect(measuredSpeed([{ type: 'player.move', dx: 0, dy: -1 }, { type: 'player.sneak', on: true }], TICK)).toBeCloseTo(M.sneakTilesPerSecond, 2);
    // Sneaking beats sprinting; diagonal input moves at the same speed.
    expect(measuredSpeed([{ type: 'player.move', dx: 1, dy: 1 }, { type: 'player.sneak', on: true }, { type: 'player.sprint', on: true }], TICK)).toBeCloseTo(M.sneakTilesPerSecond, 2);
    // A stick half tilted walks half as fast.
    expect(measuredSpeed([{ type: 'player.move', dx: 0.5, dy: 0 }], TICK)).toBeCloseTo(M.walkTilesPerSecond / 2, 2);
  });

  it('armour weight slows every steered mode: medium −5 %, heavy −10 %', () => {
    const heavy = (w: ReturnType<typeof testWorld>): void => w.influences.addModifierSource((_s, _p, out) => (out.armorWeight = 'schwer'));
    const medium = (w: ReturnType<typeof testWorld>): void => w.influences.addModifierSource((_s, _p, out) => (out.armorWeight = 'mittel'));
    expect(measuredSpeed([{ type: 'player.move', dx: 1, dy: 0 }], TICK, heavy)).toBeCloseTo(4.05, 2);
    expect(measuredSpeed([{ type: 'player.move', dx: 1, dy: 0 }, { type: 'player.sprint', on: true }], TICK, medium)).toBeCloseTo(6.65, 2);
  });

  it('swims 2,5 tiles/s in deep water', () => {
    const w = testWorld(['..wwwwwwwwwwwwwwwwwwww..', '..wwwwwwwwwwwwwwwwwwww..', '..wwwwwwwwwwwwwwwwwwww..']);
    w.run(1, [{ type: 'player.teleport', x: w.centre(4, 1).x, y: w.centre(4, 1).y, layer: 0 }]);
    // No player yet: the teleport is rejected, the spawn needs a dry tile – spawn on land, then teleport into the lake.
    w.spawn(0, 1);
    w.run(1, [{ type: 'player.teleport', x: w.centre(4, 1).x, y: w.centre(4, 1).y, layer: 0 }]);
    const a = w.pos();
    w.run(TICK, [{ type: 'player.move', dx: 1, dy: 0 }, { type: 'player.sprint', on: true }]);
    const b = w.pos();
    expect(w.body().state).toBe('swim');
    expect((b.x - a.x) / T).toBeCloseTo(M.swimTilesPerSecond, 2);
  });

  it('rolls 3 tiles in 0,4 s, invulnerable for the first 0,25 s, then stands again', () => {
    const w = testWorld(meadow(40, 10));
    w.spawn(4, 5);
    const a = w.pos();
    const events = w.run(1, [{ type: 'player.roll', dx: 1, dy: 0 }]);
    expect(events.get('playerRolled')).toEqual([{ entity: w.sim.player, dx: 1, dy: 0, tick: 1 }]);
    expect(w.body().state).toBe('roll');
    expect(w.player.isInvulnerable(w.sim)).toBe(true);
    // 0,25 s = 15 ticks invulnerable (the first included).
    w.run(13);
    expect(w.player.isInvulnerable(w.sim)).toBe(true);
    w.run(1);
    expect(w.player.isInvulnerable(w.sim)).toBe(false);
    w.run(24 - 15);
    const b = w.pos();
    expect((b.x - a.x) / T).toBeCloseTo(BALANCE.player.roll.distanceTiles, 3);
    expect(w.body().state).toBe('roll');
    w.run(1);
    expect(w.body().state).toBe('idle');
    expect(w.pos()).toEqual(b);
    // A roll costs 20 stamina (§11.1).
    expect(w.vit().stamina).toBeCloseTo(100 - BALANCE.survival.stamina.rollCost, 6);
  });

  it('rolls towards the facing without input; rejects a roll without stamina or while rolling', () => {
    const w = testWorld(meadow(40, 20));
    w.spawn(10, 10);
    w.run(10, [{ type: 'player.move', dx: 0, dy: -1 }]);
    w.run(1, [{ type: 'player.move', dx: 0, dy: 0 }]);
    const a = w.pos();
    w.run(24, [{ type: 'player.roll', dx: 0, dy: 0 }]);
    expect(w.pos().x).toBe(a.x);
    expect((a.y - w.pos().y) / T).toBeCloseTo(3, 3);
    const busy = w.run(2, [{ type: 'player.roll', dx: 1, dy: 0 }]);
    const again = w.run(1, [{ type: 'player.roll', dx: 1, dy: 0 }]);
    expect(busy.get('playerRolled')).toHaveLength(1);
    expect(again.get('commandRejected')).toEqual([{ type: 'player.roll', reason: 'busy', tick: w.sim.tick - 1 }]);
    w.vit().stamina = BALANCE.survival.stamina.rollCost - 0.5;
    w.run(30);
    const tired = w.run(1, [{ type: 'player.roll', dx: 1, dy: 0 }]);
    expect(tired.get('commandRejected')).toEqual([{ type: 'player.roll', reason: 'noStamina', tick: w.sim.tick - 1 }]);
  });

  it('a sprint spends 12 stamina/s, runs dry into walking and resumes with 25 stamina back', () => {
    const w = testWorld(meadow(200, 10));
    w.spawn(2, 5);
    w.run(TICK, [{ type: 'player.move', dx: 1, dy: 0 }, { type: 'player.sprint', on: true }]);
    expect(w.vit().stamina).toBeCloseTo(100 - BALANCE.survival.stamina.sprintPerSecond, 6);
    w.vit().stamina = 0.1;
    w.run(2);
    expect(w.vit().stamina).toBe(0);
    expect(w.vit().sprintLocked).toBe(true);
    expect(w.body().state).toBe('walk');
    // Regeneration starts after 0,8 s without use; at 25 stamina (1 s at 25/s) the held sprint takes over again.
    let ticks = 0;
    while (w.body().state !== 'sprint' && ticks < 5 * TICK) {
      w.run(1);
      ticks++;
    }
    expect(w.vit().sprintLocked).toBe(false);
    expect((ticks + 2) / TICK).toBeCloseTo(BALANCE.survival.stamina.regenDelaySeconds + BALANCE.survival.stamina.sprintResumeStamina / BALANCE.survival.stamina.regenPerSecond, 1);
  });

  it('reports footsteps every 1,5 tiles with the ground under the feet and the noise of the mode', () => {
    const w = testWorld(['SSSSSSSSSSSSSSSSSSSSSSSSSS']);
    w.spawn(1, 0);
    const x0 = w.pos().x;
    const events = w.run(TICK + 10, [{ type: 'player.move', dx: 1, dy: 0 }]);
    const steps = events.get('playerStep') as Array<{ terrain: string; water: string; noise: number }>;
    expect(steps).toHaveLength(Math.floor((w.pos().x - x0) / T / M.stepLengthTiles));
    expect(steps[0]).toMatchObject({ terrain: 'sand', water: 'none', noise: 1 });
    const sneak = w.run(TICK, [{ type: 'player.sneak', on: true }]);
    expect((sneak.get('playerStep') as Array<{ noise: number }>)[0]?.noise).toBeCloseTo(0.3, 12);
  });

  it('acts on input in the next tick: a frame pushes the command, the next step moves', () => {
    const session = new GameSession({ config: CONFIG });
    session.command({ type: 'player.spawn' });
    session.step();
    const p = session.debugState().player;
    if (p === null) throw new Error('no player');
    session.input.keyDown('KeyD');
    session.beginFrame();
    // The frame queued the command; nothing moved yet.
    expect(session.sim.commands.size).toBe(1);
    expect(session.debugState().player?.x).toBe(p.x);
    const tick = session.sim.tick;
    session.step();
    const after = session.debugState().player;
    expect(after?.x).toBeGreaterThan(p.x);
    expect(after?.state).toBe('walk');
    expect(after?.stateSince).toBe(tick);
  });
});

describe('Kollision mit der Welt', () => {
  it('stops at trees, rock and the world edge and slides along them', () => {
    const w = testWorld(['..........', '....T.....', '....#.....', '....#.....', '....#.....', '..........']);
    w.spawn(1, 1);
    w.run(TICK, [{ type: 'player.move', dx: 1, dy: 0 }]);
    // Stopped by the birch's tile (column 4): the circle's edge rests on the tile face.
    const r = BALANCE.player.movement.colliderRadiusPx;
    expect(w.pos().x).toBeCloseTo((OFFSET + 4) * T - r, 2);
    expect(w.pos().y).toBe(w.centre(1, 1).y);
    // Diagonal input slides up along the rock face (rows 2–4 of column 4).
    w.run(1, [{ type: 'player.teleport', x: w.centre(3, 4).x, y: w.centre(3, 4).y, layer: 0 }]);
    w.run(20, [{ type: 'player.move', dx: Math.SQRT1_2, dy: -Math.SQRT1_2 }]);
    expect(w.pos().x).toBeCloseTo((OFFSET + 4) * T - r, 2);
    expect(w.centre(3, 4).y - w.pos().y).toBeGreaterThan(10);
  });

  it('moves over the memoised collision grid of the world; a changed tile blocks after its invalidation', () => {
    const w = testWorld(meadow(20, 5));
    w.spawn(2, 2);
    expect(w.collision.grid.memo).toBe(true);
    w.run(5, [{ type: 'player.move', dx: 1, dy: 0 }]);
    // A rock appears in the way (e.g. placed by a later system), reported to the grid.
    const { chunk, i } = w.chunks.at(OFFSET + 6, OFFSET + 2);
    chunk.solid[i] = contentWorldIdTables().terrain.runtimeId('fels');
    w.collision.invalidateTile(0, OFFSET + 6, OFFSET + 2);
    expect(w.collision.grid.staleTiles()).toEqual([]);
    w.run(TICK);
    expect(w.pos().x).toBeCloseTo((OFFSET + 6) * T - BALANCE.player.movement.colliderRadiusPx, 2);
  });

  it(
    'spawns on the start beach of the generated world, the active zone follows, the world grid is memoised',
    () => {
      const sim: Simulation = createSimulation(CONFIG);
      sim.step([{ type: 'player.spawn' }]);
      const player = sim.system('player') as PlayerSystem;
      const collision = sim.system(WORLD_COLLISION_SYSTEM_ID) as WorldCollision;
      expect(sim.player).not.toBe(NULL_ENTITY);
      const p = { x: 0, y: 0 };
      player.position(sim, p);
      const spawn = sim.world.generated.spawn;
      const tx = Math.floor(p.x / TILE_PX);
      const ty = Math.floor(p.y / TILE_PX);
      expect(Math.hypot(tx - spawn.x, ty - spawn.y)).toBeLessThanOrEqual(BALANCE.player.spawn.searchRadiusTiles);
      // On a free, dry tile at the centre of a tile.
      expect(collision.grid.tileInfo(0, tx, ty) & (PLAYER_RULES.blockMask | BLOCK_DEEP_WATER)).toBe(0);
      expect([p.x % TILE_PX, p.y % TILE_PX]).toEqual([TILE_PX / 2, TILE_PX / 2]);
      expect(collision.grid.memo).toBe(true);
      // A second spawn is rejected; the zone forms around the player in the next tick.
      sim.events.clear();
      sim.step([{ type: 'player.spawn' }]);
      const rejected: unknown[] = [];
      sim.events.drain((type, payload) => {
        if (type === 'commandRejected') rejected.push(payload);
      });
      expect(rejected).toEqual([{ type: 'player.spawn', reason: 'playerExists', tick: 1 }]);
      expect(sim.world.zone.size).toBe(25);
      expect(sim.world.zone.isActive(0, tileToChunk(tx), tileToChunk(ty))).toBe(true);
      // Walking a while on the real world keeps the player on standable ground.
      sim.step([{ type: 'player.move', dx: -1, dy: -1 }, { type: 'player.sprint', on: true }]);
      for (let i = 0; i < 5 * TICK; i++) sim.step();
      player.position(sim, p);
      const info = collision.grid.tileInfo(0, Math.floor(p.x / TILE_PX), Math.floor(p.y / TILE_PX));
      expect(info & PLAYER_RULES.blockMask).toBe(0);
    },
    30_000,
  );

  it(
    'replays a recorded walk to the same state hash',
    () => {
      const a = createSimulation(CONFIG);
      const recorder = new CommandRecorder<GameCommand>();
      a.commands.setSink(recorder);
      const script: Array<[number, GameCommand]> = [
        [0, { type: 'player.spawn' }],
        [1, { type: 'player.move', dx: 1, dy: 0.3 }],
        [40, { type: 'player.sprint', on: true }],
        [70, { type: 'player.roll', dx: 0, dy: 1 }],
        [100, { type: 'player.sneak', on: true }],
        [130, { type: 'player.move', dx: 0, dy: 0 }],
      ];
      for (let t = 0; t < 160; t++) {
        for (const [at, cmd] of script) if (at === t) a.commands.push(cmd);
        a.step();
        a.events.clear();
      }
      const b = createSimulation(CONFIG);
      const replay = CommandRecorder.fromJSON(recorder.toJSON(), (c) => c as GameCommand);
      const entries = replay.entries;
      for (let t = 0; t < 160; t++) {
        for (const e of entries) if (e.tick === t) b.commands.push(e.cmd);
        b.step();
        b.events.clear();
      }
      expect(b.hashState()).toBe(a.hashState());
    },
    30_000,
  );
});
