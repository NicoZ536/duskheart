/**
 * Palette LUT (MASTERPROMPT §4.3, docs/RENDER.md §3): sprites store palette indices (1…64, 0 =
 * transparent); the colour comes from a 64 × rows RGBA8 texture. Row 0 is the master palette,
 * further rows are variants (seasons, biome tint, elite/variant recolours, character customisation,
 * corruption) that map each of the 64 indices to another palette index – no new sprites needed.
 * Shader side: `shaders/palette.glsl`.
 */
import type { GpuResourceRegistry } from '../gl/resources';
import { Texture2D } from '../gl/texture';

/** Colours of the master palette (UI colours excluded). */
export const PALETTE_SIZE = 64;
/** Bytes per LUT texel (RGBA8). */
const RGBA = 4;
const OPAQUE = 255;
const HEX_RADIX = 16;
const BYTE_MASK = 0xff;
const RED_SHIFT = 16;
const GREEN_SHIFT = 8;

/** One palette variant: `map[i]` is the palette index (1…64) shown for sprite index `i + 1`. */
export interface PaletteRow {
  readonly name: string;
  readonly map: ArrayLike<number>;
}

export function parseHexColor(hex: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (m === null) throw new Error(`Palette: ${hex} ist keine #rrggbb-Farbe`);
  const v = Number.parseInt(m[1] ?? '0', HEX_RADIX);
  return [(v >> RED_SHIFT) & BYTE_MASK, (v >> GREEN_SHIFT) & BYTE_MASK, v & BYTE_MASK];
}

/** The identity row (every index shows its own colour). */
export function identityRow(name = 'grund'): PaletteRow {
  return { name, map: Array.from({ length: PALETTE_SIZE }, (_, i) => i + 1) };
}

/** Throws unless the row maps all 64 indices to valid palette indices. */
export function validateRow(row: PaletteRow): void {
  if (row.map.length !== PALETTE_SIZE) throw new Error(`Palettenzeile ${row.name}: ${row.map.length} statt ${PALETTE_SIZE} Einträge`);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const v = row.map[i] ?? 0;
    if (!Number.isInteger(v) || v < 1 || v > PALETTE_SIZE) throw new Error(`Palettenzeile ${row.name}: Index ${i + 1} → ${v} liegt außerhalb 1…${PALETTE_SIZE}`);
  }
}

/** LUT pixels: width 64, one texel row per palette row (texel (i, r) = colour of index i + 1 in row r). */
export function buildPaletteLutPixels(paletteHex: readonly string[], rows: readonly PaletteRow[]): Uint8Array {
  if (paletteHex.length < PALETTE_SIZE) throw new Error(`Palette: ${paletteHex.length} statt ${PALETTE_SIZE} Farben`);
  if (rows.length === 0) throw new Error('Palette: mindestens eine Zeile nötig');
  const colors = paletteHex.slice(0, PALETTE_SIZE).map(parseHexColor);
  const out = new Uint8Array(PALETTE_SIZE * rows.length * RGBA);
  rows.forEach((row, r) => {
    validateRow(row);
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const c = colors[(row.map[i] ?? 1) - 1] ?? [0, 0, 0];
      const o = (r * PALETTE_SIZE + i) * RGBA;
      out[o] = c[0];
      out[o + 1] = c[1];
      out[o + 2] = c[2];
      out[o + 3] = OPAQUE;
    }
  });
  return out;
}

/** Palette index (1…64) whose colour is closest to `hex` (squared RGB distance). */
export function nearestPaletteIndex(paletteHex: readonly string[], hex: string): number {
  const [r, g, b] = parseHexColor(hex);
  let best = 1;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < Math.min(PALETTE_SIZE, paletteHex.length); i++) {
    const [pr, pg, pb] = parseHexColor(paletteHex[i] ?? '#000000');
    const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i + 1;
    }
  }
  return best;
}

/** Palette index (1…64) with the highest luminance (white flash). */
export function brightestPaletteIndex(paletteHex: readonly string[]): number {
  let best = 1;
  let bestL = -1;
  for (let i = 0; i < Math.min(PALETTE_SIZE, paletteHex.length); i++) {
    const [r, g, b] = parseHexColor(paletteHex[i] ?? '#000000');
    const l = r + g + b;
    if (l > bestL) {
      bestL = l;
      best = i + 1;
    }
  }
  return best;
}

export class PaletteLut {
  readonly texture: Texture2D;
  private rowNames: string[];

  constructor(
    registry: GpuResourceRegistry,
    gl: WebGL2RenderingContext,
    private readonly paletteHex: readonly string[],
    rows: readonly PaletteRow[],
  ) {
    this.rowNames = rows.map((r) => r.name);
    this.texture = registry.add(
      new Texture2D(gl, { label: 'palette-lut', width: PALETTE_SIZE, height: rows.length, format: 'RGBA8', pixels: buildPaletteLutPixels(paletteHex, rows) }),
    );
  }

  get rows(): number {
    return this.rowNames.length;
  }

  /** Row number of a named variant. */
  row(name: string): number {
    const i = this.rowNames.indexOf(name);
    if (i < 0) throw new Error(`Palettenzeile ${name} fehlt (vorhanden: ${this.rowNames.join(', ')})`);
    return i;
  }

  names(): readonly string[] {
    return this.rowNames;
  }

  /** Replaces all rows (e.g. when a generated atlas brings its own row table). */
  setRows(rows: readonly PaletteRow[]): void {
    const pixels = buildPaletteLutPixels(this.paletteHex, rows);
    this.rowNames = rows.map((r) => r.name);
    this.texture.resize(PALETTE_SIZE, rows.length);
    this.texture.setPixels(pixels);
  }
}
