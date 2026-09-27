/**
 * The hint line of the build mode (src/ui/screens/bau/hinweise.ts; MASTERPROMPT §26, M4-38, Review M4 "Hinweiszeile
 * bricht um"): only the gestures of the tool in use – placing with its blueprint toggle (lit while on), turn or mirror
 * where the piece allows it, pipette, undo and the selection by keys; dismantling with cancel (confirm while a large
 * dismantling waits); upgrading with the pipette; repairing with cancel – and one row always: hints of the lowest
 * priority give way first, never the primary one, the order on screen stays. Every text in German and English.
 */
import { describe, expect, it } from 'vitest';
import { createI18n } from '../../../src/i18n';
import { BUILD_TOOLS } from '../../../src/render/game/ghost';
import { bauHinweise, HINWEIS_PRIORITAET, verborgeneHinweise, type HinweisLage } from '../../../src/ui/screens/bau/hinweise';
import type { BauEintrag } from '../../../src/ui/screens/bau/katalog';

function eintrag(id: string, o: Partial<BauEintrag>): BauEintrag {
  return { id, source: 'bauteil', kategorie: 'waende', kind: 'wand', name: { de: id, en: id }, stufe: 0, b: 1, t: 1, drehbar: false, spiegelbar: false, ziehen: 'einzeln', ...o };
}
const WAND = eintrag('wand_holz', { ziehen: 'linie' });
const TOR = eintrag('tor_holz', { kind: 'tor', drehbar: true });
const TISCH = eintrag('tisch_holz', { kind: 'moebel', spiegelbar: true });

function lage(o: Partial<HinweisLage>): HinweisLage {
  return { katalog: false, werkzeug: 'setzen', gewaehlt: WAND, pad: false, blaupause: false, wartet: false, ...o };
}

describe('Hinweiszeile je Werkzeug', () => {
  it('Setzen: ziehen oder setzen, Blaupause (leuchtet, solange an), drehen nur mit Richtung, spiegeln nur spiegelbar, Pipette, Rückgängig, Auswahl', () => {
    expect(bauHinweise(lage({})).map((h) => [h.action, h.key])).toEqual([
      ['attack', 'ui.bau.taste.ziehen'],
      ['blueprint', 'ui.bau.taste.blaupause'],
      ['pipette', 'ui.bau.taste.pipette'],
      ['undo', 'ui.bau.taste.rueckgaengig'],
      ['inventory', 'ui.bau.taste.auswahl'],
    ]);
    expect(bauHinweise(lage({ blaupause: true })).find((h) => h.action === 'blueprint')?.an).toBe(true);
    // Turning: the secondary button with keyboard and mouse, its own button on the pad.
    expect(bauHinweise(lage({ gewaehlt: TOR })).map((h) => h.action)).toContain('block');
    expect(bauHinweise(lage({ gewaehlt: TOR, pad: true })).map((h) => h.action)).toContain('rotate');
    expect(bauHinweise(lage({ gewaehlt: TISCH })).map((h) => [h.action, h.key])).toContainEqual(['mirror', 'ui.bau.taste.spiegeln']);
    expect(bauHinweise(lage({ gewaehlt: TISCH }))[0]?.key).toBe('ui.bau.taste.setzen');
  });

  it('die anderen Werkzeuge zeigen nur ihre Gesten; die Auswahl mit Tasten ihre eigenen', () => {
    expect(bauHinweise(lage({ werkzeug: 'abbauen' })).map((h) => [h.action, h.key])).toEqual([
      ['attack', 'ui.bau.taste.abbauen'],
      ['block', 'ui.bau.taste.abbrechen'],
      ['undo', 'ui.bau.taste.rueckgaengig'],
      ['inventory', 'ui.bau.taste.auswahl'],
    ]);
    expect(bauHinweise(lage({ werkzeug: 'abbauen', wartet: true })).map((h) => [h.action, h.key])).toEqual([
      ['attack', 'ui.bau.taste.bestaetigen'],
      ['block', 'ui.bau.taste.abbrechen'],
    ]);
    expect(bauHinweise(lage({ werkzeug: 'aufwerten' })).map((h) => h.key)).toEqual(['ui.bau.taste.aufwertenZiehen', 'ui.bau.taste.abbrechen', 'ui.bau.taste.pipette', 'ui.bau.taste.auswahl']);
    expect(bauHinweise(lage({ werkzeug: 'aufwerten', gewaehlt: TISCH }))[0]?.key).toBe('ui.bau.taste.aufwerten');
    expect(bauHinweise(lage({ werkzeug: 'reparieren' })).map((h) => h.key)).toEqual(['ui.bau.taste.reparieren', 'ui.bau.taste.abbrechen', 'ui.bau.taste.rueckgaengig']);
    expect(bauHinweise(lage({ katalog: true })).map((h) => h.action)).toEqual(['uiConfirm', 'uiTabNext', 'uiBack']);
    // No tool shows the tools or leaving: they stand in the tool bar.
    for (const werkzeug of BUILD_TOOLS) for (const h of bauHinweise(lage({ werkzeug }))) expect(['build', 'toolNext', 'toolPlace', 'toolDismantle', 'toolUpgrade', 'toolRepair']).not.toContain(h.action);
  });

  it('jeder Text steht auf Deutsch und Englisch', () => {
    const de = createI18n('de', { strict: true });
    const en = createI18n('en', { strict: true });
    const keys = new Set<string>();
    for (const werkzeug of BUILD_TOOLS) for (const gewaehlt of [WAND, TOR, TISCH]) for (const wartet of [false, true]) for (const h of bauHinweise(lage({ werkzeug, gewaehlt, wartet }))) keys.add(h.key);
    for (const h of bauHinweise(lage({ katalog: true }))) keys.add(h.key);
    for (const k of keys) {
      expect(de.t(k).length, k).toBeGreaterThan(0);
      expect(en.t(k).length, k).toBeGreaterThan(0);
    }
  });
});

describe('eine Zeile: was nicht passt, weicht nach Wichtigkeit', () => {
  it('passt alles, bleibt alles; sonst zuerst die Pipette, dann die Auswahl, dann Rückgängig – nie die Primärtaste, die Reihenfolge bleibt', () => {
    const h = bauHinweise(lage({ gewaehlt: TISCH }));
    // attack, blueprint, mirror, pipette, undo, inventory
    const breiten = [48, 62, 56, 71, 92, 61];
    const summe = breiten.reduce((a, b) => a + b, 0) + 5 * 5;
    expect([...verborgeneHinweise(h, breiten, 5, summe)]).toEqual([]);
    expect([...verborgeneHinweise(h, breiten, 5, summe - 1)]).toEqual([3]);
    expect([...verborgeneHinweise(h, breiten, 5, summe - 71 - 5 - 1)].sort()).toEqual([3, 5]);
    expect([...verborgeneHinweise(h, breiten, 5, 150)].sort()).toEqual([1, 3, 4, 5]);
    // Nothing fits: the primary gesture stays anyway.
    expect(verborgeneHinweise(h, breiten, 5, 10).has(0)).toBe(false);
    expect(HINWEIS_PRIORITAET.primaer).toBeLessThan(HINWEIS_PRIORITAET.pipette);
  });
});
