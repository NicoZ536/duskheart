/**
 * SFX-Regel des Content-Validators (M3-33 „ungenutzte SFX-Presets ⇒ Validator-Warnung“): Ein Preset gilt
 * als verwendet, wenn seine Id als String-Literal in einer Datei unter `src/` außerhalb der
 * Preset-Definitionen (`src/content/sfx/`) vorkommt – in den Klangtabellen der Spielmodule, im Content
 * (`sounds` der Items, `sound` der Zustände), in der Ereignistabelle `src/audio/eventMap.ts` – oder per
 * Namenskonvention abgeleitet wird (Schritte je Bodenmaterial, `sfxConventionIds`). Alle anderen sind
 * Warnungen: Klang ohne Auslöser ist entweder vergessene Verdrahtung oder toter Content.
 */
import { join, relative, sep } from 'node:path';
import type { ContentRegistryView } from '../../src/content/registry';
import { SFX_SOURCE_DIR, sfxConventionIds } from '../../src/content/sfx/conventions';
import { findUnusedSprites, usageFiles } from '../assets/spriteChecks';

/** Name der SFX-Sammlung in der Content-Registry (src/content/index.ts). */
export const SFX_COLLECTION = 'sfx';

/** Ids aller SFX-Presets einer Registry (leer ohne Sammlung). */
export function registrySfxIds(registry: ContentRegistryView): string[] {
  return [...(registry.collections().find((c) => c.name === SFX_COLLECTION)?.ids() ?? [])];
}

/** Ungenutzte Presets unter `ids` (Dateien `files`, Konventions-Ids `convention`) – reine Funktion für Tests. */
export function findUnusedSfx(ids: readonly string[], files: readonly string[], convention: ReadonlySet<string>): string[] {
  return findUnusedSprites(
    ids.filter((id) => !convention.has(id)),
    files,
  );
}

/** Warnungen für ungenutzte SFX-Presets `ids`; `root` ist das Projektverzeichnis. */
export function checkSfxUsage(root: string, ids: readonly string[]): string[] {
  const sourceDir = join(root, SFX_SOURCE_DIR) + sep;
  const files = usageFiles(join(root, 'src')).filter((f) => !f.startsWith(sourceDir));
  return findUnusedSfx(ids, files, new Set(sfxConventionIds())).map(
    (id) => `SFX-Preset ${id} wird nirgends verwendet (keine Erwähnung unter src/ außer ${relative(root, sourceDir)}, keine Konvention)`,
  );
}
