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
    // M3: player (M3-08), bags (M3-02; `inventory.give` debug), interaction (M3-10), the player's life
    // (M3-19, M3-23 … M3-26, M3-32; debug `conditions.apply/cure`, `fear.set`, `death.kill`),
    // crafting (M3-16), using items (M3-15), light (M3-22) and the console's cheats (M3-35).
    expect(GAME_COMMAND_TYPES).toEqual([
      'move', 'spawnDebugMover', 'despawn', 'teleport', 'setTime', 'advanceTime', 'setSeason', 'setWeather', 'player.spawn', 'player.move',
      'player.sprint', 'player.sneak', 'player.roll', 'player.teleport', 'inventory.move', 'inventory.split', 'inventory.collect', 'inventory.sort',
      'inventory.quickMove', 'inventory.discard', 'player.selectHotbar', 'player.scrollHotbar', 'inventory.give', 'player.interact', 'player.aim',
      'conditions.apply', 'conditions.cure', 'fear.set', 'sleep.start', 'sleep.wake', 'action.eat', 'action.useBelt', 'action.drink', 'action.sit',
      'action.stand', 'action.throw', 'action.cancel', 'skills.choosePerk', 'death.respawn', 'death.lootGrave', 'death.kill',
      'craft.start', 'craft.cancel', 'craft.useChests', 'player.useItem', 'light.toggle', 'light.place', 'light.fuel', 'light.ignite', 'light.douse',
      'light.take', 'debug.god', 'debug.noclip', 'debug.unlock',
    ]);
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
