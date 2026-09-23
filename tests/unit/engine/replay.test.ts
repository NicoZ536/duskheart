/**
 * M0-08: a command recording reproduces the identical simulation hash (docs/ARCHITEKTUR.md
 * "Datenfluss" – Replays).
 */
import { describe, expect, it } from 'vitest';
import { CommandRecorder, ReplayPlayer } from '../../../src/engine/commands';
import { makeEntity } from '../../../src/engine/ecs';
import { Rng } from '../../../src/engine/rng';
import { parseCommandRecording, type GameCommand } from '../../../src/game/commands';
import { runHeadless } from '../../../src/game/headless';
import { createSimulation } from '../../../src/game/setup';

const SEED = 20260923;
const TICKS = 3000;

/** Plays a "session": live input decides commands on the fly (like a player), recorded by the sink. */
function playLiveSession(seed: number, inputSeed: number): { hash: string; recording: CommandRecorder<GameCommand> } {
  const sim = createSimulation({ seed });
  const recorder = new CommandRecorder<GameCommand>({ seed });
  sim.commands.setSink(recorder);
  const input = new Rng(inputSeed);
  let spawned = 0;
  sim.commands.push({ type: 'spawnDebugMover', x: 400, y: 400, controlled: true });
  spawned++;
  for (let t = 0; t < TICKS; t++) {
    // Several commands can arrive between two ticks, many ticks have none.
    if (input.bool(0.05)) sim.commands.push({ type: 'move', dx: input.float(-1, 1), dy: input.float(-1, 1) });
    if (input.bool(0.02)) {
      sim.commands.push({ type: 'spawnDebugMover', x: input.float(0, 2000), y: input.float(0, 2000) });
      spawned++;
    }
    if (input.bool(0.005)) sim.commands.push({ type: 'despawn', entity: makeEntity(input.int(1, spawned + 1), 0) });
    sim.step();
    sim.events.clear();
  }
  return { hash: sim.hashState(), recording: recorder };
}

describe('command replay', () => {
  it('replaying a recorded session into a fresh simulation yields the identical hash', () => {
    const live = playLiveSession(SEED, 99);
    expect(live.recording.length).toBeGreaterThan(100);
    const replay = runHeadless({ seed: SEED, ticks: TICKS, commands: live.recording });
    expect(replay.hash).toBe(live.hash);
    expect(replay.events.commandRejected).toBeGreaterThan(0);
  });

  it('survives serialization of the recording (bug-repro file)', () => {
    const live = playLiveSession(SEED, 7);
    const file = JSON.stringify(live.recording.toJSON());
    const loaded = parseCommandRecording(JSON.parse(file));
    expect(loaded.meta).toEqual({ seed: SEED });
    const replay = runHeadless({ seed: Number(loaded.meta['seed']), ticks: TICKS, commands: loaded });
    expect(replay.hash).toBe(live.hash);
  });

  it('replays tick by tick with ReplayPlayer.feed into the simulation queue', () => {
    const live = playLiveSession(SEED, 3);
    const sim = createSimulation({ seed: SEED });
    const player = new ReplayPlayer(live.recording);
    for (let t = 0; t < TICKS; t++) {
      player.feed(sim.tick, sim.commands);
      sim.step();
      sim.events.clear();
    }
    expect(player.done).toBe(true);
    expect(sim.hashState()).toBe(live.hash);
  });

  it('detects a tampered recording (different hash)', () => {
    const live = playLiveSession(SEED, 5);
    const entries = live.recording.entries.slice();
    const idx = entries.findIndex((e) => e.cmd.type === 'move');
    const original = entries[idx];
    if (original === undefined || original.cmd.type !== 'move') throw new Error('fixture needs a move command');
    entries[idx] = { tick: original.tick, cmd: { ...original.cmd, dx: -original.cmd.dx || 0.5 } };
    expect(runHeadless({ seed: SEED, ticks: TICKS, commands: entries }).hash).not.toBe(live.hash);
    expect(runHeadless({ seed: SEED + 1, ticks: TICKS, commands: live.recording }).hash).not.toBe(live.hash);
  });

  it('re-recording a replay produces the same recording', () => {
    const live = playLiveSession(SEED, 11);
    const again = new CommandRecorder<GameCommand>({ seed: SEED });
    runHeadless({ seed: SEED, ticks: TICKS, commands: live.recording, recorder: again });
    expect(again.toJSON()).toEqual(live.recording.toJSON());
  });
});
