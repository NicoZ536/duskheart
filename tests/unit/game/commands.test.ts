import { describe, expect, it } from 'vitest';
import { CommandRecorder } from '../../../src/engine/commands';
import { GAME_COMMAND_TYPES, parseCommandRecording, parseGameCommand, type GameCommand } from '../../../src/game/commands';

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
    expect(GAME_COMMAND_TYPES).toEqual(['move', 'spawnDebugMover', 'despawn']);
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
