/** Einzelprüfungen des Content-Validators. Jede Prüfung liefert Fehler, Warnungen und Zählwerte. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Category } from '../content-targets';

export interface CheckResult {
  errors: string[];
  warnings: string[];
  counts: Partial<Record<Category, number>>;
}

const ROOT = process.cwd();

function loadLang(lang: 'de' | 'en'): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, 'src/i18n', `${lang}.json`), 'utf8')) as Record<string, unknown>;
}

/** Fehlende Übersetzung = Fehler (§31.4); beide Sprachen müssen dieselben, nicht leeren Schlüssel haben. */
export function checkI18n(res: CheckResult): void {
  const de = loadLang('de');
  const en = loadLang('en');
  for (const [a, b, name] of [[de, en, 'EN'], [en, de, 'DE']] as const) {
    for (const key of Object.keys(a)) {
      const v = b[key];
      if (typeof v !== 'string' || v.trim() === '') res.errors.push(`Übersetzung fehlt (${name}): ${key}`);
    }
  }
}

export async function runChecks(): Promise<CheckResult> {
  const res: CheckResult = { errors: [], warnings: [], counts: {} };
  checkI18n(res);
  return res;
}
