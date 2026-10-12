/**
 * Variantennamen der Naturwunder (M7-122; docs/SPIEL.md §18 „Naturwunder“, docs/GLOSSAR.md): Karte, Entdeckungsmeldung und
 * Chronik nennen ein Naturwunder bei seiner Variante – Uraltbaum / Ancient Tree, Geysirfeld / Geyser Field, Kristallbogen /
 * Crystal Arch – statt nur „Naturwunder“; jeder andere Ort (auch eine Leuchtfeuer-Stätte, deren Slot-Variante ihr Biom ist)
 * heißt weiter nach seinem Typ, und alte Tagebucheinträge ohne Variante bleiben lesbar.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import { EventBus } from '../../../src/engine/events';
import { ChronicleSystem } from '../../../src/game/chronicle/system';
import type { ChronicleEntry } from '../../../src/game/chronicle/types';
import { placeName, placeNameOfRef, placeNameRef } from '../../../src/game/places/names';
import type { SimEventMap } from '../../../src/game/sim';
import { contentItemCatalog } from '../../../src/game/items/catalog';
import { createI18n } from '../../../src/i18n';
import type { MeldungInhalt } from '../../../src/ui/hud/meldungen/inhalte';
import { meldungsText } from '../../../src/ui/hud/meldungen/Meldungen';
import { meldungenQuelle, type MeldungenSitzung } from '../../../src/ui/hud/meldungen/quelle';
import type { MeldungEingabe } from '../../../src/ui/hud/meldungen/warteschlange';
import { tagebuchText } from '../../../src/ui/screens/chronik/modell';
import { markerName } from '../../../src/ui/screens/karte/modell';
import { chronikWelt, steps } from './chronik-testwelt';
import { NATURWUNDER, orteWelt } from './orte-testwelt';

/** Glossar (docs/GLOSSAR.md „Naturwunder“): Variante → DE/EN. */
const GLOSSAR = {
  uraltbaum: { de: 'Uraltbaum', en: 'Ancient Tree' },
  geysirfeld: { de: 'Geysirfeld', en: 'Geyser Field' },
  kristallbogen: { de: 'Kristallbogen', en: 'Crystal Arch' },
} as const;

const de = createI18n('de', { strict: true });
const en = createI18n('en', { strict: true });

function eintrag(rule: string, values: ChronicleEntry['values']): ChronicleEntry {
  return { nr: 1, tick: 0, day: 1, rule, values };
}

describe('Naturwunder: Namen der Varianten (src/game/places/names.ts)', () => {
  it('jede Variante heißt nach dem Glossar, jeder andere Ort nach seinem Typ', () => {
    for (const [variante, name] of Object.entries(GLOSSAR)) expect(placeName('naturwunder', variante)).toEqual(name);
    expect(placeName('naturwunder')).toEqual({ de: 'Naturwunder', en: 'Natural Wonder' });
    expect(placeName('naturwunder', 'unbekannt')).toEqual({ de: 'Naturwunder', en: 'Natural Wonder' });
    // A beacon site's slot variant is its biome – no name of its own.
    expect(placeName('leuchtfeuer', 'gruenhain')).toEqual(CONTENT.collection('locationTypes').get('leuchtfeuer')?.name);
    expect(placeName('erfunden', 'geysirfeld')).toBeUndefined();
  });

  it('Marker-Ref: Typ, oder Typ und benannte Variante – und zurück', () => {
    const wunder = CONTENT.collection('locationTypes').get('naturwunder');
    const feuer = CONTENT.collection('locationTypes').get('leuchtfeuer');
    if (wunder === undefined || feuer === undefined) throw new Error('Ortstypen fehlen');
    expect(placeNameRef(wunder, 'kristallbogen')).toBe('naturwunder.kristallbogen');
    expect(placeNameRef(wunder, '')).toBe('naturwunder');
    expect(placeNameRef(feuer, 'gruenhain')).toBe('leuchtfeuer');
    expect(placeNameOfRef('naturwunder.kristallbogen')).toEqual(GLOSSAR.kristallbogen);
    expect(placeNameOfRef('gehoeft')?.de).toBe('Verlassenes Gehöft');
  });
});

