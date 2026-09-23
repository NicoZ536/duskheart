/**
 * Content-Validator (MASTERPROMPT §31.4). Prüft Schemas, Referenzen, Übersetzungen (Content-Texte und
 * i18n-Parität) und zählt die Mindestmengen aus §C gegen die Zielwerte aus
 * `tools/validator/zielwerte.json` (ADR-0006 Zählregeln, ADR-0007 Zielwerte).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORIES, FINAL, type Category } from './content-targets';
import { checkTargets, effectiveTargets, loadTargets, runChecks } from './validator/checks';

const ROOT = process.cwd();
const progress = readFileSync(join(ROOT, 'PROGRESS.md'), 'utf8');
const milestone = /^Meilenstein:\s*(M\d+)/m.exec(progress)?.[1] ?? 'M0';
const finished = /^STATUS:\s*FERTIG\s*$/m.test(progress);

const { errors, warnings, counts } = await runChecks();
let targets: ReturnType<typeof loadTargets> | null = null;
try {
  targets = effectiveTargets(loadTargets(), finished);
} catch (err) {
  errors.push((err as Error).message);
}
if (targets !== null) errors.push(...checkTargets(counts, targets));

const table = (Object.keys(CATEGORIES) as Category[])
  .map((c) => `${CATEGORIES[c]} ${counts[c] ?? 0}/${targets?.[c] ?? '?'} (§C ${FINAL[c]})`)
  .join(' · ');
console.log(`Content (${milestone}) – Zählwert/Ziel: ${table}`);
for (const w of warnings) console.warn(`WARNUNG: ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`FEHLER: ${e}`);
  console.error(`Content-Validator: ${errors.length} Fehler.`);
  process.exit(1);
}
console.log(`Content-Validator: grün (${warnings.length} Warnungen).`);
