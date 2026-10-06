/**
 * Validator-Regel `orte` (M7-07 … M7-09; tools/validator/orte.ts) mit Fixtures: ein vollständiger Ortstyp mit Vorlage und
 * Beute besteht; ein fehlendes Kartensymbol, eine zu kurze Wächter-Leine, eine Vorlage, die nicht in die Slot-Scheibe passt,
 * eine 2×2-Stellfläche in einer drehbaren Vorlage oder auf `.`-Zellen, ein Monument auf der Slot-Mitte, eine Truhe ohne
 * Beutetabelle, eine Wirkung ohne ihre Marke und eine Beutetabelle ohne Ortstyp sind Fehler. Der echte Content besteht.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CONTENT } from '../../../src/content/index';
import { ContentRegistry, type ContentRegistryView } from '../../../src/content/registry';
import { idSchema } from '../../../src/content/schema/common';
import { checkPlaces, slotRadius } from '../../../tools/validator/orte';

const loose = z.object({ id: idSchema }).passthrough();
const TEXT = { de: 'Text', en: 'Text' };

interface Probe {
  type?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  loot?: { id: string }[];
  profile?: Record<string, unknown>;
}

/** A shrine (radius 3) with one 5 × 5 layout: the 2×1 shrine north of the centre, a chest, a guard. */
function registry(p: Probe = {}): ContentRegistryView {
  return new ContentRegistry()
    .defineCollection('conditions', loose, [{ id: 'gesegnet' }])
    .defineCollection('aiProfiles', loose, [{ id: 'probe', streifen: 6, ...p.profile }])
    .defineCollection('creatures', loose, [{ id: 'probe', ki: 'probe' }])
    .defineCollection('worldObjects', loose, [
      { id: 'ort_schrein', footprint: { w: 2, h: 1 }, blocking: true },
      { id: 'ort_truhe_1', footprint: { w: 1, h: 1 }, blocking: true },
      { id: 'ort_turm', footprint: { w: 2, h: 2 }, blocking: true },
    ])
    .defineCollection('locationTypes', loose, [
      {
        id: 'schrein',
        name: TEXT,
        zaehlt: true,
        kartensymbol: 'karte_ort_schrein',
        waechter: [{ creature: 'probe', anzahl: 1 }],
        wirkung: 'segen',
        segen: { zustand: 'gesegnet', sekunden: 60, abklingTage: 1 },
        ...p.type,
      },
    ])
    .defineCollection('placeLayouts', loose, [
      {
        id: 'schrein_gruenhain_01',
        ortstyp: 'schrein',
        biom: 'gruenhain',
        drehbar: false,
        legende: { X: { objekt: 'ort_schrein', marke: 'altar' }, '#': { boden: 'strasse' }, C: { objekt: 'ort_truhe_1', marke: 'truhe', daten: '1' }, W: { marke: 'waechter' } },
        zeilen: ['.....', '.X#C.', '.###.', '..W..', '.....'],
        ...p.layout,
      },
    ])
    .defineCollection('placeLoot', loose, p.loot ?? [{ id: 'ort_schrein_1' }]);
}

const SPRITES = new Set(['karte_ort_schrein']);

function errors(p: Probe = {}): string[] {
  return checkPlaces(registry(p), SPRITES).errors;
}

