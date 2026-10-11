/**
 * M7-81 (MASTERPROMPT §27 „Musik … im Worker gerendert“, §30 Budgets; docs/SPIEL.md §24): the music worker renders in turns
 * (`PacedMusicWorker`, src/audio/music/protocol.ts). Right after the audio unlock the first piece took a whole core for a
 * second (1.8 s on a loaded machine) while the software rasteriser drew no frame – the figure of `spieler-bewegung.spec.ts`
 * fell 32 px behind the simulation.
 *
 * - The bits: the paced worker answers with the info and the slices of the synchronous core (`MusicWorkerCore.handle`), which
 *   the integration test compares with Node's render.
 * - The turns: a job steps until `MUSIC_RENDER_TURN_MS` are used, then rests as long as the turn took, at least
 *   `MUSIC_RENDER_REST_MS` (about half a core, however long a step – a pattern – takes); steps that take no time all run in
 *   one turn.
 * - The queue: renders run in the order asked for; a drop forgets a job that has not finished; an unknown piece is an error at
 *   once; slices are answered at once.
 */
import { describe, expect, it } from 'vitest';
import { MUSIC_RENDER_REST_MS, MUSIC_RENDER_TURN_MS, MusicWorkerCore, PacedMusicWorker, type MusicWorkerReply } from '../../../src/audio/music/protocol';
import { PieceRender } from '../../../src/audio/music/render';
import { TEST_TABLES, testLibrary, testPiece } from './musik-testlied';

/** The worker's timer by hand: turns wait in a queue with the rest they asked for. */
class Timers {
  readonly queue: { fn: () => void; ms: number }[] = [];
  readonly schedule = (fn: () => void, ms: number): void => {
    this.queue.push({ fn, ms });
  };
  /** Runs every turn until none is left; returns the rests asked for, in order. */
  drain(): number[] {
    const rests: number[] = [];
    for (let guard = 0; this.queue.length > 0; guard++) {
      if (guard > 100_000) throw new Error('kein Ende');
      const t = this.queue.shift() as { fn: () => void; ms: number };
      rests.push(t.ms);
      t.fn();
    }
    return rests;
  }
}

/** A clock that moves `perRead` ms with every read (the work a step takes, as the worker sees it). */
function clock(perRead: number): () => number {
  let t = 0;
  return () => (t += perRead);
}

/** Steps a render of the test piece takes (`PieceRender.step` until done). */
function stepsOfTestPiece(): number {
  const job = new PieceRender(testPiece(), 'standard', TEST_TABLES);
  let steps = 1;
  while (job.step()) steps++;
  return steps;
}

