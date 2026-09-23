import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MASTER_COLOR_COUNT, RAMPS, UI_COLORS, flatPalette } from '../../assets-src/palette';

export function buildPalette(out: { generated: string }): string {
  if (MASTER_COLOR_COUNT !== 64) throw new Error(`Master-Palette muss 64 Farben haben, hat ${MASTER_COLOR_COUNT}`);
  for (const r of RAMPS) if (r.colors.length < 5 || r.colors.length > 7) throw new Error(`Rampe ${r.name}: 5–7 Stufen erwartet`);
  const flat = flatPalette();
  const ramps = RAMPS.map((r) => ({ name: r.name, size: r.colors.length }));
  const src = `// Generiert von tools/assets (palette-step). Nicht bearbeiten.\n` +
    `export const PALETTE_HEX: readonly string[] = ${JSON.stringify(flat)};\n` +
    `export const PALETTE_RAMPS: readonly { name: string; size: number }[] = ${JSON.stringify(ramps)};\n` +
    `export const UI_HEX = ${JSON.stringify(UI_COLORS)} as const;\n`;
  writeFileSync(join(out.generated, 'palette.ts'), src);
  return `${flat.length} Farben in ${RAMPS.length} Rampen + ${Object.keys(UI_COLORS).length} UI-Farben`;
}
