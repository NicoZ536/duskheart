/**
 * Sprite-Suche (docs/RENDER.md §1): jede Datei `assets-src/sprites/**\/*.ts` exportiert per Default ein
 * Sprite, ein Array oder ein Generator-Ergebnis (auch gemischt in einem Array). Dateien mit `_` am
 * Anfang sind Hilfsmodule (gemeinsame Legenden) und werden übersprungen. Gruppe ohne Angabe = erster
 * Ordner unter `sprites/` (Dateien direkt darin: `allgemein`).
 */
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isGeneratorResult } from '../../assets-src/lib/generator';
import { isSprite, type Sprite } from '../../assets-src/lib/sprite';
import { listFiles, relPath } from '../lib/files';

/** Gruppe für Sprite-Dateien direkt in `sprites/`. */
export const DEFAULT_GROUP = 'allgemein';

export interface LoadedSprite {
  readonly sprite: Sprite;
  /** Kontaktbogen-Gruppe (Sprite-Angabe oder Ordnername). */
  readonly group: string;
  /** Quelldatei relativ zum Sprite-Ordner. */
  readonly file: string;
}

export interface LoadResult {
  readonly sprites: readonly LoadedSprite[];
  readonly errors: readonly string[];
}

/** Sprite-Quelldateien unter `dir` (sortiert). */
export function spriteFiles(dir: string): string[] {
  return listFiles(dir, (f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !basename(f).startsWith('_'));
}

function collect(value: unknown, into: Sprite[]): boolean {
  if (isSprite(value)) into.push(value);
  else if (isGeneratorResult(value)) into.push(...value.sprites);
  else if (Array.isArray(value)) {
    for (const v of value as unknown[]) if (!collect(v, into)) return false;
  } else return false;
  return true;
}

/** Lädt alle Sprites unter `dir`. Lade-, Format- und Id-Fehler landen in `errors` statt zu werfen. */
export async function loadSprites(dir: string): Promise<LoadResult> {
  const sprites: LoadedSprite[] = [];
  const errors: string[] = [];
  const seen = new Map<string, string>();
  for (const file of spriteFiles(dir)) {
    const rel = relPath(dir, file);
    let mod: { default?: unknown };
    try {
      mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
    } catch (err) {
      errors.push(`${rel}: ${(err as Error).message}`);
      continue;
    }
    const found: Sprite[] = [];
    if (!collect(mod.default, found) || found.length === 0) {
      errors.push(`${rel}: Default-Export muss ein Sprite, ein Array von Sprites oder ein Generator-Ergebnis sein`);
      continue;
    }
    const folder = rel.includes('/') ? (rel.split('/')[0] ?? DEFAULT_GROUP) : DEFAULT_GROUP;
    for (const s of found) {
      const other = seen.get(s.id);
      if (other !== undefined) {
        errors.push(`${rel}: Sprite-Id ${s.id} ist schon in ${other} vergeben`);
        continue;
      }
      seen.set(s.id, rel);
      sprites.push({ sprite: s, group: s.group ?? folder, file: rel });
    }
  }
  // Gruppe, dann Datei (sortiert), dann Reihenfolge in der Datei (Materialstufen T0 → T7).
  const order = new Map(sprites.map((s, i) => [s, i]));
  sprites.sort((a, b) => compare(a.group, b.group) || (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return { sprites, errors };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