describe('Regel `orte` (M7-07)', () => {
  it('ein vollständiger Ortstyp besteht', () => {
    expect(errors()).toEqual([]);
  });

  it('Kartensymbol, Wächter-Leine und Segen-Zustand', () => {
    expect(checkPlaces(registry(), new Set()).errors).toEqual(['Ortstyp schrein: Kartensymbol karte_ort_schrein fehlt (Sprite)']);
    expect(errors({ profile: { streifen: 20 } })).toEqual(['Ortstyp schrein: Leine 12 Kacheln des Wächters probe kürzer als sein Streifradius 20']);
    expect(errors({ type: { waechter: [{ creature: 'probe', anzahl: 1, leineTiles: 25 }] }, profile: { streifen: 20 } })).toEqual([]);
    expect(errors({ type: { segen: { zustand: 'fehlt', sekunden: 60, abklingTage: 1 } } })).toEqual(['Ortstyp schrein: Segen-Zustand fehlt fehlt']);
  });

  it('die Vorlage muss in die Slot-Scheibe passen; Brückenruinen stehen außerhalb', () => {
    expect(slotRadius('schrein')).toBe(3);
    expect(slotRadius('brueckenruine')).toBeNull();
    const wide = ['.........', '.........', '.........', '.........', 'C...X#...', '.........', '.........', '.........', '.........'];
    expect(errors({ layout: { zeilen: wide } })).toContain('Ortsvorlage schrein_gruenhain_01: passt in keiner Lage in die Slot-Scheibe (Radius 3)');
  });

  it('Stellflächen: nur 1×1 in drehbaren Vorlagen, nie auf `.`, nie über der Mitte', () => {
    expect(errors({ layout: { drehbar: true } })).toContain('Ortsvorlage schrein_gruenhain_01: ort_schrein (2×1) in einer gedrehten Vorlage');
    const legende = { T: { objekt: 'ort_turm', marke: 'altar' }, '#': { boden: 'erde' }, C: { objekt: 'ort_truhe_1', marke: 'truhe', daten: '1' } };
    expect(errors({ layout: { legende, zeilen: ['.....', '.....', 'T##C.', '.###.', '.....'] } })).toEqual([
      'Ortsvorlage schrein_gruenhain_01: Stellfläche von ort_turm bei 0,2 reicht auf 0,1 (außerhalb oder nicht gestempelt)',
      'Ortsvorlage schrein_gruenhain_01: Stellfläche von ort_turm bei 0,2 reicht auf 1,1 (außerhalb oder nicht gestempelt)',
    ]);
    expect(errors({ layout: { legende, zeilen: ['.....', '.##..', '.#T#C', '.###.', '.....'] } }).join('\n')).toMatch(/ort_turm bei 2,2 versperrt die Mitte 2,2/);
  });

  it('Marken: Truhe mit Stufe und Beutetabelle, die Marke der Wirkung', () => {
    expect(errors({ loot: [] })).toEqual(['Ortsvorlage schrein_gruenhain_01: Beutetabelle ort_schrein_1 fehlt']);
    const ohneAltar = { X: { objekt: 'ort_schrein' }, '#': { boden: 'strasse' }, C: { objekt: 'ort_truhe_1', marke: 'truhe', daten: '1' }, W: { marke: 'waechter' } };
    expect(errors({ layout: { legende: ohneAltar } })).toEqual(['Ortsvorlage schrein_gruenhain_01: Wirkung segen ohne Marke altar']);
    const falscheStufe = { X: { objekt: 'ort_schrein', marke: 'altar' }, '#': { boden: 'strasse' }, C: { objekt: 'ort_truhe_1', marke: 'truhe', daten: '2' }, W: { marke: 'waechter' } };
    expect(errors({ layout: { legende: falscheStufe } })).toEqual(['Ortsvorlage schrein_gruenhain_01: Truhe "C" steht nicht auf ort_truhe_<stufe> mit der Stufe als Datum']);
    expect(errors({ loot: [{ id: 'ort_schrein_1' }, { id: 'ort_gibtsnicht_1' }] })).toEqual(['Beutetabelle ort_gibtsnicht_1: kein Ortstyp gibtsnicht']);
  });

  it('der echte Content besteht (ohne Fehler; Warnungen nur für die Naturwunder kommender Biome)', () => {
    const sprites = new Set(CONTENT.collection('locationTypes').values().map((t) => t.kartensymbol));
    const res = checkPlaces(CONTENT, sprites);
    expect(res.errors).toEqual([]);
    expect(res.warnings).toEqual(['Ortstyp naturwunder: keine Vorlage für aschenschlund, scherbenhain – Slots dort bleiben ohne Gestalt']);
  });
});
