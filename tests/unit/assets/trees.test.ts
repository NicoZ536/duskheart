/**
 * M2-20: Baum-Generator und 14 Baumarten. Belegt am Pixel: die 14 Arten aus docs/WORLD.md §7 mit Stumpf
 * und Setzling, Größen 32×48 bis 64×96, Anker am Stammfuß, Blätterdach + Wind nur auf der Krone,
 * Occluder am Stamm, Jahreszeiten-Clips (Laubbäume kahl im Winter), Palettenzeilen je Art und
 * Jahreszeit (Blüte/Frucht der Obstbäume, Schnee der Nadelbäume), leuchtende Kristallblätter beim
 * Lichtbaum, ≤ 12 Farben ohne Einzelpixel, Determinismus.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import apfelbaum from '../../../assets-src/sprites/baeume/apfelbaum';
import aschebaum from '../../../assets-src/sprites/baeume/aschebaum';
import birke from '../../../assets-src/sprites/baeume/birke';
import birnbaum from '../../../assets-src/sprites/baeume/birnbaum';
import buche from '../../../assets-src/sprites/baeume/buche';
import dattelpalme from '../../../assets-src/sprites/baeume/dattelpalme';
import eiche, { EICHE } from '../../../assets-src/sprites/baeume/eiche';
import kiefer from '../../../assets-src/sprites/baeume/kiefer';
import kirschbaum from '../../../assets-src/sprites/baeume/kirschbaum';
import lichtbaum from '../../../assets-src/sprites/baeume/lichtbaum';
import mangrove from '../../../assets-src/sprites/baeume/mangrove';
import tanne from '../../../assets-src/sprites/baeume/tanne';
import walnussbaum from '../../../assets-src/sprites/baeume/walnussbaum';
import weide from '../../../assets-src/sprites/baeume/weide';
import { baumArt } from '../../../assets-src/sprites/baeume/_baukasten';
import { hexToOklch } from '../../../assets-src/lib/color';
import { MATERIAL_BITS, MAX_SPRITE_COLORS, TRANSPARENT, spriteColorCount, type Sprite, type SpriteFrame } from '../../../assets-src/lib/sprite';
import { flatPalette, paletteRef } from '../../../assets-src/palette';
import { ART_ZEILEN, JAHRESZEITEN, PALETTE_ROWS, jahreszeitZeile, paletteRowIndex } from '../../../assets-src/paletteRows';
import { checkSprite } from '../../../tools/assets/spriteChecks';
import type { GeneratorResult } from '../../../assets-src/lib/generator';
import { WORLD_OBJECTS } from '../../../src/content/worldObjects';

/** docs/WORLD.md §7: die 14 Baumarten. */
const ARTEN = ['eiche', 'birke', 'buche', 'kiefer', 'weide', 'mangrove', 'tanne', 'dattelpalme', 'aschebaum', 'lichtbaum', 'apfelbaum', 'kirschbaum', 'birnbaum', 'walnussbaum'] as const;
const LAUBBAEUME = ['eiche', 'birke', 'buche', 'weide', 'apfelbaum', 'kirschbaum', 'birnbaum', 'walnussbaum'];
const OBSTBAEUME = ['apfelbaum', 'kirschbaum', 'birnbaum', 'walnussbaum'];
const ERGEBNISSE: readonly GeneratorResult[] = [eiche, birke, buche, kiefer, weide, mangrove, tanne, dattelpalme, aschebaum, lichtbaum, apfelbaum, kirschbaum, birnbaum, walnussbaum];
const ALLE: readonly Sprite[] = ERGEBNISSE.flatMap((r) => r.sprites);
const L = flatPalette().map((hex) => hexToOklch(hex).L);

function sprite(id: string): Sprite {
  const s = ALLE.find((x) => x.id === id);
  if (s === undefined) throw new Error(`${id} fehlt`);
  return s;
}

function frame(s: Sprite, i: number): SpriteFrame {
  const f = s.frames[i];
  if (f === undefined) throw new Error(`${s.id}: Frame ${i} fehlt`);
  return f;
}

