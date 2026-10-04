/**
 * M3-30: item tooltips (src/ui/tooltip) – rarity colour and name, category/tier/rarity, description,
 * stats × quality with the comparison green/red against the worn piece, durability (broken hint),
 * freshness and shelf life, food values, "Herkunft"/"Verwendet in" from the content's item index,
 * placement next to the anchor on whole design pixels, and the rarity colour tokens (docs/ART.md §6).
 * M6-30c: the sources in a fixed order (world and digging, making, creature loot). M6-43: the armour set of a piece with the
 * pieces worn and its bonuses (reached ones active, the others greyed); a tooltip too tall for the view widens until it fits.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import { baseItem, defineItemGroup, ITEM_SFX, type ItemSpec } from '../../../src/content/items/define';
import { ITEMS } from '../../../src/content/items/index';
import type { ItemIndex } from '../../../src/content/items/usage';
import { RARITIES } from '../../../src/content/schema/common';
import { ITEM_SOURCE_KINDS, type ItemDef, type ItemInput } from '../../../src/content/schema/item';
import { PALETTE_HEX, PALETTE_RAMPS } from '../../../src/generated/palette';
import { ItemCatalog } from '../../../src/game/items/catalog';
import { newStack } from '../../../src/game/items/stack';
import { createI18n } from '../../../src/i18n';
import { paletteRefHex } from '../../../src/render/palette/rows';
import { contentItemLookup, createItemLookup, sourceGroups, useGroups } from '../../../src/ui/tooltip/lookup';
import { armorSetOf, formatStat, itemTooltip, MAX_NAMES, type TooltipLine } from '../../../src/ui/tooltip/itemTooltip';
import { fittingWidth, TOOLTIP_WIDTH } from '../../../src/ui/tooltip/Tooltip';
import { RUESTUNGSSETS } from '../../../src/content/ruestungssets';
import { placeTooltip } from '../../../src/ui/tooltip/place';
import { herkunftsGruppen, SOURCE_DISPLAY_ORDER } from '../../../src/ui/tooltip/verwendung';
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

  it('M6-30c: Herkunft in fester Reihenfolge – Welt und Graben, dann Herstellen, dann Kreaturbeute (nicht alphabetisch)', () => {
    // The raw index sorts its source strings, so `drop:` came before `welt:` and the flint read "Beute von Kreaturen" first.
    // M7 (ADR-0175) adds harvest and fishing after the world, boss loot after creature loot, vaults, world events and beacons
    // after places – the M6 kinds keep their order.
    expect(SOURCE_DISPLAY_ORDER).toEqual(['welt', 'graben', 'ernte', 'angeln', 'rezept', 'drop', 'boss', 'ort', 'gewoelbe', 'ereignis', 'leuchtfeuer', 'haendlerin']);
    expect([...SOURCE_DISPLAY_ORDER].sort()).toEqual(Object.keys(ITEM_SOURCE_KINDS).sort());
    const index: ItemIndex = { sources: new Map([['x', ['drop:wolf', 'graben:erde', 'haendlerin', 'ort:ruine', 'rezept:rezept_x', 'welt:baum']]]), uses: new Map(), unclassified: [] };
    const lookup = createItemLookup(index, (_c, id) => ({ name: { de: id, en: id } }));
    expect(sourceGroups(lookup, 'x', 'de').map((g) => g.kind)).toEqual(['welt', 'graben', 'rezept', 'drop', 'ort', 'haendlerin']);
    // The game's content: gravel is gathered and dug; the flint blade is made and carried by the beach raider. Flint itself
    // only comes from the world – no enemy drops world material (ADR-0105), so its hint never reads "Beute".
    const content = contentItemLookup();
    expect(sourceGroups(content, 'kies', 'de').map((g) => g.kind)).toEqual(['welt', 'graben']);
    expect(sourceGroups(content, 'feuerstein', 'de').map((g) => g.kind)).toEqual(['welt']);
    const verzeichnis = content.verzeichnis;
    expect(verzeichnis).toBeDefined();
    if (verzeichnis === undefined) return;
    expect(herkunftsGruppen(verzeichnis, 'kies', de).map((g) => g.kind)).toEqual(['welt', 'graben']);
    expect(herkunftsGruppen(verzeichnis, 'feuersteinklinge', de).map((g) => g.kind)).toEqual(['rezept', 'drop']);
    const herkunft = itemTooltip(de, { def: def('feuerstein'), stack: null, lookup: content }).sections.find((s) => s.heading === 'Herkunft');
    expect(herkunft?.lines[0]?.text).toMatch(/^Sammeln in der Welt: /);
    // Every item of the content lists its kinds in that order.
    const rank = (k: string): number => SOURCE_DISPLAY_ORDER.indexOf(k as (typeof SOURCE_DISPLAY_ORDER)[number]);
    for (const item of ITEMS) {
      const kinds = herkunftsGruppen(verzeichnis, item.id, de).map((g) => rank(g.kind));
      expect(kinds, item.id).toEqual([...kinds].sort((a, b) => a - b));
    }
  });

  it('M6-43: ein Rüstungsteil zeigt sein Set mit getragenen Teilen, erreichte Boni in Textfarbe, die anderen grau', () => {
    const kappe = def('lederkappe');
    expect(armorSetOf('lederkappe')?.id).toBe('leder');
    expect(armorSetOf('holz')).toBeUndefined();
    const set = (m: ReturnType<typeof itemTooltip>) => m.sections.find((x) => x.heading?.startsWith('Set: ') === true);
    // Two leather pieces worn (and two of bronze): the two-piece bonus is reached, the four-piece one not.
    const worn = itemTooltip(de, { def: kappe, stack: newStack(kappe, 1), wornSets: [{ id: 'leder', teile: 2, boni: 1 }, { id: 'bronze', teile: 2, boni: 1 }] });
    expect(set(worn)).toEqual({
      heading: 'Set: Lederrüstung (2/4)',
      lines: [
        { text: '2/4: +2 Isolation', tone: 'text' },
        { text: '4/4: +2 Rüstung, +15 Max. Ausdauer', tone: 'dim' },
      ],
    });
    // None worn: 0/4, everything greyed; the full set: every bonus reached.
    expect(set(itemTooltip(en, { def: kappe, stack: null, wornSets: [] }))?.heading).toBe('Set: Leather Armour (0/4)');
    expect(set(itemTooltip(de, { def: kappe, stack: null, wornSets: [] }))?.lines.map((l) => l.tone)).toEqual(['dim', 'dim']);
    expect(set(itemTooltip(de, { def: kappe, stack: null, wornSets: [{ id: 'leder', teile: 4, boni: 2 }] }))?.lines.map((l) => l.tone)).toEqual(['text', 'text']);
    // Without the worn state (recipe book, station): the set and its bonuses, no count, nothing greyed.
    const unknown = set(itemTooltip(de, { def: kappe, stack: null }));
    expect(unknown?.heading).toBe('Set: Lederrüstung');
    expect(unknown?.lines.map((l) => l.tone)).toEqual(['text', 'text']);
    // After the comparison, before the sources; items outside a set have no set section.
    const m = itemTooltip(de, { def: kappe, stack: null, lookup: contentItemLookup(), wornSets: [] });
    const headings = m.sections.map((x) => x.heading);
    expect(headings.indexOf('Set: Lederrüstung (0/4)')).toBeLessThan(headings.indexOf('Herkunft'));
    expect(itemTooltip(de, { def: def('holz'), stack: null, wornSets: [] }).sections.some((x) => x.heading?.startsWith('Set: ') === true)).toBe(false);
    // Every piece of every set of the content, in both languages.
    for (const s of RUESTUNGSSETS) {
      for (const id of s.teile) {
        for (const i18n of [de, en]) {
          const lines = set(itemTooltip(i18n, { def: def(id), stack: null, wornSets: [] }))?.lines ?? [];
          expect(lines.length, id).toBe(s.boni.length);
          for (const [i, l] of lines.entries()) expect(l.text, id).toMatch(new RegExp(`^${s.boni[i]?.teile ?? 0}/4: \\+`));
        }
      }
    }
  });

  it('M6-43: ein zu hoher Tooltip wird stufenweise breiter, bis er in die Ansicht passt', () => {
    // A height that shrinks as the lines rewrap: 300 px at the normal width, 20 px less per step.
    const heightAt = (w: number): number => 300 - (w - TOOLTIP_WIDTH.normal);
    expect(fittingWidth(heightAt, 400)).toBe(TOOLTIP_WIDTH.normal);
    expect(fittingWidth(heightAt, 280)).toBe(TOOLTIP_WIDTH.normal + TOOLTIP_WIDTH.step);
    expect(fittingWidth(heightAt, 260)).toBe(TOOLTIP_WIDTH.normal + 2 * TOOLTIP_WIDTH.step);
    // The first width that fits, step by step: never wider than needed.
    expect(fittingWidth(heightAt, 279)).toBe(TOOLTIP_WIDTH.normal + 2 * TOOLTIP_WIDTH.step);
    expect(fittingWidth(heightAt, 100)).toBe(TOOLTIP_WIDTH.max);
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
