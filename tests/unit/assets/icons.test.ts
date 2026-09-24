/**
 * M3-04/M3-15/M3-16 (Icon-Teil): Jedes Item aus docs/SPIEL.md §6 (Rohstoffe T0, Werkzeuge T0, Grundlagen
 * ohne Station) hat ein Sprite `icon_<itemId>` (docs/SPIEL.md §2 „Icon-Konvention“). Belegt am Pixel: 16×16,
 * ein Frame, Motiv mit 1 px Luft zum Rand (≤ 14×14), Anker unten Mitte für den Welt-Drop, Kontur `nacht.1`
 * rundum (außer an offenen Flammen und dünnen Stielen), ≤ 12 Farben ohne Einzelpixel, jedes Icon
 * verschieden, nur der Leuchtpilz leuchtet, das Wasser im Eimer glänzt nass. Dazu die Interaktions-Glyphen
 * (M3-10): Tastenkappe, Maus, Fortschrittsring (neun Stufen, wachsende Füllung, leuchtend), Pfeil.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import grundlagen from '../../../assets-src/sprites/icons/grundlagen';
import hinweise from '../../../assets-src/sprites/icons/hinweise';
import nahrung from '../../../assets-src/sprites/icons/nahrung';
import pflanzen from '../../../assets-src/sprites/icons/pflanzen';
import rohstoffe from '../../../assets-src/sprites/icons/rohstoffe';
import werkzeuge from '../../../assets-src/sprites/icons/werkzeuge';
import { ICON_ANKER, ICON_GROESSE, ICON_GRUPPE } from '../../../assets-src/sprites/icons/_icon';
import { MATERIAL_BITS, MAX_SPRITE_COLORS, TRANSPARENT, spriteColorCount, spriteHasEmissive, type Sprite, type SpriteFrame } from '../../../assets-src/lib/sprite';
import { paletteIndex, paletteRef } from '../../../assets-src/palette';
import { checkSprite } from '../../../tools/assets/spriteChecks';

const ICONS: readonly Sprite[] = [...rohstoffe, ...nahrung, ...pflanzen, ...werkzeuge, ...grundlagen];

/** Kanonische Item-Ids aus docs/SPIEL.md §6 (Aufzählungspunkt mit dem Titel `titel`). */
function spielIds(titel: string): string[] {
  const text = readFileSync(join(process.cwd(), 'docs/SPIEL.md'), 'utf8');
  const zeile = text.split('\n').find((l) => l.startsWith(`- **${titel}`));
  if (zeile === undefined) throw new Error(`docs/SPIEL.md: Zeile „${titel}“ fehlt`);
  return [...zeile.matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1] ?? '');
}

const ITEM_IDS = [...spielIds('Rohstoffe T0'), ...spielIds('Werkzeuge T0'), ...spielIds('Grundlagen ohne Station')];

/** Mindestanteil der Randpixel in `nacht.1` (offene Flammen und Stiele sind ohne Kontur). */
const KONTUR_ANTEIL = 0.65;
const KONTUR = paletteIndex('nacht.1');

function frame0(s: Sprite): SpriteFrame {
  const f = s.frames[0];
  if (f === undefined) throw new Error(`${s.id}: kein Frame`);
  return f;
}

function deckend(s: Sprite, f: SpriteFrame, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < s.w && y < s.h && (f.index[y * s.w + x] ?? TRANSPARENT) !== TRANSPARENT;
}

