/**
 * `npm run assets` (MASTERPROMPT §5): Palette → Icons → Sprites (Atlanten, Manifest, Kontaktbögen)
 * → Vorschau (Kachelfelder, Szene, Biom-Tönung) → UI-Grafik. Jeder Schritt ist deterministisch;
 * Ausgaben sind Build-Artefakte (gitignored). Sprite- und Vorschau-Schritt überspringen sich per
 * Quell-Hash, wenn sich nichts geändert hat (docs/RENDER.md §2).
 *
 * CLI: `tsx tools/assets/build.ts [--force]` (`--force` ignoriert den Cache).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { buildIcons } from './icons-step';
import { buildPalette } from './palette-step';
import { buildSprites } from './sprites-step';
import { buildPreviews } from './tile-preview';
import { uiStep } from './ui-step';

const ROOT = process.cwd();
const OUT = {
  generated: join(ROOT, 'src/generated'),
  publicGenerated: join(ROOT, 'public/generated'),
  sheets: join(ROOT, 'tools/out/sheets'),
  cache: join(ROOT, 'tools/out/cache'),
};
const SPRITES_DIR = join(ROOT, 'assets-src/sprites');
/** Vorschaubögen des Vorschau-Schritts (tools/assets/tile-preview.ts). */
const PREVIEW_SHEETS = ['vorschau_gruenhain.png', 'biome.png'];
const force = process.argv.includes('--force');
/** Whether the sprite step rebuilt (its source hash also covers every input of the previews). */
let spritesChanged = true;

async function spritesStep(): Promise<string> {
  const r = await buildSprites({ root: ROOT, spritesDir: SPRITES_DIR, ...OUT }, force);
  spritesChanged = !r.cached;
  const hash = r.hash.slice(0, 12);
  if (r.cached) return `unverändert (Quell-Hash ${hash}), ${r.sprites} Sprites`;
  return `${r.sprites} Sprites, ${r.frames} Frames (${r.uniqueFrames} eindeutig) → Atlas ${r.atlas.width}×${r.atlas.height}; Kontaktbögen: ${[...r.groups, 'palette', 'normals'].join(', ')} (Quell-Hash ${hash})`;
}

async function previewStep(): Promise<string> {
  if (!spritesChanged && PREVIEW_SHEETS.every((f) => existsSync(join(OUT.sheets, f)))) return 'unverändert';
  const files = await buildPreviews(SPRITES_DIR, OUT.sheets);
  return files.map((f) => basename(f)).join(', ');
}

const t0 = performance.now();
for (const dir of Object.values(OUT)) mkdirSync(dir, { recursive: true });
const steps: Array<[string, () => string | Promise<string>]> = [
  ['Palette', () => buildPalette(OUT)],
  ['Icons', () => buildIcons(OUT)],
  ['Sprites', spritesStep],
  ['Vorschau', previewStep],
  ['UI', () => uiStep(OUT)],
];
try {
  for (const [name, run] of steps) console.log(`assets: ${name} – ${await run()}`);
} catch (err) {
  console.error(`assets: FEHLER – ${(err as Error).message}`);
  process.exit(1);
}
console.log(`assets: fertig in ${Math.round(performance.now() - t0)} ms`);
