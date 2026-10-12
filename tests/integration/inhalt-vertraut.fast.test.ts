/**
 * The production build trusts the content (M7-115, src/content/check.ts): with `import.meta.env.PROD` the registry and the
 * group definitions use the authored records without zod. This test loads the whole content a second time in that mode and
 * compares every collection with the fully checked one of the tests – the game runs exactly the content `npm run check`
 * checked, key order included.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ContentRegistryView } from '../../src/content/registry';

interface Loaded {
  readonly mode: string;
  readonly content: ContentRegistryView;
  readonly ms: number;
}

async function load(prod: boolean): Promise<Loaded> {
  vi.resetModules();
  vi.stubEnv('PROD', prod);
  const t0 = performance.now();
  const index = await import('../../src/content/index');
  const ms = performance.now() - t0;
  const check = await import('../../src/content/check');
  return { mode: check.CONTENT_CHECK_MODE, content: index.CONTENT, ms };
}

describe('Inhalt im Produktionsbuild', () => {
  afterAll(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('the trusted registry holds the same collections with the same records, key order included, frozen', async () => {
    const voll = await load(false);
    const vertraut = await load(true);
    expect([voll.mode, vertraut.mode]).toEqual(['voll', 'vertraut']);
    expect(vertraut.content.collectionNames()).toEqual(voll.content.collectionNames());
    let records = 0;
    for (const c of voll.content.collections()) {
      const t = vertraut.content.collections().find((x) => x.name === c.name);
      expect(t, c.name).toBeDefined();
      if (t === undefined) continue;
      expect(t.ids(), c.name).toEqual(c.ids());
      // JSON keeps the key order: the game's records read exactly as the checked ones.
      expect(JSON.stringify(t.values()), c.name).toBe(JSON.stringify(c.values()));
      expect(t.values(), c.name).toStrictEqual(c.values());
      for (const r of t.values()) expect(Object.isFrozen(r), `${c.name}:${r.id}`).toBe(true);
      records += c.size;
    }
    expect(records).toBeGreaterThan(2000);
    expect(vertraut.content.countsByCategory()).toEqual(voll.content.countsByCategory());
    console.info(`Inhalt laden: voll ${voll.ms.toFixed(0)} ms, vertraut ${vertraut.ms.toFixed(0)} ms, ${records} Datensätze`);
  });
});
