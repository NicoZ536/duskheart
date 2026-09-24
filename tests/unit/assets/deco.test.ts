/**
 * M2-19: Streudeko. Belegt: jeder Streudeko-Typ aus `src/content/worldObjects.ts` hat ein Sprite
 * `deko_<typ>` (Kontaktbogen `streudeko`), jedes der 11 Biome hat mindestens vier Typen, jeder Typ hat
 * drei Varianten (16×16, 1 px Luft zum Rand), und die Biom-Tönung per Palettenzeile färbt geteilte
 * Streudeko in jedem Biom anders (Steinchen, Gräser), während Knochen und Muscheln ihre Farbe behalten.
 */
import { describe, expect, it } from 'vitest';
import streudeko, { DEKO_TYPEN } from '../../../assets-src/sprites/deko/streudeko';
import { MAX_SPRITE_COLORS, TRANSPARENT, spriteColorCount, type Sprite } from '../../../assets-src/lib/sprite';
import { BIOME_TINTS, PALETTE_ROWS, objektZeile, paletteRowIndex } from '../../../assets-src/paletteRows';
import { checkSprite } from '../../../tools/assets/spriteChecks';
import { WORLD_OBJECTS } from '../../../src/content/worldObjects';

/** M2-19: Mindestzahl der Streudeko-Typen je Biom. */
const MIN_TYPEN_JE_BIOM = 4;
const VARIANTEN = 3;

function sprite(id: string): Sprite {
  const s = streudeko.sprites.find((x) => x.id === id);
  if (s === undefined) throw new Error(`${id} fehlt`);
  return s;
}

/** Farben aller Pixel aller Frames durch die Palettenzeile des Objekts im Biom. */
function getoent(s: Sprite, biom: string): string {
  const map = PALETTE_ROWS[paletteRowIndex(objektZeile(s.id, biom, 'sommer'))]?.map ?? [];
  return s.frames.map((f) => Array.from(f.index, (v) => (v === TRANSPARENT ? 0 : (map[v - 1] ?? v))).join(',')).join('|');
}

describe('M2-19 Streudeko', () => {
  it('jeder Streudeko-Typ der Welt-Objekte hat ein Sprite deko_<typ> in der Gruppe streudeko', () => {
    const inhalt = WORLD_OBJECTS.filter((o) => o.kind === 'deko').map((o) => o.id);
    expect(streudeko.sprites.map((s) => s.id)).toEqual(inhalt);
    expect(DEKO_TYPEN.map((t) => `deko_${t}`)).toEqual(inhalt);
    for (const s of streudeko.sprites) expect(s.group, s.id).toBe('streudeko');
  });

  it(`jedes Biom hat mindestens ${MIN_TYPEN_JE_BIOM} Streudeko-Typen mit Sprite`, () => {
    for (const b of BIOME_TINTS) {
      const typen = WORLD_OBJECTS.filter((o) => o.kind === 'deko' && o.biomes.includes(b.biom) && streudeko.sprites.some((s) => s.id === o.id));
      expect(typen.length, b.biom).toBeGreaterThanOrEqual(MIN_TYPEN_JE_BIOM);
    }
  });

  it(`jeder Typ: ${VARIANTEN} verschiedene Varianten, 16×16, Anker unten Mitte, 1 px Luft zum Zellrand`, () => {
    for (const s of streudeko.sprites) {
      expect(s.frames.length, s.id).toBe(VARIANTEN);
      expect([s.w, s.h], s.id).toEqual([16, 16]);
      expect(s.anchor, s.id).toEqual([8, 14]);
      const varianten = new Set(s.frames.map((f) => f.index.join(',')));
      expect(varianten.size, s.id).toBe(VARIANTEN);
      for (const f of s.frames) {
        expect(f.index.some((v) => v !== TRANSPARENT), s.id).toBe(true);
        for (let i = 0; i < 16; i++) {
          expect(f.index[i], `${s.id} oben`).toBe(TRANSPARENT);
          expect(f.index[15 * 16 + i], `${s.id} unten`).toBe(TRANSPARENT);
          expect(f.index[i * 16], `${s.id} links`).toBe(TRANSPARENT);
          expect(f.index[i * 16 + 15], `${s.id} rechts`).toBe(TRANSPARENT);
        }
      }
    }
  });

  it('Biom-Tönung: geteilte Steinchen und Gräser sehen in jedem ihrer Biome anders aus; Knochen bleiben Knochen', () => {
    for (const id of ['deko_steinchen', 'deko_graeser']) {
      const s = sprite(id);
      const biome = WORLD_OBJECTS.find((o) => o.id === id)?.biomes ?? [];
      expect(biome.length, id).toBeGreaterThan(1);
      expect(new Set(biome.map((b) => getoent(s, b))).size, id).toBe(biome.length);
    }
    const knochen = sprite('deko_knochen');
    const biome = WORLD_OBJECTS.find((o) => o.id === 'deko_knochen')?.biomes ?? [];
    expect(new Set(biome.map((b) => getoent(knochen, b))).size).toBe(1);
  });

  it('jedes Sprite: ≤ 12 Farben, nur Palettenfarben, keine verwaisten Einzelpixel', () => {
    for (const s of streudeko.sprites) {
      expect(spriteColorCount(s), s.id).toBeLessThanOrEqual(MAX_SPRITE_COLORS);
      expect(s.ausnahmeFarben, s.id).toBeNull();
      expect(checkSprite(s), s.id).toEqual({ errors: [], warnings: [] });
    }
  });
});