describe('Naturwunder: Karte, Meldung und Chronik nennen die Variante', () => {
  it('Karte: der Marker des entdeckten Geysirfelds heißt „Geysirfeld“ / „Geyser Field“, das Gehöft weiter nach seinem Typ', () => {
    const w = orteWelt({ naturwunder: true });
    const discovered = w.goTo(NATURWUNDER.x, NATURWUNDER.y).get('placeDiscovered') as SimEventMap['placeDiscovered'][];
    expect(discovered.map((e) => [e.ortstyp, e.variante])).toEqual([['naturwunder', 'geysirfeld']]);
    w.places.reveal(w.sim, 0, 'kartentisch');
    const markers: { kind: 'ort'; ref: string }[] = [];
    w.places.mapMarkers()(w.sim, 0, (kind, _sprite, ref) => {
      if (kind === 'ort') markers.push({ kind, ref });
    });
    expect(markers.map((m) => m.ref)).toEqual(['gehoeft', 'naturwunder.geysirfeld']);
    expect(markers.map((m) => markerName(de, m))).toEqual(['Verlassenes Gehöft', 'Geysirfeld']);
    expect(markers.map((m) => markerName(en, m))).toEqual(['Abandoned Farmstead', 'Geyser Field']);
  });

  it('Meldung: „Entdeckt: Geysirfeld“ / „Discovered: Geyser Field“; ein Ort ohne benannte Variante nach seinem Typ', () => {
    const bus = new EventBus<SimEventMap>();
    const sitzung: MeldungenSitzung = { onEvent: (type, handler) => bus.on(type, handler) };
    const out: MeldungEingabe<MeldungInhalt>[] = [];
    meldungenQuelle(sitzung, contentItemCatalog(), (e) => out.push(e));
    const ort = { biome: 'aschenschlund', x: 0, y: 0, layer: 0, tick: 1 };
    bus.emit('placeDiscovered', { ...ort, place: 4, ortstyp: 'naturwunder', variante: 'geysirfeld' });
    bus.emit('placeDiscovered', { ...ort, place: 5, ortstyp: 'naturwunder', variante: 'uraltbaum' });
    bus.emit('placeDiscovered', { ...ort, place: 6, ortstyp: 'leuchtfeuer', variante: 'gruenhain' });
    const texte = (i18n: typeof de, lang: 'de' | 'en'): string[] => out.map((m) => meldungsText(i18n, lang, m.daten, 1));
    expect(texte(de, 'de')).toEqual(['Entdeckt: Geysirfeld', 'Entdeckt: Uraltbaum', `Entdeckt: ${placeName('leuchtfeuer')?.de}`]);
    expect(texte(en, 'en')).toEqual(['Discovered: Geyser Field', 'Discovered: Ancient Tree', `Discovered: ${placeName('leuchtfeuer')?.en}`]);
  });

  it('Chronik: der Eintrag hält die Variante fest und nennt sie; geplündert ebenso; alte Einträge ohne Variante nennen den Typ', () => {
    const { sim, feeder, world } = chronikWelt();
    const chronicle = sim.addSystem(new ChronicleSystem({ world, knowledge: [] }));
    const ort = { biome: 'scherbenhain', x: 0, y: 0, layer: 0 };
    feeder.push(
      ['placeDiscovered', { ...ort, place: 7, ortstyp: 'naturwunder', variante: 'kristallbogen' }],
      ['placeDiscovered', { ...ort, place: 8, ortstyp: 'gehoeft', variante: '' }],
      ['placeLooted', { place: 7, ortstyp: 'naturwunder', variante: 'kristallbogen' }],
    );
    steps(sim, 1);
    const entries = chronicle.entries();
    expect(entries.map((e) => [e.rule, e.values])).toEqual([
      ['chronik_ort_entdeckt', { ortstyp: 'naturwunder', variante: 'kristallbogen' }],
      ['chronik_ort_entdeckt', { ortstyp: 'gehoeft' }],
      ['chronik_ort_gepluendert', { ortstyp: 'naturwunder', variante: 'kristallbogen' }],
    ]);
    expect(entries.map((e) => tagebuchText(e, 'de'))).toEqual(['Entdeckt: Kristallbogen.', 'Entdeckt: Verlassenes Gehöft.', 'Die letzte Truhe von Kristallbogen ist leer.']);
    expect(entries.map((e) => tagebuchText(e, 'en'))).toEqual(['Discovered: Crystal Arch.', 'Discovered: Abandoned Farmstead.', 'The last chest of Crystal Arch is empty.']);
    expect(tagebuchText(eintrag('chronik_ort_entdeckt', { ortstyp: 'naturwunder' }), 'de')).toBe('Entdeckt: Naturwunder.');
  });

  it('der Ort selbst: das Plündern der Truhe des Geysirfelds nennt seine Variante (placeLooted)', () => {
    const w = orteWelt({ naturwunder: true });
    w.goTo(NATURWUNDER.x, NATURWUNDER.y);
    const looted = w.use(NATURWUNDER.slot, w.markerIndex(NATURWUNDER.slot, 'truhe')).get('placeLooted') as SimEventMap['placeLooted'][];
    expect(looted.map((e) => [e.ortstyp, e.variante])).toEqual([['naturwunder', 'geysirfeld']]);
  });
});
