/**
 * Content of an item tooltip (MASTERPROMPT §26 "Tooltips mit Raritätsfarbe … Vergleichs-Tooltips
 * (grün/rot), ‚Verwendet in'/‚Herkunft'", §13.1, §18; M3-30) as plain data, so the rules are unit
 * tested and the component only lays it out:
 *
 * - Title: the item's name in its rarity colour; below it category and tier, and the rarity by name.
 * - The description (the item's `beschreibung`).
 * - Stats of a worn piece × its quality factor, each with the difference to the piece it would
 *   replace (`compare`): green where it is better, red where it is worse; a stat only the worn piece
 *   has shows as 0 with its loss. All stats are "more is better" (a negative speed bonus is worse).
 * - Tool data, food values, durability (or the broken hint with where to repair), freshness and
 *   shelf life, burn time and where it burns (one line), backpack slots, trade value.
 * - "Herkunft" and "Verwendet in" (§15.1 "Für jedes Item … nachschlagbar"; M4-08) from the lookup: with the
 *   game's `Verwendungsindex` named – where it is made, the products it goes into (also through an ingredient
 *   group), what a station makes, what its mending costs (src/ui/tooltip/verwendung.ts) –, else from the derived
 *   item index alone. Both headings always stand: without a known source "Herkunft unbekannt", without a use "Wird
 *   selbst benutzt" for an end product (a bandage), else "Keine bekannte Verwendung".
 * - The armour set of a piece (§13.1 "Rüstungssets mit Set-Boni"; M6-43): its name with the pieces worn ("Set:
 *   Lederrüstung (2/4)", from the equipment's `sets`) and every bonus with the pieces it asks for and its stats
 *   ("2/4: +2 Isolation", `setBonusText`) –
 *   reached bonuses in the text colour, the others greyed; without the worn state (a recipe book) no count, no greying.
 */
import { RUESTUNGSSETS, type ArmorSetDef } from '../../content/ruestungssets';
import type { Rarity } from '../../content/schema/common';
import { ITEM_STATS, type ItemDef, type ItemStat } from '../../content/schema/item';
import type { WornSet } from '../../game/equipment/formulas';
import { maxDurability, qualityFactor } from '../../game/items/formulas';
import { stackQuality, type ItemStack } from '../../game/items/stack';
import type { I18n, Lang } from '../../i18n';
import { formatNumber, formatPercent } from '../../i18n/format';
import { sourceGroups, useGroups, type ItemLookup } from './lookup';
import { brennstellenNamen, herkunftsGruppen, verwendungsGruppen } from './verwendung';

/** How a line is coloured. */
export type TooltipTone = 'text' | 'dim' | 'better' | 'worse' | 'warn';

/** One line; `delta` is the comparison with the worn piece. */
export interface TooltipLine {
  readonly text: string;
  readonly tone: TooltipTone;
  readonly delta?: { readonly text: string; readonly tone: 'better' | 'worse' };
}

/** A block of lines, optionally with a heading. */
export interface TooltipSection {
  readonly heading?: string;
  readonly lines: readonly TooltipLine[];
}

export interface ItemTooltipModel {
  readonly title: string;
  readonly rarity: Rarity;
  /** Category · tier. */
  readonly subtitle: string;
  /** Name of the rarity (shown in its colour; the text keeps it readable without colour, §29). */
  readonly rarityLabel: string;
  readonly sections: readonly TooltipSection[];
}

/** The piece a tooltip compares with (the worn one in the same slot, or the tool in the hand). */
export interface TooltipComparison {
  readonly def: ItemDef;
  readonly stack: ItemStack;
}

export interface ItemTooltipInput {
  readonly def: ItemDef;
  /** The stack in the slot; `null` for a bare item (no durability, freshness or quality known). */
  readonly stack: ItemStack | null;
  readonly compare?: TooltipComparison | null;
  readonly lookup?: ItemLookup | null;
  /** The sets of the worn equipment (`EquipmentStats.sets`); absent or `null`: not known (no count, nothing greyed). */
  readonly wornSets?: readonly WornSet[] | null;
  /** The armour sets (default: the game's content). */
  readonly armorSets?: readonly ArmorSetDef[];
}

/** Stats shown as percent (fractions in the data, §13.1 `ITEM_STATS` units). */
const PERCENT_STATS: ReadonlySet<ItemStat> = new Set(['tempo', 'blockkraft', 'kritchance', 'schleichen', 'giftresistenz', 'frostresistenz', 'feuerresistenz', 'furchtresistenz']);
/** Most record names listed per source or use kind before "+n". */
export const MAX_NAMES = 3;
/** Freshness below which the line turns into a warning [percent]. */
export const STALE_FRESHNESS = 25;
/** Rounding of stat values [fraction digits] (quality bonuses make tenths). */
const STAT_DIGITS = 1;
/** Differences smaller than this count as equal (floating point of quality factors). */
const EPSILON = 1e-9;

