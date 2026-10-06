/**
 * A small test piece for the tracker tests (M7-03 … M7-05): two channels – a pulse lead (layer `melodie`, with echo) and a
 * falling-pitch drum (layer `basis`) – at 120 BPM and 4 rows per beat (one row = 4000 samples at 32 kHz), three patterns of
 * one bar: `a` (intro), `b` and `c` (the loop). Rendering it takes milliseconds. Also: a music worker driven by the test
 * (`FakeMusicWorker`) and the worker's protocol run to the end in Node (`pullThroughWorker`).
 */
import type { MusicWorkerLike } from '../../../src/audio/music/bank';
import { createMusicLibrary, type MusicLibrary } from '../../../src/audio/music/library';
import { MusicWorkerCore, type MusicWorkerReply, type MusicWorkerRequest } from '../../../src/audio/music/protocol';
import type { RenderedPiece } from '../../../src/audio/music/types';
import { n, PatternBuilder } from '../../../src/content/music/compose';
import { WAVETABLES, musicPieceSchema, type MusicArrangementKind, type MusicLayer, type MusicPiece, type MusicPieceInput } from '../../../src/content/music/index';

/** Instrument indices of the test piece. */
export const PULS = 0;
export const TROMMEL = 1;

/** Rows of every pattern. */
export const TEST_ROWS = 8;

function bar(id: string, lead: string, drums: string): ReturnType<PatternBuilder['build']> {
  const p = new PatternBuilder(id, TEST_ROWS, 2);
  p.line(0, PULS, lead);
  p.hits(1, TROMMEL, n('C2'), drums);
  return p.build();
}

/** The raw test piece (`patch` replaces top-level fields). */
export function testPieceInput(patch: Partial<MusicPieceInput> = {}): MusicPieceInput {
  return {
    id: 'testlied',
    titel: { de: 'Testlied', en: 'Test Song' },
    bpm: 120,
    zeilenJeSchlag: 4,
    instrumente: [
      { id: 'puls', welle: 'rechteck', tastgrad: 0.5, huellkurve: [0.002, 0.1, 0.6, 0.08], pegel: 0.6, pan: -0.3, echoSend: 0.4 },
      { id: 'trommel', welle: 'dreieck', huellkurve: [0.001, 0.12, 0, 0.05], pegel: 0.9, pan: 0, echoSend: 0, tonhoehenHuelle: { halbtoene: 24, sekunden: 0.05 } },
    ],
    patterns: [bar('a', 'C5:2 E5:2 G5:2 r:2', 'x...x...'), bar('b', 'A4:4 C5:2 r:2', 'x.o.x.o.'), bar('c', 'G4:2 B4:2 D5:4', 'x...xxo.')],
    arrangements: [{ art: 'standard', folge: ['a', 'b', 'c'], loopAb: 1 }],
    schichten: { basis: [1], melodie: [0], gefahr: [] },
    echo: { verzoegerungMs: 112, rueckkopplung: 0.4, fir: [0.5, 0.25, 0.125, 0.0625, 0, 0, 0, 0], pegel: 0.5 },
    zaehlt: false,
    ...patch,
  };
}

/** The validated test piece. */
export function testPiece(patch: Partial<MusicPieceInput> = {}): MusicPiece {
  return musicPieceSchema.parse(testPieceInput(patch));
}

/** The game's wavetables by id. */
export const TEST_TABLES: ReadonlyMap<string, readonly number[]> = new Map(WAVETABLES.map((t) => [t.id, t.werte]));

/** The test piece played once (`a`, `b`, no loop: no pre-roll – the cheapest render for the bank's tests). */
export function onceArrangement(): MusicPieceInput['arrangements'] {
  return [{ art: 'standard', folge: ['a', 'b'], loopAb: 2 }];
}

/**
 * A library that answers every piece id with the test piece (renamed): the bank and the runtime without the long pieces.
 * `loops` false: the pieces play once (no pre-roll).
 */
export function testLibrary(loops = true): MusicLibrary {
  const cache = new Map<string, MusicPiece>();
  return {
    piece(id) {
      let p = cache.get(id);
      if (p === undefined) {
        p = testPiece(loops ? { id } : { id, arrangements: onceArrangement() });
        cache.set(id, p);
      }
      return p;
    },
    tables: TEST_TABLES,
  };
}

/** The real library (the game's pieces). */
export function gameLibrary(): MusicLibrary {
  return createMusicLibrary();
}

/**
 * A music worker in the test's hands: requests queue up like messages to a real worker, `deliver()` answers them all with
 * the worker's own core (src/audio/music/protocol.ts) – between two frames, as the browser would.
 */
export class FakeMusicWorker implements MusicWorkerLike {
  onmessage: ((ev: MessageEvent<MusicWorkerReply>) => unknown) | null = null;
  readonly requests: MusicWorkerRequest[] = [];
  private inbox: MusicWorkerRequest[] = [];
  readonly core: MusicWorkerCore;

  constructor(library: MusicLibrary) {
    this.core = new MusicWorkerCore(library);
  }

  postMessage(message: MusicWorkerRequest): void {
    this.requests.push(message);
    this.inbox.push(message);
  }

  /** Answers every queued request; returns how many. */
  deliver(): number {
    const batch = this.inbox;
    this.inbox = [];
    for (const req of batch) {
      const reply = this.core.handle(req);
      if (reply !== null) this.onmessage?.(new MessageEvent('message', { data: reply }));
    }
    return batch.length;
  }
}

/**
 * The worker's whole protocol run in Node: render, then pull the stems in slices of `sliceFrames` and put them together –
 * what the page's buffers receive (tests compare its bits with `renderPiece`).
 */
export function pullThroughWorker(core: MusicWorkerCore, piece: string, arrangement: MusicArrangementKind, sliceFrames: number): RenderedPiece {
  const info = core.handle({ kind: 'render', id: 1, piece, arrangement });
  if (info === null || info.kind !== 'info') throw new Error(info?.kind === 'error' ? info.error : 'no info');
  const n = info.info.lengthSamples;
  const ch = info.info.channels;
  const stems: Partial<Record<MusicLayer, Float32Array>> = {};
  for (const layer of info.info.layers) stems[layer] = new Float32Array(ch * n);
  for (let from = 0; from < n; from += sliceFrames) {
    const reply = core.handle({ kind: 'slice', id: 1, from, to: from + sliceFrames });
    if (reply === null || reply.kind !== 'slice') throw new Error('no slice');
    const len = reply.to - reply.from;
    for (const layer of info.info.layers) {
      const part = reply.stems[layer] as Float32Array;
      for (let c = 0; c < ch; c++) (stems[layer] as Float32Array).set(part.subarray(c * len, (c + 1) * len), c * n + reply.from);
    }
  }
  const { layers: _layers, ...shape } = info.info;
  return { ...shape, stems };
}
