/**
 * Sprite source format (docs/RENDER.md §1) as used by the in-memory atlas builder: index rasters
 * with a legend (`'.': null`, `o: 'holz.2'`, `f: 'feuer.3*'` – `*` = emissive), frames as template
 * strings (indentation is removed), anchor, height hint, clips, sockets per frame and material
 * characters.
 */
import type { ClipEvent } from '../anim/animation';
import { MATERIAL } from '../gbuffer';
import type { HeightHint } from './atlas';

export interface SpriteClipSource {
  readonly frames: readonly number[];
  readonly fps: number;
  readonly loop: boolean;
  readonly events?: readonly ClipEvent[];
}

export interface SpriteSource {
  readonly id: string;
  readonly group: string;
  readonly size: readonly [number, number];
  readonly anchor: readonly [number, number];
  readonly hoehe: HeightHint;
  readonly legende: Readonly<Record<string, string | null>>;
  readonly frames: readonly string[];
  readonly clips?: Readonly<Record<string, SpriteClipSource>>;
  readonly sockets?: Readonly<Record<string, readonly (readonly [number, number] | null)[]>>;
  /** Legend characters carrying a material flag, e.g. `{ metall: 'Mm' }`. */
  readonly material?: Partial<Record<SourceMaterial, string>>;
  readonly symmetric?: boolean;
}

/** One parsed frame: palette index (0 = transparent), emissive flag and material bits per pixel. */
export interface ParsedFrame {
  readonly width: number;
  readonly height: number;
  readonly index: Uint8Array;
  readonly emissive: Uint8Array;
  readonly material: Uint8Array;
}

/** Material names of the source format (docs/RENDER.md §1) and their atlas bits (§2). */
export const SOURCE_MATERIAL = {
  metall: MATERIAL.metal,
  nass: MATERIAL.wet,
  eis: MATERIAL.ice,
  wind: MATERIAL.wind,
  dach: MATERIAL.canopy,
} as const;
export type SourceMaterial = keyof typeof SOURCE_MATERIAL;

/** Marks an emissive legend entry (`feuer.4*`). */
export const EMISSIVE_MARK = '*';

/** Splits a raster template string into rows, removing indentation and blank lines. */
export function rasterRows(raster: string): string[] {
  return raster
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Resolves `rampe.stufe` to a palette index (1…64) given the ramps in palette order. */
export function paletteRefResolver(ramps: readonly { readonly name: string; readonly size: number }[]): (ref: string) => number {
  const offsets = new Map<string, { offset: number; size: number }>();
  let offset = 1;
  for (const r of ramps) {
    offsets.set(r.name, { offset, size: r.size });
    offset += r.size;
  }
  return (ref) => {
    const [name, stepText] = ref.split('.');
    const ramp = offsets.get(name ?? '');
    if (!ramp) throw new Error(`Palette: unbekannte Rampe „${name ?? ''}“ in ${ref}`);
    const step = Number(stepText);
    if (!Number.isInteger(step) || step < 0 || step >= ramp.size) throw new Error(`Palette: Stufe ${stepText ?? ''} fehlt in Rampe ${name ?? ''} (0…${ramp.size - 1})`);
    return ramp.offset + step;
  };
}

/** Parses every frame of a sprite source; throws on unknown characters or wrong frame sizes. */
export function parseSpriteFrames(src: SpriteSource, resolveRef: (ref: string) => number): ParsedFrame[] {
  const [w, h] = src.size;
  const legend = new Map<string, { index: number; emissive: boolean; material: number }>();
  const materialBits = new Map<string, number>();
  for (const [name, chars] of Object.entries(src.material ?? {}) as [SourceMaterial, string][]) {
    for (const ch of chars) materialBits.set(ch, (materialBits.get(ch) ?? 0) | SOURCE_MATERIAL[name]);
  }
  for (const [ch, ref] of Object.entries(src.legende)) {
    if ([...ch].length !== 1) throw new Error(`Sprite ${src.id}: Legendenschlüssel „${ch}“ muss genau ein Zeichen sein`);
    if (ref === null) {
      legend.set(ch, { index: 0, emissive: false, material: 0 });
      continue;
    }
    const emissive = ref.endsWith(EMISSIVE_MARK);
    const index = resolveRef(emissive ? ref.slice(0, -EMISSIVE_MARK.length) : ref);
    legend.set(ch, { index, emissive, material: materialBits.get(ch) ?? 0 });
  }
  if (src.frames.length === 0) throw new Error(`Sprite ${src.id}: keine Frames`);
  return src.frames.map((raster, f) => {
    const rows = rasterRows(raster);
    if (rows.length !== h) throw new Error(`Sprite ${src.id}: Frame ${f} hat ${rows.length} statt ${h} Zeilen`);
    const index = new Uint8Array(w * h);
    const emissive = new Uint8Array(w * h);
    const material = new Uint8Array(w * h);
    rows.forEach((row, y) => {
      const chars = [...row];
      if (chars.length !== w) throw new Error(`Sprite ${src.id}: Frame ${f}, Zeile ${y} hat ${chars.length} statt ${w} Zeichen`);
      chars.forEach((ch, x) => {
        const e = legend.get(ch);
        if (!e) throw new Error(`Sprite ${src.id}: Frame ${f}, Zeile ${y}: unbekanntes Legendenzeichen „${ch}“`);
        const i = y * w + x;
        index[i] = e.index;
        emissive[i] = e.emissive && e.index > 0 ? 1 : 0;
        material[i] = e.index > 0 ? e.material : 0;
      });
    });
    return { width: w, height: h, index, emissive, material };
  });
}

/** Mirrors a raster horizontally (build-time mirroring for asymmetric figures). */
export function mirrorRaster(raster: string): string {
  return rasterRows(raster)
    .map((r) => [...r].reverse().join(''))
    .join('\n');
}
