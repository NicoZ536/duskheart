/**
 * M1-05/M1-06/M1-07: Atlas-Build über `buildSprites` mit den Fixtures aus tests/fixtures/sprites/atlas –
 * deterministische Ausgabe, keine Überlappung, Kanalkodierung beider Atlanten, Manifest, Kontaktbögen,
 * Cache (zweiter Lauf ohne Änderung < 1 s) und die Warnung für ungenutzte Sprites.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { paletteIndex } from '../../../assets-src/palette';
import { PALETTE_ROWS } from '../../../assets-src/paletteRows';
import { MATERIAL_BITS } from '../../../assets-src/lib/sprite';
import { buildAtlas, type Rect } from '../../../tools/assets/atlas';
import { loadSprites } from '../../../tools/assets/sources';
import { buildSprites, inputFiles, OUTPUT_NAMES, type SpriteStepPaths } from '../../../tools/assets/sprites-step';
import { checkSpriteSources, conventionSpriteIds } from '../../../tools/validator/checks';
import { WORLD_OBJECTS } from '../../../src/content/worldObjects';
import { decodePng } from '../../../tools/lib/png';

const ROOT = process.cwd();
const FIXTURES = fileURLToPath(new URL('../../fixtures/sprites/atlas', import.meta.url));
const NUTZUNG = fileURLToPath(new URL('../../fixtures/sprites/nutzung', import.meta.url));
/** §3.4/M1-05: ein unveränderter zweiter Lauf dauert weniger als eine Sekunde. */
const CACHED_RUN_BUDGET_MS = 1000;

const temps: string[] = [];
afterAll(() => {
  for (const t of temps) rmSync(t, { recursive: true, force: true });
});

function paths(spritesDir = FIXTURES): SpriteStepPaths {
  const out = mkdtempSync(join(tmpdir(), 'dh-atlas-'));
  temps.push(out);
  return { root: ROOT, spritesDir, generated: join(out, 'gen'), publicGenerated: join(out, 'pub'), sheets: join(out, 'sheets'), cache: join(out, 'cache') };
}

function overlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w + 1 && b.x < a.x + a.w + 1 && a.y < b.y + b.h + 1 && b.y < a.y + a.h + 1;
}

describe('Sprite-Suche', () => {
  it('lädt Sprites, Arrays und Generator-Ergebnisse, überspringt _-Hilfsmodule, Gruppe = Ordner', async () => {
    const { sprites, errors } = await loadSprites(FIXTURES);
    expect(errors).toEqual([]);
    expect(sprites.map((l) => `${l.group}/${l.sprite.id}`)).toEqual([
      'boden/fx_fliese',
      'licht/fx_flamme',
      'natur/fx_busch',
      'natur/fx_fels_0',
      'natur/fx_fels_1',
      'natur/fx_fels_2',
    ]);
  });

  it('meldet doppelte Ids und ungültige Default-Exporte als Fehler', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dh-sprites-'));
    temps.push(dir);
    const lib = join(ROOT, 'assets-src/lib/sprite').split('\\').join('/');
    const src = (id: string): string => `import { sprite } from '${lib}';\nexport default sprite({ id: '${id}', size: [1, 1], anchor: [0, 1], hoehe: 'flach', legende: { a: 'stein.1' }, frames: ['a'] });\n`;
    writeFileSync(join(dir, 'a.ts'), src('doppel'));
    writeFileSync(join(dir, 'b.ts'), src('doppel'));
    writeFileSync(join(dir, 'c.ts'), 'export default 42;\n');
    writeFileSync(join(dir, 'd.ts'), src('Kaputt Id'));
    const { sprites, errors } = await loadSprites(dir);
    expect(sprites.map((s) => s.group)).toEqual(['allgemein']);
    expect(errors).toEqual([
      'b.ts: Sprite-Id doppel ist schon in a.ts vergeben',
      'c.ts: Default-Export muss ein Sprite, ein Array von Sprites oder ein Generator-Ergebnis sein',
      expect.stringMatching(/^d\.ts: Sprite Kaputt Id: id/),
    ]);
  });
});

