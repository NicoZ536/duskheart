/**
 * `npm run assets` (MASTERPROMPT §5): Sprite-Quellen → Atlanten + Manifeste + Kontaktbögen.
 * Jeder Schritt ist deterministisch; Ausgaben sind Build-Artefakte (gitignored).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPalette } from './palette-step';
import { buildIcons } from './icons-step';

const ROOT = process.cwd();
export const OUT = {
  generated: join(ROOT, 'src/generated'),
  publicGenerated: join(ROOT, 'public/generated'),
  sheets: join(ROOT, 'tools/out/sheets'),
};

const t0 = performance.now();
for (const dir of Object.values(OUT)) mkdirSync(dir, { recursive: true });
const steps: Array<[string, () => string]> = [
  ['Palette', () => buildPalette(OUT)],
  ['Icons', () => buildIcons(OUT)],
];
for (const [name, run] of steps) {
  const info = run();
  console.log(`assets: ${name} – ${info}`);
}
writeFileSync(join(OUT.generated, '.stamp'), 'assets\n');
console.log(`assets: fertig in ${Math.round(performance.now() - t0)} ms`);
