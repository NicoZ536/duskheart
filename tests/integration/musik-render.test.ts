/**
 * M7-03/M7-05 Ganze Musikstücke (docs/SPIEL.md §24 "ganze Stücke nur in tests/integration/musik-render.test.ts", §28
 * "Musik-Rendering: Node und Worker bitgleich"; MASTERPROMPT §27 "1,5–3 min, loopbar"): every arrangement of every piece –
 * the five counted pieces, the stingers, the songs – rendered whole at 32 kHz, the way the worker renders it when a mood
 * first asks for it.
 *
 * - level: finite samples, the mix's peak at most `MUSIC_PEAK_CEILING`, its RMS at `MUSIC_LOUDNESS` (or held back by the
 *   peak ceiling), no DC; every layer the piece declares carries sound;
 * - identity: two renders, the worker's whole protocol (`MusicWorkerCore` on a fresh library: render, then the stems pulled in
 *   the bank's slices and put together) and a job stepped in turns with another give the same bits (`renderHash`); the
 *   arrangements of one piece differ;
 * - loop: the whole loop body of the file is what continuous play gives after the body's own end (intro, then the body three
 *   times) – to float precision, so the jump from the file's end to its loop start is no seam; stingers end in silence.
 *
 * - the frame: once the music plays, a frame of the audio (`attachAudio(…).frame()`: listener, occlusion, room, loops,
 *   ambience, music director, bank, player) allocates nothing – sampled heap profile, median of three windows after re-warming
 *   (the method of tests/unit/render/kampf-ruhe.test.ts, ADR-0203). The render bench never unlocks the audio, so this is
 *   where its frame is measured.
 *
 * Unit tests check only the bars around the loop points (tests/unit/audio/musik-loop.test.ts) and short patterns
 * (sequencer.test.ts); this sweep lives in the integration project (ADR-0192), `npm run verify` runs it.
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation } from '../../tools/bench/heap';
import { attachAudio, type AudioSession } from '../../src/audio/runtime';
import { createSettingsStore } from '../../src/engine/settings';
import type { SessionFocus } from '../../src/game/session';
import type { SimEventMap, Simulation } from '../../src/game/sim';
import { TILE_PX } from '../../src/world/model/coords';
import { FakeContext } from '../unit/audio/fakeAudio';
import { lightWorld } from '../unit/game/licht-testwelt';
import { OFFSET, meadow } from '../unit/game/spieler-testwelt';
import { createMusicLibrary } from '../../src/audio/music/library';
import { MusicWorkerCore } from '../../src/audio/music/protocol';
import { MUSIC_LOUDNESS, MUSIC_PEAK_CEILING, MUSIC_SAMPLE_RATE, PieceRender, renderHash, renderPatterns, renderPiece } from '../../src/audio/music/render';
import type { RenderedPiece } from '../../src/audio/music/types';
import { UPLOAD_FRAMES_PER_FRAME } from '../../src/audio/music/bank';
import { COUNTED_PIECE_MAX_SECONDS, COUNTED_PIECE_MIN_SECONDS, MUSIC_LAYERS, MUSIC_PIECES, type MusicPiece } from '../../src/content/music/index';
import { FakeMusicWorker, pullThroughWorker, testLibrary } from '../unit/audio/musik-testlied';

const library = createMusicLibrary();
const PIECES: readonly MusicPiece[] = MUSIC_PIECES.map((p) => library.piece(p.id) as MusicPiece);
const CASES = PIECES.flatMap((p) => p.arrangements.map((a) => [`${p.id}/${a.art}`, p, a.art] as const));

/** Mix of every stem: left and right channel. */
function mix(r: RenderedPiece): { L: Float64Array; R: Float64Array } {
  const n = r.lengthSamples;
  const L = new Float64Array(n);
  const R = new Float64Array(n);
  for (const s of Object.values(r.stems)) {
    if (s === undefined) continue;
    for (let i = 0; i < n; i++) {
      L[i] = (L[i] as number) + (s[i] as number);
      R[i] = (R[i] as number) + (s[n + i] as number);
    }
  }
  return { L, R };
}

/** Renders once per case (the checks below share the renders). */
const renders = new Map<string, RenderedPiece>();
function rendered(name: string, piece: MusicPiece, art: MusicPiece['arrangements'][number]['art']): RenderedPiece {
  let r = renders.get(name);
  if (r === undefined) {
    r = renderPiece(piece, art, library.tables);
    renders.set(name, r);
  }
  return r;
}

