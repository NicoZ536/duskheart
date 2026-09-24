/**
 * Texts of the HUD (M3-27; MASTERPROMPT §26 "Texte: Satzanfang groß, klare Verben; Fehlermeldungen sagen,
 * was fehlt und wie man es löst"): accessible names, the short timers of the condition icons and the
 * tooltips of bars, thermometer, fear eye, conditions and slots. Pure – keys under `ui.hud.*` in
 * src/i18n/de.json and en.json, numbers through src/i18n/format.ts; unit-tested with strict i18n
 * (tests/unit/ui/hud-texte.test.ts).
 */
import { BALANCE } from '../../content/balance';
import type { FearStage } from '../../content/balance/fear';
import type { TemperatureStage } from '../../content/balance/survival';
import type { ConditionDef } from '../../content/conditions';
import type { ItemDef } from '../../content/schema/item';
import { FRESHNESS_MAX } from '../../game/items/formulas';
import type { ItemStack } from '../../game/items/stack';
import type { I18n } from '../../i18n';
import { formatNumber, formatPercent, formatTemperature } from '../../i18n/format';
import type { HudLeiste } from './modus';
import type { TrendStufe } from './thermometer';
import { NO_TIMER, type LightView } from './signale';

/** Tone of a tooltip line. */
export type HudTon = 'text' | 'dim' | 'warn' | 'gut';

export interface HudZeile {
  readonly text: string;
  readonly ton: HudTon;
  /** CSS colour instead of the tone's (a palette token: the rarity of an item). */
  readonly farbe?: string;
}

/** A HUD tooltip: title (optionally in a colour token), sections of lines. */
export interface HudTooltipModell {
  readonly titel: string;
  /** CSS colour of the title (a palette token); default the accent. */
  readonly titelFarbe?: string;
  readonly abschnitte: ReadonlyArray<{ readonly kopf?: string; readonly zeilen: readonly HudZeile[] }>;
}

const S = BALANCE.survival;
const SEKUNDEN_JE_MINUTE = 60;
/** Below ten minutes the timer shows minutes and seconds ("9:05"), from then on whole minutes ("12m"). */
const NUR_MINUTEN_AB_S = 600;
const ZWEI_STELLEN = 10;

/** Short timer under a condition icon: "45s", "2:05", "12m"; empty for conditions without an end. */
export function zustandsZeit(i18n: I18n, sekunden: number): string {
  if (sekunden === NO_TIMER || sekunden < 0) return '';
  if (sekunden < SEKUNDEN_JE_MINUTE) return i18n.t('ui.hud.zustand.zeit.sekunden', { s: sekunden });
  if (sekunden < NUR_MINUTEN_AB_S) {
    const m = Math.floor(sekunden / SEKUNDEN_JE_MINUTE);
    const s = sekunden % SEKUNDEN_JE_MINUTE;
    return i18n.t('ui.hud.zustand.zeit.minutenSekunden', { m, ss: s < ZWEI_STELLEN ? `0${s}` : String(s) });
  }
  return i18n.t('ui.hud.zustand.zeit.minuten', { m: Math.ceil(sekunden / SEKUNDEN_JE_MINUTE) });
}

/** Remaining time in words ("Noch 2 min 5 s", "Hält an, bis es behandelt wird"). */
export function zustandsRest(i18n: I18n, def: ConditionDef, sekunden: number): string {
  if (sekunden === NO_TIMER || sekunden < 0) return i18n.t(def.dauer.art === 'wert' ? 'ui.hud.zustand.rest.wert' : 'ui.hud.zustand.rest.heilung');
  if (sekunden < SEKUNDEN_JE_MINUTE) return i18n.t('ui.hud.zustand.rest.sekunden', { s: sekunden });
  return i18n.t('ui.hud.zustand.rest.minuten', { m: Math.floor(sekunden / SEKUNDEN_JE_MINUTE), s: sekunden % SEKUNDEN_JE_MINUTE });
}

/** Accessible name of a condition icon. */
export function zustandsLabel(i18n: I18n, def: ConditionDef, stacks: number, sekunden: number): string {
  const name = stacks > 1 ? i18n.t('ui.hud.zustand.mitStapel', { name: def.name[i18n.lang], n: stacks }) : def.name[i18n.lang];
  return i18n.t('ui.hud.zustand.label', { name, rest: zustandsRest(i18n, def, sekunden) });
}

