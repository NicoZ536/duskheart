/**
 * M7-132: the wall records of the autotiler. `wandInto` fills a held record instead of returning a new object per cliff
 * tile – the chunk builder asks every tile with higher ground above it, and `klippenFrames` asks for the wall and, through
 * `wandSpalte`, for both side neighbours (2–8 KB of garbage per cliff chunk before). The held path gives bit for bit what
 * `wandAn` gives, the cliff frames are unchanged, and a call allocates nothing once optimised.
 */
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heapProfileOf, pathAllocation } from '../../../tools/bench/heap';
import { Rng } from '../../../src/engine/rng';
import { KLIPPE_FRAME, klippenFrames, MAX_HOEHENSTUFE, UEBERGANG, WAND_SPALTE, WAND_VARIANTE_ANTEIL, wandAn, wandFrame, wandInto, wandSpalte, WandStueckRecord, wandZeile, type KlippenUmgebung } from '../../../src/world/autotile';

/** Mean bytes between two heap samples (small: almost every allocation is seen). */
const SAMPLING_INTERVAL = 16;
const COMPILER_PAUSE_MS = 200;
const MAX_WINDOWS = 4;
/** Side of a height field; the tiles asked lie inside a border of `MAX_HOEHENSTUFE` + 1. */
const SIDE = 24;
const BORDER = MAX_HOEHENSTUFE + 1;
/** Share of tiles with a ramp or stairs flag. */
const TRANSITION_SHARE = 0.15;

let session: Session;
beforeAll(async () => {
  session = new Session();
  session.connect();
  await session.post('HeapProfiler.enable');
});
afterAll(() => session.disconnect());

/** A random height field (0 … MAX_HOEHENSTUFE) with transition flags, seen from tile (x, y). */
class Feld implements KlippenUmgebung {
  readonly hoehen = new Uint8Array(SIDE * SIDE);
  readonly flags = new Uint8Array(SIDE * SIDE);
  x = 0;
  y = 0;

  constructor(rng: Rng) {
    for (let i = 0; i < SIDE * SIDE; i++) {
      this.hoehen[i] = rng.int(0, MAX_HOEHENSTUFE + 1);
      const r = rng.next();
      this.flags[i] = r < TRANSITION_SHARE / 2 ? UEBERGANG.rampe : r < TRANSITION_SHARE ? UEBERGANG.treppe : UEBERGANG.keiner;
    }
  }

  private at(dx: number, dy: number): number {
    const x = this.x + dx;
    const y = this.y + dy;
    return x < 0 || y < 0 || x >= SIDE || y >= SIDE ? -1 : y * SIDE + x;
  }

  hoehe(dx: number, dy: number): number {
    const i = this.at(dx, dy);
    return i < 0 ? 0 : (this.hoehen[i] as number);
  }

  uebergang(dx: number, dy: number): number {
    const i = this.at(dx, dy);
    return i < 0 ? UEBERGANG.keiner : (this.flags[i] as number);
  }
}

/** The cliff frames of the tile the way the allocating helpers give them (the reference of the held path). */
function referenzFrames(u: KlippenUmgebung, zufall: number): number[] {
  const wand = wandAn(u);
  if (wand === null) {
    const out: number[] = [];
    return out.slice(0, klippenFrames(u, zufall, out));
  }
  const zeile = wandZeile(wand);
  const spalte = wandSpalte(u, wand);
  return [wand.art === UEBERGANG.keiner && spalte === WAND_SPALTE.mitte && zufall < WAND_VARIANTE_ANTEIL ? KLIPPE_FRAME.wandVariante + zeile : wandFrame(wand.art, zeile, spalte)];
}

