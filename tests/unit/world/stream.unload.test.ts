/**
 * Unloading without hashing (M2-22, M4-Gate): a resident chunk whose saved state is its generated one is compared
 * with its baseline on unload and before a save (`sameChunkContent`), instead of hashing its 8 KiB (`chunkHash`,
 * ≈ 0.3 ms per chunk – three quarters of the heaviest streaming frames of `fluessiges-laufen` in a V8 CPU profile).
 * Only chunks whose saved state differs from the generated one (loaded with a stored diff, saved with a change) are
 * still hashed. What storage receives is unchanged: the same diffs, the same deletions.
 */
import { describe, expect, it } from 'vitest';
import { CHUNK_FIELDS, ChunkData, chunkHash, sameChunkContent } from '../../../src/world/model/chunk';
import { CHUNK_AREA } from '../../../src/world/model/coords';
import type { ChunkDiff } from '../../../src/world/stream/diff';
import { fixtureGenerate, fixtureManager, settle } from './streamFixture';

/** The fixture chunk at (5, 5) and an independent copy. */
function pair(): [ChunkData, ChunkData] {
  const a = fixtureGenerate({ seed: 7 }, 0, 5, 5);
  a.setObjectState(3, 2, 0.5, 90);
  return [a, a.clone()];
}

describe('sameChunkContent', () => {
  it('vergleicht alle sieben Felder und die Objektzustände – so wie der Hash', () => {
    const [a, b] = pair();
    expect(sameChunkContent(a, b)).toBe(true);
    for (const name of CHUNK_FIELDS) {
      const [x, y] = pair();
      const f = y.field(name);
      f[CHUNK_AREA - 1] = (f[CHUNK_AREA - 1] as number) + 1;
      expect(sameChunkContent(x, y), name).toBe(false);
      expect(chunkHash(x)).not.toBe(chunkHash(y));
    }
    const [c, d] = pair();
    d.setObjectState(3, 2, 0.75, 90);
    expect(sameChunkContent(c, d)).toBe(false);
    d.setObjectState(3, 2, 0.5, 90);
    expect(sameChunkContent(c, d)).toBe(true);
    d.setObjectState(4, 1, 0, 0);
    expect(sameChunkContent(c, d)).toBe(false);
    d.clearObjectState(4);
    d.clearObjectState(3);
    d.setObjectState(5, 2, 0.5, 90);
    expect(sameChunkContent(c, d)).toBe(false);
  });

  it('Adresse und frozenAtTick zählen nicht (der Hash nimmt die Adresse, die ist bei Chunk und Grundstand gleich)', () => {
    const [a] = pair();
    const moved = new ChunkData(0, 9, 9).copyFrom(a);
    moved.frozenAtTick = 1234;
    expect(sameChunkContent(a, moved)).toBe(true);
  });

  it('kostet einen Bruchteil des Hashes', () => {
    const chunks = Array.from({ length: 40 }, (_, i) => fixtureGenerate({ seed: 3 }, 0, i % 8, Math.floor(i / 8)));
    const copies = chunks.map((c) => c.clone());
    const time = (fn: () => void): number => {
      const runs: number[] = [];
      for (let r = 0; r < 7; r++) {
        const t0 = performance.now();
        fn();
        runs.push(performance.now() - t0);
      }
      return runs.sort((x, y) => x - y)[3] as number;
    };
    let same = 0;
    const compare = (): void => {
      for (let i = 0; i < chunks.length; i++) if (sameChunkContent(chunks[i] as ChunkData, copies[i] as ChunkData)) same++;
    };
    const hash = (): void => {
      for (const c of chunks) if (chunkHash(c).length > 0) same++;
    };
    for (let w = 0; w < 20; w++) {
      compare();
      hash();
    }
    const compareMs = time(compare);
    const hashMs = time(hash);
    expect(same).toBeGreaterThan(0);
    // Measured ≈ 7× apart when optimized (4 against 27 µs per chunk); a factor of 2 leaves room for a loaded machine.
    expect(compareMs * 2, `compare ${compareMs.toFixed(3)} ms, hash ${hashMs.toFixed(3)} ms for ${chunks.length} chunks`).toBeLessThan(hashMs);
  });
});