/** Tooltip of a condition: name in the colour of its kind, description, remaining time, stacks. */
export function zustandsTooltip(i18n: I18n, def: ConditionDef, stacks: number, sekunden: number): HudTooltipModell {
  const zeilen: HudZeile[] = [{ text: def.beschreibung[i18n.lang], ton: 'text' }];
  if (stacks > 1) zeilen.push({ text: i18n.t('ui.hud.zustand.stapel', { n: stacks }), ton: 'text' });
  zeilen.push({ text: zustandsRest(i18n, def, sekunden), ton: 'dim' });
  return {
    titel: def.name[i18n.lang],
    titelFarbe: def.art === 'gut' ? 'var(--dh-hud-gut)' : def.art === 'kritisch' ? 'var(--dh-warnung)' : 'var(--dh-akzent)',
    abschnitte: [{ kopf: i18n.t(`ui.hud.zustand.art.${def.art}`), zeilen }],
  };
}

/** Accessible name of a bar ("Leben: 87 von 100"). */
export function leistenLabel(i18n: I18n, art: HudLeiste, wert: number, max: number): string {
  return i18n.t('ui.hud.wert.label', { label: i18n.t(`ui.hud.wert.${art}`), wert: formatNumber(i18n.lang, Math.floor(wert)), max: formatNumber(i18n.lang, Math.round(max)) });
}

/** Tooltip of a bar: value of maximum and what it means now (§11.1 thresholds from the balance). */
export function leistenTooltip(i18n: I18n, art: HudLeiste, wert: number, max: number): HudTooltipModell {
  const satt = S.health.regenAboveSatiety;
  const durst = S.health.regenAboveThirst;
  let zeile: HudZeile;
  switch (art) {
    case 'leben':
      zeile = { text: i18n.t('ui.hud.wert.info.leben', { satt, durst, sekunden: S.health.regenDamageFreeSeconds }), ton: 'dim' };
      break;
    case 'ausdauer':
      zeile = { text: i18n.t('ui.hud.wert.info.ausdauer'), ton: 'dim' };
      break;
    case 'saettigung':
      zeile = wert > satt ? { text: i18n.t('ui.hud.wert.info.saettigung', { satt }), ton: 'dim' } : { text: i18n.t('ui.hud.wert.warn.saettigung', { satt }), ton: 'warn' };
      break;
    case 'durst':
      zeile = wert > durst ? { text: i18n.t('ui.hud.wert.info.durst', { durst }), ton: 'dim' } : { text: i18n.t('ui.hud.wert.warn.durst', { durst }), ton: 'warn' };
      break;
  }
  const wertText = i18n.t('ui.hud.wert.vonMax', { wert: formatNumber(i18n.lang, Math.floor(wert)), max: formatNumber(i18n.lang, Math.round(max)) });
  return { titel: i18n.t(`ui.hud.wert.${art}`), abschnitte: [{ zeilen: [{ text: wertText, ton: 'text' }, zeile] }] };
}

/** Key of a trend step's word. */
function trendSchluessel(t: TrendStufe): string {
  switch (t) {
    case -2:
      return 'ui.hud.thermo.trend.faelltSchnell';
    case -1:
      return 'ui.hud.thermo.trend.faellt';
    case 0:
      return 'ui.hud.thermo.trend.stabil';
    case 1:
      return 'ui.hud.thermo.trend.steigt';
    case 2:
      return 'ui.hud.thermo.trend.steigtSchnell';
  }
}

/** What the thermometer tooltip needs (the bridge's vitals). */
export interface ThermoWerte {
  readonly coreC: number;
  readonly feltC: number;
  readonly bandLowC: number;
  readonly bandHighC: number;
  readonly ambientC: number;
  readonly heatC: number;
  readonly roomC: number;
  /** 0–100 %. */
  readonly wetness: number;
  readonly stage: TemperatureStage;
  readonly trend: TrendStufe;
}

