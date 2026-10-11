/**
 * Validator-Regel `aussehen` (M7-52 … M7-54, Strang I; docs/SPIEL.md §26 „Aussehen“, „Frisuren … Validator zählt 12 (Sammlung
 * `hairstyles`, zählt nicht §C)“): die Sammlungen der Charaktererstellung und ihre Sprites und Palettenzeilen.
 *
 * - **Frisuren:** genau zwölf (`HAIRSTYLE_COUNT`); jede mit Haar-Layer `frisur_<id>` und Auswahlbild `frisur_<id>_ansicht`;
 *   dazu die Zuordnung der Kopfposen `frisur_kopfposen` und die kurzen Haare unter dem Helm `frisur_scheitel_helm`.
 * - **Körperformen:** genau `schmal`, `mittel`, `kraeftig`; jede Form außer `mittel` (die Sprites bis M6) mit Grundkörper
 *   `spieler_<form>_basis` und der Kleidung des Schiffbrüchigen `ausruestung_leinentunika_<form>`, `…leinenhose_<form>`.
 * - **Paletten** (`APPEARANCE_PALETTES`, keine Sammlung): je Art so viele wie §26 nennt (`haut` 6, `haar` 8, `kleid` 8), jede eine
 *   Palettenzeile gleichen Namens.
 */
import { APPEARANCE_PALETTE_COUNTS, APPEARANCE_PALETTE_KINDS, BODY_SHAPE_IDS, HAIRSTYLE_COUNT, type AppearancePaletteDef, type BodyShapeDef, type HairstyleDef } from '../../src/content/appearance/schema';
import { APPEARANCE_PALETTES } from '../../src/content/appearance/index';
import type { ContentRegistryView } from '../../src/content/registry';

/** Ergebnis der Regel. */
export interface AussehenCheckResult {
  readonly errors: string[];
  readonly warnings: string[];
  /** Zahl der Frisuren (Zählbericht). */
  readonly frisuren: number;
}

function records<T>(registry: ContentRegistryView, name: string): readonly T[] {
  return (registry.collections().find((c) => c.name === name)?.values() ?? []) as unknown as readonly T[];
}

/** Sprite-Ids, die der Renderer und die Charaktererstellung aus den Sammlungen bilden (Nutzung per Konvention). */
export function aussehenSpriteIds(hairstyles: readonly string[], shapes: readonly string[]): string[] {
  return [
    'frisur_kopfposen',
    ...hairstyles.flatMap((h) => [`frisur_${h}`, `frisur_${h}_helm`, `frisur_${h}_ansicht`]),
    ...shapes.filter((f) => f !== 'mittel').flatMap((f) => [`spieler_${f}_basis`, `spieler_${f}_koerper`, `ausruestung_leinentunika_${f}`, `ausruestung_leinenhose_${f}`]),
  ];
}

export function checkAussehen(registry: ContentRegistryView, spriteIds: ReadonlySet<string>, paletteRows: ReadonlySet<string>, palettes: readonly AppearancePaletteDef[] = APPEARANCE_PALETTES): AussehenCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const hair = records<HairstyleDef>(registry, 'hairstyles');
  const shapes = records<BodyShapeDef>(registry, 'bodyShapes');
  if (hair.length !== HAIRSTYLE_COUNT) errors.push(`aussehen: ${hair.length} Frisuren, §26 verlangt ${HAIRSTYLE_COUNT}`);
  for (const h of hair) {
    for (const id of [`frisur_${h.id}`, `frisur_${h.id}_ansicht`]) if (!spriteIds.has(id)) errors.push(`aussehen: Frisur ${h.id} ohne Sprite ${id}`);
  }
  for (const id of ['frisur_kopfposen', 'frisur_scheitel_helm']) if (!spriteIds.has(id)) errors.push(`aussehen: Sprite ${id} fehlt`);
  const shapeIds = shapes.map((s) => s.id).sort();
  if (shapeIds.join(',') !== [...BODY_SHAPE_IDS].sort().join(',')) errors.push(`aussehen: Körperformen ${shapeIds.join(', ')}, erwartet ${BODY_SHAPE_IDS.join(', ')}`);
  for (const f of shapeIds) {
    if (f === 'mittel') continue;
    for (const id of [`spieler_${f}_basis`, `ausruestung_leinentunika_${f}`, `ausruestung_leinenhose_${f}`]) if (!spriteIds.has(id)) errors.push(`aussehen: Körperform ${f} ohne Sprite ${id}`);
  }
  for (const art of APPEARANCE_PALETTE_KINDS) {
    const n = palettes.filter((p) => p.art === art).length;
    if (n !== APPEARANCE_PALETTE_COUNTS[art]) errors.push(`aussehen: ${n} Paletten der Art ${art}, §26 verlangt ${APPEARANCE_PALETTE_COUNTS[art]}`);
  }
  for (const p of palettes) if (!paletteRows.has(p.id)) errors.push(`aussehen: Palette ${p.id} ohne Palettenzeile (assets-src/paletteRows.ts)`);
  return { errors, warnings, frisuren: hair.length };
}