describe('Musik-Worker in Takten (M7-81)', () => {
  it('antwortet mit den Bits des Kerns: dieselbe Gestalt, dieselben Scheiben', () => {
    const lib = testLibrary();
    const replies: MusicWorkerReply[] = [];
    const timers = new Timers();
    const paced = new PacedMusicWorker(new MusicWorkerCore(lib), (r) => replies.push(r), timers.schedule, clock(5));
    const core = new MusicWorkerCore(lib);
    paced.handle({ kind: 'render', id: 3, piece: 'testlied', arrangement: 'standard' });
    expect(replies).toEqual([]);
    timers.drain();
    const expected = core.handle({ kind: 'render', id: 3, piece: 'testlied', arrangement: 'standard' });
    expect(replies).toEqual([expected]);
    if (expected === null || expected.kind !== 'info') throw new Error('keine Gestalt');
    // Slices at once, byte for byte the core's.
    const n = expected.info.lengthSamples;
    for (const [from, to] of [
      [0, 7777],
      [7777, n - 100],
      [n - 100, n],
    ] as const) {
      paced.handle({ kind: 'slice', id: 3, from, to });
      const mine = replies[replies.length - 1];
      const theirs = core.handle({ kind: 'slice', id: 3, from, to });
      if (mine?.kind !== 'slice' || theirs?.kind !== 'slice') throw new Error('keine Scheibe');
      expect([mine.from, mine.to]).toEqual([theirs.from, theirs.to]);
      for (const layer of expected.info.layers) expect(Buffer.from((mine.stems[layer] as Float32Array).buffer).equals(Buffer.from((theirs.stems[layer] as Float32Array).buffer)), layer).toBe(true);
    }
    expect(timers.queue).toHaveLength(0);
  });

  it('ein Takt rechnet, bis seine Zeit um ist, dann ruht der Worker so lange, wie er rechnete; ohne verbrauchte Zeit reicht ein Takt', () => {
    const steps = stepsOfTestPiece();
    expect(steps).toBeGreaterThan(2);
    expect(MUSIC_RENDER_REST_MS).toBeGreaterThan(0);
    // Every step uses a whole turn: one step a turn, the first turn at once, every later one after the shortest rest.
    const slow = new Timers();
    const slowReplies: MusicWorkerReply[] = [];
    new PacedMusicWorker(new MusicWorkerCore(testLibrary()), (r) => slowReplies.push(r), slow.schedule, clock(MUSIC_RENDER_TURN_MS)).handle({ kind: 'render', id: 1, piece: 'testlied', arrangement: 'standard' });
    expect(slow.drain()).toEqual([0, ...Array.from({ length: steps - 1 }, () => Math.max(MUSIC_RENDER_TURN_MS, MUSIC_RENDER_REST_MS))]);
    expect(slowReplies.map((r) => r.kind)).toEqual(['info']);
    // A step five turns long (a pattern on a slow machine): the rest after it is as long.
    const long = new Timers();
    new PacedMusicWorker(new MusicWorkerCore(testLibrary()), () => undefined, long.schedule, clock(5 * MUSIC_RENDER_TURN_MS)).handle({ kind: 'render', id: 1, piece: 'testlied', arrangement: 'standard' });
    expect(long.drain()).toEqual([0, ...Array.from({ length: steps - 1 }, () => 5 * MUSIC_RENDER_TURN_MS)]);
    // Steps that take no time: one turn renders the whole piece.
    const fast = new Timers();
    const fastReplies: MusicWorkerReply[] = [];
    new PacedMusicWorker(new MusicWorkerCore(testLibrary()), (r) => fastReplies.push(r), fast.schedule, () => 0).handle({ kind: 'render', id: 1, piece: 'testlied', arrangement: 'standard' });
    expect(fast.drain()).toEqual([0]);
    expect(fastReplies).toEqual(slowReplies);
  });

  it('Aufträge der Reihe nach; ein Verwerfen vergisst einen unfertigen; ein unbekanntes Stück ist sofort ein Fehler', () => {
    const replies: MusicWorkerReply[] = [];
    const timers = new Timers();
    // A library that knows only the test piece (`testLibrary` answers every id).
    const lib = testLibrary();
    const only = { piece: (id: string) => (id === 'testlied' ? lib.piece(id) : undefined), tables: lib.tables };
    const paced = new PacedMusicWorker(new MusicWorkerCore(only), (r) => replies.push(r), timers.schedule, clock(MUSIC_RENDER_TURN_MS));
    paced.handle({ kind: 'render', id: 1, piece: 'testlied', arrangement: 'standard' });
    paced.handle({ kind: 'render', id: 2, piece: 'testlied', arrangement: 'standard' });
    paced.handle({ kind: 'render', id: 3, piece: 'testlied', arrangement: 'standard' });
    // Only one turn is ever waiting.
    expect(timers.queue).toHaveLength(1);
    paced.handle({ kind: 'render', id: 4, piece: 'gibtsnicht', arrangement: 'standard' });
    expect(replies).toEqual([{ kind: 'error', id: 4, error: 'unbekanntes Musikstück „gibtsnicht“' }]);
    expect(paced.waiting).toBe(3);
    paced.handle({ kind: 'drop', id: 2 });
    expect(paced.waiting).toBe(2);
    timers.drain();
    expect(replies.map((r) => [r.kind, r.id])).toEqual([
      ['error', 4],
      ['info', 1],
      ['info', 3],
    ]);
    expect(paced.waiting).toBe(0);
    // The dropped render is not kept: its slice is an error.
    paced.handle({ kind: 'slice', id: 2, from: 0, to: 10 });
    expect(replies[replies.length - 1]).toEqual({ kind: 'error', id: 2, error: 'Musik: kein Render 2' });
  });
});