describe('Ganze Stücke: Pegel', () => {
  it.each(CASES)('%s: endlich, Spitze ≤ Decke, Lautheit wie verlangt, kein Gleichanteil, jede Schicht klingt', (name, piece, art) => {
    const r = rendered(name, piece, art);
    expect(r.sampleRate).toBe(MUSIC_SAMPLE_RATE);
    expect(r.channels).toBe(2);
    const declared = MUSIC_LAYERS.filter((l) => piece.schichten[l].length > 0);
    expect(Object.keys(r.stems).sort()).toEqual([...declared].sort());
    const { L, R } = mix(r);
    let peak = 0;
    let sum = 0;
    let dc = 0;
    let nonFinite = 0;
    for (let i = 0; i < r.lengthSamples; i++) {
      const l = L[i] as number;
      const rr = R[i] as number;
      if (!Number.isFinite(l) || !Number.isFinite(rr)) nonFinite++;
      peak = Math.max(peak, Math.abs(l), Math.abs(rr));
      sum += l * l + rr * rr;
      dc += l + rr;
    }
    expect(nonFinite).toBe(0);
    expect(peak).toBeLessThanOrEqual(MUSIC_PEAK_CEILING + 1e-5);
    const rms = Math.sqrt(sum / (2 * r.lengthSamples));
    if (peak < MUSIC_PEAK_CEILING - 1e-3) expect(rms).toBeCloseTo(MUSIC_LOUDNESS, 4);
    // Held back by the peak ceiling: still within 4,4 dB of the target (a solo lute that rang too short fell 8 dB below).
    else expect(rms).toBeGreaterThan(MUSIC_LOUDNESS * 0.6);
    expect(Math.abs(dc / (2 * r.lengthSamples))).toBeLessThan(0.005);
    // Every declared layer sounds on its own (a stem of silence would be a wasted buffer and a dead mood).
    for (const layer of declared) {
      const s = r.stems[layer] as Float32Array;
      let lp = 0;
      for (let i = 0; i < s.length; i++) lp = Math.max(lp, Math.abs(s[i] as number));
      expect(lp, `${name}: Schicht ${layer}`).toBeGreaterThan(0.02);
    }
    if (piece.zaehlt) {
      const seconds = r.lengthSamples / r.sampleRate;
      expect(seconds).toBeGreaterThanOrEqual(COUNTED_PIECE_MIN_SECONDS);
      expect(seconds).toBeLessThanOrEqual(COUNTED_PIECE_MAX_SECONDS);
    }
  });
});

describe('Ganze Stücke: Identität (Node ≡ Worker)', () => {
  it.each(CASES)('%s: zweimal gerendert, als Auftrag des Workers und verschränkt gestept – dieselben Bits', (name, piece, art) => {
    const first = renderHash(rendered(name, piece, art));
    expect(renderHash(renderPiece(piece, art, library.tables))).toBe(first);
    // The worker's whole job, on its own library (the worker builds one from the same content), pulled in the bank's slices.
    const core = new MusicWorkerCore(createMusicLibrary());
    const viaWorker = pullThroughWorker(core, piece.id, art, UPLOAD_FRAMES_PER_FRAME / 2);
    expect(viaWorker.arrangement).toBe(art);
    expect(renderHash(viaWorker)).toBe(first);
    expect(core.pending).toBe(0);
    // A page without a worker steps the job between frames, beside another job: the same bits.
    const other = PIECES.find((p) => p.id !== piece.id && p.zaehlt) as MusicPiece;
    const a = new PieceRender(piece, art, library.tables);
    const b = new PieceRender(other, other.arrangements[0]?.art ?? 'standard', library.tables);
    let more = true;
    while (more) {
      more = a.step();
      b.step();
    }
    expect(renderHash(a.result())).toBe(first);
  });

  it('die Arrangements eines Stücks klingen verschieden (Grünhain: Tag ≠ Nacht)', () => {
    for (const piece of PIECES) {
      const hashes = new Set(piece.arrangements.map((a) => renderHash(rendered(`${piece.id}/${a.art}`, piece, a.art))));
      expect(hashes.size, piece.id).toBe(piece.arrangements.length);
    }
    const gruenhain = PIECES.find((p) => p.id === 'gruenhain') as MusicPiece;
    expect(gruenhain.arrangements.map((a) => a.art).sort()).toEqual(['nacht', 'tag']);
  });
});

