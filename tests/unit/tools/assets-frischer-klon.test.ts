/**
 * `npm run assets` in einem frischen Klon (M6-Gate; MASTERPROMPT §3.4, §33 „frischer Klon baut“): `src/generated/**` ist
 * gitignoriert und entsteht erst in diesem Lauf – die Palette im ersten Schritt, Atlas und UI danach. Was `tools/assets/build.ts`
 * statisch importiert, lädt Node vor dem ersten Schritt; erreicht dieser Graph ein generiertes Modul, bricht der Build im
 * frischen Klon mit `ERR_MODULE_NOT_FOUND` ab (so seit M5: die Kachelvorschau rendert über `terrainMesh` → `surface/params` →
 * `generated/palette`). Schritte, die generierte Module brauchen, laden sie dynamisch (`await import(…)`) nach dem
 * Palettenschritt.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const ENTRY = join(ROOT, 'tools/assets/build.ts');
const GENERATED = join(ROOT, 'src/generated');

/** Static import and re-export specifiers of a TypeScript module (type-only imports are erased and load nothing). */
function staticImports(source: string): string[] {
  const out: string[] = [];
  const re = /^\s*(?:import|export)\s+(type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
  for (let m = re.exec(source); m !== null; m = re.exec(source)) {
    if (m[1] === undefined && m[2] !== undefined) out.push(m[2]);
  }
  return out;
}

/** The file a relative specifier from `from` loads, or null for a package or a file that does not exist (yet). */
function resolveFile(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (candidate.startsWith(GENERATED)) return candidate;
    if (existsSync(candidate) && !candidate.endsWith('/')) {
      try {
        readFileSync(candidate);
        return candidate;
      } catch {
        // A directory: try the next candidate.
      }
    }
  }
  return null;
}

/** Every module the entry loads before its first line runs, with the chain that reaches it. */
function staticGraph(entry: string): Map<string, readonly string[]> {
  const seen = new Map<string, readonly string[]>([[entry, [entry]]]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (file.startsWith(GENERATED)) continue;
    for (const spec of staticImports(readFileSync(file, 'utf8'))) {
      const target = resolveFile(file, spec);
      if (target === null || seen.has(target)) continue;
      seen.set(target, [...(seen.get(file) ?? []), target]);
      queue.push(target);
    }
  }
  return seen;
}

describe('Asset-Build im frischen Klon', () => {
  it('der statische Importgraph von tools/assets/build.ts erreicht kein generiertes Modul', () => {
    const graph = staticGraph(ENTRY);
    expect(graph.size).toBeGreaterThan(5);
    const generated = [...graph.entries()].filter(([file]) => file.startsWith(GENERATED));
    expect(generated.map(([, chain]) => chain.map((f) => relative(ROOT, f)).join(' → '))).toEqual([]);
  });

  it('die Prüfung sieht einen statischen Import der Kachelvorschau, die über das Gelände die Palette lädt', () => {
    // The probe the test exists for: the import that broke the fresh clone since M5.
    const viaPreview = staticGraph(join(ROOT, 'tools/assets/tile-preview.ts'));
    const chains = [...viaPreview.entries()].filter(([file]) => file.startsWith(GENERATED)).map(([, chain]) => chain.map((f) => relative(ROOT, f)));
    expect(chains.length).toBeGreaterThan(0);
    expect(chains.some((c) => c.includes('src/generated/palette'))).toBe(true);
  });

  it('nur Typ-Importe und Paketnamen laden nichts aus dem Baum', () => {
    expect(staticImports("import type { A } from './a';\nimport { b } from './b';\nexport { c } from './c';\nimport 'node:fs';\nconst d = await import('./d');")).toEqual(['./b', './c', 'node:fs']);
  });
});
