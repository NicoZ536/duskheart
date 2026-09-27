/**
 * M4-09: the rules of the repair tab (src/ui/screens/station/reparatur.ts) – which pieces it lists and in which order,
 * the chosen one, which stations mend a piece (the content's `reparatur`: Werkbank I tier 0, Werkbank II and the bronze
 * anvil up to tier 1, the grindstone tools and weapons), what a station mends in words, the worn share and the price,
 * the material rows with what is missing, when "Reparieren" goes and why not – and every text in German and English.
 */
import { describe, expect, it } from 'vitest';
import { REPAIR_REJECT_REASONS } from '../../../src/game/repair/events';
import { newStack } from '../../../src/game/items/stack';
import { createI18n } from '../../../src/i18n';
import { contentRezeptKontext } from '../../../src/ui/screens/handwerk/modell';
import {
  abnutzung,
  kannText,
  kostenZeilen,
  reparaturAblehnung,
  reparaturAuswahl,
  reparaturListe,
  reparaturStationen,
  reparierbar,
  repariert,
  sperrText,
} from '../../../src/ui/screens/station/reparatur';
import type { ReparaturAnsicht, ReparaturStueck } from '../../../src/ui/screens/station/reparaturQuelle';

const ctx = contentRezeptKontext();
const de = createI18n('de', { strict: true });
const en = createI18n('en', { strict: true });

function stueck(item: string, bereich: 'schnellleiste' | 'inventar', index: number, over: Partial<ReparaturStueck> = {}): ReparaturStueck {
  const def = ctx.book.catalog.get(item);
  const stack = { ...newStack(def, 1), haltbarkeit: 30 };
  return { key: `${bereich}:${index}`, slot: { bereich, index }, stack, voll: 60, hier: true, station: 'werkbank', grund: null, kosten: [], ...over };
}

describe('Liste und Auswahl', () => {
  const a = stueck('steinaxt', 'schnellleiste', 0);
  const b = stueck('bronzeaxt', 'schnellleiste', 1, { hier: false, station: null, grund: 'noStation' });
  const c = stueck('steinspitzhacke', 'inventar', 4);
  const ansicht: ReparaturAnsicht = { vorhanden: true, stuecke: [a, b, c] };

  it('zeigt zuerst, was diese Station repariert, dann den Rest – je in der Reihenfolge der Abtastung', () => {
    const liste = reparaturListe(ansicht);
    expect(liste.hier.map((s) => s.key)).toEqual(['schnellleiste:0', 'inventar:4']);
    expect(liste.anderswo.map((s) => s.key)).toEqual(['schnellleiste:1']);
    expect(reparaturListe(null)).toEqual({ hier: [], anderswo: [] });
    expect(reparaturListe({ vorhanden: false, stuecke: [a] })).toEqual({ hier: [], anderswo: [] });
  });

  it('wählt das gewählte Stück, sonst das erste hier reparierbare, sonst das erste andere', () => {
    const liste = reparaturListe(ansicht);
    expect(reparaturAuswahl(liste, 'inventar:4')?.key).toBe('inventar:4');
    expect(reparaturAuswahl(liste, 'schnellleiste:1')?.key).toBe('schnellleiste:1');
    expect(reparaturAuswahl(liste, 'weg:9')?.key).toBe('schnellleiste:0');
    expect(reparaturAuswahl(reparaturListe({ vorhanden: true, stuecke: [b] }), null)?.key).toBe('schnellleiste:1');
    expect(reparaturAuswahl(reparaturListe(null), null)).toBeNull();
  });
});

