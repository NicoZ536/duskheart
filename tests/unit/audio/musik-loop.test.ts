/**
 * M7-05 Nahtlose Schleifen (MASTERPROMPT §27 "1,5–3 min, loopbar"; docs/SPIEL.md §24): only the bars around the loop
 * points – the whole pieces render in tests/integration/musik-render.test.ts.
 *
 * - the mechanism on the test piece: the loop body of the file is what follows its own end in continuous play (the
 *   renderer plays the body's last patterns as a silent pre-roll before it), to float precision;
 * - every counted piece: the loop start after the pre-roll equals the loop start after a longer history – the voices and the
 *   echo forget within `PREROLL_SECONDS`, so the file's end and its loop start meet without a seam; the lengths (1,5–3 min)
 *   and loop points;
 * - the stingers and songs that play once end in silence within `TAIL_MAX_SECONDS` after their last pattern.
 */
import { describe, expect, it } from 'vitest';
import { createMusicLibrary } from '../../../src/audio/music/library';
import { PREROLL_SECONDS, PieceRender, Sequencer, TAIL_MAX_SECONDS, arrangementOf, prerollPatterns, renderPatterns, renderPiece } from '../../../src/audio/music/render';
import { COUNTED_PIECE_MAX_SECONDS, COUNTED_PIECE_MIN_SECONDS, MUSIC_PIECES, type MusicPiece } from '../../../src/content/music/index';
import { TEST_TABLES, testPiece } from './musik-testlied';

/** Sample rate of the checks around the real pieces' loop points (the forgetting does not depend on it). */
const LOW_SR = 4000;
/** Rows of the loop start compared (the first bars of the body's first pattern). */
const PROBE_ROWS = 16;

/** `piece` with pattern `__probe`: the first `PROBE_ROWS` rows of pattern `id`. */
function withProbe(piece: MusicPiece, id: string): MusicPiece {
  const p = piece.patterns.find((q) => q.id === id);
  if (p === undefined) throw new Error(id);
  return { ...piece, patterns: [...piece.patterns, { id: '__probe', kanaele: p.kanaele, zeilen: p.zeilen.slice(0, PROBE_ROWS) }] };
}

/** Planar stereo stems mixed: left channel. */
function mixLeft(r: { stems: Partial<Record<string, Float32Array>>; lengthSamples: number }): Float64Array {
  const out = new Float64Array(r.lengthSamples);
  for (const s of Object.values(r.stems)) if (s !== undefined) for (let i = 0; i < r.lengthSamples; i++) out[i] = (out[i] as number) + (s[i] as number);
  return out;
}

/** The first pattern of the loop body rendered after `history` (silently) – the stems' left channels mixed. */
function loopStartAfter(seq: Sequencer, history: readonly string[], first: string): Float64Array {
  seq.reset();
  for (const id of history) seq.renderPattern(id, null, 0);
  const n = seq.patternSamples(first);
  const stems = seq.layers.map(() => ({ data: new Float32Array(2 * n), length: n }));
  seq.renderPattern(first, stems, 0);
  const out = new Float64Array(n);
  for (const s of stems) for (let i = 0; i < n; i++) out[i] = (out[i] as number) + (s.data[i] as number);
  return out;
}

