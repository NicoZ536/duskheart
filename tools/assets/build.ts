/**
 * `npm run assets` (MASTERPROMPT §5): Palette → Icons → Sprites (Atlanten, Manifest, Kontaktbögen)
 * → Vorschau (Kachelfelder, Szene, Biom-Tönung) → UI-Grafik (mit der Ergänzungsschrift der
 * Pixelschrift im Stylesheet). Jeder Schritt ist deterministisch;
 * Ausgaben sind Build-Artefakte (gitignored). Sprite- und Vorschau-Schritt überspringen sich per
 * Quell-Hash, wenn sich nichts geändert hat (docs/RENDER.md §2).
 *
 * CLI: `tsx tools/assets/build.ts [--force]` (`--force` ignoriert den Cache).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
/** Cache-Datei des Vorschau-Schritts: Quell-Hash des Sprite-Schritts und die geschriebenen Bögen. */
const PREVIEW_CACHE = join(OUT.cache, 'previews.json');
const force = process.argv.includes('--force');
/** Source hash of the sprite step (it also covers every input of the previews, `SOURCE_INPUTS`). */
let spriteHash = '';

/** Whether the previews of the last run belong to `hash` and all of them still exist. */
function previewsFresh(hash: string): boolean {
  if (!existsSync(PREVIEW_CACHE)) return false;
  try {
    const cached = JSON.parse(readFileSync(PREVIEW_CACHE, 'utf8')) as { hash?: unknown; files?: unknown };
    return cached.hash === hash && Array.isArray(cached.files) && cached.files.length > 0 && cached.files.every((f) => typeof f === 'string' && existsSync(join(OUT.sheets, f)));
  } catch {
    return false;
  }
}

async function spritesStep(): Promise<string> {
  const r = await buildSprites({ root: ROOT, spritesDir: SPRITES_DIR, ...OUT }, force);
  spriteHash = r.hash;
  const hash = r.hash.slice(0, 12);
  if (r.cached) return `unverändert (Quell-Hash ${hash}), ${r.sprites} Sprites`;
  return `${r.sprites} Sprites, ${r.frames} Frames (${r.uniqueFrames} eindeutig) → Atlas ${r.atlas.width}×${r.atlas.height}; Kontaktbögen: ${[...r.groups, 'palette', 'normals'].join(', ')} (Quell-Hash ${hash})`;
}

async function previewStep(): Promise<string> {
  if (!force && previewsFresh(spriteHash)) return 'unverändert';
  const files = (await buildPreviews(SPRITES_DIR, OUT.sheets)).map((f) => basename(f));
  writeFileSync(PREVIEW_CACHE, JSON.stringify({ hash: spriteHash, files }));
  return files.join(', ');
}

const t0 = performance.now();
for (const dir of Object.values(OUT)) mkdirSync(dir, { recursive: true });
const steps: Array<[string, () => string | Promise<string>]> = [
  ['Palette', () => buildPalette(OUT)],
  ['Icons', () => buildIcons(OUT)],
  ['Sprites', spritesStep],
  ['Vorschau', previewStep],
  ['Figuren', async () => (await import('./figure-preview')).figurePreviewStep(OUT.sheets)],
  ['UI', () => uiStep(OUT)],
];
try {
  for (const [name, run] of steps) console.log(`assets: ${name} – ${await run()}`);
} catch (err) {
  console.error(`assets: FEHLER – ${(err as Error).message}`);
  process.exit(1);
}
console.log(`assets: fertig in ${Math.round(performance.now() - t0)} ms`);