describe('M3-04/M3-15/M3-16 Item-Icons', () => {
  it('jedes Item aus docs/SPIEL.md §6 hat genau ein Icon icon_<itemId> in der Gruppe icons', () => {
    expect(ITEM_IDS.length).toBe(61);
    expect(new Set(ITEM_IDS).size).toBe(ITEM_IDS.length);
    const ids = ICONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ITEM_IDS.map((id) => `icon_${id}`).sort());
    for (const s of ICONS) expect(s.group, s.id).toBe(ICON_GRUPPE);
  });

  it('16×16, ein Frame, Anker unten Mitte, Motiv mit 1 px Luft zum Zellrand', () => {
    for (const s of ICONS) {
      expect([s.w, s.h, s.frames.length], s.id).toEqual([ICON_GROESSE, ICON_GROESSE, 1]);
      expect(s.anchor, s.id).toEqual(ICON_ANKER);
      expect(s.schatten, s.id).toBe('none');
      const f = frame0(s);
      let pixel = 0;
      for (let i = 0; i < s.w; i++) {
        for (const [x, y] of [
          [i, 0],
          [i, s.h - 1],
          [0, i],
          [s.w - 1, i],
        ] as const) {
          expect(deckend(s, f, x, y), `${s.id} Rand (${x}, ${y})`).toBe(false);
        }
      }
      f.index.forEach((v) => {
        if (v !== TRANSPARENT) pixel++;
      });
      // Klare, große Silhouette auch bei schlanken Dingen (Messer, Speer): mindestens 3/16 der Zelle.
      expect(pixel, s.id).toBeGreaterThanOrEqual(48);
    }
  });

  it('Kontur nacht.1 rundum (selektiv nur an Flammen und Stielen)', () => {
    for (const s of ICONS) {
      const f = frame0(s);
      let rand = 0;
      let kontur = 0;
      for (let y = 0; y < s.h; y++) {
        for (let x = 0; x < s.w; x++) {
          if (!deckend(s, f, x, y)) continue;
          const aussen = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ].some(([dx, dy]) => !deckend(s, f, x + (dx ?? 0), y + (dy ?? 0)));
          if (!aussen) continue;
          rand++;
          if (f.index[y * s.w + x] === KONTUR) kontur++;
        }
      }
      expect(kontur / rand, s.id).toBeGreaterThanOrEqual(KONTUR_ANTEIL);
    }
  });

  it('≤ 12 Farben ohne Ausnahme, nur Palettenfarben, keine verwaisten Einzelpixel, jedes Icon verschieden', () => {
    const bilder = new Set<string>();
    for (const s of ICONS) {
      expect(spriteColorCount(s), s.id).toBeLessThanOrEqual(MAX_SPRITE_COLORS);
      expect(s.ausnahmeFarben, s.id).toBeNull();
      expect(checkSprite(s), s.id).toEqual({ errors: [], warnings: [] });
      bilder.add(frame0(s).index.join(','));
    }
    expect(bilder.size).toBe(ICONS.length);
  });

  it('nur der Leuchtpilz leuchtet (türkis); Flammen im Icon sind keine Lichtquelle', () => {
    for (const s of ICONS) expect(spriteHasEmissive(s), s.id).toBe(s.id === 'icon_leuchtpilz');
    const pilz = ICONS.find((s) => s.id === 'icon_leuchtpilz');
    const f = frame0(pilz as Sprite);
    f.index.forEach((v, p) => {
      if ((f.emissive[p] ?? 0) > 0) expect(paletteRef(v).startsWith('wasser.')).toBe(true);
    });
  });

  it('Holzeimer: leer dunkler Innenraum, gefüllt glänzendes Wasser (Materialflag nass) auf derselben Form', () => {
    const leer = frame0(ICONS.find((s) => s.id === 'icon_holzeimer') as Sprite);
    const voll = frame0(ICONS.find((s) => s.id === 'icon_holzeimer_wasser') as Sprite);
    let wasser = 0;
    voll.index.forEach((v, p) => {
      expect(v === TRANSPARENT, `Silhouette ${p}`).toBe(leer.index[p] === TRANSPARENT);
      if (v !== TRANSPARENT && paletteRef(v).startsWith('wasser.')) {
        wasser++;
        expect((voll.material[p] ?? 0) & MATERIAL_BITS.nass).toBe(MATERIAL_BITS.nass);
      }
    });
    expect(wasser).toBeGreaterThanOrEqual(16);
  });
});

describe('M3-10/M3-11 Interaktions-Glyphen', () => {
  const glyphe = (id: string): Sprite => {
    const s = hinweise.find((x) => x.id === id);
    if (s === undefined) throw new Error(`${id} fehlt`);
    return s;
  };

  it('Tastenkappe, Maus links/rechts, Ring und Pfeil in der Gruppe hinweise, ohne Befund', () => {
    expect(hinweise.map((s) => s.id)).toEqual(['hinweis_taste', 'hinweis_maus_links', 'hinweis_maus_rechts', 'hinweis_ring', 'hinweis_pfeil']);
    for (const s of hinweise) {
      expect(s.group, s.id).toBe('hinweise');
      expect(checkSprite(s), s.id).toEqual({ errors: [], warnings: [] });
    }
    // Die Innenfläche der Tastenkappe ist einfarbig (die Pixelschrift schreibt die Taste hinein).
    const kappe = frame0(glyphe('hinweis_taste'));
    const innen = new Set<number>();
    for (let y = 3; y <= 9; y++) for (let x = 3; x <= 12; x++) innen.add(kappe.index[y * 16 + x] ?? TRANSPARENT);
    expect(innen.size).toBe(1);
  });

  it('Fortschrittsring: neun Stufen, Füllung wächst streng und leuchtet, der Ring selbst bleibt gleich', () => {
    const ring = glyphe('hinweis_ring');
    expect(ring.frames).toHaveLength(9);
    const gefuellt = ring.frames.map((f) => f.index.reduce((n, v, p) => n + (v !== TRANSPARENT && (f.emissive[p] ?? 0) > 0 ? 1 : 0), 0));
    expect(gefuellt[0]).toBe(0);
    for (let i = 1; i < gefuellt.length; i++) expect(gefuellt[i] ?? 0).toBeGreaterThan(gefuellt[i - 1] ?? 0);
    const maske = (f: SpriteFrame): string => Array.from(f.index, (v) => (v === TRANSPARENT ? 0 : 1)).join('');
    for (const f of ring.frames) expect(maske(f)).toBe(maske(frame0(ring)));
  });

  it('Pfeil wippt (drei Lagen, Clip wippen) und leuchtet', () => {
    const pfeil = glyphe('hinweis_pfeil');
    expect(pfeil.frames).toHaveLength(3);
    expect(pfeil.clips.wippen?.frames).toEqual([0, 1, 2, 1]);
    expect(spriteHasEmissive(pfeil)).toBe(true);
  });
});
