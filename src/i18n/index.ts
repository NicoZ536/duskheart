/**
 * Translation (MASTERPROMPT §2.2, §31.4): flat-key dictionaries in de.json /
 * en.json, `{name}` interpolation, plurals via `key.one` / `key.other`
 * (Intl.PluralRules), fallback EN → DE → key, and a tracker of missing keys.
 */
import de from './de.json';
import en from './en.json';
import { LOCALES, formatNumber } from './format';

export const LANGS = ['de', 'en'] as const;
export type Lang = (typeof LANGS)[number];
/** Language every key must exist in; other languages fall back to it. */
export const FALLBACK_LANG: Lang = 'de';

export type Dictionary = Readonly<Record<string, string>>;
/** Keys of the shipped dictionaries (for call sites that want compile-time checking). */
export type I18nKey = keyof typeof de;
export type TranslateParams = Readonly<Record<string, string | number>>;

/** Maximum fraction digits used when a number is interpolated into a text. */
const PARAM_FRACTION_DIGITS = 2;

const BUILTIN: Readonly<Record<Lang, Dictionary>> = { de, en };

export function isLang(value: unknown): value is Lang {
  return value === 'de' || value === 'en';
}

/** All keys of a shipped dictionary, sorted. */
export function listKeys(lang: Lang): string[] {
  return Object.keys(BUILTIN[lang]).sort();
}

/** Names of the `{placeholders}` in a text. */
export function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
}

export interface I18nOptions {
  /** Replace or extend the built-in dictionaries (tests, mods). */
  readonly dictionaries?: Partial<Record<Lang, Dictionary>>;
}

export interface I18n {
  readonly lang: Lang;
  readonly locale: string;
  /** Translate `key`; `{name}` placeholders are filled from `params`, a numeric `count` selects the plural form. */
  t(key: string, params?: TranslateParams): string;
  /** Whether `key` (or its plural forms) exists in `lang` (default: current language). */
  has(key: string, lang?: Lang): boolean;
  setLanguage(lang: Lang): void;
  /** Keys requested but missing in `lang` (default: current language), sorted. */
  missingKeys(lang?: Lang): string[];
  onChange(listener: (lang: Lang) => void): () => void;
}

export function createI18n(initial: Lang = FALLBACK_LANG, opts: I18nOptions = {}): I18n {
  const dicts: Record<Lang, Dictionary> = {
    de: opts.dictionaries?.de ?? BUILTIN.de,
    en: opts.dictionaries?.en ?? BUILTIN.en,
  };
  const plurals: Record<Lang, Intl.PluralRules> = {
    de: new Intl.PluralRules(LOCALES.de),
    en: new Intl.PluralRules(LOCALES.en),
  };
  const missing: Record<Lang, Set<string>> = { de: new Set(), en: new Set() };
  const listeners = new Set<(lang: Lang) => void>();
  let lang: Lang = initial;

  function lookup(l: Lang, key: string, count: number | undefined): string | undefined {
    const dict = dicts[l];
    if (count !== undefined) {
      const form = dict[`${key}.${plurals[l].select(count)}`] ?? dict[`${key}.other`];
      if (form !== undefined) return form;
    }
    return dict[key];
  }

  function interpolate(l: Lang, text: string, params: TranslateParams | undefined): string {
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (match, name: string) => {
      const v = params[name];
      if (v === undefined) return match;
      return typeof v === 'number' ? formatNumber(l, v, PARAM_FRACTION_DIGITS) : v;
    });
  }

  const api: I18n = {
    get lang() {
      return lang;
    },
    get locale() {
      return LOCALES[lang];
    },
    t(key, params) {
      const count = typeof params?.count === 'number' ? params.count : undefined;
      const own = lookup(lang, key, count);
      if (own !== undefined) return interpolate(lang, own, params);
      missing[lang].add(key);
      if (lang !== FALLBACK_LANG) {
        const fallback = lookup(FALLBACK_LANG, key, count);
        if (fallback !== undefined) return interpolate(FALLBACK_LANG, fallback, params);
        missing[FALLBACK_LANG].add(key);
      }
      return key;
    },
    has(key, l = lang) {
      const dict = dicts[l];
      return dict[key] !== undefined || dict[`${key}.other`] !== undefined;
    },
    setLanguage(next) {
      if (next === lang) return;
      lang = next;
      for (const listener of [...listeners]) listener(lang);
    },
    missingKeys(l = lang) {
      return [...missing[l]].sort();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return api;
}
