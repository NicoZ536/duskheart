/**
 * M3-33/§27 subtitles of important sounds: the display keeps the newest three lines, each for three seconds;
 * the same text again refreshes its line (moved to the end) instead of stacking.
 */
import { describe, expect, it } from 'vitest';
import { UNTERTITEL, untertitelAktuell, untertitelAufnehmen, type UntertitelZeile } from '../../../src/ui/hud/Untertitel';

const T = (de: string): { de: string; en: string } => ({ de, en: `${de} (en)` });

describe('Untertitel', () => {
  it('zeigt die neuesten Zeilen, gleiche Texte frischen auf, alte laufen ab', () => {
    let z: UntertitelZeile[] = [];
    z = untertitelAufnehmen(z, T('Ein Baum fällt'), 0, 1);
    z = untertitelAufnehmen(z, T('Flüstern'), 100, 2);
    z = untertitelAufnehmen(z, T('Ein Baum fällt'), 200, 3);
    expect(z.map((l) => l.text.de)).toEqual(['Flüstern', 'Ein Baum fällt']);
    expect(z.at(-1)?.bis).toBe(200 + UNTERTITEL.dauerMs);
    for (let i = 0; i < 5; i++) z = untertitelAufnehmen(z, T(`Laut ${i}`), 300 + i, 10 + i);
    expect(z).toHaveLength(UNTERTITEL.maxZeilen);
    expect(z.map((l) => l.text.de)).toEqual(['Laut 2', 'Laut 3', 'Laut 4']);
    expect(untertitelAktuell(z, 302 + UNTERTITEL.dauerMs).map((l) => l.text.de)).toEqual(['Laut 3', 'Laut 4']);
    expect(untertitelAktuell(z, 10_000)).toEqual([]);
  });
});
