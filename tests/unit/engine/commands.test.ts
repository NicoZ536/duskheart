import { describe, expect, it } from 'vitest';
import { COMMAND_RECORDING_VERSION, CommandQueue, CommandRecorder, ReplayPlayer, type RecordedCommand } from '../../../src/engine/commands';
import { Rng } from '../../../src/engine/rng';

type Cmd = { kind: 'move'; dx: number; dy: number } | { kind: 'use'; slot: number } | { kind: 'craft'; recipe: string };

function parseCmd(raw: unknown): Cmd {
  if (typeof raw !== 'object' || raw === null) throw new TypeError('bad command');
  const r = raw as Record<string, unknown>;
  if (r['kind'] === 'move' && typeof r['dx'] === 'number' && typeof r['dy'] === 'number') return { kind: 'move', dx: r['dx'], dy: r['dy'] };
  if (r['kind'] === 'use' && typeof r['slot'] === 'number') return { kind: 'use', slot: r['slot'] };
  if (r['kind'] === 'craft' && typeof r['recipe'] === 'string') return { kind: 'craft', recipe: r['recipe'] };
  throw new TypeError('bad command');
}

function randomCmd(rng: Rng): Cmd {
  switch (rng.int(0, 3)) {
    case 0:
      return { kind: 'move', dx: rng.int(-1, 2), dy: rng.int(-1, 2) };
    case 1:
      return { kind: 'use', slot: rng.int(0, 10) };
    default:
      return { kind: 'craft', recipe: rng.pick(['torch', 'axe', 'campfire']) };
  }
}

/** Tiny deterministic "simulation" whose state depends on the command stream. */
function applyCmd(state: { x: number; y: number; used: number; crafted: string[] }, cmd: Cmd, tick: number): void {
  if (cmd.kind === 'move') {
    state.x += cmd.dx * (tick % 3);
    state.y += cmd.dy;
  } else if (cmd.kind === 'use') state.used += cmd.slot * tick;
  else state.crafted.push(`${tick}:${cmd.recipe}`);
}

describe('CommandQueue', () => {
  it('drains FIFO for a tick and delivers late pushes next tick', () => {
    const q = new CommandQueue<Cmd>();
    q.push({ kind: 'use', slot: 1 });
    q.push({ kind: 'use', slot: 2 });
    expect(q.size).toBe(2);
    const got: Array<[number, number]> = [];
    const n = q.drainForTick(5, (cmd, tick) => {
      if (cmd.kind === 'use') {
        got.push([tick, cmd.slot]);
        if (cmd.slot === 1) q.push({ kind: 'use', slot: 3 });
      }
    });
    expect(n).toBe(2);
    expect(got).toEqual([
      [5, 1],
      [5, 2],
    ]);
    expect(q.size).toBe(1);
    q.drainForTick(6, (cmd, tick) => {
      if (cmd.kind === 'use') got.push([tick, cmd.slot]);
    });
    expect(got[2]).toEqual([6, 3]);
    q.push({ kind: 'use', slot: 9 });
    q.clear();
    expect(q.drainForTick(7, () => undefined)).toBe(0);
    expect(() => q.drainForTick(-1, () => undefined)).toThrow(RangeError);
  });
});

describe('CommandQueue re-entrancy', () => {
  it('rejects draining from inside a drain instead of losing commands', () => {
    const q = new CommandQueue<number>();
    q.push(1);
    q.push(2);
    const got: number[] = [];
    q.drainForTick(0, (cmd) => {
      got.push(cmd);
      q.push(cmd * 10);
      if (cmd === 1) expect(() => q.drainForTick(0, () => undefined)).toThrow(/re-entrant/);
    });
    expect(got).toEqual([1, 2]);
    // Nothing was lost: the pushes from inside the drain arrive next tick, and draining works again.
    const next: number[] = [];
    q.drainForTick(1, (cmd) => next.push(cmd));
    expect(next).toEqual([10, 20]);
  });

  it('is usable again after a handler throws', () => {
    const q = new CommandQueue<number>();
    q.push(1);
    expect(() =>
      q.drainForTick(0, () => {
        throw new Error('bad');
      }),
    ).toThrow('bad');
    q.push(2);
    const got: number[] = [];
    q.drainForTick(1, (cmd) => got.push(cmd));
    expect(got).toEqual([2]);
  });
});

