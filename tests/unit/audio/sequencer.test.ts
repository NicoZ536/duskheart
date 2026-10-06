/**
 * M7-03 Tracker/Sequencer (docs/SPIEL.md §24 "Tracker/Sequencer: Patterns, Kanäle, Instrumente …; im Browser im Worker
 * (`music.worker.ts`, Transferable)"; §28 "Musik-Rendering: Node und Worker bitgleich"):
 *
 * - the notation: cells parse and format back, a note names its instrument;
 * - timing: a row lasts `round(sr · 60 / (bpm · rowsPerBeat))` samples, notes start on their row's first sample;
 * - the tick effects: arpeggio (note, +x, +y per tick), portamento (xx/16 semitone per tick), vibrato; the echo send;
 * - determinism: the same piece renders the same bits (a golden hash pins them), however the render job's steps are spread;
 * - the worker protocol: the worker's whole job (`handleMusicRequest`) gives the same bits as Node, the stems are
 *   transferred; the bank uploads them in slices, falls back to the main thread with identical bits and keeps its budget.
 */
import { describe, expect, it } from 'vitest';
import { MusicBank, UPLOAD_FRAMES_PER_FRAME, musicKey, type MusicWorkerLike } from '../../../src/audio/music/bank';
import { handleMusicRequest, transferablesOf, type MusicRenderRequest, type MusicRenderResult } from '../../../src/audio/music/protocol';
import { MUSIC_SAMPLE_RATE, PieceRender, renderHash, renderPatterns, renderPiece, samplesPerRow } from '../../../src/audio/music/render';
import { NOTE_NONE, NOTE_OFF, FX_ARPEGGIO, FX_ECHO, formatCell, noteFrequency, parseCell, type TrackerCell } from '../../../src/content/music/notation';
import { n, PatternBuilder } from '../../../src/content/music/compose';
import type { MusicPiece } from '../../../src/content/music/schema';
import { FakeContext, type FakeBuffer } from './fakeAudio';
import { TEST_ROWS, TEST_TABLES, onceArrangement, testLibrary, testPiece, testPieceInput } from './musik-testlied';

/** The golden hash of the test piece's `standard` arrangement (any change of the synth's bits must be deliberate). */
const GOLDEN_TESTLIED = 'f7b23e4e';

/** A piece with one dry triangle voice (no echo) playing `pattern`. */
function dryPiece(pattern: ReturnType<PatternBuilder['build']>): MusicPiece {
  return testPiece({
    instrumente: [{ id: 'dreieck', welle: 'dreieck', huellkurve: [0.001, 0.01, 1, 0.01], pegel: 0.8, pan: 0, echoSend: 0 }],
    patterns: [pattern],
    arrangements: [{ art: 'standard', folge: [pattern.id], loopAb: 1 }],
    schichten: { basis: [], melodie: [0], gefahr: [] },
    echo: { verzoegerungMs: 16, rueckkopplung: 0, fir: [1, 0, 0, 0, 0, 0, 0, 0], pegel: 0 },
  });
}

/** Frequency of the left channel between samples `from` and `to` from interpolated rising zero crossings [Hz]. */
function frequency(stem: Float32Array, from: number, to: number, sr = MUSIC_SAMPLE_RATE): number {
  const crossings: number[] = [];
  for (let i = from + 1; i < to; i++) {
    const a = stem[i - 1] as number;
    const b = stem[i] as number;
    if (a < 0 && b >= 0) crossings.push(i - 1 + a / (a - b));
  }
  if (crossings.length < 2) return 0;
  return ((crossings.length - 1) / ((crossings.at(-1) as number) - (crossings[0] as number))) * sr;
}

const semitones = (f: number, ref: number): number => 12 * Math.log2(f / ref);

