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
 *   shelf life, burn time, backpack slots, trade value.
 * - "Herkunft" and "Verwendet in" from the derived item index (`ItemLookup`).
 */
import type { Rarity } from '../../content/schema/common';
import { ITEM_STATS, type ItemDef, type ItemStat } from '../../content/schema/item';
import { maxDurability, qualityFactor } from '../../game/items/formulas';
import { stackQuality, type ItemStack } from '../../game/items/stack';
import type { I18n, Lang } from '../../i18n';
import { formatNumber, formatPercent } from '../../i18n/format';
import { sourceGroups, useGroups, type ItemLookup } from './lookup';

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
  if (def.brennwert !== undefined) facts.push({ text: i18n.t('ui.item.brennwert', { sekunden: def.brennwert }), tone: 'text' });
  if (def.rucksack !== undefined) facts.push({ text: i18n.t('ui.tooltip.rucksack', { plaetze: def.rucksack.plaetze }), tone: 'text' });
  facts.push({ text: i18n.t('ui.item.tauschwert', { wert: def.tauschwert }), tone: 'dim' });
  sections.push({ lines: facts });

  const stats = statLines(i18n, def, stack, compare);
  if (stats.length > 0) sections.push({ heading: compare === null ? undefined : i18n.t('ui.tooltip.vergleich', { item: compare.def.name[lang] }), lines: stats });

  const lookup = input.lookup ?? null;
  if (lookup !== null) {
    const sources = sourceGroups(lookup, def.id, lang);
    if (sources.length > 0) {
      sections.push({
        heading: i18n.t('ui.item.herkunft'),
        lines: sources.map((g) => ({ text: g.names.length === 0 ? i18n.t(`ui.item.quelle.${g.kind}`) : i18n.t('ui.tooltip.gruppe', { art: i18n.t(`ui.item.quelle.${g.kind}`), liste: nameList(i18n, g.names) }), tone: 'text' as const })),
      });
    }
    const uses = useGroups(lookup, def.id, lang);
    if (uses.length > 0) {
      sections.push({
        heading: i18n.t('ui.item.verwendetIn'),
        lines: uses.map((g) => ({ text: g.names.length === 0 ? i18n.t(`ui.item.verwendung.${g.kind}`) : i18n.t('ui.tooltip.gruppe', { art: i18n.t(`ui.item.verwendung.${g.kind}`), liste: nameList(i18n, g.names) }), tone: 'text' as const })),
      });
    }
  }

  const subtitle = i18n.t('ui.tooltip.untertitel', {
    kategorie: i18n.t(`ui.item.kategorie.${def.kategorie}`),
    stufe: i18n.t('ui.item.stufe', { stufe: def.stufe }),
  });
  return { title: def.name[lang], rarity: def.raritaet, subtitle, rarityLabel: i18n.t(`ui.item.raritaet.${def.raritaet}`), sections };
}
