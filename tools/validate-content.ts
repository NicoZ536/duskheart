/**
 * Content-Validator (MASTERPROMPT §31.4). Prüft Referenzen, Übersetzungen, Palette, Erreichbarkeit
 * und zählt die Mindestmengen aus §C gegen die Ziele des aktuellen Meilensteins (ADR-0004).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORIES, FINAL, targetsFor, type Category } from './content-targets';
import { runChecks } from './validate/checks';

const ROOT = process.cwd();
const progress = readFileSync(join(ROOT, 'PROGRESS.md'), 'utf8');
const milestone = /^Meilenstein:\s*(M\d+)/m.exec(progress)?.[1] ?? 'M0';
const done = /^STATUS:\s*FERTIG\s*$/m.test(progress);
const targets = done ? FINAL : targetsFor(milestone);

const { errors, warnings, counts } = await runChecks();

for (const cat of Object.keys(CATEGORIES) as Category[]) {
  const have = counts[cat] ?? 0;
  if (have < targets[cat]) errors.push(`Mindestmenge ${CATEGORIES[cat]}: ${have} < Ziel ${targets[cat]} (${milestone}; §C: ${FINAL[cat]})`);
}

const table = (Object.keys(CATEGORIES) as Category[])
  .map((c) => `${CATEGORIES[c]} ${counts[c] ?? 0}/${FINAL[c]}`)
  .join(' · ');
console.log(`Content (${milestone}): ${table}`);
for (const w of warnings) console.warn(`WARNUNG: ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`FEHLER: ${e}`);
  console.error(`Content-Validator: ${errors.length} Fehler.`);
  process.exit(1);
}
console.log(`Content-Validator: grün (${warnings.length} Warnungen).`);