describe('Welche Station was repariert', () => {
  it('folgt der Regel des Contents: Kategorie und Stufe', () => {
    const werkbank = ctx.book.stations.get('werkbank');
    const schleifstein = ctx.book.stations.get('schleifstein');
    expect(repariert(werkbank, ctx.book.catalog.get('steinaxt'))).toBe(true);
    expect(repariert(werkbank, ctx.book.catalog.get('bronzeaxt'))).toBe(false);
    expect(repariert(ctx.book.stations.get('saegebock'), ctx.book.catalog.get('steinaxt'))).toBe(false);
    expect(repariert(schleifstein, ctx.book.catalog.get('bronzeaxt'))).toBe(true);
    expect(reparaturStationen(ctx, ctx.book.catalog.get('bronzeaxt'), 'de')).toEqual(expect.arrayContaining(['Werkbank II', 'Schleifstein']));
    expect(reparaturStationen(ctx, ctx.book.catalog.get('bronzeaxt'), 'de')).not.toContain('Werkbank');
    expect(reparaturStationen(ctx, ctx.book.catalog.get('steinaxt'), 'en')).toContain('Workbench');
  });

  it('nennt, was eine Station repariert, und nichts für eine, die nichts repariert', () => {
    expect(kannText(de, ctx.book.stations.get('werkbank'))).toBe('Repariert bis Stufe 0: Werkzeug, Waffe, Rüstung, Schild');
    expect(kannText(en, ctx.book.stations.get('schleifstein'))).toBe('Mends up to tier 1: Tool, Weapon');
    expect(kannText(de, ctx.book.stations.get('saegebock'))).toBeNull();
  });
});

describe('Abnutzung, Kosten und Sperren', () => {
  it('rechnet den abgenutzten Anteil und den Preis (die Hälfte davon)', () => {
    expect(abnutzung({ stack: { item: 'steinaxt', count: 1, haltbarkeit: 30 }, voll: 60 })).toEqual({ abgenutzt: 0.5, kosten: 0.25 });
    expect(abnutzung({ stack: { item: 'steinaxt', count: 1, haltbarkeit: 0 }, voll: 60 })).toEqual({ abgenutzt: 1, kosten: 0.5 });
    expect(abnutzung({ stack: { item: 'steinaxt', count: 1 }, voll: 60 }).abgenutzt).toBe(0);
    expect(abnutzung({ stack: { item: 'steinaxt', count: 1, haltbarkeit: 3 }, voll: 0 }).abgenutzt).toBe(0);
  });

  it('macht aus den Kosten Zeilen wie die Zutaten des Handwerks, Gruppen mit ihrem Namen', () => {
    const zeilen = kostenZeilen(
      ctx,
      {
        kosten: [
          { key: 'zweig', items: ['zweig'], anzahl: 2, vorhanden: 1 },
          { key: 'bauholz', items: ctx.book.group('bauholz')?.items ?? [], anzahl: 1, vorhanden: 3 },
        ],
      },
      'de',
    );
    expect(zeilen[0]).toMatchObject({ key: 'zweig', gruppe: false, name: 'Zweig', iconItem: 'zweig', braucht: 2, hat: 1, fehlt: 1 });
    expect(zeilen[1]).toMatchObject({ key: 'bauholz', gruppe: true, name: ctx.book.group('bauholz')?.name.de, braucht: 1, hat: 3, fehlt: 0 });
  });

  it('repariert nur mit Station in Reichweite, ohne Ablehnung und mit allem Material', () => {
    const genug = stueck('steinaxt', 'schnellleiste', 0, { kosten: [{ key: 'zweig', items: ['zweig'], anzahl: 1, vorhanden: 1 }] });
    expect(reparierbar(genug)).toBe(true);
    expect(sperrText(de, ctx, genug)).toBeNull();
    expect(reparierbar({ ...genug, kosten: [{ key: 'zweig', items: ['zweig'], anzahl: 2, vorhanden: 1 }] })).toBe(false);
    expect(reparierbar({ ...genug, station: null, grund: 'noStation' })).toBe(false);
    // Another station in reach mends it: the button works, the station is named.
    expect(reparierbar({ ...genug, hier: false, station: 'amboss_bronze' })).toBe(true);
    const bronze = stueck('bronzeaxt', 'schnellleiste', 1, { hier: false, station: null, grund: 'noStation' });
    expect(sperrText(de, ctx, bronze)).toMatch(/^Diese Station repariert das nicht – das können: .*Werkbank II/);
    expect(sperrText(en, ctx, bronze)).toMatch(/^This station does not mend it – these do: /);
    expect(sperrText(de, ctx, { ...genug, grund: 'asleep' })).toBe(de.t('ui.repair.reject.asleep'));
  });

  it('hat für jeden Grund der Reparatur einen Text in beiden Sprachen', () => {
    for (const r of REPAIR_REJECT_REASONS) {
      expect(reparaturAblehnung(de, r).length).toBeGreaterThan(0);
      expect(reparaturAblehnung(en, r).length).toBeGreaterThan(0);
    }
  });
});
