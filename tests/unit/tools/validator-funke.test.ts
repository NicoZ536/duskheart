/**
 * Validator-Regel `funke` (MASTERPROMPT §8 „Funke … höchstens 2 Zeilen pro Einwurf“; docs/SPIEL.md §23 „Funke“; M7-44): jeder
 * Funke-Kommentar und jede Zeile eines Funke-Dialogs umbricht in der Box (`BALANCE.guide.funkeTextWidthPx`) mit der echten
 * Pixelschrift auf höchstens `funkeMaxLines` Zeilen; ein Wort breiter als die Box ist nie zu setzen; mindestens 40 Kommentare.
 * Hier die Bausteine (Messung, Umbruch); den Inhalt prüft funke.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { checkFunke, pixelFontMeasure, wrappedLines } from '../../../tools/validator/funke';

describe('Validator-Regel funke', () => {
  const measure = pixelFontMeasure();

  it('misst mit der Pixelschrift: längere Texte sind breiter, ein Leerzeichen zählt, gleiche Texte gleich', () => {
    expect(measure('')).toBe(0);
    expect(measure('a')).toBeGreaterThan(0);
    expect(measure('aa')).toBeGreaterThan(measure('a'));
    expect(measure('a a')).toBeGreaterThan(measure('aa'));
    expect(measure('Funke')).toBe(measure('Funke'));
    // The box holds about fifty characters of the pixel font per line (the balance's reason).
    const zeile = 'Die Glut in deiner Laterne regt sich, sie flüstert.';
    expect(measure(zeile)).toBeLessThanOrEqual(BALANCE.guide.funkeTextWidthPx);
  });

  it('bricht gierig an Leerzeichen um; eine Zeile, die genau passt, bleibt eine', () => {
    const w = (t: string): number => t.length * 4;
    expect(wrappedLines('', 40, w)).toBe(0);
    expect(wrappedLines('aaaa bbbb', 36, w)).toBe(1);
    expect(wrappedLines('aaaa bbbb', 35, w)).toBe(2);
    expect(wrappedLines('aaaa bbbb cccc', 36, w)).toBe(2);
    expect(wrappedLines('aaaaaaaaaaa', 40, w)).toBe(Number.POSITIVE_INFINITY);
  });

  it('die Box des Spiels: jeder Kommentar und jede Dialogzeile in höchstens zwei Zeilen', () => {
    const res = checkFunke(CONTENT, measure);
    expect(res.errors).toEqual([]);
    for (const h of CONTENT.collection('guideHints').values().filter((x) => x.kanal === 'funke')) {
      for (const lang of ['de', 'en'] as const) expect(wrappedLines(h.text[lang], BALANCE.guide.funkeTextWidthPx, measure), `${h.id} ${lang}`).toBeLessThanOrEqual(BALANCE.guide.funkeMaxLines);
    }
  });
});
