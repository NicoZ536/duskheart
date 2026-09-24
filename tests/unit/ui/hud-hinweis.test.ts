/**
 * M3-27/M3-37: whether the HUD shows the interaction hint (src/ui/hud/Hud.tsx `hudZeigtHinweis`) – then the
 * world marker over the target shows only the key cap (no text twice). The HUD shows it while it is visible
 * (the UI layer not hidden for a screenshot, or a HUD scenario keeps it, `hudVorgabe`) in Voll and
 * Kontextuell; never in Minimal.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { hudVorgabe, hudZeigtHinweis } from '../../../src/ui/hud';

describe('HUD-Hinweis und Welt-Marker', () => {
  afterEach(() => {
    hudVorgabe.value = null;
  });

  it('im Spiel: sichtbare Oberfläche in Voll und Kontextuell, nicht in Minimal, nicht versteckt', () => {
    expect(hudZeigtHinweis(true, 'full')).toBe(true);
    expect(hudZeigtHinweis(true, 'contextual')).toBe(true);
    expect(hudZeigtHinweis(true, 'minimal')).toBe(false);
    expect(hudZeigtHinweis(false, 'full')).toBe(false);
  });

  it('ein HUD-Szenario hält das HUD im Screenshot-Modus sichtbar und gibt den Modus vor', () => {
    hudVorgabe.value = { modus: 'full' };
    expect(hudZeigtHinweis(false, 'minimal')).toBe(true);
    hudVorgabe.value = { modus: 'minimal' };
    expect(hudZeigtHinweis(false, 'full')).toBe(false);
    expect(hudZeigtHinweis(true, 'full')).toBe(false);
  });
});