/** Accessible name of the thermometer ("Körpertemperatur 36,4 °C, Frierend, fällt"). */
export function thermoLabel(i18n: I18n, w: ThermoWerte): string {
  return i18n.t('ui.hud.thermo.label', { wert: formatTemperature(i18n.lang, w.coreC), stufe: i18n.t(`ui.stats.stufe.${w.stage}`), trend: i18n.t(trendSchluessel(w.trend)) });
}

/**
 * Tooltip of the thermometer (§11.2 "Tooltip mit gefühlter Temperatur und Einflüssen"): core with stage
 * and trend, felt temperature, comfort band, then the influences – surroundings, heat sources, room,
 * wetness, what clothing adds to the band – and what to do.
 */
export function thermoTooltip(i18n: I18n, w: ThermoWerte): HudTooltipModell {
  const lang = i18n.lang;
  const T = S.temperature;
  const t = (c: number, signed = false): string => formatTemperature(lang, c, signed);
  const kalt = w.feltC < w.bandLowC;
  const heiss = w.feltC > w.bandHighC;
  const kopf: HudZeile[] = [
    { text: i18n.t('ui.hud.thermo.kern', { wert: t(w.coreC), trend: i18n.t(trendSchluessel(w.trend)) }), ton: w.stage === 'normal' ? 'text' : 'warn' },
    { text: i18n.t('ui.hud.thermo.stufe', { stufe: i18n.t(`ui.stats.stufe.${w.stage}`) }), ton: w.stage === 'normal' ? 'dim' : 'warn' },
    { text: i18n.t('ui.hud.thermo.gefuehlt', { wert: t(w.feltC) }), ton: kalt || heiss ? 'warn' : 'text' },
    { text: i18n.t('ui.hud.thermo.komfort', { von: t(w.bandLowC), bis: t(w.bandHighC) }), ton: 'dim' },
  ];
  const einfluesse: HudZeile[] = [{ text: i18n.t('ui.hud.thermo.umgebung', { wert: t(w.ambientC) }), ton: 'text' }];
  if (w.heatC !== 0) einfluesse.push({ text: i18n.t('ui.hud.thermo.waerme', { wert: t(w.heatC, true) }), ton: 'gut' });
  if (w.roomC !== 0) einfluesse.push({ text: i18n.t('ui.hud.thermo.raum', { wert: t(w.roomC, true) }), ton: 'text' });
  if (w.wetness > 0) einfluesse.push({ text: i18n.t('ui.hud.thermo.naesse', { wert: formatPercent(lang, w.wetness / 100) }), ton: 'warn' });
  const isolation = T.comfortLowC - w.bandLowC;
  const kuehlung = w.bandHighC - T.comfortHighC;
  if (isolation > 0) einfluesse.push({ text: i18n.t('ui.hud.thermo.isolation', { wert: t(isolation, true) }), ton: 'text' });
  if (kuehlung > 0) einfluesse.push({ text: i18n.t('ui.hud.thermo.kuehlung', { wert: t(kuehlung, true) }), ton: 'text' });
  const rat: HudZeile = kalt ? { text: i18n.t('ui.hud.thermo.rat.kalt'), ton: 'warn' } : heiss ? { text: i18n.t('ui.hud.thermo.rat.heiss'), ton: 'warn' } : { text: i18n.t('ui.hud.thermo.rat.gut'), ton: 'gut' };
  return {
    titel: i18n.t('ui.hud.thermo.titel'),
    abschnitte: [{ zeilen: kopf }, { kopf: i18n.t('ui.hud.thermo.einfluesse'), zeilen: einfluesse }, { zeilen: [rat] }],
  };
}

/** Accessible name of the fear eye ("Furcht 45: Flüstern"). */
export function furchtLabel(i18n: I18n, wert: number, stage: FearStage): string {
  return i18n.t('ui.hud.furcht.label', { wert: formatNumber(i18n.lang, Math.round(wert)), stufe: i18n.t(`ui.hud.furcht.stufe.${stage}`) });
}

