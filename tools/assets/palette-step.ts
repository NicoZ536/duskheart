import { join } from 'node:path';
import { MASTER_COLOR_COUNT, PALETTE_SIZE, RAMPS, RAMP_STEPS_MAX, RAMP_STEPS_MIN, RARITY_COLORS, UI_COLORS, UI_COLOR_COUNT, flatPalette, paletteIndex } from '../../assets-src/palette';
import { writeIfChanged } from '../lib/files';

export function buildPalette(out: { generated: string }): string {
  if (MASTER_COLOR_COUNT !== PALETTE_SIZE) throw new Error(`Master-Palette muss ${PALETTE_SIZE} Farben haben, hat ${MASTER_COLOR_COUNT}`);
  if (Object.keys(UI_COLORS).length !== UI_COLOR_COUNT) throw new Error(`Es müssen ${UI_COLOR_COUNT} UI-Farben sein`);
  for (const r of RAMPS) if (r.colors.length < RAMP_STEPS_MIN || r.colors.length > RAMP_STEPS_MAX) throw new Error(`Rampe ${r.name}: ${RAMP_STEPS_MIN}–${RAMP_STEPS_MAX} Stufen erwartet`);
  const flat = flatPalette();
  const ramps = RAMPS.map((r) => ({ name: r.name, size: r.colors.length }));
  // Throws for a rarity colour outside the palette (§4.5: rarity colours are palette colours).
  for (const ref of Object.values(RARITY_COLORS)) paletteIndex(ref);
  const src = `// Generiert von tools/assets (palette-step). Nicht bearbeiten.\n` +
    `export const PALETTE_HEX: readonly string[] = ${JSON.stringify(flat)};\n` +
    `export const PALETTE_RAMPS: readonly { name: string; size: number }[] = ${JSON.stringify(ramps)};\n` +
    `export const UI_HEX = ${JSON.stringify(UI_COLORS)} as const;\n` +
    `/** Raritätsfarben (§4.5) als Palettenreferenzen \`rampe.stufe\`. */\n` +
    `export const RARITY_REFS = ${JSON.stringify(RARITY_COLORS)} as const;\n`;
  writeIfChanged(join(out.generated, 'palette.ts'), src);
  return `${flat.length} Farben in ${RAMPS.length} Rampen + ${Object.keys(UI_COLORS).length} UI-Farben`;
}
