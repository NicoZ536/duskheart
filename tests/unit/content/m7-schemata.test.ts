/**
 * M7-Verträge im Content (M7-01, docs/SPIEL.md §17, §29, ADR-0207): die Auslöser-Sprache (`triggerSchema`), die Item-Blöcke
 * und Quellenarten im Item-Schema, die Schemas der Beobachter-Tabellen (Chronik-Regeln, Wissen, Statistiken, Meilensteine,
 * Hinweise, Vermittlungs-Register) und der Orte; die Sammlungen sind registriert – leer, bis die Stränge ihre Dateien in die
 * Sammeldateien eintragen.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import { chronicleRuleSchema, knowledgeSchema } from '../../../src/content/chronik/schema';
import { guideHintSchema } from '../../../src/content/guide/schema';
import { placeDefSchema, placeLayoutSchema, placeLootSchema } from '../../../src/content/places/schema';
import { ITEM_SOURCE_KINDS, itemSchema, parseItemSource, type ItemInput } from '../../../src/content/schema/item';
import { TRIGGER_KINDS, forEachTrigger, triggerSchema, type Trigger } from '../../../src/content/schema/trigger';
import { milestoneSchema, statSchema, statSourceSchema } from '../../../src/content/stats/schema';
import { mechanicSchema } from '../../../src/content/vermittlung/schema';

const T = { de: 'Text', en: 'Text' };

/** One trigger of every kind, nested in the combinations. */
const EVERY: Trigger[] = [
  { art: 'ereignis', ereignis: 'placeDiscovered', wo: { ortstyp: 'schrein', layer: 0, neu: true }, anzahl: 2 },
  { art: 'statistik', statistik: 'kills', schluessel: 'wolf', mindestens: 5 },
  { art: 'besitz', item: 'bronzebarren', anzahl: 1 },
  { art: 'zustand', zustand: 'frierend' },
  { art: 'uhr', tag: 1, vorStunde: 19 },
  { art: 'lichtstufe', hoechstens: 0.15 },
  { art: 'raum', innen: true, raumtyp: 'kueche' },
  { art: 'freischaltung', freischaltung: 'lf1_lumen_laterne' },
  { art: 'aufgabe', aufgabe: 'einstieg', schritt: 'steinaxt', status: 'erledigt' },
  { art: 'ort', ortstyp: 'leuchtfeuer' },
];

describe('Auslöser-Sprache (src/content/schema/trigger.ts)', () => {
  it('jede Art wird angenommen, auch verschachtelt; der Gang besucht alle', () => {
    const all: Trigger = { art: 'alle', von: [{ art: 'eines', von: EVERY }, { art: 'nicht', von: { art: 'zustand', zustand: 'muede' } }] };
    expect(triggerSchema.parse(all)).toEqual(all);
    const kinds = new Set<string>();
    forEachTrigger(all, (t) => kinds.add(t.art));
    expect([...kinds].sort()).toEqual([...TRIGGER_KINDS].sort());
  });

  it('lehnt Unvollständiges und Fremdes ab', () => {
    const bad: unknown[] = [
      { art: 'uhr' },
      { art: 'raum' },
      { art: 'lichtstufe' },
      { art: 'ereignis', ereignis: 'Place-Discovered' },
      { art: 'ereignis', ereignis: 'tileDug', anzahl: 0 },
      { art: 'besitz', item: 'Stein', anzahl: 1 },
      { art: 'alle', von: [] },
      { art: 'nicht', von: { art: 'erfunden' } },
      { art: 'aufgabe', aufgabe: 'einstieg', status: 'halb' },
      { art: 'zustand', zustand: 'muede', extra: 1 },
    ];
    for (const t of bad) expect(triggerSchema.safeParse(t).success, JSON.stringify(t)).toBe(false);
  });
});