describe('Entladen ohne Hash', () => {
  it('unveränderte Chunks werden verglichen, nicht gehasht, und hinterlassen nichts', () => {
    const m = fixtureManager().manager;
    settle(m, 0, 5, 5);
    const s = m.update(0, 25, 25);
    expect(s.unloaded).toBeGreaterThan(0);
    expect(s.hashed).toBe(0);
    expect(m.unsavedUnloaded).toBe(0);
    expect(m.collectChanges().writes).toEqual([]);
  });

  it('ein geänderter Chunk hinterlässt seinen Diff, einer zurück im Grundstand nichts – ohne Hash', () => {
    const m = fixtureManager().manager;
    settle(m, 0, 5, 5);
    const changed = m.get(0, 5, 5) as ChunkData;
    changed.ground[10] = (changed.ground[10] as number) + 1;
    const back = m.get(0, 6, 5) as ChunkData;
    const old = back.object[3] as number;
    back.setObject(3, old + 1);
    back.setObject(3, old);
    const s = m.update(0, 25, 25);
    expect(s.hashed).toBe(0);
    expect(m.unsavedUnloaded).toBe(1);
    const writes = m.collectChanges().writes;
    expect(writes.map((w) => w.key)).toEqual(['0:5:5']);
    expect(writes[0]?.diff?.fields.ground?.values).toEqual(Uint8Array.of((changed.ground[10] as number)));
  });

  it('gespeichert mit Änderung: der Chunk wird gehasht, unverändert hinterlässt er nichts, zurückgesetzt löscht er den Eintrag', () => {
    const first = fixtureManager().manager;
    settle(first, 0, 5, 5);
    (first.get(0, 5, 5) as ChunkData).ground[7] = 4;
    const saved = first.collectChanges();
    first.markSaved(saved);
    expect(saved.writes.map((w) => w.key)).toEqual(['0:5:5']);
    // Unchanged since the save: hashed on unload (its saved state is not the generated one), nothing left behind.
    let s = first.update(0, 25, 25);
    expect(s.hashed).toBe(1);
    expect(first.unsavedUnloaded).toBe(0);
    expect(first.collectChanges().writes).toEqual([]);

    // A new manager seeded with the save: the chunk loads with its stored diff.
    const m = fixtureManager().manager;
    m.loadStored(saved.writes.map((w) => w.diff as ChunkDiff));
    settle(m, 0, 5, 5);
    const c = m.get(0, 5, 5) as ChunkData;
    expect(c.ground[7]).toBe(4);
    const generated = m.generatedOf(c) as ChunkData;
    // Back to the generated state: storage must delete its record.
    c.ground[7] = generated.ground[7] as number;
    s = m.update(0, 25, 25);
    expect(s.hashed).toBe(1);
    const writes = m.collectChanges().writes;
    expect(writes).toEqual([{ key: '0:5:5', diff: null }]);
  });

  it('nach dem Speichern des Grundstands vergleicht der Stream wieder statt zu hashen', () => {
    const m = fixtureManager().manager;
    settle(m, 0, 5, 5);
    const c = m.get(0, 5, 5) as ChunkData;
    const old = c.height[2] as number;
    c.height[2] = old + 1;
    m.markSaved(m.collectChanges());
    c.height[2] = old;
    const back = m.collectChanges();
    expect(back.writes).toEqual([{ key: '0:5:5', diff: null }]);
    m.markSaved(back);
    const s = m.update(0, 25, 25);
    expect(s.hashed).toBe(0);
    expect(m.unsavedUnloaded).toBe(0);
    expect(m.collectChanges().writes).toEqual([]);
  });
});
