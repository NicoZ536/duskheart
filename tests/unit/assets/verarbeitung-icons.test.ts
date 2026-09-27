/**
 * M4-10/M4-35 (Icon-Teil): Jedes Verarbeitungsprodukt T0–T1 (src/content/items/verarbeitung.ts), jedes
 * Bronzewerkzeug (verarbeitung_bronzewerkzeuge.ts) und die Schiene (heilmittel.ts) hat sein Icon
 * `icon_<itemId>` (docs/SPIEL.md §2 „Icon-Konvention“). Belegt am Pixel wie die M3-Icons (icons.test.ts):
 * 16×16, ein Frame, Motiv mit 1 px Luft, Anker des Welt-Drops, Kontur `nacht.1` rundum, ≤ 12 reine
 * Palettenfarben ohne verwaiste Einzelpixel, nichts leuchtet, jedes Icon verschieden (auch von den
 * M3-Icons). Dazu die Materialien:
 * - Barren: eine Barrenform, drei Metalle ohne gemeinsame Farbe; Kupfer, Zinn und Bronze liegen im
 *   Farbraum (OKLab) deutlich auseinander, Bronze ist gelber als Kupfer; alle Metallpixel tragen das
 *   Metallflag.
 * - Bronzewerkzeuge: Kopf nur in der Bronzerampe (Metallflag), klar entfernt vom Steinkopf der
 *   Steinwerkzeuge derselben Art.
 * - Glas glänzt (Glanzflag), Roh- und Brandziegel teilen die Form (lehmfarben bzw. ziegelrot).
 */
import { describe, expect, it } from 'vitest';
import bronzewerkzeuge from '../../../assets-src/sprites/icons/bronzewerkzeuge';
import grundlagen from '../../../assets-src/sprites/icons/grundlagen';
import heilmittel from '../../../assets-src/sprites/icons/heilmittel';
import nahrung from '../../../assets-src/sprites/icons/nahrung';
import pflanzen from '../../../assets-src/sprites/icons/pflanzen';
import rohstoffe from '../../../assets-src/sprites/icons/rohstoffe';
import verarbeitung, { METALL_RAMPEN } from '../../../assets-src/sprites/icons/verarbeitung';
import werkzeuge from '../../../assets-src/sprites/icons/werkzeuge';
import { ICON_ANKER, ICON_GROESSE, ICON_GRUPPE } from '../../../assets-src/sprites/icons/_icon';
import { oklabDistance, paletteOklab, type Oklab } from '../../../assets-src/lib/color';
import { MATERIAL_BITS, MAX_SPRITE_COLORS, TRANSPARENT, spriteColorCount, spriteHasEmissive, type Sprite, type SpriteFrame } from '../../../assets-src/lib/sprite';
import { paletteIndex, paletteRef } from '../../../assets-src/palette';
import { checkSprite } from '../../../tools/assets/spriteChecks';
import { HEILMITTEL } from '../../../src/content/items/heilmittel';
import { VERARBEITUNG } from '../../../src/content/items/verarbeitung';
import { BRONZEWERKZEUGE } from '../../../src/content/items/verarbeitung_bronzewerkzeuge';

const ICONS: readonly Sprite[] = [...verarbeitung, ...bronzewerkzeuge, ...heilmittel];
const M3_ICONS: readonly Sprite[] = [...rohstoffe, ...nahrung, ...pflanzen, ...werkzeuge, ...grundlagen];
const ITEM_IDS = [...VERARBEITUNG, ...BRONZEWERKZEUGE, ...HEILMITTEL].map((i) => i.id);
const KONTUR = paletteIndex('nacht.1');
/** Mindestanteil der Randpixel in `nacht.1` (wie icons.test.ts). */
const KONTUR_ANTEIL = 0.65;
/** Mindestzahl deckender Pixel: klare Silhouette auch bei schlanken Dingen (3/16 der Zelle). */
const MIN_PIXEL = 48;
/** Mindestabstand der mittleren Metallfarben zweier Barren (OKLab; ≈ 0,02 ist gerade sichtbar). */
const MIN_METALL_ABSTAND = 0.08;
/** Mindestabstand der mittleren Kopffarbe Bronze ↔ Stein je Werkzeugart (OKLab). */
const MIN_KOPF_ABSTAND = 0.09;
/** Buntheit (OKLab-Chroma der mittleren Kopffarbe): Bronze mindestens, Stein höchstens. */
const MIN_CHROMA_BRONZE = 0.06;
const MAX_CHROMA_STEIN = 0.03;
/** Bronze liegt im Farbton mindestens so weit Richtung Gelb wie Kupfer [Grad OKLCH]. */
const BRONZE_GELBER_ALS_KUPFER_GRAD = 15;
const LAB = paletteOklab();

function icon(id: string, liste: readonly Sprite[] = ICONS): Sprite {
  const s = liste.find((x) => x.id === `icon_${id}`);
  if (s === undefined) throw new Error(`icon_${id} fehlt`);
  return s;
}