describe('Item-Blöcke und Quellenarten M7 (src/content/schema/itemBlocks.ts)', () => {
  const base: ItemInput = {
    id: 'probe',
    name: T,
    beschreibung: T,
    kategorie: 'rohstoff',
    stufe: 0,
    raritaet: 'gewoehnlich',
    stapel: 100,
    tauschwert: 1,
    sounds: { aufheben: 'sfx_item_aufheben' },
  };
  const ok = (extra: Partial<ItemInput>): boolean => itemSchema.safeParse({ ...base, ...extra }).success;

  it('jeder Block als optionales Feld; eine Saat ist Saatgut mit genau einem Ziel', () => {
    expect(ok({ kategorie: 'saatgut', stapel: 100, saat: { pflanze: 'karotte' } })).toBe(true);
    expect(ok({ saat: { pflanze: 'karotte' } })).toBe(false);
    expect(ok({ kategorie: 'saatgut', saat: { pflanze: 'karotte' }, pflanzt: 'baum_eiche' })).toBe(false);
    expect(ok({ kategorie: 'saatgut' })).toBe(false);
    expect(ok({ duenger: { fruchtbarkeit: 30 }, endprodukt: true })).toBe(true);
    expect(ok({ duenger: { fruchtbarkeit: 130 } })).toBe(false);
    expect(ok({ koeder: { biss: 0.2, fische: ['forelle'] } })).toBe(true);
    expect(ok({ kategorie: 'gericht', stapel: 20, essbar: { saettigung: 30, durst: 0 }, mahlzeit: { zustaende: [{ id: 'gestaerkt', sekunden: 600 }], wohlfuehl: 20, salz: 5 } })).toBe(true);
    expect(ok({ kategorie: 'gericht', stapel: 20, essbar: { saettigung: 30, durst: 0 }, mahlzeit: { zustaende: [], wohlfuehl: 30 } })).toBe(false);
    expect(ok({ mahlzeit: { zustaende: [{ id: 'gestaerkt', sekunden: 600 }] } })).toBe(false);
    expect(ok({ kategorie: 'trank', stapel: 20, trank: { gibt: [], heilt: ['vergiftung'] } })).toBe(true);
    expect(ok({ trank: { gibt: [], heilt: ['vergiftung'] } })).toBe(false);
    expect(ok({ kategorie: 'trank', stapel: 20, trank: { gibt: [], heilt: [] } })).toBe(false);
    expect(ok({ ladungen: { max: 5, inhalt: 'wasser', fuellen: ['wasser', 'regensammler'] } })).toBe(true);
    expect(ok({ instrument: { lieder: ['lied_1'] } })).toBe(true);
    expect(ok({ bauplan: { freischaltung: 'bp_lumen_falle' } })).toBe(true);
    expect(ok({ ortskarte: { ortstyp: 'schrein' } })).toBe(true);
    expect(ok({ splitter: { art: 'glut' } })).toBe(true);
    expect(ok({ splitter: { art: 'stein' } as never })).toBe(false);
  });

  it('die Quellenarten §29 mit ihren Sammlungen', () => {
    expect(ITEM_SOURCE_KINDS).toMatchObject({ ernte: 'crops', angeln: 'fish', gewoelbe: 'vaultTilesets', boss: 'bosses', leuchtfeuer: 'beacons', ereignis: 'worldEvents', ort: 'locationTypes' });
    expect(parseItemSource('boss:borkenvater')).toEqual({ kind: 'boss', id: 'borkenvater' });
    expect(parseItemSource('ernte:karotte')).toEqual({ kind: 'ernte', id: 'karotte' });
    expect(ok({ quellen: ['ereignis:lumenregen', 'leuchtfeuer:leuchtfeuer_1'] })).toBe(true);
    expect(ok({ quellen: ['angeln'] })).toBe(false);
  });
});