describe('Atlas', () => {
  it('packt ohne Überlappung, teilt identische Frames und kodiert Albedo/Normal-Kanäle', async () => {
    const { sprites } = await loadSprites(FIXTURES);
    const build = buildAtlas(sprites);
    const flamme = build.sprites.find((s) => s.id === 'fx_flamme');
    expect(flamme).toBeDefined();
    if (flamme === undefined) return;
    expect(build.frameCount).toBe(8);
    expect(build.uniqueFrames).toBe(7);
    expect(flamme.frames[2]).toEqual(flamme.frames[0]);
    const rects = [...new Map(build.sprites.flatMap((s) => s.frames).map((r) => [`${r.x},${r.y}`, r])).values()];
    expect(rects).toHaveLength(7);
    for (let i = 0; i < rects.length; i++) {
      const a = rects[i];
      if (a === undefined) continue;
      expect(a.x + a.w).toBeLessThanOrEqual(build.width);
      expect(a.y + a.h).toBeLessThanOrEqual(build.height);
      for (let j = i + 1; j < rects.length; j++) {
        const b = rects[j];
        if (b !== undefined) expect(overlap(a, b)).toBe(false);
      }
    }
    // Albedo: (3, 2) in Frame 0 ist feuer.5* (W), (2, 5) Metall-Schale, (0, 0) transparent.
    const at = (buf: Uint8Array, r: Rect, x: number, y: number): number[] => Array.from(buf.subarray(((r.y + y) * build.width + r.x + x) * 4, ((r.y + y) * build.width + r.x + x) * 4 + 4));
    const f0 = flamme.frames[0];
    if (f0 === undefined) return;
    expect(at(build.albedo, f0, 3, 3)).toEqual([paletteIndex('feuer.5'), 255, 0, 255]);
    expect(at(build.albedo, f0, 2, 5)).toEqual([paletteIndex('stein.2'), 0, MATERIAL_BITS.metall, 255]);
    expect(at(build.albedo, f0, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(at(build.normal, f0, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(at(build.normal, f0, 3, 3)[3]).toBe(255);
    // Manifest-Daten
    expect(flamme.group).toBe('licht');
    expect(flamme.emissiv).toBe(true);
    expect(flamme.material).toBe(MATERIAL_BITS.metall);
    expect(flamme.hitbox).toEqual({ x: 2, y: 5, w: 4, h: 3 });
    expect(flamme.sockets.licht).toEqual([
      [4, 3],
      [4, 4],
      [4, 3],
    ]);
    expect(flamme.clips.idle?.events).toEqual([{ frame: 1, name: 'knistern' }]);
    expect(flamme.occluder).toEqual({ kind: 'ellipse', x: 4, y: 7, rx: 2, ry: 1 });
    expect(flamme.schatten).toEqual({ kind: 'silhouette', basisY: 7, bounds: flamme.bounds });
    const fliese = build.sprites.find((s) => s.id === 'fx_fliese');
    expect(fliese?.schatten).toEqual({ kind: 'none' });
    expect(fliese?.material).toBe(MATERIAL_BITS.nass);
    expect(build.sprites.find((s) => s.id === 'fx_busch')?.material).toBe(MATERIAL_BITS.wind);
  });

  it('bricht bei Farben außerhalb der Palette ab', async () => {
    const { sprites } = await loadSprites(fileURLToPath(new URL('../../fixtures/sprites/verstoesse', import.meta.url)));
    expect(() => buildAtlas(sprites)).toThrow(/Farben außerhalb der Palette in fx_fremdfarbe/);
  });
});

describe('npm run assets: Sprite-Schritt', () => {
  it('deterministische Ausgabe: zwei Läufe erzeugen byte-gleiche Atlanten, Manifest und Bögen', async () => {
    const a = paths();
    const b = paths();
    const ra = await buildSprites(a, true);
    const rb = await buildSprites(b, true);
    expect(ra.hash).toBe(rb.hash);
    expect(ra.cached).toBe(false);
    const files = (p: SpriteStepPaths): string[] => [
      join(p.publicGenerated, OUTPUT_NAMES.albedo),
      join(p.publicGenerated, OUTPUT_NAMES.normal),
      join(p.generated, OUTPUT_NAMES.manifest),
      join(p.sheets, 'licht.png'),
      join(p.sheets, 'natur.png'),
      join(p.sheets, 'boden.png'),
      join(p.sheets, OUTPUT_NAMES.palette),
    ];
    const fa = files(a);
    const fb = files(b);
    fa.forEach((f, i) => expect(readFileSync(f).equals(readFileSync(fb[i] ?? '')), f).toBe(true));
    expect(ra.groups).toEqual(['boden', 'licht', 'natur']);
  });

  it('Atlas-PNGs: Albedo R = Palettenindex, Normal A = Deckung; Manifest nennt Quell-Hash und Palettenzeilen', async () => {
    const p = paths();
    const r = await buildSprites(p, true);
    const albedo = decodePng(readFileSync(join(p.publicGenerated, OUTPUT_NAMES.albedo)));
    const normal = decodePng(readFileSync(join(p.publicGenerated, OUTPUT_NAMES.normal)));
    expect([albedo.width, albedo.height]).toEqual([r.atlas.width, r.atlas.height]);
    for (let i = 0; i < albedo.rgba.length; i += 4) {
      expect(albedo.rgba[i] ?? 0).toBeLessThanOrEqual(64);
      expect(normal.rgba[i + 3]).toBe(albedo.rgba[i + 3]);
      if (albedo.rgba[i + 3] === 255) expect(albedo.rgba[i] ?? 0).toBeGreaterThan(0);
    }
    const manifest = readFileSync(join(p.generated, OUTPUT_NAMES.manifest), 'utf8');
    expect(manifest).toContain(`"sourceHash":"${r.hash}"`);
    expect(manifest).toContain('export type SpriteId');
    for (const row of PALETTE_ROWS) expect(manifest).toContain(`"id":"${row.id}"`);
    expect(manifest).toMatch(/"fx_flamme": \{"id":"fx_flamme"/);
  });

  it('Cache: zweiter Lauf ohne Änderung < 1 s; neue Quelle ⇒ Neubau; veraltete Bögen werden entfernt', async () => {
    const sprites = mkdtempSync(join(tmpdir(), 'dh-sprites-'));
    temps.push(sprites);
    cpSync(FIXTURES, sprites, { recursive: true });
    const p = paths(sprites);
    // Die kopierten Fixtures importieren relativ aus dem Projekt: Pfade absolut machen.
    await rewriteImports(sprites);
    const first = await buildSprites(p);
    expect(first.cached).toBe(false);
    const t0 = performance.now();
    const second = await buildSprites(p);
    const ms = performance.now() - t0;
    expect(second.cached).toBe(true);
    expect(second.hash).toBe(first.hash);
    expect(ms).toBeLessThan(CACHED_RUN_BUDGET_MS);
    // Ausgabe gelöscht ⇒ kein Cache-Treffer.
    rmSync(join(p.sheets, 'boden.png'));
    expect((await buildSprites(p)).cached).toBe(false);
    // Gruppe entfernt ⇒ ihr Bogen verschwindet beim nächsten Lauf.
    rmSync(join(sprites, 'boden'), { recursive: true });
    const third = await buildSprites(p);
    expect(third.cached).toBe(false);
    expect(third.hash).not.toBe(first.hash);
    expect(existsSync(join(p.sheets, 'boden.png'))).toBe(false);
    expect(existsSync(join(p.sheets, 'licht.png'))).toBe(true);
  });
});

describe('ungenutzte Sprites', () => {
  it('Fixture mit ungenutztem Sprite ⇒ Warnung (nur für das nicht erwähnte)', async () => {
    const res = await checkSpriteSources(join(NUTZUNG, 'quellen'), join(NUTZUNG, 'src'));
    expect(res.errors).toEqual([]);
    expect(res.warnings).toEqual(['Sprite fx_ungenutzt wird nirgends verwendet (keine Erwähnung unter src/)']);
  });

  it('per Namenskonvention verwendete Sprites (Welt-Objekte, Tilesets) warnen nicht', async () => {
    const res = await checkSpriteSources(join(NUTZUNG, 'quellen'), join(NUTZUNG, 'src'), ['fx_ungenutzt']);
    expect(res.warnings).toEqual([]);
    const ids = new Set(conventionSpriteIds());
    for (const o of WORLD_OBJECTS) expect(ids.has(o.id), o.id).toBe(true);
    for (const id of ['tileset_gras', 'tileset_lehm', 'tileset_klippe_gruen', 'tileset_klippe_hoehle']) expect(ids.has(id), id).toBe(true);
    // Festes Gestein hat kein Tileset, Stümpfe und Setzlinge sind (noch) keine Welt-Objekte.
    for (const id of ['tileset_fels', 'tileset_ader_kupfer', 'baum_eiche_stumpf']) expect(ids.has(id), id).toBe(false);
  });
});

describe('Cache-Eingaben des Sprite-Schritts', () => {
  it('umfassen die Quellmodule aus src/, die Generatoren und Vorschau einbinden (Autotiling, Terrain-Daten)', () => {
    const files = inputFiles(paths()).map((f) => f.slice(ROOT.length + 1).split('\\').join('/'));
    for (const f of ['src/world/autotile.ts', 'src/content/terrain.ts', 'src/engine/rng.ts', 'tools/assets/tile-preview.ts']) expect(files, f).toContain(f);
  });
});

/** Macht die relativen Importe der kopierten Fixtures absolut (Kopie liegt im Temp-Ordner). */
async function rewriteImports(dir: string): Promise<void> {
  const { listFiles } = await import('../../../tools/lib/files');
  const lib = join(ROOT, 'assets-src/lib').split('\\').join('/');
  for (const f of listFiles(dir, (x) => x.endsWith('.ts'))) {
    const src = readFileSync(f, 'utf8').replace(/'(?:\.\.\/)+assets-src\/lib\//g, `'${lib}/`).replace(/'\.\.\/\.\.\/generatoren'/g, `'${join(ROOT, 'tests/fixtures/sprites/generatoren').split('\\').join('/')}'`);
    writeFileSync(f, src);
  }
}
