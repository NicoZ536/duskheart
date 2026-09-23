/**
 * Schwellwerte und Bericht von `npm run bench` (MASTERPROMPT §3.4 „Schwellwerte mit
 * Sicherheitsmarge“, §30). Die Grenzwerte stehen in `tools/bench/schwellwerte.json`: je Messwert
 * Budget, Marge (Faktor auf das Budget) und Begründung; Grenze = Budget × Marge. Jeder Messwert
 * braucht genau einen Schwellwert und umgekehrt, sonst scheitert der Lauf. Reine Funktionen, damit
 * `tests/unit/tools/bench.test.ts` künstliche Verletzungen prüfen kann.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';

/** Standard-Schwellwertdatei relativ zur Projektwurzel. */
export const THRESHOLDS_FILE = 'tools/bench/schwellwerte.json';
/** Standard-Berichtsdatei relativ zur Projektwurzel (gitignored). */
export const REPORT_FILE = 'tools/out/bench/bericht.json';
/** Format-Version des JSON-Berichts. */
export const REPORT_VERSION = 1;

/** Ein gemessener Wert eines Szenarios. */
export interface Measurement {
  readonly scenario: string;
  readonly metric: string;
  readonly value: number;
  readonly unit: string;
}

const thresholdSchema = z
  .object({
    /** Budget aus §30 oder aus dem Akzeptanzkriterium. */
    budget: z.number().nonnegative(),
    /** Faktor auf das Budget (1 = exakt das Budget; > 1 nur mit Begründung, z. B. SwiftShader). */
    marge: z.number().positive(),
    einheit: z.string(),
    grund: z.string().min(1),
  })
  .strict();
export type Threshold = z.output<typeof thresholdSchema>;

const fileSchema = z
  .object({
    beschreibung: z.string().min(1),
    /** Schlüssel `<szenario> · <metrik>`. */
    schwellwerte: z.record(z.string().regex(/^.+ · .+$/, 'Schlüssel muss „<szenario> · <metrik>“ sein'), thresholdSchema),
  })
  .strict();

/** Schlüssel eines Messwerts in der Schwellwertdatei. */
export function thresholdKey(scenario: string, metric: string): string {
  return `${scenario} · ${metric}`;
}

/** Prüft den Inhalt einer Schwellwertdatei. */
export function parseThresholds(json: unknown): ReadonlyMap<string, Threshold> {
  const parsed = fileSchema.safeParse(json);
  if (!parsed.success) throw new TypeError(`Schwellwerte ungültig: ${parsed.error.issues.map((i) => `${i.path.map(String).join('.') || '(Datei)'}: ${i.message}`).join('; ')}`);
  return new Map(Object.entries(parsed.data.schwellwerte));
}

/** Liest eine Schwellwertdatei. */
export function loadThresholds(file: string): ReadonlyMap<string, Threshold> {
  return parseThresholds(JSON.parse(readFileSync(file, 'utf8')));
}

/** Bewertung eines Messwerts. */
export interface BenchRow extends Measurement {
  readonly limit: number;
  readonly ok: boolean;
}

/** Ergebnis eines Bench-Laufs (auch Inhalt des JSON-Berichts). */
export interface BenchReport {
  readonly version: number;
  readonly ok: boolean;
  readonly rows: readonly BenchRow[];
  /** Strukturfehler: Messwert ohne Schwellwert, Schwellwert ohne Messwert, Einheit falsch. */
  readonly errors: readonly string[];
}

/**
 * Vergleicht Messwerte mit den Schwellwerten. `scenarios` begrenzt die Pflicht „jeder Schwellwert
 * hat einen Messwert“ auf die gelaufenen Szenarien (z. B. `--nur sim`).
 */
export function evaluate(measurements: readonly Measurement[], thresholds: ReadonlyMap<string, Threshold>, scenarios: ReadonlySet<string>): BenchReport {
  const rows: BenchRow[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const m of measurements) {
    const key = thresholdKey(m.scenario, m.metric);
    const t = thresholds.get(key);
    if (seen.has(key)) errors.push(`Messwert doppelt: ${key}`);
    seen.add(key);
    if (t === undefined) {
      errors.push(`Kein Schwellwert für ${key} in der Schwellwertdatei`);
      continue;
    }
    if (t.einheit !== m.unit) errors.push(`Einheit von ${key}: gemessen ${m.unit}, Schwellwert ${t.einheit}`);
    const limit = t.budget * t.marge;
    rows.push({ ...m, limit, ok: Number.isFinite(m.value) && m.value <= limit });
  }
  for (const key of thresholds.keys()) {
    const scenario = key.slice(0, key.indexOf(' · '));
    if (scenarios.has(scenario) && !seen.has(key)) errors.push(`Schwellwert ohne Messwert: ${key}`);
  }
  return { version: REPORT_VERSION, ok: errors.length === 0 && rows.every((r) => r.ok), rows, errors };
}

/** Eine Tabellenzeile der Konsolenausgabe. */
export function formatRow(r: BenchRow): string {
  return `${r.ok ? 'OK  ' : 'FAIL'} ${r.scenario.padEnd(28)} ${r.metric.padEnd(24)} ${r.value.toFixed(3).padStart(10)} ${r.unit.padEnd(5)} ≤ ${Number(r.limit.toFixed(3))}`;
}