describe('CommandRecorder', () => {
  it('records tick stamped commands and enforces order', () => {
    const rec = new CommandRecorder<Cmd>({ seed: 42 });
    rec.record(0, { kind: 'use', slot: 1 });
    rec.record(3, { kind: 'use', slot: 2 });
    rec.record(3, { kind: 'use', slot: 3 });
    expect(rec.length).toBe(3);
    expect(rec.lastTick).toBe(3);
    expect(() => rec.record(2, { kind: 'use', slot: 4 })).toThrow(RangeError);
    rec.setMeta('build', 'test');
    expect(rec.meta).toEqual({ seed: 42, build: 'test' });
    const json = rec.toJSON();
    expect(json.version).toBe(COMMAND_RECORDING_VERSION);
    expect(json.entries.length).toBe(3);
    rec.clear();
    expect(rec.length).toBe(0);
    expect(rec.lastTick).toBe(-1);
  });

  it('fromJSON validates structure and commands', () => {
    expect(() => CommandRecorder.fromJSON(null, parseCmd)).toThrow(TypeError);
    expect(() => CommandRecorder.fromJSON({ version: 2, meta: {}, entries: [] }, parseCmd)).toThrow(TypeError);
    expect(() => CommandRecorder.fromJSON({ version: 1, meta: { a: {} }, entries: [] }, parseCmd)).toThrow(TypeError);
    expect(() => CommandRecorder.fromJSON({ version: 1, meta: {}, entries: [{ tick: 'x', cmd: {} }] }, parseCmd)).toThrow(TypeError);
    expect(() => CommandRecorder.fromJSON({ version: 1, meta: {}, entries: [{ tick: 1, cmd: { kind: 'fly' } }] }, parseCmd)).toThrow(TypeError);
    expect(() =>
      CommandRecorder.fromJSON(
        {
          version: 1,
          meta: {},
          entries: [
            { tick: 2, cmd: { kind: 'use', slot: 1 } },
            { tick: 1, cmd: { kind: 'use', slot: 1 } },
          ],
        },
        parseCmd,
      ),
    ).toThrow(RangeError);
  });
});

describe('record → replay', () => {
  it('reproduces the identical command stream and simulation state', () => {
    const rng = new Rng(1234);
    const queue = new CommandQueue<Cmd>();
    const recorder = new CommandRecorder<Cmd>({ seed: 1234 });
    queue.setSink(recorder);
    const liveStream: Array<RecordedCommand<Cmd>> = [];
    const live = { x: 0, y: 0, used: 0, crafted: [] as string[] };
    for (let tick = 0; tick < 600; tick++) {
      // Input arrives irregularly: sometimes nothing, sometimes bursts.
      const burst = rng.bool(0.3) ? rng.int(1, 4) : 0;
      for (let i = 0; i < burst; i++) queue.push(randomCmd(rng));
      queue.drainForTick(tick, (cmd, t) => {
        liveStream.push({ tick: t, cmd });
        applyCmd(live, cmd, t);
      });
    }
    expect(recorder.length).toBe(liveStream.length);
    expect(recorder.length).toBeGreaterThan(100);

    const saved = JSON.stringify(recorder.toJSON());
    const loaded = CommandRecorder.fromJSON(JSON.parse(saved) as unknown, parseCmd);
    expect(loaded.meta).toEqual({ seed: 1234 });

    // Replay through a fresh queue (the regular input path).
    const player = new ReplayPlayer(loaded.toJSON());
    const replayQueue = new CommandQueue<Cmd>();
    const replayStream: Array<RecordedCommand<Cmd>> = [];
    const replay = { x: 0, y: 0, used: 0, crafted: [] as string[] };
    for (let tick = 0; tick < 600; tick++) {
      player.feed(tick, replayQueue);
      replayQueue.drainForTick(tick, (cmd, t) => {
        replayStream.push({ tick: t, cmd });
        applyCmd(replay, cmd, t);
      });
    }
    expect(player.done).toBe(true);
    expect(replayStream).toEqual(liveStream);
    expect(replay).toEqual(live);
  });

  it('ReplayPlayer delivers per tick, seeks, rewinds and detects desync', () => {
    const entries: Array<RecordedCommand<Cmd>> = [
      { tick: 1, cmd: { kind: 'use', slot: 1 } },
      { tick: 1, cmd: { kind: 'use', slot: 2 } },
      { tick: 4, cmd: { kind: 'use', slot: 3 } },
      { tick: 9, cmd: { kind: 'use', slot: 4 } },
    ];
    const player = new ReplayPlayer<Cmd>(entries);
    expect(player.nextTick).toBe(1);
    expect(player.lastTick).toBe(9);
    const got: number[] = [];
    const collect = (cmd: Cmd): void => {
      if (cmd.kind === 'use') got.push(cmd.slot);
    };
    expect(player.play(0, collect)).toBe(0);
    expect(player.play(1, collect)).toBe(2);
    expect(got).toEqual([1, 2]);
    expect(player.remaining).toBe(2);
    expect(() => player.play(5, collect)).toThrow(/desync/);
    player.seek(5);
    expect(player.nextTick).toBe(9);
    expect(player.play(9, collect)).toBe(1);
    expect(player.done).toBe(true);
    expect(player.nextTick).toBe(-1);
    player.rewind();
    expect(player.remaining).toBe(4);
    expect(new ReplayPlayer<Cmd>(new CommandRecorder<Cmd>()).done).toBe(true);
    expect(() => new ReplayPlayer<Cmd>([entries[2] as RecordedCommand<Cmd>, entries[0] as RecordedCommand<Cmd>])).toThrow(RangeError);
  });
});
