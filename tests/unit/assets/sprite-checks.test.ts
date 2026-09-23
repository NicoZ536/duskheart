/**
 * M1-04: Paletten-Validator mit Verstoß-Fixtures (tests/fixtures/sprites/verstoesse, sauber) – nur
 * Palettenfarben, ≤ 12 Farben inkl. Outline (Ausnahme nur mit Begründung), Warnung bei verwaisten
 * Einzelpixeln – und seine Einbindung in `validate:content` (`runChecks`).
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSprites } from '../../../tools/assets/sources';
import { checkSprite, checkSprites, findOrphanPixels } from '../../../tools/assets/spriteChecks';
import { checkSpriteSources, runChecks } from '../../../tools/validator/checks';

const VERSTOESSE = fileURLToPath(new URL('../../fixtures/sprites/verstoesse', import.meta.url));
const SAUBER = fileURLToPath(new URL('../../fixtures/sprites/sauber', import.meta.url));
const LEER = fileURLToPath(new URL('../../fixtures/sprites/nutzung/src', import.meta.url));

describe('Paletten-Validator', () => {
  it('Verstoß-Fixtures: Fremdfarbe und 13 Farben sind Fehler, Einzelpixel eine Warnung', async () => {
    const { sprites, errors } = await loadSprites(VERSTOESSE);
    expect(errors).toEqual([]);
    const res = checkSprites(sprites.map((l) => l.sprite));
    expect(res.errors).toEqual([
      expect.stringMatching(/^Sprite fx_fremdfarbe: nur Palettenfarben erlaubt – Legende "p": #ff00ff ist keine Palettenfarbe \(nächste: /),
      expect.stringMatching(/^Sprite fx_fremdfarbe: nur Palettenfarben erlaubt – Legende "m": moor\.2 ist keine Palettenfarbe/),
      'Sprite fx_zu_viele_farben: 13 Farben, höchstens 12 inkl. Outline (Ausnahme nur mit ausnahmeFarben: \'Begründung\')',
    ]);
    expect(res.warnings).toEqual(['Sprite fx_einzelpixel: 2 verwaiste Einzelpixel F0(0,0) F0(3,3)']);
  });

  it('saubere Fixtures: begründete Ausnahmen und exakte Hexfarben sind erlaubt', async () => {
    const { sprites, errors } = await loadSprites(SAUBER);
    expect(errors).toEqual([]);
    expect(sprites.map((l) => l.sprite.id)).toEqual(['fx_verlauf', 'fx_funken']);
    expect(checkSprites(sprites.map((l) => l.sprite))).toEqual({ errors: [], warnings: [] });
    const funken = sprites[1]?.sprite;
    // Zwei frei schwebende Funken oben; der Funke über der Glut hat Nachbarn und gilt nicht als verwaist.
    expect(funken === undefined ? [] : findOrphanPixels(funken)).toHaveLength(2);
  });

  it('die Fremdfarbe zählt bei der Farbgrenze mit', async () => {
    const { sprites } = await loadSprites(VERSTOESSE);
    const fremd = sprites.find((l) => l.sprite.id === 'fx_fremdfarbe')?.sprite;
    expect(fremd?.fremdFarben).toBe(2);
    expect(fremd === undefined ? [] : checkSprite(fremd).errors).toHaveLength(2);
  });

  it('checkSpriteSources meldet Ladefehler, Palettenfehler und Warnungen für einen Sprite-Ordner', async () => {
    const res = await checkSpriteSources(VERSTOESSE, LEER);
    expect(res.errors).toHaveLength(3);
    expect(res.warnings).toContain('Sprite fx_einzelpixel: 2 verwaiste Einzelpixel F0(0,0) F0(3,3)');
    expect(res.warnings.filter((w) => w.includes('nirgends verwendet'))).toHaveLength(3);
  });

  it('ist in validate:content eingebunden: die echten Sprites sind palettenrein', async () => {
    const res = await runChecks();
    expect(res.errors).toEqual([]);
    expect(res.warnings.filter((w) => /Farben|Einzelpixel/.test(w))).toEqual([]);
  });
});
