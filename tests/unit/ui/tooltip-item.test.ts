/**
 * M3-30: item tooltips (src/ui/tooltip) – rarity colour and name, category/tier/rarity, description,
 * stats × quality with the comparison green/red against the worn piece, durability (broken hint),
 * freshness and shelf life, food values, "Herkunft"/"Verwendet in" from the content's item index,
 * placement next to the anchor on whole design pixels, and the rarity colour tokens (docs/ART.md §6).
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import { baseItem, defineItemGroup, ITEM_SFX, type ItemSpec } from '../../../src/content/items/define';
import { ITEMS } from '../../../src/content/items/index';
import type { ItemIndex } from '../../../src/content/items/usage';
import { RARITIES } from '../../../src/content/schema/common';
import type { ItemDef, ItemInput } from '../../../src/content/schema/item';
import { PALETTE_HEX, PALETTE_RAMPS } from '../../../src/generated/palette';
import { ItemCatalog } from '../../../src/game/items/catalog';
import { newStack } from '../../../src/game/items/stack';
import { createI18n } from '../../../src/i18n';
import { paletteRefHex } from '../../../src/render/palette/rows';
import { contentItemLookup, createItemLookup, sourceGroups, useGroups } from '../../../src/ui/tooltip/lookup';
import { formatStat, itemTooltip, MAX_NAMES, type TooltipLine } from '../../../src/ui/tooltip/itemTooltip';
import { placeTooltip } from '../../../src/ui/tooltip/place';
import { rarityHex, rarityRank, rarityTokens, rarityVar } from '../../../src/ui/tooltip/rarity';

function probe(id: string, spec: Omit<ItemSpec, 'id' | 'name' | 'beschreibung' | 'tauschwert' | 'sounds'>): ItemInput {
  return baseItem({ id, name: { de: `DE ${id}`, en: `EN ${id}` }, beschreibung: { de: 'Beschreibung.', en: 'Description.' }, tauschwert: 3, sounds: { aufheben: ITEM_SFX.holz }, ...spec });
}

const FIXTURES = defineItemGroup('tooltip_proben', [
  probe('tt_brust_alt', { kategorie: 'ruestung', ausruestung: 'brust', ruestungsgewicht: 'leicht', haltbarkeit: 60, werte: { ruestung: 3, isolation: 20 } }),
  probe('tt_brust_neu', { kategorie: 'ruestung', ausruestung: 'brust', ruestungsgewicht: 'mittel', haltbarkeit: 60, raritaet: 'selten', werte: { ruestung: 5, tempo: -0.05 } }),
  probe('tt_axt', { kategorie: 'werkzeug', haltbarkeit: 60, werkzeug: { art: 'axt', abbaukraft: 2 } }),
]);
const catalog = new ItemCatalog([...ITEMS, ...FIXTURES]);
const def = (id: string): ItemDef => catalog.get(id);
const de = createI18n('de', { strict: true });
const en = createI18n('en', { strict: true });

function lines(model: ReturnType<typeof itemTooltip>): TooltipLine[] {
  return model.sections.flatMap((s) => s.lines);
}

describe('Tooltip: Inhalt', () => {
  it('Titel, Raritätsstufe, Untertitel und Beschreibung in beiden Sprachen', () => {
    const m = itemTooltip(de, { def: def('tt_brust_neu'), stack: newStack(def('tt_brust_neu'), 1) });
    expect(m.title).toBe('DE tt_brust_neu');
    expect(m.rarity).toBe('selten');
    expect(m.subtitle).toBe('Rüstung · Stufe 0');
    expect(m.rarityLabel).toBe('Selten');
    expect(lines(m)[0]).toEqual({ text: 'Beschreibung.', tone: 'text' });
    const e = itemTooltip(en, { def: def('tt_brust_neu'), stack: null });
    expect(e.title).toBe('EN tt_brust_neu');
    expect(e.rarityLabel).toBe('Rare');
  });

  it('Vergleich mit dem getragenen Stück: besser grün, schlechter rot, fehlende Werte als Verlust; Qualität zählt', () => {
    const neu = { ...newStack(def('tt_brust_neu'), 1, { qualitaet: 2 }) };
    const alt = newStack(def('tt_brust_alt'), 1);
    const m = itemTooltip(de, { def: def('tt_brust_neu'), stack: neu, compare: { def: def('tt_brust_alt'), stack: alt } });
    const section = m.sections.find((s) => s.heading === 'Verglichen mit DE tt_brust_alt');
    expect(section).toBeDefined();
    const byText = new Map(section?.lines.map((l) => [l.text, l]));
    // Rüstung 5 × 1,1 = 5,5 vs 3 → +2,5 besser.
    expect(byText.get('Rüstung 5,5')?.delta).toEqual({ text: '+2,5', tone: 'better' });
    // Isolation only on the worn piece: 0 now, −20.
    expect(byText.get('Isolation 0')).toEqual({ text: 'Isolation 0', tone: 'dim', delta: { text: '-20', tone: 'worse' } });
    // Negative speed bonus is worse: −5 % × 1,1 = −5,5 % → rounded "-6 %".
    const tempo = section?.lines.find((l) => /^Tempo -6\s%$/.test(l.text));
    expect(tempo?.delta).toEqual({ text: expect.stringMatching(/^-6\s%$/), tone: 'worse' });
  });

  it('ohne Vergleich keine Differenzen; Haltbarkeit, kaputt mit Reparaturhinweis', () => {
    const m = itemTooltip(de, { def: def('tt_axt'), stack: { ...newStack(def('tt_axt'), 1), haltbarkeit: 40 } });
    const texts = lines(m).map((l) => l.text);
    expect(texts).toContain('Axt · Abbaukraft 2');
    expect(texts).toContain('Haltbarkeit 40/60');
    expect(lines(m).every((l) => l.delta === undefined)).toBe(true);
    const broken = itemTooltip(de, { def: def('tt_axt'), stack: { ...newStack(def('tt_axt'), 1), haltbarkeit: 0 } });
    expect(lines(broken).find((l) => l.tone === 'warn')?.text).toBe('Kaputt – an Werkbank, Amboss oder Schleifstein reparieren');
    const worn = itemTooltip(de, { def: def('tt_axt'), stack: { ...newStack(def('tt_axt'), 1), haltbarkeit: 15 } });
    expect(lines(worn).find((l) => l.text === 'Haltbarkeit 15/60')?.tone).toBe('warn');
  });

  it('Nahrung: Nährwerte mit Vorzeichen, Frische (Warnung unter 25 %), Haltbarkeit in Tagen', () => {
    const berry = def('himbeeren');
    const fresh = itemTooltip(de, { def: berry, stack: newStack(berry, 5) });
    const t = lines(fresh).map((l) => l.text);
    expect(t.some((x) => /^Sättigung \+\d+ · Durst \+\d+$/.test(x))).toBe(true);
    expect(t).toContain('Frische 100 %');
    expect(t).toContain(`Hält ${berry.frische} Tage`);
    const stale = itemTooltip(de, { def: berry, stack: newStack(berry, 5, { frische: 20 }) });
    expect(lines(stale).find((l) => l.text === 'Frische 20 %')?.tone).toBe('warn');
  });

  it('Herkunft und Verwendung aus dem Item-Index des Contents (Himbeeren: Sammeln am Beerenstrauch, Essen)', () => {
    const lookup = contentItemLookup();
    const sources = sourceGroups(lookup, 'himbeeren', 'de');
    expect(sources.map((g) => g.kind)).toEqual(['welt']);
    expect(sources[0]?.names.length).toBeGreaterThan(0);
    for (const name of sources[0]?.names ?? []) expect(CONTENT.collection('worldObjects').values().some((o) => o.name.de === name)).toBe(true);
    expect(useGroups(lookup, 'himbeeren', 'de').map((g) => g.kind)).toContain('essen');
    const m = itemTooltip(de, { def: def('himbeeren'), stack: null, lookup });
    expect(m.sections.map((s) => s.heading)).toEqual(expect.arrayContaining(['Herkunft', 'Verwendet in']));
    const holz = itemTooltip(en, { def: def('holz'), stack: null, lookup });
    expect(holz.sections.find((s) => s.heading === 'Used in')?.lines.map((l) => l.text)).toContain('Fuel');
  });

  it('lange Namenslisten werden nach drei Namen mit „und n weitere“ gekürzt', () => {
    const index: ItemIndex = { sources: new Map([['x', ['welt:a', 'welt:b', 'welt:c', 'welt:d', 'welt:e']]]), uses: new Map(), unclassified: [] };
    const lookup = createItemLookup(index, (_c, id) => ({ name: { de: id.toUpperCase(), en: id } }));
    expect(sourceGroups(lookup, 'x', 'de')).toEqual([{ kind: 'welt', names: ['A', 'B', 'C', 'D', 'E'] }]);
    const m = itemTooltip(de, { def: def('holz'), stack: null, lookup: { ...lookup, sources: () => ['welt:a', 'welt:b', 'welt:c', 'welt:d', 'welt:e'] } });
    const herkunft = m.sections.find((s) => s.heading === 'Herkunft');
    expect(herkunft?.lines[0]?.text).toBe(`Sammeln in der Welt: A, B, C und ${5 - MAX_NAMES} weitere`);
  });

  it('Zahlenformat der Werte: Prozentwerte, Nachkommastelle, Vorzeichen', () => {
    expect(formatStat('de', 'ruestung', 3)).toBe('3');
    expect(formatStat('de', 'ruestung', 1.25)).toBe('1,3');
    expect(formatStat('en', 'ruestung', 1.25)).toBe('1.3');
    expect(formatStat('de', 'blockkraft', 0.4)).toMatch(/^40\s%$/);
    expect(formatStat('de', 'ruestung', 2, true)).toBe('+2');
    expect(formatStat('de', 'ruestung', -2, true)).toBe('-2');
  });
});

describe('Tooltip: Platzierung', () => {
  const view = { width: 480, height: 270 };
  it('rechts neben dem Anker, oben bündig', () => {
    expect(placeTooltip({ left: 100, top: 50, width: 20, height: 20 }, { width: 100, height: 60 }, view, 3, 2, 1)).toEqual({ left: 123, top: 50, flipped: false });
  });
  it('links, wenn rechts kein Platz ist; unten und seitlich in den Bildschirm geschoben', () => {
    expect(placeTooltip({ left: 400, top: 250, width: 20, height: 20 }, { width: 100, height: 60 }, view, 3, 2, 1)).toEqual({ left: 297, top: 208, flipped: true });
    expect(placeTooltip({ left: 30, top: 10, width: 20, height: 20 }, { width: 460, height: 60 }, view, 3, 2, 1).left).toBe(18);
  });
  it('rastet auf ganze Designpixel (Schritt = CSS-Pixel je Designpixel)', () => {
    const p = placeTooltip({ left: 101, top: 51, width: 80, height: 80 }, { width: 400, height: 240 }, { width: 1920, height: 1080 }, 12, 8, 4);
    expect(p.left % 4).toBe(0);
    expect(p.top % 4).toBe(0);
  });
});

describe('Raritätsfarben', () => {
  it('fünf Tokens aus der Palette in der Reihenfolge Gewöhnlich … Legendär (docs/ART.md §6)', () => {
    const tokens = rarityTokens();
    expect(Object.keys(tokens)).toEqual(RARITIES.map((r) => rarityVar(r)));
    const expected = { gewoehnlich: 'eis.4', ungewoehnlich: 'gras.4', selten: 'wasser.4', episch: 'verderb.4', legendaer: 'feuer.4' } as const;
    for (const r of RARITIES) expect(rarityHex(r)).toBe(paletteRefHex(expected[r], PALETTE_RAMPS, PALETTE_HEX));
    expect(new Set(Object.values(tokens)).size).toBe(RARITIES.length);
    expect(RARITIES.map(rarityRank)).toEqual([0, 1, 2, 3, 4]);
  });
});