function frame0(s: Sprite): SpriteFrame {
  const f = s.frames[0];
  if (f === undefined) throw new Error(`${s.id}: kein Frame`);
  return f;
}

function deckend(s: Sprite, f: SpriteFrame, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < s.w && y < s.h && (f.index[y * s.w + x] ?? TRANSPARENT) !== TRANSPARENT;
}

/** Palettenindizes der Pixel mit Metallflag. */
function metallPixel(s: Sprite): number[] {
  const f = frame0(s);
  const out: number[] = [];
  f.index.forEach((v, p) => {
    if (v !== TRANSPARENT && ((f.material[p] ?? 0) & MATERIAL_BITS.metall) !== 0) out.push(v);
  });
  return out;
}

/** Pixel einer Rampe (`stein` …). */
function rampenPixel(s: Sprite, rampe: string): number[] {
  return [...frame0(s).index].filter((v) => v !== TRANSPARENT && paletteRef(v).startsWith(`${rampe}.`));
}

function mittel(indizes: readonly number[]): Oklab {
  const n = Math.max(1, indizes.length);
  const sum = indizes.reduce((acc, v) => {
    const c = LAB[v - 1] ?? { L: 0, a: 0, b: 0 };
    return { L: acc.L + c.L, a: acc.a + c.a, b: acc.b + c.b };
  }, { L: 0, a: 0, b: 0 });
  return { L: sum.L / n, a: sum.a / n, b: sum.b / n };
}

const farbton = (c: Oklab): number => (Math.atan2(c.b, c.a) * 180) / Math.PI;
const chroma = (c: Oklab): number => Math.hypot(c.a, c.b);

const maske = (s: Sprite): string => Array.from(frame0(s).index, (v) => (v === TRANSPARENT ? 0 : 1)).join('');

describe('M4-10/M4-35 Icons der Verarbeitungsprodukte, Bronzewerkzeuge und Schiene', () => {
  it('jedes Item der drei Gruppen hat genau ein Icon icon_<itemId> in der Gruppe icons', () => {
    expect(ITEM_IDS).toHaveLength(16 + 6 + 1);
    const ids = ICONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ITEM_IDS.map((id) => `icon_${id}`).sort());
    for (const s of ICONS) expect(s.group, s.id).toBe(ICON_GRUPPE);
  });

  it('16×16, ein Frame, Anker unten Mitte, kein Sonnenschatten, Motiv mit 1 px Luft und klarer Silhouette', () => {
    for (const s of ICONS) {
      expect([s.w, s.h, s.frames.length], s.id).toEqual([ICON_GROESSE, ICON_GROESSE, 1]);
      expect(s.anchor, s.id).toEqual(ICON_ANKER);
      expect(s.schatten, s.id).toBe('none');
      const f = frame0(s);
      for (let i = 0; i < ICON_GROESSE; i++) {
        for (const [x, y] of [
          [i, 0],
          [i, s.h - 1],
          [0, i],
          [s.w - 1, i],
        ] as const) {
          expect(deckend(s, f, x, y), `${s.id} Rand (${x}, ${y})`).toBe(false);
        }
      }
      expect(f.index.filter((v) => v !== TRANSPARENT).length, s.id).toBeGreaterThanOrEqual(MIN_PIXEL);
    }
  });

  it('Kontur nacht.1 rundum', () => {
    for (const s of ICONS) {
      const f = frame0(s);
      let rand = 0;
      let kontur = 0;
      for (let y = 0; y < s.h; y++) {
        for (let x = 0; x < s.w; x++) {
          if (!deckend(s, f, x, y)) continue;
          if (deckend(s, f, x - 1, y) && deckend(s, f, x + 1, y) && deckend(s, f, x, y - 1) && deckend(s, f, x, y + 1)) continue;
          rand++;
          if (f.index[y * s.w + x] === KONTUR) kontur++;
        }
      }
      expect(kontur / rand, s.id).toBeGreaterThanOrEqual(KONTUR_ANTEIL);
    }
  });

  it('≤ 12 reine Palettenfarben ohne Ausnahme, keine Befunde des Paletten-Validators, nichts leuchtet', () => {
    for (const s of ICONS) {
      expect(s.farbFehler, s.id).toEqual([]);
      expect(s.fremdFarben, s.id).toBe(0);
      expect(spriteColorCount(s), s.id).toBeLessThanOrEqual(MAX_SPRITE_COLORS);
      expect(s.ausnahmeFarben, s.id).toBeNull();
      expect(checkSprite(s), s.id).toEqual({ errors: [], warnings: [] });
      expect(spriteHasEmissive(s), s.id).toBe(false);
    }
  });

  it('jedes Icon ist verschieden – untereinander und von den M3-Icons', () => {
    const bilder = new Map<string, string>();
    for (const s of [...M3_ICONS, ...ICONS]) {
      const bild = frame0(s).index.join(',');
      expect(bilder.get(bild), s.id).toBeUndefined();
      bilder.set(bild, s.id);
    }
  });
});