describe('Notation', () => {
  it('Zellen lesen sich und schreiben sich zurück; eine Note nennt ihr Instrument', () => {
    const cell: TrackerCell = { note: 0, inst: 0, vol: 0, fx: 0, param: 0 };
    for (const text of ['C-4 00 40 ...', 'A#3 0F 20 037', '=== .. .. ...', '--- .. 10 E40', 'G-5 01 .. 308']) {
      expect(parseCell(text, cell)).toBeNull();
      expect(formatCell(cell)).toBe(text);
    }
    expect(parseCell('C-4 .. 40 ...', cell)).toMatch(/names its instrument/);
    expect(parseCell('H-4 00 40 ...', cell)).toMatch(/bad note/);
    expect(parseCell('C-4 00 41 ...', cell)).toMatch(/bad volume/);
    expect(parseCell('C-4 00 40 X12', cell)).toMatch(/bad effect/);
    expect(parseCell('C-4 00 40', cell)).toMatch(/not "NOT II VV FXX"/);
    parseCell('=== .. .. ...', cell);
    expect(cell.note).toBe(NOTE_OFF);
    parseCell('--- .. .. 047', cell);
    expect([cell.note, cell.fx, cell.param]).toEqual([NOTE_NONE, FX_ARPEGGIO, 0x47]);
    parseCell('--- .. .. E20', cell);
    expect([cell.fx, cell.param]).toEqual([FX_ECHO, 0x20]);
    expect(noteFrequency(n('A4'))).toBe(440);
    expect(noteFrequency(n('C4'))).toBeCloseTo(261.63, 2);
  });
});

describe('Zeitraster', () => {
  it('eine Zeile dauert round(sr·60/(bpm·Zeilen je Schlag)) Samples; Trommelschläge setzen auf der ersten Probe ihrer Zeile ein', () => {
    const piece = testPiece();
    const spr = samplesPerRow(piece);
    expect(spr).toBe(4000);
    expect(samplesPerRow({ bpm: 100, zeilenJeSchlag: 4 })).toBe(Math.round((32000 * 60) / 400));
    const r = renderPatterns(piece, ['a'], TEST_TABLES);
    expect(r.lengthSamples).toBe(TEST_ROWS * spr);
    const drums = r.stems.basis as Float32Array;
    // `x...x...`: hits on rows 0 and 4; silence just before row 4's first sample (the first hit has died away).
    const onset = (from: number): number => {
      for (let i = from; i < from + spr; i++) if (Math.abs(drums[i] as number) > 1e-4) return i;
      return -1;
    };
    expect(onset(0)).toBeLessThanOrEqual(2);
    for (let i = 4 * spr - 200; i < 4 * spr; i++) expect(Math.abs(drums[i] as number)).toBeLessThan(1e-4);
    expect(onset(4 * spr - 200)).toBeGreaterThanOrEqual(4 * spr);
    expect(onset(4 * spr - 200)).toBeLessThanOrEqual(4 * spr + 2);
  });
});