/** Tooltip of the fear eye: value, stage and what helps (§12.3). */
export function furchtTooltip(i18n: I18n, wert: number, stage: FearStage): HudTooltipModell {
  return {
    titel: i18n.t('ui.hud.furcht.titel'),
    titelFarbe: 'var(--dh-hud-furcht)',
    abschnitte: [
      {
        zeilen: [
          { text: i18n.t('ui.hud.furcht.wert', { wert: formatNumber(i18n.lang, Math.round(wert)), max: BALANCE.fear.max, stufe: i18n.t(`ui.hud.furcht.stufe.${stage}`) }), ton: 'text' },
          { text: i18n.t(`ui.hud.furcht.rat.${stage}`), ton: stage === 'unruhig' ? 'dim' : 'warn' },
        ],
      },
    ],
  };
}

/** Durability (0–1) of a worn piece or the freshness of spoiling food, once it is below full (§13.1, §18). */
export function verschleiss(stack: ItemStack | null, def: ItemDef | undefined, maxHaltbarkeit: number | null): { readonly anteil: number; readonly art: 'haltbarkeit' | 'frische' } | null {
  if (stack === null || def === undefined) return null;
  let v: { anteil: number; art: 'haltbarkeit' | 'frische' } | null = null;
  if (maxHaltbarkeit !== null && maxHaltbarkeit > 0 && stack.haltbarkeit !== undefined) v = { anteil: stack.haltbarkeit / maxHaltbarkeit, art: 'haltbarkeit' };
  else if (stack.frische !== undefined) v = { anteil: stack.frische / FRESHNESS_MAX, art: 'frische' };
  return v !== null && v.anteil < 1 ? { anteil: Math.max(0, v.anteil), art: v.art } : null;
}

/** Accessible name of a hotbar, off-hand or belt slot. */
export function platzLabel(i18n: I18n, schluessel: 'schnellleiste' | 'guertel', nummer: string, stack: ItemStack | null, def: ItemDef | undefined): string {
  if (stack === null || def === undefined) return i18n.t(`ui.hud.${schluessel}.leer`, { n: nummer });
  const item = stack.count > 1 ? i18n.t('ui.hud.item.anzahl', { item: def.name[i18n.lang], n: stack.count }) : def.name[i18n.lang];
  return i18n.t(`ui.hud.${schluessel}.platz`, { n: nummer, item });
}

/** Below this share of durability, freshness or burn time a line warns (the wear bar turns red there too). */
export const NIEDRIG_ANTEIL = 0.25;

/** A food value with its sign ("+4", "-2", "0"). */
function vorzeichen(lang: I18n['lang'], wert: number): string {
  const text = formatNumber(lang, Math.abs(wert));
  return wert > 0 ? `+${text}` : wert < 0 ? `-${text}` : text;
}

/**
 * Tooltip of an item in a HUD slot: the name in its rarity colour, category · tier, the rarity from
 * Ungewöhnlich also as a word (§29 "farbunabhängige Symbole"), count, tool and mining power, food values, durability of
 * maximum or the broken hint, freshness – then what the slot adds (`zusatz`: the belt key, the carried
 * light). The full sheet with description, sources and uses is the inventory's tooltip.
 */
export function itemTooltip(i18n: I18n, stack: ItemStack, def: ItemDef, maxHaltbarkeit: number | null, titelFarbe: string, zusatz: readonly HudZeile[] = []): HudTooltipModell {
  const lang = i18n.lang;
  const zeilen: HudZeile[] = [{ text: i18n.t('ui.tooltip.untertitel', { kategorie: i18n.t(`ui.item.kategorie.${def.kategorie}`), stufe: i18n.t('ui.item.stufe', { stufe: def.stufe }) }), ton: 'dim' }];
  // Rarity from Ungewöhnlich as a word in its colour (a common item's title has no colour to explain).
  if (def.raritaet !== 'gewoehnlich') zeilen.push({ text: i18n.t(`ui.item.raritaet.${def.raritaet}`), ton: 'text', farbe: titelFarbe });
  if (stack.count > 1) zeilen.push({ text: i18n.t('ui.hud.item.stapel', { n: stack.count }), ton: 'text' });
  if (def.werkzeug !== undefined) zeilen.push({ text: i18n.t('ui.item.werkzeug', { art: i18n.t(`ui.item.werkzeugart.${def.werkzeug.art}`), kraft: def.werkzeug.abbaukraft }), ton: 'text' });
  if (def.essbar !== undefined) zeilen.push({ text: i18n.t('ui.item.essbar', { saettigung: vorzeichen(lang, def.essbar.saettigung), durst: vorzeichen(lang, def.essbar.durst) }), ton: 'text' });
  if (stack.haltbarkeit === 0) zeilen.push({ text: i18n.t('ui.hud.item.kaputt'), ton: 'warn' });
  else if (maxHaltbarkeit !== null && maxHaltbarkeit > 0 && stack.haltbarkeit !== undefined) {
    zeilen.push({ text: i18n.t('ui.item.haltbarkeit', { wert: stack.haltbarkeit, max: maxHaltbarkeit }), ton: stack.haltbarkeit / maxHaltbarkeit < NIEDRIG_ANTEIL ? 'warn' : 'dim' });
  }
  if (stack.frische !== undefined) zeilen.push({ text: i18n.t('ui.item.frische', { wert: Math.round(stack.frische) }), ton: stack.frische / FRESHNESS_MAX < NIEDRIG_ANTEIL ? 'warn' : 'dim' });
  const abschnitte: Array<{ readonly zeilen: readonly HudZeile[] }> = [{ zeilen }];
  if (zusatz.length > 0) abschnitte.push({ zeilen: zusatz });
  return { titel: def.name[lang], titelFarbe, abschnitte };
}

