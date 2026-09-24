/**
 * Stats panel of the inventory screen ("Werte", MASTERPROMPT §26 "Inventar/Ausrüstung/Werte",
 * §11.1, §11.2, §11.4): survival values, temperature (core with its stage, felt, comfort band) and
 * what the worn equipment adds (insulation, cooling, armour, armour weight, speed). Pure: rows of
 * translated label/value pairs with a tone, built from the bridge's vitals and equipment stats.
 */
import type { TemperatureStage } from '../../../content/balance/survival';
import type { EquipmentStats } from '../../../game/equipment/formulas';
import type { I18n } from '../../../i18n';
import { formatNumber, formatPercent, formatTemperature } from '../../../i18n/format';

/** Tone of a row: normal, dimmed (nothing worn), warning (low value or temperature stage). */
export type StatTone = 'text' | 'dim' | 'warn';

export interface StatRow {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly tone: StatTone;
}

export interface StatGroup {
  readonly id: 'werte' | 'temperatur' | 'ausruestung';
  readonly heading: string;
  readonly rows: readonly StatRow[];
}

/** The vitals the panel shows (the bridge's `PlayerVitalsView` values). */
export interface VitalsValues {
  readonly health: number;
  readonly maxHealth: number;
  readonly stamina: number;
  readonly maxStamina: number;
  readonly satiety: number;
  readonly thirst: number;
  readonly wetness: number;
  readonly exhaustion: number;
  readonly coreC: number;
  readonly feltC: number;
  readonly bandLowC: number;
  readonly bandHighC: number;
  readonly temperatureStage: TemperatureStage;
}

/** Share of a meter below which its row warns (§11.1: "Hungrig" below 20 of 100). */
export const LOW_SHARE = 0.2;
/** Wetness [percent] from which the row warns (§11.2: wetness lowers the insulation by up to 70 %). */
export const WET_WARN = 50;
/** Exhaustion from which the row warns (§11.5: sleep possible from 60). */
export const TIRED_WARN = 60;

function low(value: number, max: number): StatTone {
  return value < max * LOW_SHARE ? 'warn' : 'text';
}

/** The groups of the stats panel. */
export function statGroups(i18n: I18n, vitals: VitalsValues | null, equipment: EquipmentStats | null): StatGroup[] {
  const lang = i18n.lang;
  const n = (v: number): string => formatNumber(lang, v);
  const groups: StatGroup[] = [];
  if (vitals !== null) {
    groups.push({
      id: 'werte',
      heading: i18n.t('ui.stats.werte'),
      rows: [
        { id: 'leben', label: i18n.t('ui.stats.leben'), value: i18n.t('ui.stats.vonMax', { wert: n(Math.ceil(vitals.health)), max: n(vitals.maxHealth) }), tone: low(vitals.health, vitals.maxHealth) },
        { id: 'ausdauer', label: i18n.t('ui.stats.ausdauer'), value: i18n.t('ui.stats.vonMax', { wert: n(Math.floor(vitals.stamina)), max: n(vitals.maxStamina) }), tone: 'text' },
        { id: 'saettigung', label: i18n.t('ui.stats.saettigung'), value: n(Math.ceil(vitals.satiety)), tone: low(vitals.satiety, 100) },
        { id: 'durst', label: i18n.t('ui.stats.durst'), value: n(Math.ceil(vitals.thirst)), tone: low(vitals.thirst, 100) },
        { id: 'naesse', label: i18n.t('ui.stats.naesse'), value: formatPercent(lang, vitals.wetness / 100), tone: vitals.wetness >= WET_WARN ? 'warn' : 'text' },
        { id: 'erschoepfung', label: i18n.t('ui.stats.erschoepfung'), value: n(Math.floor(vitals.exhaustion)), tone: vitals.exhaustion >= TIRED_WARN ? 'warn' : 'text' },
      ],
    });
    const stage = vitals.temperatureStage;
    groups.push({
      id: 'temperatur',
      heading: i18n.t('ui.stats.temperatur'),
      rows: [
        { id: 'kern', label: i18n.t('ui.stats.kern'), value: formatTemperature(lang, vitals.coreC), tone: stage === 'normal' ? 'text' : 'warn' },
        { id: 'zustand', label: i18n.t('ui.stats.zustand'), value: i18n.t(`ui.stats.stufe.${stage}`), tone: stage === 'normal' ? 'text' : 'warn' },
        { id: 'gefuehlt', label: i18n.t('ui.stats.gefuehlt'), value: formatTemperature(lang, vitals.feltC), tone: vitals.feltC < vitals.bandLowC || vitals.feltC > vitals.bandHighC ? 'warn' : 'text' },
        { id: 'komfort', label: i18n.t('ui.stats.komfort'), value: i18n.t('ui.stats.bereich', { von: formatNumber(lang, vitals.bandLowC, 1), bis: formatNumber(lang, vitals.bandHighC, 1) }), tone: 'text' },
      ],
    });
  }
  const w = equipment?.werte;
  const weight = equipment?.ruestungsgewicht ?? null;
  groups.push({
    id: 'ausruestung',
    heading: i18n.t('ui.stats.ausruestung'),
    rows: [
      { id: 'isolation', label: i18n.t('ui.item.wert.isolation'), value: n(w?.isolation ?? 0), tone: (w?.isolation ?? 0) > 0 ? 'text' : 'dim' },
      { id: 'kuehlung', label: i18n.t('ui.item.wert.kuehlung'), value: n(w?.kuehlung ?? 0), tone: (w?.kuehlung ?? 0) > 0 ? 'text' : 'dim' },
      { id: 'ruestung', label: i18n.t('ui.item.wert.ruestung'), value: formatNumber(lang, w?.ruestung ?? 0, 1), tone: (w?.ruestung ?? 0) > 0 ? 'text' : 'dim' },
      { id: 'gewicht', label: i18n.t('ui.stats.gewicht'), value: weight === null ? i18n.t('ui.stats.gewicht.keins') : i18n.t(`ui.stats.gewicht.${weight}`), tone: weight === null ? 'dim' : 'text' },
    ],
  });
  return groups;
}