function rampe(v: number): string {
  return v === TRANSPARENT ? '' : (paletteRef(v).split('.')[0] ?? '');
}

describe('M2-20 Baumarten', () => {
  it('liefert die 14 Arten aus WORLD.md §7 mit Stumpf und Setzling, passend zu den Welt-Objekten', () => {
    expect(ALLE.filter((s) => /^baum_[a-z]+$/.test(s.id)).map((s) => s.id)).toEqual(ARTEN.map((a) => `baum_${a}`));
    for (const a of ARTEN) {
      expect(ALLE.some((s) => s.id === `baum_${a}_stumpf`), a).toBe(true);
      expect(ALLE.some((s) => s.id === `baum_${a}_setzling`), a).toBe(true);
    }
    const inhalt = WORLD_OBJECTS.filter((o) => o.kind === 'baum').map((o) => o.id);
    expect(inhalt.sort()).toEqual(ARTEN.map((a) => `baum_${a}`).sort());
    expect(new Set(ALLE.map((s) => s.group))).toEqual(new Set(['baeume']));
  });

  it('Bäume sind 32×48 bis 64×96 groß, Anker am Stammfuß, Occluder-Ellipse am Stamm, Hitbox am Fuß', () => {
    for (const a of ARTEN) {
      const s = sprite(`baum_${a}`);
      expect(s.w, a).toBeGreaterThanOrEqual(32);
      expect(s.w, a).toBeLessThanOrEqual(64);
      expect(s.h, a).toBeGreaterThanOrEqual(48);
      expect(s.h, a).toBeLessThanOrEqual(96);
      expect(s.hoehe, a).toBe('kugel');
      const [ax, ay] = s.anchor;
      // Unter dem Anker ist nichts mehr; auf der Ankerzeile steht der Stammfuß (bei der Mangrove die
      // Enden der Stelzwurzeln links und rechts der Mitte).
      const f = frame(s, 0);
      for (let y = ay + 1; y < s.h; y++) for (let x = 0; x < s.w; x++) expect(f.index[y * s.w + x], `${a} (${x}, ${y})`).toBe(TRANSPARENT);
      const fuss = [...Array(s.w).keys()].filter((x) => f.index[ay * s.w + x] !== TRANSPARENT);
      expect(fuss.length, a).toBeGreaterThan(0);
      if (a !== 'mangrove') expect(fuss, a).toContain(ax);
      else expect(fuss.some((x) => x < ax) && fuss.some((x) => x > ax), a).toBe(true);
      expect(s.occluder.kind, a).toBe('ellipse');
      if (s.occluder.kind === 'ellipse') {
        expect(Math.abs(s.occluder.x - ax), a).toBeLessThanOrEqual(1);
        expect(ay - s.occluder.y, a).toBeLessThanOrEqual(3);
        expect(s.occluder.rx, a).toBeLessThanOrEqual(8);
      }
      expect(s.hitbox, a).not.toBeNull();
    }
  });

  it('Blätterdach und Wind liegen auf der Krone, nie am Stammfuß; 1 px Luft zum Zellrand', () => {
    const krone = MATERIAL_BITS.dach | MATERIAL_BITS.wind;
    for (const a of ARTEN) {
      const s = sprite(`baum_${a}`);
      const f = frame(s, 0);
      let dach = 0;
      f.material.forEach((m, p) => {
        if ((m & krone) === krone && f.index[p] !== TRANSPARENT) dach++;
      });
      expect(dach, a).toBeGreaterThan(s.w * s.h * 0.12);
      const [ax, ay] = s.anchor;
      for (let y = ay - 3; y <= ay; y++) for (let x = ax - 2; x <= ax + 2; x++) expect((f.material[y * s.w + x] ?? 0) & MATERIAL_BITS.dach, `${a} Fuß`).toBe(0);
      for (const fr of s.frames) {
        for (let y = 0; y < s.h; y++) {
          expect(fr.index[y * s.w], `${a} linker Rand`).toBe(TRANSPARENT);
          expect(fr.index[y * s.w + s.w - 1], `${a} rechter Rand`).toBe(TRANSPARENT);
        }
        for (let x = 0; x < s.w; x++) expect(fr.index[x], `${a} oberer Rand`).toBe(TRANSPARENT);
      }
    }
  });

  it('Jahreszeiten: Clips für alle vier; Laubbäume kahl im Winter (ohne Blätterdach), Immergrüne belaubt', () => {
    for (const a of ARTEN) {
      const s = sprite(`baum_${a}`);
      for (const j of JAHRESZEITEN) expect(s.clips[j]?.frames.length, `${a} ${j}`).toBe(1);
      const winter = s.clips.winter?.frames[0] ?? -1;
      if (LAUBBAEUME.includes(a)) {
        expect(winter, a).toBe(1);
        const kahl = frame(s, 1);
        expect(kahl.material.some((m, p) => (m & MATERIAL_BITS.dach) !== 0 && kahl.index[p] !== TRANSPARENT), a).toBe(false);
        expect([...kahl.index].filter((v) => rampe(v) === 'gras').length, `${a}: kein Laub im Winter`).toBe(0);
      } else expect(winter, a).toBe(0);
      for (const j of ['fruehling', 'sommer', 'herbst'] as const) expect(s.clips[j]?.frames[0], `${a} ${j}`).toBe(0);
    }
  });

  it('Palettenzeilen je Art und Jahreszeit existieren; Stumpf und Setzling nutzen dieselben', () => {
    for (const a of ARTEN) {
      for (const j of JAHRESZEITEN) {
        const zeile = jahreszeitZeile(`baum_${a}`, j);
        expect(() => paletteRowIndex(zeile), `${a} ${j}`).not.toThrow();
        expect(jahreszeitZeile(`baum_${a}_stumpf`, j)).toBe(zeile);
        expect(jahreszeitZeile(`baum_${a}_setzling`, j)).toBe(zeile);
      }
    }
    expect(jahreszeitZeile('baum_eiche', 'herbst')).toBe('herbst');
    expect(jahreszeitZeile('baum_tanne', 'winter')).toBe('winter_tanne');
    expect(jahreszeitZeile('busch_beeren', 'winter')).toBe('winter');
    for (const z of ART_ZEILEN) expect(ARTEN, z.art).toContain(z.art);
  });

  it('Nadelbäume tragen im Winter Schnee (Lichtkappen weiß) und bleiben im Herbst grün', () => {
    const lEis = L[flatPalette().indexOf('#f4fbff')] ?? 1;
    for (const a of ['tanne', 'kiefer']) {
      const s = sprite(`baum_${a}`);
      const f = frame(s, 0);
      const winter = PALETTE_ROWS[paletteRowIndex(jahreszeitZeile(s.id, 'winter'))]?.map ?? [];
      const herbst = PALETTE_ROWS[paletteRowIndex(jahreszeitZeile(s.id, 'herbst'))]?.map ?? [];
      let schnee = 0;
      let krone = 0;
      f.index.forEach((v, p) => {
        if (v === TRANSPARENT || ((f.material[p] ?? 0) & MATERIAL_BITS.dach) === 0) return;
        krone++;
        if (L[(winter[v - 1] ?? v) - 1] === lEis || rampe(winter[v - 1] ?? v) === 'eis') schnee++;
        expect(rampe(herbst[v - 1] ?? v), `${a} Herbst`).not.toBe('laub');
      });
      expect(schnee / krone, a).toBeGreaterThan(0.08);
    }
  });

  it('Obstbäume: Früchte in `laub`, Frame „abgeerntet“ ohne Früchte; Blüte im Frühling heller als die reife Frucht', () => {
    for (const a of OBSTBAEUME) {
      const s = sprite(`baum_${a}`);
      const voll = frame(s, 0);
      const ab = s.clips.abgeerntet?.frames[0];
      expect(ab, a).toBeDefined();
      const leer = frame(s, ab ?? 0);
      const frucht = [...voll.index.keys()].filter((p) => rampe(voll.index[p] ?? 0) === 'laub');
      expect(frucht.length, a).toBeGreaterThanOrEqual(16);
      expect([...leer.index].filter((v) => rampe(v) === 'laub').length, a).toBe(0);
      const mittel = (j: 'fruehling' | 'sommer' | 'herbst'): number => {
        const map = PALETTE_ROWS[paletteRowIndex(jahreszeitZeile(s.id, j))]?.map ?? [];
        return frucht.reduce((sum, p) => sum + (L[(map[(voll.index[p] ?? 1) - 1] ?? 1) - 1] ?? 0), 0) / frucht.length;
      };
      expect(mittel('fruehling'), `${a}: Blüte hell`).toBeGreaterThan(Math.min(mittel('sommer'), mittel('herbst')));
      // Die Zeilen der drei belaubten Jahreszeiten färben die Früchte verschieden.
      const farben = (['fruehling', 'sommer', 'herbst'] as const).map((j) => {
        const map = PALETTE_ROWS[paletteRowIndex(jahreszeitZeile(s.id, j))]?.map ?? [];
        return frucht.map((p) => map[(voll.index[p] ?? 1) - 1]).join(',');
      });
      expect(new Set(farben).size, a).toBe(3);
    }
  });

  it('Lichtbaum leuchtet in der Krone (Kern heller als Rand), Aschebaum glimmt; die übrigen leuchten nicht', () => {
    for (const a of ARTEN) {
      const f = frame(sprite(`baum_${a}`), 0);
      const emissiv = [...f.emissive].filter((v, p) => v > 0 && f.index[p] !== TRANSPARENT).length;
      if (a === 'lichtbaum') expect(emissiv, a).toBeGreaterThan(200);
      else if (a === 'aschebaum') expect(emissiv, a).toBeGreaterThan(10);
      else expect(emissiv, a).toBe(0);
    }
    const licht = frame(sprite('baum_lichtbaum'), 0);
    let lEm = 0;
    let nEm = 0;
    let lRand = 0;
    let nRand = 0;
    licht.index.forEach((v, p) => {
      if (v === TRANSPARENT || ((licht.material[p] ?? 0) & MATERIAL_BITS.dach) === 0) return;
      if ((licht.emissive[p] ?? 0) > 0) {
        lEm += L[v - 1] ?? 0;
        nEm++;
      } else {
        lRand += L[v - 1] ?? 0;
        nRand++;
      }
    });
    expect(lEm / nEm).toBeGreaterThan(lRand / nRand);
  });

  it('Stümpfe und Setzlinge: klein, Anker unten Mitte, Holz der Art; Setzling wiegt sich im Wind', () => {
    for (const a of ARTEN) {
      const st = sprite(`baum_${a}_stumpf`);
      expect(st.w, a).toBeLessThanOrEqual(24);
      expect(st.h, a).toBeLessThanOrEqual(16);
      expect(st.hoehe, a).toBe('zylinder');
      const se = sprite(`baum_${a}_setzling`);
      expect([se.w, se.h], a).toEqual([16, 24]);
      expect(frame(se, 0).material.some((m) => (m & MATERIAL_BITS.wind) !== 0), a).toBe(true);
      expect(frame(se, 0).material.some((m) => (m & MATERIAL_BITS.dach) !== 0), a).toBe(false);
    }
  });

  it('jedes Sprite: ≤ 12 Farben, nur Palettenfarben, keine verwaisten Einzelpixel', () => {
    for (const s of ALLE) {
      expect(spriteColorCount(s), s.id).toBeLessThanOrEqual(MAX_SPRITE_COLORS);
      expect(s.ausnahmeFarben, s.id).toBeNull();
      expect(checkSprite(s), s.id).toEqual({ errors: [], warnings: [] });
    }
  });

  it('ist deterministisch: gleiche Artbeschreibung ⇒ identische Pixel', () => {
    const hash = (r: GeneratorResult): string => {
      const h = createHash('sha256');
      for (const s of r.sprites) for (const f of s.frames) h.update(f.index).update(f.emissive).update(f.material);
      return h.digest('hex');
    };
    expect(hash(baumArt(EICHE))).toBe(hash(eiche));
    expect(hash(baumArt({ ...EICHE, seed: EICHE.seed + 1 }))).not.toBe(hash(eiche));
  });
});
