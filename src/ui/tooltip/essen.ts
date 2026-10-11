/**
 * The meal section of an item tooltip (MASTERPROMPT §18 "Mahlzeit-Effekte … Überdruss … Salz → Durst", §12.3 "Wohlfühlessen",
 * §16.4 "+10 % Mahlzeitwirkung", "Abkochen macht sauber"; docs/SPIEL.md §21; M7-26 … M7-30, strand E) as plain data: what a
 * piece does besides filling – the conditions a meal or a potion gives and for how long (10 % longer from a kitchen), what a
 * medicine cures, instant health and stamina, salt, comfort food, the kitchen's mark, raw meat's risk, boredom (the stomach's
 * counter from the session, `ueberdruss`), and the water of a vessel with its fever risk. `null` for items without any of it.
 */
import { BALANCE } from '../../content/balance';
import { CONTENT } from '../../content/index';
import type { ItemDef } from '../../content/schema/item';
import type { ItemStack } from '../../game/items/stack';
import { bored, comfortOf, countsForBoredom, effectSeconds, fromKitchen, isRawMeat } from '../../game/meals/formulas';
import { isVessel, vesselFever, vesselSips } from '../../game/water/formulas';
import type { I18n } from '../../i18n';
import { formatNumber, formatPercent } from '../../i18n/format';
import type { TooltipLine, TooltipSection } from './itemTooltip';

const M = BALANCE.meals;
const SECONDS_PER_MINUTE = 60;

/** Name of condition `id` in the language of `i18n`. */
function conditionName(i18n: I18n, id: string): string {
  return CONTENT.collection('conditions').get(id).name[i18n.lang];
}

function signed(i18n: I18n, value: number): string {
  const text = formatNumber(i18n.lang, Math.abs(value));
  return value < 0 ? `-${text}` : `+${text}`;
}

/**
 * The meal section of `def` (with the stack's kitchen mark and water, when a stack is known) – `ueberdruss` the stomach's
 * boredom counter of this dish (`null`: not known, e.g. in the recipe book). `null` when the item has nothing to say here.
 */
export function mealSection(i18n: I18n, def: ItemDef, stack: ItemStack | null, ueberdruss: number | null = null): TooltipSection | null {
  const lines: TooltipLine[] = [];
  const kitchen = stack !== null && fromKitchen(stack);
  const minutes = (seconds: number): string => formatNumber(i18n.lang, effectSeconds(seconds, kitchen) / SECONDS_PER_MINUTE, 1);
  for (const z of def.mahlzeit?.zustaende ?? []) lines.push({ text: i18n.t('ui.essen.wirkt', { zustand: conditionName(i18n, z.id), minuten: minutes(z.sekunden) }), tone: 'text' });
  const potion = def.trank;
  if (potion !== undefined) {
    for (const z of potion.gibt) lines.push({ text: i18n.t('ui.essen.wirkt', { zustand: conditionName(i18n, z.id), minuten: minutes(z.sekunden) }), tone: 'text' });
    for (const id of potion.heilt) lines.push({ text: i18n.t('ui.essen.heilt', { zustand: conditionName(i18n, id) }), tone: 'better' });
    if (potion.sofort?.leben !== undefined) lines.push({ text: i18n.t('ui.essen.leben', { wert: signed(i18n, potion.sofort.leben) }), tone: 'better' });
    if (potion.sofort?.ausdauer !== undefined) lines.push({ text: i18n.t('ui.essen.ausdauer', { wert: signed(i18n, potion.sofort.ausdauer) }), tone: 'better' });
  }
  const salt = def.mahlzeit?.salz;
  if (salt !== undefined) lines.push({ text: i18n.t('ui.essen.salz', { wert: formatNumber(i18n.lang, salt) }), tone: 'warn' });
  if (def.mahlzeit !== undefined || def.kategorie === 'gericht') {
    const comfort = comfortOf(def) * (kitchen ? M.kitchen.effect : 1);
    if (comfort > 0) lines.push({ text: i18n.t('ui.essen.wohlfuehl', { wert: formatNumber(i18n.lang, comfort, 1) }), tone: 'text' });
  }
  if (kitchen) lines.push({ text: i18n.t('ui.essen.kueche', { prozent: formatPercent(i18n.lang, M.kitchen.effect - 1) }), tone: 'better' });
  if (isRawMeat(def.id)) lines.push({ text: i18n.t('ui.essen.roh', { prozent: formatPercent(i18n.lang, M.rawMeatPoison) }), tone: 'warn' });
  if (ueberdruss !== null && countsForBoredom(def) && bored(ueberdruss)) lines.push({ text: i18n.t('ui.essen.ueberdruss'), tone: 'warn' });
  if (isVessel(def) && stack !== null) {
    const sips = vesselSips(stack, def);
    lines.push({ text: i18n.t('ui.essen.schlucke', { wert: sips, max: def.ladungen?.max ?? 0 }), tone: sips > 0 ? 'text' : 'dim' });
    if (sips > 0) {
      const fever = vesselFever(stack);
      lines.push(fever > 0 ? { text: i18n.t('ui.essen.fieber', { prozent: formatPercent(i18n.lang, fever) }), tone: 'warn' } : { text: i18n.t('ui.essen.sauber'), tone: 'better' });
    }
  }
  return lines.length === 0 ? null : { heading: i18n.t('ui.essen.titel'), lines };
}