/** Value of `stat` of a piece of `def` at `stack`'s quality (0 when it has none). */
export function statValue(def: ItemDef, stack: ItemStack | null, stat: ItemStat): number {
  const base = def.werte?.[stat];
  if (base === undefined) return 0;
  return base * qualityFactor(stack === null ? 1 : stackQuality(stack));
}

/** Formats a stat value ("3", "1,1", "40 %", "-5 %"); `signed` adds "+" to positive values. */
export function formatStat(lang: Lang, stat: ItemStat, value: number, signed = false): string {
  const text = PERCENT_STATS.has(stat) ? formatPercent(lang, Math.abs(value)) : formatNumber(lang, Math.abs(value), STAT_DIGITS);
  if (value < -EPSILON) return `-${text}`;
  return signed && value > EPSILON ? `+${text}` : text;
}

function signed(lang: Lang, value: number): string {
  const text = formatNumber(lang, Math.abs(value));
  return value > 0 ? `+${text}` : value < 0 ? `-${text}` : text;
}

/** Joins record names, at most `MAX_NAMES`, then "+n". */
function nameList(i18n: I18n, names: readonly string[]): string {
  const shown = names.slice(0, MAX_NAMES).join(', ');
  return names.length > MAX_NAMES ? i18n.t('ui.tooltip.mehr', { liste: shown, anzahl: names.length - MAX_NAMES }) : shown;
}

/** Stat lines with the comparison (see module comment). */
function statLines(i18n: I18n, def: ItemDef, stack: ItemStack | null, compare: TooltipComparison | null): TooltipLine[] {
  const lang = i18n.lang;
  const lines: TooltipLine[] = [];
  for (const stat of ITEM_STATS) {
    const own = def.werte?.[stat];
    const theirs = compare?.def.werte?.[stat];
    if (own === undefined && theirs === undefined) continue;
    const value = statValue(def, stack, stat);
    const label = i18n.t(`ui.item.wert.${stat}`);
    const line: { text: string; tone: TooltipTone; delta?: TooltipLine['delta'] } = { text: i18n.t('ui.tooltip.wert', { wert: label, zahl: formatStat(lang, stat, value) }), tone: own === undefined ? 'dim' : 'text' };
    if (compare !== null) {
      const diff = value - statValue(compare.def, compare.stack, stat);
      if (Math.abs(diff) > EPSILON) line.delta = { text: formatStat(lang, stat, diff, true), tone: diff > 0 ? 'better' : 'worse' };
    }
    lines.push(line);
  }
  return lines;
}

/** The set `itemId` belongs to, or `undefined`. */
export function armorSetOf(itemId: string, sets: readonly ArmorSetDef[] = RUESTUNGSSETS): ArmorSetDef | undefined {
  return sets.find((s) => s.teile.includes(itemId));
}

/**
 * One bonus of a set as the inventory and the tooltip show it: the pieces it asks for, then its stats with the labels and
 * number format of the item stats ("4/4: +2 Rüstung, +15 Max. Ausdauer") – shorter than the bonus's prose `beschreibung`,
 * so a bonus stays one line in the tooltip and two in the narrow set panel of the inventory (the screen fits 270 px).
 */
export function setBonusText(i18n: I18n, set: ArmorSetDef, bonus: ArmorSetDef['boni'][number]): string {
  const parts: string[] = [];
  for (const stat of ITEM_STATS) {
    const value = bonus.werte[stat];
    if (value !== undefined) parts.push(i18n.t('ui.set.wert', { zahl: formatStat(i18n.lang, stat, value, true), wert: i18n.t(`ui.item.wert.${stat}`) }));
  }
  return i18n.t('ui.set.bonus', { teile: bonus.teile, von: set.teile.length, bonus: parts.join(', ') });
}

/** The set section of a piece of `set` (see module comment); `worn` = the equipment's worn sets, `null` when not known. */
function setSection(i18n: I18n, set: ArmorSetDef, worn: readonly WornSet[] | null): TooltipSection {
  const lang = i18n.lang;
  const teile = worn === null ? null : (worn.find((w) => w.id === set.id)?.teile ?? 0);
  return {
    heading: teile === null ? i18n.t('ui.tooltip.set', { name: set.name[lang] }) : i18n.t('ui.tooltip.setAnzahl', { name: set.name[lang], teile, von: set.teile.length }),
    lines: set.boni.map((b) => ({ text: setBonusText(i18n, set, b), tone: teile === null || teile >= b.teile ? ('text' as const) : ('dim' as const) })),
  };
}

