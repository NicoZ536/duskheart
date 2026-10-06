import { describe, expect, it } from 'vitest';
import { CommandRecorder } from '../../../src/engine/commands';
import { GAME_COMMAND_TYPES, parseCommandRecording, parseGameCommand, type GameCommand } from '../../../src/game/commands';
import { createSimulation } from '../../../src/game/setup';
import { laterCommandsOutsideM7, M6_COMMAND_TYPES } from './sim-stand';

describe('game commands', () => {
  it('parses every command type', () => {
    expect(parseGameCommand({ type: 'move', dx: 1, dy: -0.5 })).toEqual({ type: 'move', dx: 1, dy: -0.5 });
    expect(parseGameCommand({ type: 'spawnDebugMover', x: 3, y: 4 })).toEqual({ type: 'spawnDebugMover', x: 3, y: 4 });
    expect(parseGameCommand({ type: 'spawnDebugMover', x: 3, y: 4, vx: -2, vy: 0, controlled: true })).toEqual({
      type: 'spawnDebugMover',
      x: 3,
      y: 4,
      vx: -2,
      vy: 0,
      controlled: true,
    });
    expect(parseGameCommand({ type: 'despawn', entity: 12 })).toEqual({ type: 'despawn', entity: 12 });
    // M4 commands parse with their optional fields (E on a station, a door, a chest, a hearth; repair; area repair).
    expect(parseGameCommand({ type: 'station.use', station: 3 })).toEqual({ type: 'station.use', station: 3 });
    expect(parseGameCommand({ type: 'build.door', tx: 4, ty: 5, open: false })).toEqual({ type: 'build.door', tx: 4, ty: 5, open: false });
    expect(parseGameCommand({ type: 'build.complete', tx: 4, ty: 5 })).toEqual({ type: 'build.complete', tx: 4, ty: 5 });
    expect(parseGameCommand({ type: 'build.repair', tx0: 1, ty0: 2, tx1: 3, ty1: 4 })).toEqual({ type: 'build.repair', tx0: 1, ty0: 2, tx1: 3, ty1: 4 });
    expect(parseGameCommand({ type: 'storage.open', chest: 1 })).toEqual({ type: 'storage.open', chest: 1 });
    expect(parseGameCommand({ type: 'hearth.fuel', hearth: 2, from: { bereich: 'inventar', index: 0 }, count: 3 })).toEqual({ type: 'hearth.fuel', hearth: 2, from: { bereich: 'inventar', index: 0 }, count: 3 });
    expect(parseGameCommand({ type: 'repair.item', slot: { bereich: 'schnellleiste', index: 1 } })).toEqual({ type: 'repair.item', slot: { bereich: 'schnellleiste', index: 1 } });
    expect(() => parseGameCommand({ type: 'build.door', tx: 1.5, ty: 5 })).toThrow(TypeError);
    expect(parseGameCommand({ type: 'craft.pin', recipe: 'rezept_steinaxt', on: true })).toEqual({ type: 'craft.pin', recipe: 'rezept_steinaxt', on: true });
    expect(() => parseGameCommand({ type: 'craft.pin', recipe: 'rezept_steinaxt' })).toThrow(TypeError);
    // The commands of M6 (M3 … M6, listed with their tasks in tests/unit/game/sim-stand.ts) come first, exactly these in this
    // order (ADR-0208); every later one is handled by a system M7 adds to SYSTEM_ORDER (docs/SPIEL.md §16), none twice.
    expect(GAME_COMMAND_TYPES.slice(0, M6_COMMAND_TYPES.length)).toEqual(M6_COMMAND_TYPES);
    expect(new Set(GAME_COMMAND_TYPES).size).toBe(GAME_COMMAND_TYPES.length);
    expect(laterCommandsOutsideM7(createSimulation({ seed: 1, worldSize: 'small' }), GAME_COMMAND_TYPES)).toEqual([]);
  });

  it('rejects malformed commands with a descriptive error', () => {
    expect(() => parseGameCommand({ type: 'move', dx: 2, dy: 0 })).toThrow(/dx/);
    expect(() => parseGameCommand({ type: 'move', dx: Number.NaN, dy: 0 })).toThrow(TypeError);
    expect(() => parseGameCommand({ type: 'teleport' })).toThrow(TypeError);
    expect(() => parseGameCommand({ type: 'despawn', entity: -1 })).toThrow(/entity/);
    expect(() => parseGameCommand({ type: 'despawn', entity: 1, extra: true })).toThrow(TypeError);
    expect(() => parseGameCommand({ type: 'spawnDebugMover', x: Number.POSITIVE_INFINITY, y: 0 })).toThrow(TypeError);
    expect(() => parseGameCommand(null)).toThrow(TypeError);
  });

  it('round-trips a recording through JSON with validation', () => {
    const rec = new CommandRecorder<GameCommand>({ seed: 4 });
    rec.record(0, { type: 'spawnDebugMover', x: 1, y: 2, controlled: true });
    rec.record(5, { type: 'move', dx: 0, dy: 1 });
    const parsed = parseCommandRecording(JSON.parse(JSON.stringify(rec.toJSON())));
    expect(parsed.toJSON()).toEqual(rec.toJSON());
    const broken = JSON.parse(JSON.stringify(rec.toJSON())) as { entries: Array<{ cmd: { dx?: number } }> };
    (broken.entries[1] as { cmd: { dx?: number } }).cmd.dx = 9;
    expect(() => parseCommandRecording(broken)).toThrow(/Invalid game command/);
  });
});