describe('M4-10 Metalle', () => {
  const barren = { kupfer: icon('kupferbarren'), zinn: icon('zinnbarren'), bronze: icon('bronzebarren') } as const;

  it('eine Barrenform, jedes Metallpixel mit Metallflag in der Rampe seines Metalls', () => {
    const formen = new Set(Object.values(barren).map(maske));
    expect(formen.size).toBe(1);
    for (const [metall, s] of Object.entries(barren)) {
      const rampe = new Set(Object.values(METALL_RAMPEN[metall as keyof typeof METALL_RAMPEN]).map((r) => paletteIndex(r)));
      const f = frame0(s);
      f.index.forEach((v, p) => {
        if (v === TRANSPARENT || v === KONTUR) return;
        expect(rampe.has(v), `${s.id} ${paletteRef(v)}`).toBe(true);
        expect((f.material[p] ?? 0) & MATERIAL_BITS.metall, `${s.id} Metallflag`).toBe(MATERIAL_BITS.metall);
      });
    }
  });

  it('Kupfer, Zinn und Bronze teilen keine Farbe und liegen deutlich auseinander; Bronze ist gelber als Kupfer', () => {
    const farben = Object.fromEntries(Object.entries(barren).map(([m, s]) => [m, new Set(metallPixel(s))])) as Record<keyof typeof barren, Set<number>>;
    const paare = [
      ['kupfer', 'zinn'],
      ['kupfer', 'bronze'],
      ['zinn', 'bronze'],
    ] as const;
    for (const [a, b] of paare) {
      expect([...farben[a]].filter((v) => farben[b].has(v)), `${a}/${b}`).toEqual([]);
      expect(oklabDistance(mittel(metallPixel(barren[a])), mittel(metallPixel(barren[b]))), `${a}/${b}`).toBeGreaterThanOrEqual(MIN_METALL_ABSTAND);
    }
    expect(farbton(mittel(metallPixel(barren.bronze))) - farbton(mittel(metallPixel(barren.kupfer)))).toBeGreaterThanOrEqual(BRONZE_GELBER_ALS_KUPFER_GRAD);
    // Der Bronzenagel ist aus derselben Bronze wie der Barren.
    for (const v of metallPixel(icon('nagel_bronze'))) expect(farben.bronze.has(v), paletteRef(v)).toBe(true);
  });

  it('Bronzewerkzeuge: Kopf nur in der Bronzerampe mit Metallflag, bunt und klar entfernt vom grauen Steinkopf derselben Art', () => {
    const bronze = new Set(Object.values(METALL_RAMPEN.bronze).map((r) => paletteIndex(r)));
    for (const s of bronzewerkzeuge) {
      const kopf = metallPixel(s);
      expect(kopf.length, s.id).toBeGreaterThanOrEqual(12);
      for (const v of kopf) expect(bronze.has(v), `${s.id} ${paletteRef(v)}`).toBe(true);
      expect(rampenPixel(s, 'stein').filter((v) => !['stein.3', 'stein.5'].includes(paletteRef(v))), `${s.id}: nur Garn in stein`).toEqual([]);
      const art = s.id.replace('icon_bronze', '');
      const steinKopf = rampenPixel(icon(`stein${art}`, werkzeuge), 'stein');
      expect(oklabDistance(mittel(kopf), mittel(steinKopf)), s.id).toBeGreaterThanOrEqual(MIN_KOPF_ABSTAND);
      expect(chroma(mittel(kopf)), s.id).toBeGreaterThanOrEqual(MIN_CHROMA_BRONZE);
      expect(chroma(mittel(steinKopf)), s.id).toBeLessThanOrEqual(MAX_CHROMA_STEIN);
    }
  });
});

describe('M4-10 Keramik und Glas', () => {
  it('Glas glänzt: jedes Glaspixel trägt das Glanzflag', () => {
    const s = icon('glas');
    const f = frame0(s);
    let glas = 0;
    f.index.forEach((v, p) => {
      if (v === TRANSPARENT || v === KONTUR) return;
      glas++;
      expect((f.material[p] ?? 0) & MATERIAL_BITS.nass, paletteRef(v)).toBe(MATERIAL_BITS.nass);
    });
    expect(glas).toBeGreaterThanOrEqual(MIN_PIXEL);
  });

  it('Roh- und Brandziegel: gleiche Form, roh lehmfarben (ohne Rot), gebrannt ziegelrot (laub)', () => {
    const roh = icon('ziegel_roh');
    const gebrannt = icon('ziegel');
    expect(maske(roh)).toBe(maske(gebrannt));
    const innen = (s: Sprite): string[] => [...frame0(s).index].filter((v) => v !== TRANSPARENT && v !== KONTUR).map(paletteRef);
    expect(innen(roh).some((r) => r.startsWith('laub.'))).toBe(false);
    expect(innen(gebrannt).every((r) => r.startsWith('laub.'))).toBe(true);
  });
});
