/**
 * M2-21: Vegetation und Gestein aller Biome. Belegt: jedes Welt-Objekt aus `src/content/worldObjects.ts`
 * hat ein Sprite mit derselben Id (docs/WORLD.md §7), jedes Biom hat Vegetation und Gestein, Felsen
 * haben die Größen aus docs/ART.md §3 mit Bodenkontakt, jedes Erz aus `src/content/ores.ts` hat einen
 * Knoten mit eigener, lesbarer Erzfarbe (magische Erze leuchten), Kristalle leuchten mit hellem Kern,
 * pflückbare Büsche haben einen Frame „abgeerntet“ und Laub im Wind, und die Palettenzeile je Objekt (`objektZeile`)
 * folgt dem Vertrag. Alle Sprites: ≤ 12 Farben, keine Einzelpixel.
 */
import { describe, expect, it } from 'vitest';
import erzknoten from '../../../assets-src/sprites/erze/erzknoten';
import felsen from '../../../assets-src/sprites/gestein/felsen';
import kristalle from '../../../assets-src/sprites/gestein/kristalle';
import pflanzen from '../../../assets-src/sprites/pflanzen/pflanzen';
import buesche from '../../../assets-src/sprites/vegetation/buesche';
import streudeko from '../../../assets-src/sprites/deko/streudeko';
import baeume from '../../../assets-src/sprites/baeume/eiche';
import { hexToOklab, hexToOklch, oklabDistance, type Oklab } from '../../../assets-src/lib/color';
import { MATERIAL_BITS, MAX_SPRITE_COLORS, TRANSPARENT, spriteColorCount, type Sprite } from '../../../assets-src/lib/sprite';
import { flatPalette, paletteRef } from '../../../assets-src/palette';
import { BIOME_TINTS, objektZeile, paletteRowIndex } from '../../../assets-src/paletteRows';
import { checkSprite } from '../../../tools/assets/spriteChecks';
import { loadSprites } from '../../../tools/assets/sources';
import { ORES } from '../../../src/content/ores';
import { WORLD_OBJECTS } from '../../../src/content/worldObjects';

const EIGENE: readonly Sprite[] = [...felsen.sprites, ...kristalle.sprites, ...erzknoten.sprites, ...pflanzen.sprites, ...buesche.sprites];
const PAL = flatPalette();
const LAB = PAL.map(hexToOklab);
const L = PAL.map((hex) => hexToOklch(hex).L);
/** Magische Erze leuchten (M2-21). */
const MAGISCH = ['lumenit', 'prismenquarz', 'magmit'];

function sprite(id: string): Sprite {
  const s = EIGENE.find((x) => x.id === id);
  if (s === undefined) throw new Error(`${id} fehlt`);
  return s;
}

function rampe(v: number): string {
  return paletteRef(v).split('.')[0] ?? '';
}