describe('Ganze Stücke: Schleife', () => {
  const looping = CASES.filter(([, piece, art]) => {
    const a = piece.arrangements.find((x) => x.art === art);
    return a !== undefined && a.loopAb < a.folge.length;
  });

  it('jedes gezählte Stück und jedes Lied schleift; jeder Stinger spielt einmal', () => {
    for (const piece of PIECES) {
      for (const a of piece.arrangements) {
        const loops = a.loopAb < a.folge.length;
        const stinger = !piece.zaehlt && !loops;
        expect(loops || stinger, `${piece.id}/${a.art}`).toBe(true);
        if (piece.zaehlt) expect(loops, `${piece.id}/${a.art}`).toBe(true);
      }
    }
    expect(looping.length).toBeGreaterThanOrEqual(6);
  });

  it.each(looping)('%s: der ganze Schleifenkörper der Datei ist, was in durchgehendem Spiel auf sein Ende folgt', (name, piece, art) => {
    const file = rendered(name, piece, art);
    const a = piece.arrangements.find((x) => x.art === art) as MusicPiece['arrangements'][number];
    const intro = a.folge.slice(0, a.loopAb);
    const body = a.folge.slice(a.loopAb);
    // Continuous play from silence: the intro, then the body three times; the third pass is the reference.
    const ref = renderPatterns(piece, [...intro, ...body, ...body, ...body], library.tables);
    const f = mix(file).L;
    const r = mix(ref).L;
    const start = file.loopStartSample;
    const len = file.lengthSamples - start;
    const off = start + 2 * len;
    expect(ref.lengthSamples).toBe(start + 3 * len);
    // The file is normalised with one gain: find it, then compare the whole body.
    let num = 0;
    let den = 0;
    for (let i = 0; i < len; i++) {
      num += (f[start + i] as number) * (r[off + i] as number);
      den += (r[off + i] as number) ** 2;
    }
    const g = num / den;
    let peak = 0;
    let err = 0;
    for (let i = 0; i < len; i++) {
      peak = Math.max(peak, Math.abs(f[start + i] as number));
      err = Math.max(err, Math.abs((f[start + i] as number) - g * (r[off + i] as number)));
    }
    expect(peak).toBeGreaterThan(0.05);
    expect(err / peak, `${name}: ${err.toExponential(2)}`).toBeLessThan(1e-5);
    // The seam: the file's last sample and its loop start are neighbours in continuous play – the jump between them is an
    // ordinary step of the music, not a click.
    const jump = Math.abs((f[file.lengthSamples - 1] as number) - (f[start] as number));
    const refJump = Math.abs(g * ((r[off - 1] as number) - (r[off] as number)));
    expect(Math.abs(jump - refJump) / peak).toBeLessThan(1e-5);
  });
});

/** A session over a drawn world: the player stands in it, no events. */
class QuietSession implements AudioSession {
  constructor(readonly sim: Simulation) {}
  onEvent<K extends keyof SimEventMap>(_type: K, _handler: (payload: SimEventMap[K]) => void): () => void {
    return () => undefined;
  }
  sampleFocus(out: SessionFocus): boolean {
    out.x = (OFFSET + 10.5) * TILE_PX;
    out.y = (OFFSET + 10.5) * TILE_PX;
    out.layer = 0;
    return true;
  }
}

describe('Laufzeit: ein Frame der Audio, während Musik spielt, ohne Allokation', () => {
  let inspector: Session;
  beforeAll(async () => {
    inspector = new Session();
    inspector.connect();
    await inspector.post('HeapProfiler.enable');
  });
  afterAll(() => inspector.disconnect());

  /** Frames per sampled window, the re-warm before it (after the forced collection) and the pause for the compiler. */
  const WINDOW_FRAMES = 2000;
  const REWARM_FRAMES = 6000;
  const INSTALL_FRAMES = 100;
  const COMPILER_PAUSE_MS = 200;
  const WINDOWS = 3;
  /** Limit [B per frame]: one number boxed every frame (16 B) would exceed it eight times. */
  const MAX_BYTES_PER_FRAME = 2;

  it('Hörer, Verdeckung, Raum, Schleifen, Umgebung, Musik: 0 B je Frame (Median dreier Fenster)', async () => {
    const w = lightWorld(meadow(24, 24));
    w.spawn(10, 10);
    const ctx = new FakeContext();
    const gestures = new EventTarget();
    const worker = new FakeMusicWorker(testLibrary());
    const audio = attachAudio({ session: new QuietSession(w.sim), settings: createSettingsStore(null), gestureTarget: gestures, createContext: () => ctx, createWorker: null, createMusicWorker: () => worker, schedule: () => undefined });
    gestures.dispatchEvent(new Event('keydown'));
    const frames = (n: number): void => {
      for (let i = 0; i < n; i++) {
        ctx.currentTime += 1 / 60;
        audio.frame();
        worker.deliver();
      }
    };
    frames(3000);
    // The exploration piece plays: its two stems loop.
    expect(ctx.sources.filter((s) => s.loop && s.startedAt !== null && s.stoppedAt === null)).toHaveLength(2);
    const perFrame: number[] = [];
    const tops: string[] = [];
    for (let k = 0; k < WINDOWS; k++) {
      await inspector.post('HeapProfiler.collectGarbage');
      frames(REWARM_FRAMES);
      await new Promise((resolve) => setTimeout(resolve, COMPILER_PAUSE_MS));
      frames(INSTALL_FRAMES);
      await inspector.post('HeapProfiler.startSampling', { samplingInterval: 16, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      frames(WINDOW_FRAMES);
      const profile = heapProfileOf((await inspector.post('HeapProfiler.stopSampling')).profile);
      const alloc = pathAllocation(profile, (f) => f.functionName === 'frame' && /src\/audio\/runtime\.ts$/.test(f.url));
      perFrame.push(alloc.inPath / WINDOW_FRAMES);
      tops.push(JSON.stringify(alloc.top));
    }
    const median = [...perFrame].sort((a, b) => a - b)[Math.floor(WINDOWS / 2)] as number;
    expect(median, `Allokation je Audio-Frame (Fenster ${perFrame.map((b) => b.toFixed(2)).join(' / ')}): ${tops.join(' | ')}`).toBeLessThan(MAX_BYTES_PER_FRAME);
  });
});
