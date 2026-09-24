/**
 * Sprite-Schritt von `npm run assets` (M1-05 … M1-08): Sprites suchen → Atlanten (Albedo + Normal/Höhe)
 * → Manifest `src/generated/atlas.ts` → Kontaktbögen je Gruppe + `palette.png`.
 *
 * Cache: Ein SHA-256 über alle Eingaben (Sprite-Quellen, `assets-src/`, die Werkzeuge selbst und die
 * Quellmodule aus `src/`, die Generatoren und Vorschau nutzen: RNG/Rauschen, Autotiling mit dem
 * Frame-Layout der Tilesets, die Terrain-Daten mit den Variantengewichten) steht in `<cache>/sprites.json`. Ist er unverändert und
 * existieren alle Ausgaben, endet der Schritt ohne Sprites zu laden (< 1 s). Veraltete Kontaktbögen
 * früherer Läufe (umbenannte Gruppen) werden entfernt.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PALETTE_ROWS, validatePaletteRows } from '../../assets-src/paletteRows';
import { hashFiles, listFiles, writeIfChanged } from '../lib/files';
import { encodePng } from '../lib/png';
import { buildAtlas } from './atlas';
import { manifestSource } from './manifest';
import { groupSheet, normalsSheet, paletteSheet } from './sheets';
import { loadSprites } from './sources';

export interface SpriteStepPaths {
  /** Projektwurzel (Basis relativer Pfade im Hash). */
  readonly root: string;
  /** Sprite-Quellen (`assets-src/sprites`). */
  readonly spritesDir: string;
  /** `src/generated` (Manifest). */
  readonly generated: string;
  /** `public/generated` (Atlanten). */
  readonly publicGenerated: string;
  /** `tools/out/sheets` (Kontaktbögen). */
  readonly sheets: string;
  /** Ablage der Cache-Datei. */
  readonly cache: string;
}

export interface SpriteStepResult {
  readonly cached: boolean;
  readonly hash: string;
  readonly sprites: number;
  readonly frames: number;
  readonly uniqueFrames: number;
  readonly atlas: { readonly width: number; readonly height: number };
  readonly groups: readonly string[];
  /** Geschriebene Ausgabedateien (absolut). */
  readonly outputs: readonly string[];
}

/** Dateiname des Caches im Cache-Ordner. */
export const CACHE_FILE = 'sprites.json';
/** Ausgabedateien der Atlanten und des Manifests. */
export const OUTPUT_NAMES = { albedo: 'atlas-albedo.png', normal: 'atlas-normal.png', manifest: 'atlas.ts', palette: 'palette.png', normals: 'normals.png' } as const;
/** Bogennamen, die keine Sprite-Gruppe tragen darf. */
const RESERVED_SHEETS = new Set(['palette', 'normals']);

interface CacheEntry {
  readonly hash: string;
  readonly result: Omit<SpriteStepResult, 'cached'>;
}

/**
 * Quellmodule aus `src/`, die Sprite-Generatoren und Vorschau (tools/assets/tile-preview.ts) einbinden –
 * ändert sich eines, sind Atlas und Bögen veraltet (z. B. das Blob-Frame-Layout in `autotile.ts`).
 */
export const SOURCE_INPUTS = [
  'src/engine/rng.ts',
  'src/engine/noise.ts',
  'src/content/schema/common.ts',
  'src/world/autotile.ts',
  'src/content/terrain.ts',
  'src/content/ores.ts',
] as const;

/** Alle Dateien, deren Inhalt die Ausgaben bestimmt. */
export function inputFiles(paths: SpriteStepPaths): string[] {
  const { root } = paths;
  const dirs = [paths.spritesDir, join(root, 'assets-src'), join(root, 'tools/assets'), join(root, 'tools/lib')];
  const single = SOURCE_INPUTS.map((f) => join(root, f)).filter((f) => existsSync(f));
  return [...new Set([...dirs.flatMap((d) => listFiles(d)), ...single])];
}

function readCache(file: string): CacheEntry | null {
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<CacheEntry>;
    if (typeof parsed.hash !== 'string' || typeof parsed.result !== 'object' || parsed.result === null) return null;
    return parsed as CacheEntry;
  } catch {
    return null;
  }
}

/** Führt den Sprite-Schritt aus (oder erkennt den Cache-Treffer). `force` ignoriert den Cache. */
export async function buildSprites(paths: SpriteStepPaths, force = false): Promise<SpriteStepResult> {
  const hash = hashFiles(paths.root, inputFiles(paths));
  const cacheFile = join(paths.cache, CACHE_FILE);
  const previous = readCache(cacheFile);
  if (!force && previous !== null && previous.hash === hash && previous.result.outputs.every((f) => existsSync(f))) {
    return { ...previous.result, cached: true };
  }

  const rowErrors = validatePaletteRows(PALETTE_ROWS);
  if (rowErrors.length > 0) throw new Error(`Palettenzeilen fehlerhaft: ${rowErrors.join('; ')}`);
  const { sprites, errors } = await loadSprites(paths.spritesDir);
  if (errors.length > 0) throw new Error(`Sprite-Quellen fehlerhaft:\n  ${errors.join('\n  ')}`);

  const build = buildAtlas(sprites);
  const outputs: string[] = [];
  const write = (file: string, data: string | Uint8Array): void => {
    writeIfChanged(file, data);
    outputs.push(file);
  };
  write(join(paths.publicGenerated, OUTPUT_NAMES.albedo), encodePng(build.width, build.height, build.albedo));
  write(join(paths.publicGenerated, OUTPUT_NAMES.normal), encodePng(build.width, build.height, build.normal));
  write(join(paths.generated, OUTPUT_NAMES.manifest), manifestSource(build, PALETTE_ROWS, hash));

  const groups = [...new Set(build.sprites.map((s) => s.group))].sort();
  const reserved = groups.filter((g) => RESERVED_SHEETS.has(g));
  if (reserved.length > 0) throw new Error(`Sprite-Gruppe ${reserved.join(', ')} ist als Bogenname reserviert`);
  for (const g of groups) {
    write(
      join(paths.sheets, `${g}.png`),
      groupSheet(
        g,
        build.sprites.filter((s) => s.group === g),
        build.pixels,
      ),
    );
  }
  write(join(paths.sheets, OUTPUT_NAMES.palette), paletteSheet(PALETTE_ROWS));
  write(join(paths.sheets, OUTPUT_NAMES.normals), normalsSheet(build.sprites, build.pixels));

  // Kontaktbögen früherer Läufe, deren Gruppe es nicht mehr gibt.
  for (const old of previous?.result.outputs ?? []) if (!outputs.includes(old) && existsSync(old)) rmSync(old);

  const result: Omit<SpriteStepResult, 'cached'> = {
    hash,
    sprites: build.sprites.length,
    frames: build.frameCount,
    uniqueFrames: build.uniqueFrames,
    atlas: { width: build.width, height: build.height },
    groups,
    outputs,
  };
  writeIfChanged(cacheFile, `${JSON.stringify({ hash, result } satisfies CacheEntry, null, 2)}\n`);
  return { ...result, cached: false };
}