/** Tooltip content of an item (see module comment). */
export function itemTooltip(i18n: I18n, input: ItemTooltipInput): ItemTooltipModel {
  const { def, stack } = input;
  const compare = input.compare ?? null;
  const lang = i18n.lang;
  const sections: TooltipSection[] = [];
  sections.push({ lines: [{ text: def.beschreibung[lang], tone: 'text' }] });

  const quality = stack === null ? 1 : stackQuality(stack);
  const facts: TooltipLine[] = [];
  if (quality > 1) facts.push({ text: i18n.t('ui.item.qualitaet', { sterne: quality }), tone: 'text' });
  if (def.werkzeug !== undefined) facts.push({ text: i18n.t('ui.item.werkzeug', { art: i18n.t(`ui.item.werkzeugart.${def.werkzeug.art}`), kraft: def.werkzeug.abbaukraft }), tone: 'text' });
  if (def.ruestungsgewicht !== undefined) facts.push({ text: i18n.t(`ui.item.ruestungsgewicht.${def.ruestungsgewicht}`), tone: 'dim' });
  if (def.essbar !== undefined) facts.push({ text: i18n.t('ui.item.essbar', { saettigung: signed(lang, def.essbar.saettigung), durst: signed(lang, def.essbar.durst) }), tone: 'text' });
  if (def.haltbarkeit !== undefined && stack?.haltbarkeit !== undefined) {
    const max = maxDurability(def.haltbarkeit, quality);
    if (stack.haltbarkeit === 0) facts.push({ text: i18n.t('ui.item.kaputt'), tone: 'warn' });
    else facts.push({ text: i18n.t('ui.item.haltbarkeit', { wert: stack.haltbarkeit, max }), tone: stack.haltbarkeit * 4 <= max ? 'warn' : 'text' });
  }
  if (def.frische !== undefined) {
    if (stack?.frische !== undefined) facts.push({ text: i18n.t('ui.item.frische', { wert: Math.round(stack.frische) }), tone: stack.frische < STALE_FRESHNESS ? 'warn' : 'text' });
    facts.push({ text: i18n.t('ui.item.haltbarTage', { tage: def.frische }), tone: 'dim' });
  }
  // The burn time and where it burns, in one line (a lamp's fuel has no burn time of its own: only where).
  const verzeichnis = input.lookup?.verzeichnis ?? null;
  const brennstellen = verzeichnis === null ? [] : brennstellenNamen(verzeichnis, def.id, lang);
  const liste = nameList(i18n, brennstellen);
  if (def.brennwert !== undefined) facts.push({ text: brennstellen.length === 0 ? i18n.t('ui.item.brennwert', { sekunden: def.brennwert }) : i18n.t('ui.tooltip.brenntSekundenIn', { sekunden: def.brennwert, liste }), tone: 'text' });
  else if (brennstellen.length > 0) facts.push({ text: i18n.t('ui.tooltip.brenntIn', { liste }), tone: 'text' });
  if (def.rucksack !== undefined) facts.push({ text: i18n.t('ui.tooltip.rucksack', { plaetze: def.rucksack.plaetze }), tone: 'text' });
  facts.push({ text: i18n.t('ui.item.tauschwert', { wert: def.tauschwert }), tone: 'dim' });
  sections.push({ lines: facts });

  const stats = statLines(i18n, def, stack, compare);
  if (stats.length > 0) sections.push({ heading: compare === null ? undefined : i18n.t('ui.tooltip.vergleich', { item: compare.def.name[lang] }), lines: stats });
  const set = armorSetOf(def.id, input.armorSets);
  if (set !== undefined) sections.push(setSection(i18n, set, input.wornSets ?? null));

  const lookup = input.lookup ?? null;
  if (lookup !== null) {
    const sources = verzeichnis === null ? sourceGroups(lookup, def.id, lang) : herkunftsGruppen(verzeichnis, def.id, i18n);
    sections.push({
      heading: i18n.t('ui.item.herkunft'),
      lines:
        sources.length === 0
          ? [{ text: i18n.t('ui.tooltip.keineHerkunft'), tone: 'dim' }]
          : sources.map((g) => ({ text: g.names.length === 0 ? i18n.t(`ui.item.quelle.${g.kind}`) : i18n.t('ui.tooltip.gruppe', { art: i18n.t(`ui.item.quelle.${g.kind}`), liste: nameList(i18n, g.names) }), tone: 'text' as const })),
    });
    const uses = verzeichnis === null ? useGroups(lookup, def.id, lang) : verwendungsGruppen(verzeichnis, def.id, i18n);
    sections.push({
      heading: i18n.t('ui.item.verwendetIn'),
      lines:
        uses.length === 0
          ? [{ text: i18n.t(def.endprodukt === true ? 'ui.tooltip.endprodukt' : 'ui.tooltip.keineVerwendung'), tone: 'dim' }]
          : uses.map((g) => ({ text: g.names.length === 0 ? i18n.t(`ui.item.verwendung.${g.kind}`) : i18n.t('ui.tooltip.gruppe', { art: i18n.t(`ui.item.verwendung.${g.kind}`), liste: nameList(i18n, g.names) }), tone: 'text' as const })),
    });
  }

  const subtitle = i18n.t('ui.tooltip.untertitel', {
    kategorie: i18n.t(`ui.item.kategorie.${def.kategorie}`),
    stufe: i18n.t('ui.item.stufe', { stufe: def.stufe }),
  });
  return { title: def.name[lang], rarity: def.raritaet, subtitle, rarityLabel: i18n.t(`ui.item.raritaet.${def.raritaet}`), sections };
}