describe('Schleifennaht', () => {
  it('Testlied: der Schleifenkörper der Datei ist, was in durchgehendem Spiel auf sein Ende folgt', () => {
    const piece = testPiece();
    const file = renderPiece(piece, 'standard', TEST_TABLES);
    // Continuous: intro, then the body three times.
    const ref = renderPatterns(piece, ['a', 'b', 'c', 'b', 'c', 'b', 'c'], TEST_TABLES);
    const f = mixLeft(file);
    const r = mixLeft(ref);
    const start = file.loopStartSample;
    const body = file.lengthSamples - start;
    // The file is normalised: one gain for all of it.
    let num = 0;
    let den = 0;
    for (let i = 0; i < body; i++) {
      num += (f[start + i] as number) * (r[start + 2 * body + i] as number);
      den += (r[start + 2 * body + i] as number) ** 2;
    }
    const g = num / den;
    let peak = 0;
    let err = 0;
    for (let i = 0; i < body; i++) {
      peak = Math.max(peak, Math.abs(f[start + i] as number));
      err = Math.max(err, Math.abs((f[start + i] as number) - g * (r[start + 2 * body + i] as number)));
    }
    expect(err / peak).toBeLessThan(1e-5);
    // And the end of the file is the end of a pass: what comes next in the reference is the file's loop start.
    let endErr = 0;
    for (let i = 1; i <= 2000; i++) endErr = Math.max(endErr, Math.abs((f[file.lengthSamples - i] as number) - g * (r[start + 2 * body - i] as number)));
    expect(endErr / peak).toBeLessThan(1e-5);
    // Without the pre-roll the loop start would differ (the echo of the body's end rings into it).
    const cold = loopStartAfter(new Sequencer(piece, TEST_TABLES), [], 'b');
    let coldErr = 0;
    for (let i = 0; i < cold.length; i++) coldErr = Math.max(coldErr, Math.abs(g * (cold[i] as number) - (f[start + i] as number)));
    expect(coldErr / peak).toBeGreaterThan(1e-3);
  });

  const library = createMusicLibrary();
  const counted = MUSIC_PIECES.filter((p) => p.zaehlt).map((p) => library.piece(p.id) as MusicPiece);

  it('jedes gezählte Stück dauert 1,5–3 min je Arrangement und kehrt zu seinem Schleifenanfang zurück', () => {
    expect(counted.map((p) => p.id)).toEqual(['titel', 'gruenhain', 'basis', 'kampf', 'borkenvater']);
    for (const piece of counted) {
      for (const a of piece.arrangements) {
        const job = new PieceRender(piece, a.art, TEST_TABLES);
        const seconds = job.lengthSamples / 32000;
        expect(seconds, `${piece.id}/${a.art}`).toBeGreaterThanOrEqual(COUNTED_PIECE_MIN_SECONDS);
        expect(seconds, `${piece.id}/${a.art}`).toBeLessThanOrEqual(COUNTED_PIECE_MAX_SECONDS);
        expect(a.loopAb, `${piece.id}/${a.art}`).toBeLessThan(a.folge.length);
      }
    }
  });

  it('am Schleifenpunkt jedes gezählten Stücks: die Stimmen und das Echo vergessen binnen der Vorlaufzeit (keine Naht)', () => {
    for (const piece of counted) {
      for (const a of piece.arrangements) {
        const body = arrangementOf(piece, a.art).folge.slice(a.loopAb);
        const seq = new Sequencer(withProbe(piece, body[0] as string), TEST_TABLES, LOW_SR);
        const first = '__probe';
        const preroll = prerollPatterns(seq, body, PREROLL_SECONDS);
        // One pattern more of history: the body's pattern played before the pre-roll's first (cyclically).
        const len = body.length;
        const before = body[(((len - preroll.length - 1) % len) + len) % len] as string;
        const longer = [before, ...preroll];
        const x = loopStartAfter(seq, preroll, first);
        const y = loopStartAfter(seq, longer, first);
        let peak = 0;
        let err = 0;
        for (let i = 0; i < x.length; i++) {
          peak = Math.max(peak, Math.abs(y[i] as number));
          err = Math.max(err, Math.abs((x[i] as number) - (y[i] as number)));
        }
        expect(peak, `${piece.id}/${a.art}`).toBeGreaterThan(0.01);
        expect(err / peak, `${piece.id}/${a.art}: ${err.toExponential(2)}`).toBeLessThan(1e-5);
      }
    }
  });

  it('Stinger und Lieder spielen einmal und enden still binnen der Ausklingzeit', () => {
    for (const raw of MUSIC_PIECES.filter((p) => !p.zaehlt)) {
      const piece = library.piece(raw.id) as MusicPiece;
      const a = arrangementOf(piece, 'standard');
      const r = renderPiece(piece, 'standard', TEST_TABLES, { sampleRate: LOW_SR });
      const seq = new Sequencer(piece, TEST_TABLES, LOW_SR);
      let patterns = 0;
      for (const id of a.folge) patterns += seq.patternSamples(id);
      if (a.loopAb >= a.folge.length) {
        // Stingers: played once, the tail at most TAIL_MAX_SECONDS, silent at the end.
        expect(r.loopStartSample, raw.id).toBe(r.lengthSamples);
        expect(r.lengthSamples - patterns, raw.id).toBeLessThanOrEqual(TAIL_MAX_SECONDS * LOW_SR);
        const last = mixLeft(r).subarray(r.lengthSamples - 64);
        for (const v of last) expect(Math.abs(v), raw.id).toBeLessThan(1e-3);
      } else {
        // Songs loop while the player plays: the loop start lies within the piece.
        expect(r.loopStartSample, raw.id).toBeLessThan(r.lengthSamples);
        expect(r.lengthSamples, raw.id).toBe(patterns);
      }
    }
  });
});
