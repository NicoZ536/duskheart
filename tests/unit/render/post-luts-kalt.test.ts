/**
 * M7-131: the two lookups the post passes build once while the page loads – the noise tile (`buildNoiseTexels`) and the
 * palette-shift lookup of the corruption (`buildCorruptionLut`) – write one texel per call of a small inner function fed by
 * a register, so most of the texels run in optimised code even on the first and only build. Their bytes are pinned: the
 * hashes of the builds before the change (commit 3e7606f), so the shots and the corruption tests read the same texels.
 * Measured in a module of its own (this file loads noise.ts and corruption.ts cold).
 */
import { createHash } from 'node:crypto';
import { Session } from 'node:inspector/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PALETTE_ROWS } from '../../../assets-src/paletteRows';
import { heapProfileOf, pathAllocation } from '../../../tools/bench/heap';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { buildCorruptionLut, CORRUPTION_ROW } from '../../../src/render/post/corruption';
import { buildNoiseTexels } from '../../../src/render/post/noise';

const SAMPLING_INTERVAL = 64;
/**
 * Limits [B per build, cold, in Node without Maglev – the interpreter until TurboFan's 3 000 calls]: the noise tile before
 * the inner function 9,3 MB in Node (1,5 MB in the browser), after it 2,2 MB; the corruption lookup 2,0 MB before and
 * 2,4 MB after in Node (its loop body is small enough for the loop's own optimised code; in the browser, where Maglev
 * takes a function after 400 calls, the inner function wins). A build that boxed every texel again would be ≥ 9 MB.
 */
const MAX_NOISE_BYTES = 3 * 1024 * 1024;
const MAX_CORRUPTION_BYTES = 3 * 1024 * 1024;
/** The builds' bytes before the change (sha256, first 16 hex digits). */
const GOLDEN = { noise: 'a434a90bc6e6c3ac', noise64Seed7: '29cb7bf605b4bab9', corruptionGeneric: '299e6c116f6655fa', corruptionRow: '5482c3890739fe06' };

const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

let session: Session;
beforeAll(async () => {
  session = new Session();
  session.connect();
  await session.post('HeapProfiler.enable');
});
afterAll(() => session.disconnect());

/** Bytes allocated below `run` (the function named `name` of this file), one cold call. */
async function coldBytes(name: string, run: () => void): Promise<{ bytes: number; top: unknown }> {
  await session.post('HeapProfiler.collectGarbage');
  await session.post('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true } as never);
  run();
  const profile = heapProfileOf((await session.post('HeapProfiler.stopSampling')).profile);
  const alloc = pathAllocation(profile, (f) => f.functionName === name && /post-luts-kalt/.test(f.url));
  return { bytes: alloc.inPath, top: alloc.top };
}

describe('Rauschkachel und Verderbnis-Lookup von kalt (M7-131)', () => {
  it('the noise tile is the one before the change, bit for bit, and its cold build allocates a fraction of the texels', async () => {
    let tile: Uint8Array | null = null;
    function rauschen(): void {
      tile = buildNoiseTexels();
    }
    const r = await coldBytes('rauschen', rauschen);
    expect(sha(tile as unknown as Uint8Array)).toBe(GOLDEN.noise);
    expect(sha(buildNoiseTexels(64, 7))).toBe(GOLDEN.noise64Seed7);
    // The tile's own bytes (64 KB) are the result, not garbage; the rest are the interpreted texels before the inner function is optimised.
    expect(r.bytes, JSON.stringify(r.top)).toBeLessThan(MAX_NOISE_BYTES);
  });

  it('the palette-shift lookup is the one before the change, with and without the row, and its cold build allocates little', async () => {
    const row = PALETTE_ROWS.find((p) => p.id === CORRUPTION_ROW)?.map ?? null;
    expect(row).not.toBeNull();
    let lut: Uint8Array | null = null;
    function verderbnis(): void {
      lut = buildCorruptionLut(PALETTE_HEX, null);
    }
    const r = await coldBytes('verderbnis', verderbnis);
    expect(sha(lut as unknown as Uint8Array)).toBe(GOLDEN.corruptionGeneric);
    expect(sha(buildCorruptionLut(PALETTE_HEX, row))).toBe(GOLDEN.corruptionRow);
    // The lookup's own bytes (128 KB) are the result; the rest are the interpreted texels before the inner function is optimised.
    expect(r.bytes, JSON.stringify(r.top)).toBeLessThan(MAX_CORRUPTION_BYTES);
  });
});
