/**
 * Locale-aware formatting for UI text (numbers, percent, temperature,
 * durations, in-game clock). Uses `Intl.*` with cached formatters.
 */
import type { Lang } from './index';

/** BCP-47 locale per UI language (en-GB: 24-hour clock and °C read naturally). */
export const LOCALES: Readonly<Record<Lang, string>> = { de: 'de-DE', en: 'en-GB' };

/** Non-breaking space between a number and its unit ("21,5 °C"). */
const NBSP = ' ';
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;

export function localeFor(lang: Lang): string {
  return LOCALES[lang];
}

const cache = new Map<string, Intl.NumberFormat>();
function numberFormat(lang: Lang, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const id = `${lang}|${JSON.stringify(opts)}`;
  let f = cache.get(id);
  if (!f) {
    f = new Intl.NumberFormat(LOCALES[lang], opts);
    cache.set(id, f);
  }
  return f;
}

function finite(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

/** Plain number with grouping ("12.345,5" in DE, "12,345.5" in EN). */
export function formatNumber(lang: Lang, value: number, maxFractionDigits = 0, minFractionDigits = 0): string {
  return numberFormat(lang, {
    maximumFractionDigits: Math.max(maxFractionDigits, minFractionDigits),
    minimumFractionDigits: minFractionDigits,
  }).format(finite(value));
}

/** Ratio 0..1 as percent ("75 %" in DE, "75%" in EN). */
export function formatPercent(lang: Lang, ratio: number, fractionDigits = 0): string {
  return numberFormat(lang, {
    style: 'percent',
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(finite(ratio));
}

/** Temperature with one decimal: "21,5 °C" (DE) / "21.5 °C" (EN). `signed` adds "+" for trends. */
export function formatTemperature(lang: Lang, celsius: number, signed = false): string {
  const value = finite(celsius);
  // Avoid "-0,0 °C" for tiny negative values that round to zero.
  const rounded = Math.round(value * 10) / 10;
  const text = numberFormat(lang, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: signed ? 'exceptZero' : 'auto',
  }).format(rounded === 0 ? 0 : rounded);
  return `${text}${NBSP}°C`;
}

function pad2(lang: Lang, n: number): string {
  return numberFormat(lang, { minimumIntegerDigits: 2, useGrouping: false, maximumFractionDigits: 0 }).format(n);
}

/** Real-time duration: "mm:ss" below one hour, "h:mm:ss" from one hour on. Negative values count as 0. */
export function formatDuration(lang: Lang, seconds: number): string {
  const total = Math.max(0, Math.floor(finite(seconds)));
  const h = Math.floor(total / SECONDS_PER_HOUR);
  const m = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const s = total % SECONDS_PER_MINUTE;
  if (h === 0) return `${pad2(lang, m)}:${pad2(lang, s)}`;
  return `${formatNumber(lang, h)}:${pad2(lang, m)}:${pad2(lang, s)}`;
}

/** Long durations such as play time in hours with one decimal: "12,5 h" / "12.5 h". */
export function formatHours(lang: Lang, seconds: number): string {
  const hours = Math.max(0, finite(seconds)) / SECONDS_PER_HOUR;
  return `${formatNumber(lang, hours, 1, 1)}${NBSP}h`;
}

/** In-game clock "HH:MM" (24 h) from minutes since midnight; wraps around midnight. */
export function formatGameTime(lang: Lang, minuteOfDay: number): string {
  const wrapped = ((Math.floor(finite(minuteOfDay)) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${pad2(lang, Math.floor(wrapped / MINUTES_PER_HOUR))}:${pad2(lang, wrapped % MINUTES_PER_HOUR)}`;
}

export interface Formatter {
  readonly lang: Lang;
  readonly locale: string;
  number(value: number, maxFractionDigits?: number, minFractionDigits?: number): string;
  percent(ratio: number, fractionDigits?: number): string;
  temperature(celsius: number, signed?: boolean): string;
  duration(seconds: number): string;
  hours(seconds: number): string;
  gameTime(minuteOfDay: number): string;
}

/** Formatter bound to one language (convenient for UI components). */
export function createFormatter(lang: Lang): Formatter {
  return {
    lang,
    locale: LOCALES[lang],
    number: (v, max, min) => formatNumber(lang, v, max, min),
    percent: (r, d) => formatPercent(lang, r, d),
    temperature: (c, signed) => formatTemperature(lang, c, signed),
    duration: (s) => formatDuration(lang, s),
    hours: (s) => formatHours(lang, s),
    gameTime: (m) => formatGameTime(lang, m),
  };
}
