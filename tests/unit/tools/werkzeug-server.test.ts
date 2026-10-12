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
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchForWorkspaceRoot } from 'vite';
import { describe, expect, it } from 'vitest';
import { TOOL_CACHE_DIR, TOOL_OPTIMIZED_DEPS, toolServedRoots, toolServerConfig } from '../../../tools/lib/browser';

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

  it('serves the real node_modules of a checkout whose node_modules is a symlink (worktree, copy – M7-120)', () => {
    const root = realpathSync(new URL('../../../', import.meta.url).pathname).replace(/\/$/, '');
    // The repository itself: node_modules lies inside the root, nothing more to allow.
    const own = toolServedRoots(root);
    expect(own[0]).toBe(searchForWorkspaceRoot(root));
    expect(own.filter((r) => r.startsWith(own[0] as string))).toEqual(own);
    expect(toolServerConfig().server?.fs?.allow).toEqual(toolServedRoots(process.cwd()));
    // A copy elsewhere with `node_modules -> <repo>/node_modules`: the real directory joins the served roots.
    const copy = mkdtempSync(join(tmpdir(), 'dh-werkzeug-'));
    try {
      symlinkSync(join(root, 'node_modules'), join(copy, 'node_modules'));
      const roots = toolServedRoots(copy);
      expect(roots[0]).toBe(searchForWorkspaceRoot(copy));
      expect(roots).toContain(realpathSync(join(root, 'node_modules')));
      // Without node_modules: the workspace root alone.
      rmSync(join(copy, 'node_modules'));
      expect(toolServedRoots(copy)).toEqual([searchForWorkspaceRoot(copy)]);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });

  it('jeder nackte Import des Spiels unter src/ wird beim Start gebündelt', () => {
    const found = bareImports(SRC);
    expect(found.size).toBeGreaterThan(2);
    for (const spec of found) expect(TOOL_OPTIMIZED_DEPS as readonly string[], spec).toContain(spec);
  });
});