describe('Tick-Effekte', () => {
  const spr = 4000;
  const tick = spr / 6;
  /** Frequency of tick `t` of row `row` (the middle of the tick, the edges left out). */
  const tickFreq = (stem: Float32Array, row: number, t: number): number => frequency(stem, Math.floor(row * spr + t * tick) + 60, Math.floor(row * spr + (t + 1) * tick) - 20);

  it('Arpeggio 0xy: Grundton, +x, +y je Tick', () => {
    const p = new PatternBuilder('arp', 2, 1);
    p.note(0, 0, n('A4'), 0, { fx: '037' });
    p.fx(0, 1, '037');
    const stem = renderPatterns(dryPiece(p.build()), ['arp'], TEST_TABLES).stems.melodie as Float32Array;
    const expected = [0, 3, 7, 0, 3, 7];
    for (let t = 0; t < 6; t++) expect(semitones(tickFreq(stem, 1, t), 440), `tick ${t}`).toBeCloseTo(expected[t] as number, 1);
  });

  it('Portamento 3xx gleitet xx/16 Halbtöne je Tick zum Ziel, ohne neuen Anschlag; Vibrato 4xy schwingt um den Ton', () => {
    const p = new PatternBuilder('porta', 3, 1);
    p.note(0, 0, n('C5'), 0);
    p.note(0, 1, n('E5'), 0, { fx: '308' });
    p.note(0, 2, n('E5'), 0, { fx: '4F8' });
    const stem = renderPatterns(dryPiece(p.build()), ['porta'], TEST_TABLES).stems.melodie as Float32Array;
    const c5 = noteFrequency(n('C5'));
    expect(semitones(tickFreq(stem, 0, 3), c5)).toBeCloseTo(0, 1);
    // Half a semitone per tick: after tick t of the slide row the note stands t/2 + 0.5 above C5.
    for (let t = 0; t < 6; t++) expect(semitones(tickFreq(stem, 1, t), c5), `tick ${t}`).toBeCloseTo((t + 1) * 0.5, 1);
    // No new attack: the level does not drop to zero at the slide's start.
    let min = Infinity;
    for (let i = spr - 40; i < spr + 40; i++) min = Math.min(min, Math.abs(stem[i] as number) + Math.abs(stem[i + 20] as number));
    expect(min).toBeGreaterThan(0.01);
    // Vibrato: the pitch moves around E5, up and down.
    const e5 = noteFrequency(n('E5'));
    const devs = [0, 1, 2, 3, 4, 5].map((t) => semitones(tickFreq(stem, 2, t), e5));
    expect(Math.max(...devs)).toBeGreaterThan(0.1);
    expect(Math.min(...devs)).toBeLessThan(0.1);
    for (const d of devs) expect(Math.abs(d)).toBeLessThan(1.2);
  });

  it('Exx schickt die Stimme ins Echo: eine Kopie nach der Echoverzögerung', () => {
    const p = new PatternBuilder('echo', 4, 1);
    p.note(0, 0, n('A4'), 0, { fx: 'E40' });
    p.off(0, 1);
    const pat = p.build();
    const base = dryPiece(pat);
    const wet = testPiece({ ...testPieceInput(), instrumente: base.instrumente as never, patterns: [pat], arrangements: [{ art: 'standard', folge: ['echo'], loopAb: 1 }], schichten: { basis: [], melodie: [0], gefahr: [] }, echo: { verzoegerungMs: 160, rueckkopplung: 0, fir: [1, 0, 0, 0, 0, 0, 0, 0], pegel: 1 } });
    const dry = renderPatterns(base, ['echo'], TEST_TABLES).stems.melodie as Float32Array;
    const echoed = renderPatterns(wet, ['echo'], TEST_TABLES).stems.melodie as Float32Array;
    const delay = Math.round(0.16 * MUSIC_SAMPLE_RATE);
    // Before the echo returns both renders are the same; afterwards the echo adds the delayed note.
    let before = 0;
    for (let i = 0; i < delay; i++) before = Math.max(before, Math.abs((echoed[i] as number) - (dry[i] as number)));
    expect(before).toBeLessThan(1e-9);
    let after = 0;
    for (let i = delay; i < delay + spr; i++) after = Math.max(after, Math.abs((echoed[i] as number) - (dry[i] as number)));
    expect(after).toBeGreaterThan(0.1);
  });
});

