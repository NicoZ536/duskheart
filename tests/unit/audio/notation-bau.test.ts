/**
 * M7-129: the pieces are composed while the page loads (`PatternBuilder`, src/content/music/compose.ts). The builder holds
 * its cells in typed arrays and writes the rows from cached cell texts: the notation is exactly `formatCell` of every cell
 * joined with `|` – read back by `parseCell` –, and a pattern of 64 rows × 8 channels leaves a few bytes per cell, not an
 * object per cell and five strings per `formatCell` (3,4 MB of boot garbage before).
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation } from '../../../tools/bench/heap';
import { arpeggio, bass, n, pad, PatternBuilder } from '../../../src/content/music/compose';
import { MUSIC_PIECES } from '../../../src/content/music/index';
import { checkPatternNotation, formatCell, parseCell, type TrackerCell } from '../../../src/content/music/notation';

const SAMPLING_INTERVAL = 32;
const COMPILER_PAUSE_MS = 200;
const MAX_WINDOWS = 4;
const ROWS = 64;
const CHANNELS = 8;
const BAR = 16;
/** Builds per window. */
const BUILDS = 40;
/**
 * Limit [B per build and cell]: the row strings themselves (≈ 128 B per row of 8 cells, the notation the piece keeps) and
 * their join; one cell object (≥ 48 B) or the five strings of `formatCell` (≈ 66 B) per cell lie well above.
 */
const MAX_BYTES_PER_CELL = 32;

let session: Session;
beforeAll(async () => {
  session = new Session();
  session.connect();
  await session.post('HeapProfiler.enable');
});
afterAll(() => session.disconnect());

/** A pattern with every kind of cell: notes with and without volume, releases, effects with and without a note. */
function compose(): PatternBuilder {
  const p = new PatternBuilder('probe', ROWS, CHANNELS);
  const chords = ['Dm', 'Bb', 'F', 'C'];
  bass(p, 0, 0, chords, BAR, 2, 'x.......5...8.-.', 56);
  arpeggio(p, 1, 1, chords, BAR, 4, [0, 1, 2, 3, 4, 3, 2, 1], 2, 32);
  pad(p, [2, 3], 2, chords, BAR, 4, 46, 1);
  p.line(4, 3, 'A4:6 D5:2 F5:8 | F5:4@40 D5:4!047 Bb4:8 | r:4 .:4 C5:6!E20 A4:2 | G4:12!310 r:4');
  p.hits(5, 4, n('C6'), '..o...o...o...o.|x.x.x.x.x.x.x.x.', 0, 64, 22);
  p.fx(6, 3, '047');
  p.fx(6, 7, 'E10');
  p.note(7, 0, n('A1'), 5, { vol: 22, fx: '402' });
  p.off(7, 8);
  return p;
}

/** The notation of `p` the way the definition writes it: `formatCell` of every cell, joined with `|`. */
function referenz(p: PatternBuilder): string[] {
  const zeilen: string[] = [];
  for (let r = 0; r < p.rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < p.channels; c++) row.push(formatCell(p.cell(c, r)));
    zeilen.push(row.join('|'));
  }
  return zeilen;
}

describe('Pattern-Bau ohne Müll (M7-129)', () => {
  it('build writes formatCell of every cell, joined per row; parseCell reads every cell back', () => {
    const p = compose();
    const built = p.build();
    expect(built).toEqual({ id: 'probe', kanaele: CHANNELS, zeilen: referenz(p) });
    expect(checkPatternNotation(built, 6)).toEqual([]);
    const cell: TrackerCell = { note: 0, inst: 0, vol: 0, fx: 0, param: 0 };
    let notes = 0;
    let effects = 0;
    built.zeilen.forEach((row, r) => {
      row.split('|').forEach((text, c) => {
        expect(parseCell(text, cell), `${r}/${c}`).toBeNull();
        expect(cell, `${r}/${c}`).toEqual(p.cell(c, r));
        if (cell.note >= 0) notes++;
        if (cell.fx !== 0) effects++;
      });
    });
    expect(notes).toBeGreaterThan(50);
    expect(effects).toBeGreaterThan(5);
  });

  it('the pieces of the game are built from the same cache: every pattern row of every piece reads back', () => {
    const cell: TrackerCell = { note: 0, inst: 0, vol: 0, fx: 0, param: 0 };
    let cells = 0;
    for (const piece of MUSIC_PIECES) {
      for (const pattern of piece.patterns) {
        for (const row of pattern.zeilen) {
          const texts = row.split('|');
          expect(texts.length, `${piece.id} ${pattern.id}`).toBe(pattern.kanaele);
          for (const text of texts) {
            expect(parseCell(text, cell), `${piece.id} ${pattern.id}: ${text}`).toBeNull();
            cells++;
          }
        }
      }
    }
    expect(cells).toBeGreaterThan(20_000);
  });

  it('building a pattern leaves little more than its row strings per cell (typed cells, cached texts)', async () => {
    const p = compose();
    let rows = 0;
    function bauen(): void {
      for (let k = 0; k < BUILDS; k++) rows += p.build().zeilen.length;
    }
    bauen();
    bauen();
    const windows: Array<{ per: number; top: unknown }> = [];
    do {
      if (windows.length > 0) await new Promise((resolve) => setTimeout(resolve, COMPILER_PAUSE_MS));
      await session.post('HeapProfiler.collectGarbage');
      await session.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true } as never);
      rows = 0;
      bauen();
      const profile = heapProfileOf((await session.post('HeapProfiler.stopSampling')).profile);
      const alloc = pathAllocation(profile, (f) => f.functionName === 'bauen' && /notation-bau/.test(f.url));
      windows.push({ per: alloc.inPath / (BUILDS * ROWS * CHANNELS), top: alloc.top });
      expect(rows).toBe(BUILDS * ROWS);
    } while ((windows[windows.length - 1] as { per: number }).per >= MAX_BYTES_PER_CELL && windows.length < MAX_WINDOWS);
    const best = Math.min(...windows.map((w) => w.per));
    expect(best, windows.map((w, i) => `window ${i + 1}: ${w.per.toFixed(1)} B/cell ${JSON.stringify(w.top)}`).join('; ')).toBeLessThan(MAX_BYTES_PER_CELL);
  });
});