/** Tooltip of an empty off-hand or belt slot: what belongs there and how it is used. */
export function leerTooltip(i18n: I18n, art: 'nebenhand' | 'guertel', inventarTaste: string | null, guertelTaste: string | null): HudTooltipModell {
  if (art === 'nebenhand') {
    const text = inventarTaste === null ? i18n.t('ui.hud.nebenhand.tipp') : i18n.t('ui.hud.nebenhand.tippTaste', { taste: inventarTaste });
    return { titel: i18n.t('ui.equipment.slot.nebenhand'), abschnitte: [{ zeilen: [{ text, ton: 'dim' }] }] };
  }
  const text = guertelTaste === null ? i18n.t('ui.hud.guertel.tipp') : i18n.t('ui.hud.guertel.nichts', { taste: guertelTaste });
  return { titel: i18n.t('ui.hud.guertel.label'), abschnitte: [{ zeilen: [{ text, ton: 'dim' }] }] };
}

/** The line of the belt slot the belt key uses next ("Q: Apfel essen oder trinken"). */
export function guertelZeile(i18n: I18n, taste: string, def: ItemDef): HudZeile {
  return { text: i18n.t('ui.hud.guertel.naechster', { taste, item: def.name[i18n.lang] }), ton: 'dim' };
}

/** Remaining burn time in words ("3 min 12 s", "45 s"). */
export function brennzeit(i18n: I18n, sekunden: number): string {
  const s = Math.max(0, Math.ceil(sekunden));
  if (s < SEKUNDEN_JE_MINUTE) return i18n.t('ui.hud.licht.zeit.sekunden', { s });
  return i18n.t('ui.hud.licht.zeit.minuten', { m: Math.floor(s / SEKUNDEN_JE_MINUTE), s: s % SEKUNDEN_JE_MINUTE });
}

/**
 * Lines of the carried light on its slot (§12.2, §10): whether it burns and for how long, or how to light
 * it; rain burns it twice as fast; on the belt it gives less light.
 */
export function lichtZeilen(i18n: I18n, licht: LightView, schalter: string | null): HudZeile[] {
  const zeit = brennzeit(i18n, licht.seconds);
  const zeilen: HudZeile[] = [];
  if (licht.lit) zeilen.push({ text: i18n.t('ui.hud.licht.brennt', { zeit }), ton: licht.share < NIEDRIG_ANTEIL ? 'warn' : 'gut' });
  else {
    zeilen.push({ text: schalter === null ? i18n.t('ui.hud.licht.aus') : i18n.t('ui.hud.licht.ausTaste', { taste: schalter }), ton: 'warn' });
    zeilen.push({ text: i18n.t('ui.hud.licht.rest', { zeit }), ton: 'dim' });
  }
  if (licht.lit && licht.rain) zeilen.push({ text: i18n.t('ui.hud.licht.regen'), ton: 'warn' });
  if (licht.belt) zeilen.push({ text: i18n.t('ui.hud.licht.guertel'), ton: 'dim' });
  return zeilen;
}