describe('Determinismus und Worker', () => {
  it('dasselbe Stück gibt dieselben Bits (Goldener Hash), gleich wie die Schritte des Auftrags verteilt sind', () => {
    const piece = testPiece();
    const a = renderPiece(piece, 'standard', TEST_TABLES);
    expect(renderHash(a)).toBe(GOLDEN_TESTLIED);
    // A fresh piece object, and two jobs stepped in turns (a page without a worker renders between frames): the same bits.
    const j1 = new PieceRender(testPiece(), 'standard', TEST_TABLES);
    const j2 = new PieceRender(testPiece({ id: 'zwei', arrangements: onceArrangement() }), 'standard', TEST_TABLES);
    while (!j1.done || !j2.done) {
      j1.step();
      j2.step();
    }
    expect(renderHash(j1.result())).toBe(renderHash(a));
    expect(a.loopStartSample).toBe(TEST_ROWS * 4000);
    expect(a.lengthSamples).toBe(3 * TEST_ROWS * 4000);
    expect(a.channels).toBe(2);
  });

  it('der Auftrag des Workers (handleMusicRequest) gibt die Bits von Node; die Stems werden übertragen', () => {
    const lib = testLibrary();
    const res = handleMusicRequest({ id: 7, piece: 'testlied', arrangement: 'standard' }, lib);
    if (!('rendered' in res)) throw new Error(res.error);
    expect(res.id).toBe(7);
    expect(renderHash(res.rendered)).toBe(renderHash(renderPiece(testPiece(), 'standard', TEST_TABLES)));
    const transfer = transferablesOf(res);
    expect(transfer).toHaveLength(2);
    expect(transfer).toContain(res.rendered.stems.basis?.buffer);
    expect(transfer).toContain(res.rendered.stems.melodie?.buffer);
    const unknown = handleMusicRequest({ id: 8, piece: 'gibtsnicht', arrangement: 'standard' }, { piece: () => undefined, tables: TEST_TABLES });
    expect(unknown).toEqual({ id: 8, error: 'unbekanntes Musikstück „gibtsnicht“' });
    expect(transferablesOf(unknown)).toEqual([]);
  });

  it('die Bank fragt den Worker, lädt die Stems scheibchenweise hoch; ohne Worker rendert sie in Schritten dieselben Bits', () => {
    const lib = testLibrary();
    const requests: MusicRenderRequest[] = [];
    const worker: MusicWorkerLike = { onmessage: null, postMessage: (m) => requests.push(m) };
    const ctx = new FakeContext();
    const bank = new MusicBank(ctx, { createWorker: () => worker });
    expect(bank.get('testlied', 'standard')).toBeNull();
    expect(requests).toEqual([{ id: 1, piece: 'testlied', arrangement: 'standard' }]);
    // Asking again does not ask the worker again.
    bank.prepare('testlied', 'standard');
    expect(requests).toHaveLength(1);
    const answer: MusicRenderResult = handleMusicRequest(requests[0] as MusicRenderRequest, lib);
    worker.onmessage?.(new MessageEvent('message', { data: answer }));
    const length = 3 * TEST_ROWS * 4000;
    const keep = new Set<string>();
    let frames = 0;
    while (!bank.isLoaded('testlied', 'standard')) {
      bank.frame(keep);
      frames++;
      expect(frames).toBeLessThan(10);
    }
    expect(frames).toBe(Math.ceil((2 * length) / UPLOAD_FRAMES_PER_FRAME));
    const loaded = bank.get('testlied', 'standard');
    expect(loaded?.key).toBe(musicKey('testlied', 'standard'));
    expect(loaded?.loops).toBe(true);
    expect(loaded?.loopStart).toBeCloseTo((TEST_ROWS * 4000) / MUSIC_SAMPLE_RATE);
    expect(loaded?.loopEnd).toBeCloseTo(length / MUSIC_SAMPLE_RATE);
    const viaWorker = loaded?.buffers.melodie as unknown as FakeBuffer;
    expect(viaWorker.numberOfChannels).toBe(2);
    // Without a worker: the same render as small steps on the main thread, the same bits in the buffers.
    const ctx2 = new FakeContext();
    const fallback = new MusicBank(ctx2, { createWorker: null, library: lib });
    fallback.get('testlied', 'standard');
    let steps = 0;
    while (!fallback.isLoaded('testlied', 'standard')) {
      fallback.frame(keep);
      steps++;
      expect(steps).toBeLessThan(50);
    }
    expect(steps).toBeGreaterThan(3);
    const viaMain = fallback.get('testlied', 'standard')?.buffers.melodie as unknown as FakeBuffer;
    for (const ch of [0, 1]) expect(Buffer.from((viaMain.channels[ch] as Float32Array).buffer).equals(Buffer.from((viaWorker.channels[ch] as Float32Array).buffer))).toBe(true);
    // A worker that cannot start: the main thread renders.
    const broken = new MusicBank(new FakeContext(), {
      createWorker: () => {
        throw new Error('no workers here');
      },
      library: testLibrary(false),
    });
    broken.get('testlied', 'standard');
    for (let i = 0; i < 50 && !broken.isLoaded('testlied', 'standard'); i++) broken.frame(keep);
    expect(broken.isLoaded('testlied', 'standard')).toBe(true);
  });

  it('die Bank hält ihr Speicherbudget: die am längsten ungenutzten, nicht gehaltenen Stücke gehen', () => {
    const lib = testLibrary(false);
    const r = renderPiece(lib.piece('eins') as MusicPiece, 'standard', TEST_TABLES);
    // Two stereo stems of float samples.
    const piece = r.lengthSamples * 2 * 2 * 4;
    const bank = new MusicBank(new FakeContext(), { createWorker: null, library: lib, budgetBytes: 2 * piece });
    const keep = new Set<string>([musicKey('eins', 'standard')]);
    const load = (id: string): void => {
      bank.get(id, 'standard');
      for (let i = 0; i < 50 && !bank.isLoaded(id, 'standard'); i++) bank.frame(keep);
      expect(bank.isLoaded(id, 'standard')).toBe(true);
    };
    load('eins');
    load('zwei');
    load('drei');
    // Three pieces over a budget of two: the least recently used one not kept (`zwei`) went.
    expect(bank.bytes).toBe(2 * piece);
    expect(bank.isLoaded('eins', 'standard')).toBe(true);
    expect(bank.isLoaded('zwei', 'standard')).toBe(false);
    expect(bank.isLoaded('drei', 'standard')).toBe(true);
  });
});