describe('M2-21 Vegetation und Gestein', () => {
  it('jedes Welt-Objekt hat ein Sprite mit derselben Id (docs/WORLD.md §7)', async () => {
    const { sprites, errors } = await loadSprites('assets-src/sprites');
    const ids = new Set(sprites.map((l) => l.sprite.id));
    expect(errors.filter((e) => /baeume|vegetation|gestein|erze|pflanzen|deko/.test(e))).toEqual([]);
    const fehlend = WORLD_OBJECTS.map((o) => o.id).filter((id) => !ids.has(id));
    expect(fehlend).toEqual([]);
  });

  it('jedes Biom hat Vegetation (Baum, Busch oder Pflanze) und Gestein (Fels) mit Sprite', () => {
    for (const b of BIOME_TINTS) {
      const hier = WORLD_OBJECTS.filter((o) => o.biomes.includes(b.biom));
      const veg = hier.filter((o) => o.kind === 'baum' || o.kind === 'busch' || o.kind === 'pflanze');
      expect(veg.length, b.biom).toBeGreaterThan(0);
      expect(hier.filter((o) => o.kind === 'fels').map((o) => o.id).sort(), b.biom).toEqual([`fels_gross_${b.biom}`, `fels_klein_${b.biom}`]);
      for (const o of [...veg.filter((v) => v.kind !== 'baum'), ...hier.filter((x) => x.kind === 'fels')]) expect(EIGENE.some((s) => s.id === o.id), o.id).toBe(true);
    }
    expect(baeume.sprites.length).toBe(3);
  });

  it('Felsen: klein 16×16, groß 32×32, Höhen-Hinweis block, Fuß mit Bodenkontakt, 1 px Luft', () => {
    for (const b of BIOME_TINTS) {
      for (const [g, size] of [
        ['klein', 16],
        ['gross', 32],
      ] as const) {
        const s = sprite(`fels_${g}_${b.biom}`);
        expect([s.w, s.h], s.id).toEqual([size, size]);
        expect(s.hoehe, s.id).toBe('block');
        const f = s.frames[0];
        if (f === undefined) throw new Error(s.id);
        const [, ay] = s.anchor;
        const fussZeile = [...Array(s.w).keys()].map((x) => f.index[ay * s.w + x] ?? 0).filter((v) => v !== TRANSPARENT);
        expect(fussZeile.length, s.id).toBeGreaterThan(size / 3);
        expect(fussZeile.some((v) => paletteRef(v) === 'nacht.1'), `${s.id}: Bodenkontakt`).toBe(true);
        for (let y = ay + 1; y < s.h; y++) for (let x = 0; x < s.w; x++) expect(f.index[y * s.w + x], s.id).toBe(TRANSPARENT);
        for (let i = 0; i < size; i++) {
          expect(f.index[i], s.id).toBe(TRANSPARENT);
          expect(f.index[i * s.w], s.id).toBe(TRANSPARENT);
          expect(f.index[i * s.w + s.w - 1], s.id).toBe(TRANSPARENT);
        }
      }
    }
  });

  it('die Felsen der Biome unterscheiden sich im Farbton (mittlere Farbe je Biompaar)', () => {
    const mittel = (s: Sprite): Oklab => {
      const f = s.frames[0];
      let n = 0;
      const sum = { L: 0, a: 0, b: 0 };
      f?.index.forEach((v) => {
        if (v === TRANSPARENT) return;
        const c = LAB[v - 1];
        if (c === undefined) return;
        sum.L += c.L;
        sum.a += c.a;
        sum.b += c.b;
        n++;
      });
      return { L: sum.L / n, a: sum.a / n, b: sum.b / n };
    };
    const farben = BIOME_TINTS.map((b) => ({ biom: b.biom, c: mittel(sprite(`fels_gross_${b.biom}`)) }));
    for (let i = 0; i < farben.length; i++) {
      for (let j = i + 1; j < farben.length; j++) {
        const p = farben[i];
        const q = farben[j];
        if (p === undefined || q === undefined) continue;
        expect(oklabDistance(p.c, q.c), `${p.biom}/${q.biom}`).toBeGreaterThan(0.02);
      }
    }
  });

  it('Erzknoten: einer je Erz, Erz ≥ 10 % der Fläche in eigenen Farben, magische Erze leuchten, sonst keins', () => {
    const erze = ORES.map((o) => o.id);
    expect(erzknoten.sprites.map((s) => s.id)).toEqual(erze.map((e) => `erz_${e}`));
    const signatur = new Map<string, string>();
    for (const e of erze) {
      const s = sprite(`erz_${e}`);
      const f = s.frames[0];
      if (f === undefined) throw new Error(e);
      let gesamt = 0;
      const zaehler = new Map<number, number>();
      f.index.forEach((v) => {
        if (v === TRANSPARENT) return;
        gesamt++;
        if (rampe(v) === 'stein' || paletteRef(v) === 'nacht.1') return;
        zaehler.set(v, (zaehler.get(v) ?? 0) + 1);
      });
      const erzPixel = [...zaehler.values()].reduce((a, b) => a + b, 0);
      expect(erzPixel / gesamt, e).toBeGreaterThanOrEqual(0.1);
      // Erzfarben stehen in Rampen, die keine Biomzeile ändert (das Erz sieht in jedem Biom gleich aus).
      for (const v of zaehler.keys()) expect(['gras', 'erde', 'holz', 'laub'], `${e}: ${paletteRef(v)}`).not.toContain(rampe(v));
      const top2 = [...zaehler.entries()]
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .slice(0, 2)
        .map(([v]) => v)
        .sort((a, b) => a - b)
        .join(',');
      expect([...signatur.entries()].find(([, sig]) => sig === top2)?.[0], `${e}: Erzfarben wie ein anderes Erz`).toBeUndefined();
      signatur.set(e, top2);
      const leuchtet = f.emissive.some((v, p) => v > 0 && f.index[p] !== TRANSPARENT);
      expect(leuchtet, e).toBe(MAGISCH.includes(e));
      expect(s.hoehe, e).toBe('block');
      expect([s.w, s.h], e).toEqual([24, 24]);
    }
  });

  it('Kristalle: sechs Arten, Glanz-Flag, leuchtende mit hellerem Kern; Eis leuchtet nicht', () => {
    expect(kristalle.sprites.map((s) => s.id)).toEqual(WORLD_OBJECTS.filter((o) => o.kind === 'kristall').map((o) => o.id));
    for (const s of kristalle.sprites) {
      const f = s.frames[0];
      if (f === undefined) throw new Error(s.id);
      expect(f.material.some((m) => (m & MATERIAL_BITS.eis) !== 0), s.id).toBe(true);
      const em = [...f.index.keys()].filter((p) => (f.emissive[p] ?? 0) > 0 && f.index[p] !== TRANSPARENT);
      if (s.id === 'kristall_eis') {
        expect(em.length, s.id).toBe(0);
        continue;
      }
      expect(em.length, s.id).toBeGreaterThan(20);
      const lEm = em.reduce((a, p) => a + (L[(f.index[p] ?? 1) - 1] ?? 0), 0) / em.length;
      const rand = [...f.index.keys()].filter((p) => (f.emissive[p] ?? 0) === 0 && f.index[p] !== TRANSPARENT && (f.material[p] ?? 0) & MATERIAL_BITS.eis);
      const lRand = rand.reduce((a, p) => a + (L[(f.index[p] ?? 1) - 1] ?? 0), 0) / Math.max(1, rand.length);
      expect(lEm, s.id).toBeGreaterThan(lRand);
    }
  });

  it('Büsche: alle 12, pflückbare mit Frame „abgeerntet“ ohne Beeren; Laub im Wind', () => {
    const inhalt = WORLD_OBJECTS.filter((o) => o.kind === 'busch');
    expect(buesche.sprites.map((s) => s.id)).toEqual(inhalt.map((o) => o.id));
    for (const o of inhalt) {
      const s = sprite(o.id);
      expect([s.w, s.h], o.id).toEqual([24, 24]);
      // Laub (Pixel in `gras`) wiegt sich im Wind.
      const f0 = s.frames[0];
      if (f0 === undefined) throw new Error(o.id);
      const laub = [...f0.index.keys()].filter((p) => f0.index[p] !== TRANSPARENT && rampe(f0.index[p] ?? 1) === 'gras');
      for (const p of laub) expect((f0.material[p] ?? 0) & MATERIAL_BITS.wind, o.id).toBe(MATERIAL_BITS.wind);
      const gepflueckt = o.tool === 'hand';
      expect(s.clips.abgeerntet !== undefined, o.id).toBe(gepflueckt);
      if (!gepflueckt) continue;
      const voll = s.frames[0];
      const leer = s.frames[s.clips.abgeerntet?.frames[0] ?? 0];
      if (voll === undefined || leer === undefined) throw new Error(o.id);
      const unterschied = [...voll.index.keys()].filter((p) => voll.index[p] !== leer.index[p]).length;
      expect(unterschied, o.id).toBeGreaterThanOrEqual(8);
    }
  });

  it('Pflanzen: alle 13 mit Sprite; Palettenzeile je Objekt nach dem Vertrag', () => {
    expect(pflanzen.sprites.map((s) => s.id)).toEqual(WORLD_OBJECTS.filter((o) => o.kind === 'pflanze').map((o) => o.id));
    expect(objektZeile('baum_tanne', 'frostkamm', 'winter')).toBe('winter_tanne');
    expect(objektZeile('busch_beeren', 'gruenhain', 'herbst')).toBe('herbst');
    expect(objektZeile('deko_steinchen', 'glutsand', 'sommer')).toBe('biom_glutsand');
    expect(objektZeile('erz_gold', 'tiefgrund', 'sommer')).toBe('biom_tiefgrund');
    expect(objektZeile('pflanze_fasergras', 'salzkueste', 'sommer')).toBe('biom_salzkueste');
    expect(objektZeile('pflanze_kaktus', 'glutsand', 'sommer')).toBe('basis');
    expect(objektZeile('fels_gross_frostkamm', 'frostkamm', 'winter')).toBe('basis');
    for (const o of WORLD_OBJECTS) for (const biom of o.biomes) expect(() => paletteRowIndex(objektZeile(o.id, biom, 'sommer')), `${o.id} in ${biom}`).not.toThrow();
  });

  it('jedes Sprite: ≤ 12 Farben, nur Palettenfarben, keine verwaisten Einzelpixel', () => {
    for (const s of [...EIGENE, ...streudeko.sprites]) {
      expect(spriteColorCount(s), s.id).toBeLessThanOrEqual(MAX_SPRITE_COLORS);
      expect(s.ausnahmeFarben, s.id).toBeNull();
      expect(checkSprite(s), s.id).toEqual({ errors: [], warnings: [] });
    }
  });
});