/** Bytes allocated per call below the function named `name` of this file, best of up to `MAX_WINDOWS` windows. */
async function bytesPerCall(name: string, run: () => void, calls: number): Promise<{ best: number; report: string }> {
  run();
  run();
  const windows: Array<{ per: number; top: unknown }> = [];
  do {
    if (windows.length > 0) await new Promise((resolve) => setTimeout(resolve, COMPILER_PAUSE_MS));
    await session.post('HeapProfiler.collectGarbage');
    await session.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true } as never);
    run();
    const profile = heapProfileOf((await session.post('HeapProfiler.stopSampling')).profile);
    const alloc = pathAllocation(profile, (f) => f.functionName === name && /klippen-wand-register/.test(f.url));
    windows.push({ per: alloc.inPath / calls, top: alloc.top });
  } while ((windows[windows.length - 1] as { per: number }).per >= 1 && windows.length < MAX_WINDOWS);
  return { best: Math.min(...windows.map((w) => w.per)), report: windows.map((w, i) => `window ${i + 1}: ${w.per.toFixed(2)} B/call ${JSON.stringify(w.top)}`).join('; ') };
}

describe('Klippenwände über einen gehaltenen Datensatz (M7-132)', () => {
  const felder = [11, 23, 47, 91].map((seed) => new Feld(new Rng(seed)));

  it('wandInto writes exactly what wandAn returns, for every tile and offset of random height fields', () => {
    const out = new WandStueckRecord();
    let walls = 0;
    let tiles = 0;
    for (const f of felder) {
      for (let y = BORDER; y < SIDE - BORDER; y++) {
        for (let x = BORDER; x < SIDE - BORDER; x++) {
          f.x = x;
          f.y = y;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const soll = wandAn(f, dx, dy);
              out.stufe = -1;
              const ist = wandInto(f, dx, dy, out);
              tiles++;
              if (soll === null) {
                if (ist || out.stufe !== -1) throw new Error(`${x},${y} (${dx},${dy}): wandInto fand eine Wand, wandAn nicht`);
                continue;
              }
              walls++;
              if (!ist) throw new Error(`${x},${y} (${dx},${dy}): wandAn fand eine Wand, wandInto nicht`);
              if (out.stufe !== soll.stufe || out.stufen !== soll.stufen || out.kanteDy !== soll.kanteDy || out.fuss !== soll.fuss || out.art !== soll.art) {
                throw new Error(`${x},${y} (${dx},${dy}): ${JSON.stringify(out)} ≠ ${JSON.stringify(soll)}`);
              }
            }
          }
        }
      }
    }
    expect(tiles).toBe(felder.length * (SIDE - 2 * BORDER) ** 2 * 9);
    expect(walls).toBeGreaterThan(tiles / 20);
  });

  it('klippenFrames with the held wall and neighbour records gives the frames of the allocating helpers', () => {
    const out: number[] = [];
    let wallTiles = 0;
    for (const f of felder) {
      for (let y = BORDER; y < SIDE - BORDER; y++) {
        for (let x = BORDER; x < SIDE - BORDER; x++) {
          f.x = x;
          f.y = y;
          const zufall = ((x * 31 + y * 17) % 100) / 100;
          const soll = referenzFrames(f, zufall);
          const n = klippenFrames(f, zufall, out);
          if (n !== soll.length || soll.some((v, i) => out[i] !== v)) throw new Error(`${x},${y}: ${JSON.stringify(out.slice(0, n))} ≠ ${JSON.stringify(soll)}`);
          if (wandAn(f) !== null) wallTiles++;
        }
      }
    }
    expect(wallTiles).toBeGreaterThan(0);
  });

  it('wandInto and klippenFrames allocate nothing per call once optimised', async () => {
    const f = felder[0] as Feld;
    const out = new WandStueckRecord();
    const frames: number[] = [];
    const inner = (SIDE - 2 * BORDER) ** 2;
    let walls = 0;
    function wandAufrufe(): void {
      for (let k = 0; k < 20; k++) {
        for (let y = BORDER; y < SIDE - BORDER; y++) {
          for (let x = BORDER; x < SIDE - BORDER; x++) {
            f.x = x;
            f.y = y;
            if (wandInto(f, 0, 0, out)) walls++;
            klippenFrames(f, 0.5, frames);
          }
        }
      }
    }
    const r = await bytesPerCall('wandAufrufe', wandAufrufe, 20 * inner);
    expect(walls).toBeGreaterThan(0);
    // One record per tile would be ≥ 40 B a call (wandAn, plus two more in wandSpalte for a wall tile).
    expect(r.best, r.report).toBeLessThan(1);
  });
});