describe('Beobachter-Tabellen und Orte: Schemas und leere, registrierte Sammlungen', () => {
  it('die Sammlungen gibt es, leer', () => {
    for (const name of ['locationTypes', 'placeLayouts', 'placeLoot', 'stats', 'statSources', 'milestones', 'chronicleRules', 'knowledge', 'guideHints', 'mechanics']) {
      expect(CONTENT.hasCollection(name), name).toBe(true);
      expect(CONTENT.collections().find((c) => c.name === name)?.size, name).toBe(0);
    }
  });

  it('Chronik-Regel: DE und EN mit denselben Platzhaltern, benannte Platzhalter stehen im Text', () => {
    const rule = { id: 'ort_entdeckt', ereignis: 'placeDiscovered', art: 'entdeckung', text: { de: '{ortstyp} entdeckt.', en: 'Found {ortstyp}.' }, platzhalter: { ortstyp: 'ort' } };
    expect(chronicleRuleSchema.safeParse(rule).success).toBe(true);
    expect(chronicleRuleSchema.safeParse({ ...rule, text: { de: '{ortstyp} entdeckt.', en: 'Found it.' } }).success).toBe(false);
    expect(chronicleRuleSchema.safeParse({ ...rule, platzhalter: { biome: 'ort' } }).success).toBe(false);
    expect(knowledgeSchema.safeParse({ id: 'wissen_feuer', titel: T, text: T, quelle: 'mechanik', freischaltung: { art: 'ereignis', ereignis: 'craftCompleted' } }).success).toBe(true);
  });

  it('Statistiken, Quellen, Meilensteine, Hinweise, Mechaniken', () => {
    expect(statSchema.safeParse({ id: 'kills', name: T, einheit: 'anzahl', geschluesselt: true }).success).toBe(true);
    expect(statSourceSchema.safeParse({ id: 'kills_kreatur', statistik: 'kills', ereignis: 'creatureDied', schluessel: 'creature' }).success).toBe(true);
    expect(milestoneSchema.safeParse({ id: 'm_lagerfeuer', name: T, ausloeser: { art: 'statistik', statistik: 'hergestellt', schluessel: 'lagerfeuer', mindestens: 1 }, zielStunden: 0.5 }).success).toBe(true);
    const hint = { id: 'funke_kaelte', kanal: 'funke', text: T, ausloeser: { art: 'zustand', zustand: 'frierend' }, prioritaet: 3, einmalig: true };
    expect(guideHintSchema.safeParse(hint).success).toBe(true);
    expect(guideHintSchema.safeParse({ ...hint, einmalig: false }).success).toBe(false);
    expect(guideHintSchema.safeParse({ ...hint, einmalig: false, abklingSekunden: 600 }).success).toBe(true);
    expect(guideHintSchema.safeParse({ ...hint, prioritaet: 4 }).success).toBe(false);
    const mech = { id: 'mech_feld_acker', paragraph: '§17', task: 'M7-19', hinweis: 'aufgabe:einstieg/feld', wissen: 'wissen_acker', tooltip: { art: 'i18n', schluessel: 'ui.item.verwendung.pflanzen' } };
    expect(mechanicSchema.safeParse(mech).success).toBe(true);
    expect(mechanicSchema.safeParse({ ...mech, id: 'acker' }).success).toBe(false);
    expect(mechanicSchema.safeParse({ ...mech, task: 'M7' }).success).toBe(false);
    expect(mechanicSchema.safeParse({ ...mech, tooltip: { art: 'content', sammlung: 'items', id: 'steinhacke' } }).success).toBe(true);
  });

  it('Orte: Segen nur am Schrein, Aussicht nur am Turm; Vorlagen rechteckig mit Legende; Beute', () => {
    const place = { id: 'schrein', name: T, beschreibung: T, chronik: T, zaehlt: true, kartensymbol: 'karte_ort_schrein', stinger: 'entdeckung', waechter: [], wirkung: 'segen', segen: { zustand: 'gesegnet', sekunden: 600, abklingTage: 3 } };
    expect(placeDefSchema.safeParse(place).success).toBe(true);
    expect(placeDefSchema.safeParse({ ...place, wirkung: 'keine' }).success).toBe(false);
    expect(placeDefSchema.safeParse({ ...place, wirkung: 'aussicht' }).success).toBe(false);
    const layout = { id: 'schrein_gruenhain_01', ortstyp: 'schrein', biom: 'gruenhain', drehbar: true, legende: { '#': { objekt: 'ort_schrein' }, a: { marke: 'altar' } }, zeilen: ['.#.', '#a#', '.#.'] };
    expect(placeLayoutSchema.safeParse(layout).success).toBe(true);
    expect(placeLayoutSchema.safeParse({ ...layout, zeilen: ['.#.', '#a', '.#.'] }).success).toBe(false);
    expect(placeLayoutSchema.safeParse({ ...layout, zeilen: ['.x.'] }).success).toBe(false);
    expect(placeLayoutSchema.safeParse({ ...layout, legende: { ...layout.legende, '.': { boden: 'gras' } } }).success).toBe(false);
    expect(placeLootSchema.safeParse({ id: 'ort_schrein_1', ziehungen: [1, 2], beute: [{ item: 'harz', gewicht: 1, anzahl: [1, 3] }] }).success).toBe(true);
    expect(placeLootSchema.safeParse({ id: 'ort_schrein_1', ziehungen: [2, 1], beute: [{ item: 'harz', gewicht: 1, anzahl: [1, 3] }] }).success).toBe(false);
  });
});
