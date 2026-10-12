/**
 * M7-98 Dev-Server der Werkzeuge ohne HMR und Dateiüberwachung (`npm run shot`, `npm run bench`; tools/lib/browser.ts): eine
 * Quelldatei, die andere Arbeit während eines Laufs speichert, lädt die Seite nicht mehr neu („Execution context was
 * destroyed“). Der Server
 *
 * - schickt keine HMR-Nachrichten (`hmr: false`) und überwacht keine Dateien (`watch: null`);
 * - bündelt seine Abhängigkeiten einmal beim Start (`noDiscovery`) – jeder nackte Import unter `src/` steht in der Liste, sonst
 *   fände der Server ihn erst später;
 * - hat einen eigenen Abhängigkeits-Cache (ein `npm run dev` mit anderer Konfiguration bündelt ihn nicht mitten im Lauf neu).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOL_CACHE_DIR, TOOL_OPTIMIZED_DEPS, toolServerConfig } from '../../../tools/lib/browser';

const SRC = new URL('../../../src/', import.meta.url).pathname;

/** The bare module specifiers imported by the client code under `src/` (static and dynamic imports, CSS `@import`). */
function bareImports(dir: string, out = new Set<string>()): Set<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      bareImports(path, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    const text = readFileSync(path, 'utf8');
    // `import … from 'x'`, `export … from 'x'`, `import 'x'` at the start of a line, and `import('x')`.
    const statements = text.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+'([^'./][^']*)'|^\s*import\s+'([^'./][^']*)'|\bimport\('([^'./][^']*)'\)/gm);
    for (const m of statements) {
      const spec = (m[1] ?? m[2] ?? m[3]) as string;
      // Virtual modules of plugins and Node built-ins of worker-free tooling are no dependencies to bundle.
      if (spec.startsWith('virtual:') || spec.startsWith('node:')) continue;
      out.add(spec);
    }
  }
  return out;
}

describe('M7-98 Dev-Server der Werkzeuge', () => {
  it('ohne HMR und ohne Dateiüberwachung, Abhängigkeiten einmal beim Start, eigener Cache', () => {
    const c = toolServerConfig();
    expect(c.server?.hmr).toBe(false);
    expect(c.server?.watch).toBeNull();
    expect(c.server?.port).toBe(0);
    expect(c.optimizeDeps?.noDiscovery).toBe(true);
    expect(c.optimizeDeps?.include).toEqual([...TOOL_OPTIMIZED_DEPS]);
    expect(c.cacheDir).toBe(TOOL_CACHE_DIR);
    expect(TOOL_CACHE_DIR).not.toBe('node_modules/.vite');
  });

  it('jeder nackte Import des Spiels unter src/ wird beim Start gebündelt', () => {
    const found = bareImports(SRC);
    expect(found.size).toBeGreaterThan(2);
    for (const spec of found) expect(TOOL_OPTIMIZED_DEPS as readonly string[], spec).toContain(spec);
  });
});
