/**
 * M7-111 Hose unter der Tunika (Screenshot `figur-aussehen`: von der Hose blieb unter dem langen Rock nur ein Streifen). Der
 * Rock der Tunika endet seit M7-111 eine Zeile höher (Rumpf 9 Zeilen, `_spieler_teile.ts`, `_spieler_formen.ts`): in jeder
 * Körperform und jeder Richtung zeigt die stehende Figur zwei Zeilen Hose zwischen Saum und Stiefeln – die Hose trägt ihre
 * eigene Palettenzeile (Charaktererstellung, docs/SPIEL.md §26) und muss als Fläche lesbar sein. Die Figur bleibt gleich groß
 * (Kopf, Rumpf und Beine zusammen 24 Zeilen, Füße auf der Ankerzeile).
 */
import { describe, expect, it } from 'vitest';
import { RICHTUNGEN } from '../../../assets-src/lib/figure';
import { TRANSPARENT, type Sprite } from '../../../assets-src/lib/sprite';
import kleidung from '../../../assets-src/sprites/ausruestung/kleidung';
import { KOERPERFORMEN } from '../../../assets-src/sprites/figuren/_spieler_formen';
import { RUMPFE } from '../../../assets-src/sprites/figuren/_spieler_teile';
import spieler from '../../../assets-src/sprites/figuren/spieler_basis';
import { formSprites } from '../../../assets-src/sprites/figuren/spieler_formen';

/** Grundkörper, Tunika und Hose einer Form (`mittel`: die Sprites bis M6 unter ihren Namen). */
function figur(form: (typeof KOERPERFORMEN)[number]): { basis: Sprite; tunika: Sprite; hose: Sprite } {
  if (form === 'mittel') {
    const [tunika, hose] = kleidung;
    if (tunika === undefined || hose === undefined) throw new Error('Kleidung fehlt');
    return { basis: spieler, tunika, hose };
  }
  const [basis, , tunika, hose] = formSprites(form);
  if (basis === undefined || tunika === undefined || hose === undefined) throw new Error(`Form ${form} fehlt`);
  return { basis, tunika, hose };
}

/** Zeilen eines Frames, in denen die Hose sichtbar ist (deckend und nicht von der Tunika verdeckt). */
function hosenZeilen(f: { tunika: Sprite; hose: Sprite }, frame: number): number[] {
  const t = f.tunika.frames[frame]?.index;
  const h = f.hose.frames[frame]?.index;
  const zeilen = new Set<number>();
  h?.forEach((v, p) => {
    if (v !== TRANSPARENT && (t?.[p] ?? TRANSPARENT) === TRANSPARENT) zeilen.add(Math.floor(p / f.hose.w));
  });
  return [...zeilen].sort((a, b) => a - b);
}

describe('M7-111 Hose unter der Tunika', () => {
  it('der Rumpf reicht vom Kragen bis zum Saum über 9 Zeilen (Kopf 11 + Rumpf 9 + Beine 4 sichtbar = 24)', () => {
    for (const r of RICHTUNGEN) expect(RUMPFE[r].normal.h, r).toBe(9);
  });

  for (const form of KOERPERFORMEN) {
    it(`${form}: stehend zeigt die Hose in jeder Richtung zwei zusammenhängende Zeilen über den Stiefeln`, () => {
      const f = figur(form);
      for (const r of RICHTUNGEN) {
        // Every form plays the clips of `spieler_basis` on the same frames (M7-53).
        const idle = spieler.clips[`idle_${r}`]?.frames[0];
        if (idle === undefined || f.basis.frames.length !== spieler.frames.length) throw new Error(`idle_${r} fehlt`);
        const zeilen = hosenZeilen(f, idle);
        expect(zeilen.length, `${form} ${r}: Zeilen ${zeilen.join(', ')}`).toBeGreaterThanOrEqual(2);
        // One area: the rows follow each other (no single line between hem and boots).
        expect(zeilen.every((z, i) => i === 0 || z === (zeilen[i - 1] ?? z) + 1), `${form} ${r}`).toBe(true);
      }
    });
  }
});
