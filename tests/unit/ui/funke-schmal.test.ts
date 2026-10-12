/**
 * Schmale Schilder im Baumodus (M7-142; MASTERPROMPT §26 „HUD … nie aufdringlich“, §8 „höchstens 2 Zeilen pro Einwurf“;
 * src/ui/hud/funke/schmal.ts): im Baumodus nimmt jedes Schild die schmalste ganze Breite, bei der sein Text seine Zeilen
 * behält – höchstens zwei, ein kurzer Einzeiler bleibt eine Zeile –, und beide Schilder enden bündig, so bleibt der obere
 * Weltstreifen neben der Spalte frei (`bau-vorschau`, `bau-abbauen-rot`, `bau-aufwerten`, `bau-blaupause`). Die Messung
 * im DOM liegt in Funke.tsx; hier die reinen Entscheidungen.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { buendigeBreiten, EINZEILIG_BIS_PX, schmalsteBreite } from '../../../src/ui/hud/funke/schmal';

/** Lines of a text of `laenge` design px of words of `wort` px each (a greedy word wrap) at width `breite`. */
function umbruch(laenge: number, wort: number): (breite: number) => number {
  return (breite) => {
    if (breite < wort) return Infinity;
    const jeZeile = Math.floor(breite / wort);
    return Math.ceil(laenge / wort / jeZeile);
  };
}

describe('schmalste Breite (schmalsteBreite)', () => {
  it('die kleinste ganze Breite, bei der der Text noch höchstens so viele Zeilen hat', () => {
    // 200 px of 20-px words: two lines from 100 px on, one line from 200 px on.
    const zeilen = umbruch(200, 20);
    expect(schmalsteBreite(zeilen, 1, 270, 2)).toBe(100);
    expect(zeilen(99)).toBe(3);
    expect(schmalsteBreite(zeilen, 1, 270, 1)).toBe(200);
    // Uneven: 7 words of 20 px need 80 px for two lines (4 + 3).
    expect(schmalsteBreite(umbruch(140, 20), 1, 256, 2)).toBe(80);
  });

  it('nie schmaler als `min`, nie breiter als `max`; braucht selbst `max` mehr Zeilen, bleibt es bei `max`', () => {
    expect(schmalsteBreite(umbruch(200, 20), 150, 270, 2)).toBe(150);
    expect(schmalsteBreite(umbruch(800, 20), 1, 270, 2)).toBe(270);
  });

  it('fragt nur ganze Breiten im Bereich und kommt mit wenigen Messungen aus (Halbierung)', () => {
    const gefragt: number[] = [];
    const zeilen = umbruch(230, 10);
    const breite = schmalsteBreite(
      (b) => {
        gefragt.push(b);
        return zeilen(b);
      },
      1,
      BALANCE.guide.hintTextWidthPx,
      2,
    );
    expect(zeilen(breite)).toBeLessThanOrEqual(2);
    expect(zeilen(breite - 1)).toBeGreaterThan(2);
    for (const b of gefragt) {
      expect(Number.isInteger(b)).toBe(true);
      expect(b).toBeGreaterThanOrEqual(1);
      expect(b).toBeLessThanOrEqual(BALANCE.guide.hintTextWidthPx);
    }
    expect(gefragt.length).toBeLessThanOrEqual(Math.ceil(Math.log2(BALANCE.guide.hintTextWidthPx)) + 2);
  });

  it('ein Einzeiler bis EINZEILIG_BIS_PX bleibt eine Zeile (kein Umbruch in zwei Stummel), die vollen Breiten liegen darüber', () => {
    expect(EINZEILIG_BIS_PX).toBeLessThan(BALANCE.guide.funkeTextWidthPx);
    expect(EINZEILIG_BIS_PX).toBeLessThan(BALANCE.guide.hintTextWidthPx);
    const kurz = umbruch(140, 20);
    expect(schmalsteBreite(kurz, 1, BALANCE.guide.hintTextWidthPx, 1)).toBe(140);
  });
});

describe('bündige Schilder (buendigeBreiten)', () => {
  it('beide enden am weiteren der beiden schmalen rechten Ränder', () => {
    // Funke's text starts 40 px in (beside the lantern), the hint's 8 px in.
    const [f, h] = buendigeBreiten({ links: 40, breite: 120, max: 256 }, { links: 8, breite: 100, max: 270 });
    expect(f).toBe(120);
    expect(h).toBe(152);
    expect(40 + (f ?? 0)).toBe(8 + (h ?? 0));
  });

  it('nie breiter als die eigene volle Breite', () => {
    const [f, h] = buendigeBreiten({ links: 0, breite: 60, max: 80 }, { links: 0, breite: 250, max: 270 });
    expect(f).toBe(80);
    expect(h).toBe(250);
  });

  it('ein fehlendes Schild: das andere behält seine schmale Breite', () => {
    expect(buendigeBreiten({ links: 40, breite: 120, max: 256 }, null)).toEqual([120, null]);
    expect(buendigeBreiten(null, { links: 8, breite: 100, max: 270 })).toEqual([null, 100]);
    expect(buendigeBreiten(null, null)).toEqual([null, null]);
  });

  it('schmaler als die vollen Breiten, die vorher den Streifen zwischen Werten und Minimap füllten', () => {
    const zwei = umbruch(300, 15);
    const f = schmalsteBreite(zwei, 1, BALANCE.guide.funkeTextWidthPx, 2);
    const h = schmalsteBreite(umbruch(200, 15), 1, BALANCE.guide.hintTextWidthPx, 2);
    const [bf, bh] = buendigeBreiten({ links: 40, breite: f, max: BALANCE.guide.funkeTextWidthPx }, { links: 8, breite: h, max: BALANCE.guide.hintTextWidthPx });
    expect(40 + (bf ?? 0)).toBeLessThan(40 + BALANCE.guide.funkeTextWidthPx);
    expect(8 + (bh ?? 0)).toBeLessThan(8 + BALANCE.guide.hintTextWidthPx);
  });
});
