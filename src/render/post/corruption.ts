/**
 * Corruption (MASTERPROMPT §6.2 "Verderbnis: Paletten-Shift + animierte emissive Adern im Boden; weicht
 * mit jedem entzündeten Leuchtfeuer", M5-22).
 *
 * - **Palette shift:** every drawn pixel's albedo is an exact palette colour (G0, after its palette row).
 *   A 32³ lookup maps it to the colour the palette row `verderbnis` gives its index (docs/ART.md §5:
 *   "kippt alles dunkel-violett und fahl"): 5 bits per channel tell all 64 palette colours apart
 *   (tested), cells without a palette colour – tinted or flashing pixels – take a luminance-kept shift
 *   towards the violet ramp (`corruptGeneric`). The corruption pass scales the lit colour by the ratio
 *   corrupted/painted albedo, so torch light on corrupted grass is warm light on violet ground.
 * - **Patches:** a region's `strength` (0…1) decides how much of the ground has turned. The corrupted
 *   area is a world-anchored noise field above a threshold that falls with the strength
 *   (`corruptionCovers`), its edge dithered on the 4×4 Bayer grid – palette-true pixels, no blend.
 * - **Veins:** the 0.5 isolines of a smooth noise field (the tile's vein channel at two incommensurate tiles, the second
 *   lookup turned – `VEIN_FIELD`, M5-55: no pattern repeats within sight) crack the flat ground of
 *   the corrupted area – a dark crack around a core glowing in `verderb.3`/`verderb.4`, a pulse running along
 *   it. Their width is measured in pixels (`veinDistance`: distance to the isoline from the field's value
 *   and gradient), so they stay unbroken lines; they widen with the strength, and weak corruption shows them
 *   only deep inside its patches (atmosphere_corruption.frag).
 *
 * Strength per region: `RenderScene.corruption.strength` is the region's value at the camera, filled by
 * the game view (until the beacons of M7 exist: the biome's base value from `atmosphereTable.ts`, full in
 * the Nachtherz); `__dh.call('postDebug', 'corruption', v)` and the screenshot scenarios set it directly.
 */
import { luma } from './grading';
import { sampleNoise } from './noise';

/** Cells per axis of the palette-shift lookup (5 bits per channel). */
export const CORRUPTION_LUT_SIZE = 32;
/** Bits dropped per 8-bit channel to find a colour's cell. */
export const CORRUPTION_KEY_SHIFT = 3;
/** Palette row of the corrupted colours (assets-src/paletteRows.ts). */
export const CORRUPTION_ROW = 'verderbnis';
/** World px per noise tile of the corrupted patches (large, slow shapes). */
export const CORRUPTION_PATCH_PX = 320;
/** Width of the dithered edge of a patch in noise units. */
export const CORRUPTION_EDGE = 0.12;
/** Contrast of the patch noise around 0.5 (fBm clusters there; spreading it makes strength ≈ area). */
export const CORRUPTION_NOISE_CONTRAST = 2.2;
/**
 * Violet ramp the generic shift maps luminance onto (dark → light), the colours of the row's
 * `stein` entry: `nacht.1`, `nacht.2`, `nacht.3`, `verderb.2`, `nacht.4`, `stein.3` as 0xRRGGBB.
 */
export const CORRUPTION_RAMP: readonly number[] = [0x1a1426, 0x2a2238, 0x403451, 0x62207a, 0x5e4e6a, 0x7e8393];

const RGBA = 4;
const BYTE_MAX = 255;
const CHANNEL_SHIFT_R = 16;
const CHANNEL_SHIFT_G = 8;
const CHANNEL_MASK = 0xff;
const HEX_RADIX = 16;
const HEX_R = 1;
const HEX_G = 3;
const HEX_B = 5;
const HEX_END = 7;

/** Cell index (0…32³ − 1) of an 8-bit colour in the lookup. */
export function corruptionKey(r8: number, g8: number, b8: number): number {
  const s = CORRUPTION_KEY_SHIFT;
  const n = CORRUPTION_LUT_SIZE;
  return ((b8 >> s) * n + (g8 >> s)) * n + (r8 >> s);
}

/**
 * The generic corrupted colour of a display-space colour (0…1): its luma picks a point on the violet
 * ramp, a fifth of the original hue stays (fahl, not grey). Writes `out`.
 */
export function corruptGeneric(r: number, g: number, b: number, out: [number, number, number]): [number, number, number] {
  const l = Math.max(0, Math.min(1, luma(r, g, b)));
  const last = CORRUPTION_RAMP.length - 1;
  const f = l * last;
  const i = Math.min(last - 1, Math.floor(f));
  const t = f - i;
  const a = CORRUPTION_RAMP[i] as number;
  const c = CORRUPTION_RAMP[i + 1] as number;
  const keep = 0.2;
  for (let k = 0; k < 3; k++) {
    const shift = k === 0 ? CHANNEL_SHIFT_R : k === 1 ? CHANNEL_SHIFT_G : 0;
    const va = ((a >> shift) & CHANNEL_MASK) / BYTE_MAX;
    const vc = ((c >> shift) & CHANNEL_MASK) / BYTE_MAX;
    const own = k === 0 ? r : k === 1 ? g : b;
    out[k] = (va + (vc - va) * t) * (1 - keep) + own * keep;
  }
  return out;
}

function hexChannels(hex: string): [number, number, number] {
  return [Number.parseInt(hex.slice(HEX_R, HEX_G), HEX_RADIX), Number.parseInt(hex.slice(HEX_G, HEX_B), HEX_RADIX), Number.parseInt(hex.slice(HEX_B, HEX_END), HEX_RADIX)];
}

/**
 * The palette-shift lookup (RGBA8, `CORRUPTION_LUT_SIZE`³ texels, x = red): cells of palette colours hold
 * the colour `rowMap` gives that index (`rowMap[i]` = target index 1…64 for palette index i + 1, the
 * manifest's `verderbnis` row), every other cell the generic shift of its centre. Without a row (no atlas
 * yet) every cell is generic. Throws if two palette colours share a cell.
 */
export function buildCorruptionLut(paletteHex: readonly string[], rowMap: ArrayLike<number> | null): Uint8Array {
  const n = CORRUPTION_LUT_SIZE;
  const out = new Uint8Array(n * n * n * RGBA);
  const half = (1 << CORRUPTION_KEY_SHIFT) / 2;
  const tmp: [number, number, number] = [0, 0, 0];
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const o = ((z * n + y) * n + x) * RGBA;
        corruptGeneric(((x << CORRUPTION_KEY_SHIFT) + half) / BYTE_MAX, ((y << CORRUPTION_KEY_SHIFT) + half) / BYTE_MAX, ((z << CORRUPTION_KEY_SHIFT) + half) / BYTE_MAX, tmp);
        out[o] = Math.round(tmp[0] * BYTE_MAX);
        out[o + 1] = Math.round(tmp[1] * BYTE_MAX);
        out[o + 2] = Math.round(tmp[2] * BYTE_MAX);
        out[o + 3] = 0;
      }
    }
  }
  const owner = new Map<number, number>();
  paletteHex.forEach((hex, i) => {
    const [r, g, b] = hexChannels(hex);
    const key = corruptionKey(r, g, b);
    const other = owner.get(key);
    if (other !== undefined) throw new Error(`Verderbnis-LUT: Palettenfarben ${other + 1} und ${i + 1} teilen eine Zelle`);
    owner.set(key, i);
    const o = key * RGBA;
    const target = rowMap?.[i];
    if (target !== undefined && target >= 1 && target <= paletteHex.length) {
      const [tr, tg, tb] = hexChannels(paletteHex[target - 1] as string);
      out[o] = tr;
      out[o + 1] = tg;
      out[o + 2] = tb;
    } else {
      corruptGeneric(r / BYTE_MAX, g / BYTE_MAX, b / BYTE_MAX, tmp);
      out[o] = Math.round(tmp[0] * BYTE_MAX);
      out[o + 1] = Math.round(tmp[1] * BYTE_MAX);
      out[o + 2] = Math.round(tmp[2] * BYTE_MAX);
    }
    // Alpha 255 marks an exact palette cell (the shader keeps the ratio to the painted colour there).
    out[o + 3] = BYTE_MAX;
  });
  return out;
}

/** Noise threshold of the corrupted area at `strength` (mirror of `corruptionThreshold` in atmosphere_corruption.frag). */
export function corruptionThreshold(strength: number): number {
  const s = Math.max(0, Math.min(1, strength));
  return -CORRUPTION_EDGE + (1 + 2 * CORRUPTION_EDGE) * (1 - s);
}

/**
 * Whether a pixel with patch noise `n` (0…1, the fBm of the noise texture) belongs to the corrupted area
 * at `strength`, with Bayer threshold `bayer` (0…1) dithering the edge. At strength 1 everything, at 0
 * nothing (mirror of `corruptionCovers` in atmosphere_corruption.frag).
 */
export function corruptionCovers(n: number, strength: number, bayer: number): boolean {
  return corruptionSpread(n) > corruptionThreshold(strength) + (bayer - 0.5) * CORRUPTION_EDGE;
}

/** Patch noise `n` spread around 0.5 (fBm clusters there; mirror of `corruptionSpread`). */
export function corruptionSpread(n: number): number {
  return Math.max(0, Math.min(1, (n - 0.5) * CORRUPTION_NOISE_CONTRAST + 0.5));
}

/**
 * Veins: noise tile [world px]; half widths [px] of the dark crack and of the glowing core at weak and at
 * full corruption, half width of the hottest centre; how far inside a patch weak corruption shows veins
 * (spread above the threshold, falling to 0 at full strength); how the width swells and thins along a vein
 * (factor range, over the finer noise channel between `swellFrom` and `swellTo`: veins taper, fade into
 * hairline cracks and break into segments instead of running as even wires); smallest gradient of the vein field [1/px]
 * (flatter: no vein); how much light a crack keeps; flatness of the terrain's open ground (squared normal xy: ramps
 * and stairs slope; which pixels are open ground the terrain marks itself, G2.A `terrain`); glow (HDR, the pulse's peak blooms),
 * resting share of the pulse, phases along a vein, pulse speed [rad/s] and the finite-difference step of the
 * gradient [px].
 */
export const VEINS = {
  tilePx: 176,
  crack: [1.0, 1.7],
  core: [0.45, 0.95],
  hot: 0.4,
  depth: 0.12,
  swell: [0.3, 1.3],
  swellFrom: 0.35,
  swellTo: 0.65,
  minGradient: 0.0015,
  dark: 0.35,
  flat: 0.02,
  glow: 1.7,
  rest: 0.4,
  phases: 18,
  speed: 2.2,
  stepPx: 2,
} as const;

/**
 * The vein field's second lookup (M5-55): the vein channel again at a tile of `tilePx` – the vein tile × the golden ratio,
 * the size that meets a whole number of vein tiles least often –, turned by `angleDeg` and shifted by `offsetPx`, mixed in
 * with `weight`. One tile alone repeated the veins every `VEINS.tilePx` (176 px): in `biom-nachtherz-nacht` 48 % of the
 * vein pixels lay on a vein again one tile further. The sum of two smooth fields is a smooth field – its 0.5 isolines stay
 * long meandering lines –, and neither tile shift nor any of its multiples within sight brings both lookups back.
 */
export const VEIN_FIELD = { tilePx: 285, angleDeg: 37, offsetPx: [71, -113], weight: 0.5 } as const;

/** Cosine and sine of the second lookup's turn. */
const VEIN_COS = Math.cos((VEIN_FIELD.angleDeg * Math.PI) / 180);
const VEIN_SIN = Math.sin((VEIN_FIELD.angleDeg * Math.PI) / 180);
/** Channel of the noise tile the veins run on (A: the smoothest fBm) and the one their swell follows (B). */
const VEIN_CHANNEL = 3;
const SWELL_CHANNEL = 2;

/**
 * The vein field at ground point (x, y) [world px] over the noise tile `texels` (mirror of `veinField` in
 * atmosphere_corruption.frag): the vein channel at the vein tile, mixed with its second, turned lookup (`VEIN_FIELD`).
 */
export function veinField(texels: Uint8Array, x: number, y: number): number {
  const t = VEINS.tilePx;
  const t2 = VEIN_FIELD.tilePx;
  const first = sampleNoise(texels, x / t, y / t, VEIN_CHANNEL);
  const qx = VEIN_COS * x - VEIN_SIN * y + VEIN_FIELD.offsetPx[0];
  const qy = VEIN_SIN * x + VEIN_COS * y + VEIN_FIELD.offsetPx[1];
  const second = sampleNoise(texels, qx / t2, qy / t2, VEIN_CHANNEL);
  return first + (second - first) * VEIN_FIELD.weight;
}

/** Scratch widths of `veinAt`. */
const veinWidthsScratch = { crack: 0, core: 0 };

/**
 * What the veins draw at ground point (x, y) [world px] of flat open terrain deep in a corrupted patch at `strength`
 * (mirror of the vein branch of atmosphere_corruption.frag): 2 the glowing core, 1 the dark crack, 0 none – the distance
 * to the field's 0.5 isoline from its value and central-difference gradient, in units of the local swell.
 */
export function veinAt(texels: Uint8Array, x: number, y: number, strength: number): 0 | 1 | 2 {
  const s = VEINS.stepPx;
  const n = veinField(texels, x, y);
  const dx = veinField(texels, x + s, y) - veinField(texels, x - s, y);
  const dy = veinField(texels, x, y + s) - veinField(texels, x, y - s);
  const d = veinDistance(n, Math.hypot(dx, dy) / (2 * s)) / veinSwell(sampleNoise(texels, x / VEINS.tilePx, y / VEINS.tilePx, SWELL_CHANNEL));
  const w = veinWidths(strength, veinWidthsScratch);
  if (d < w.core) return 2;
  return d < w.crack ? 1 : 0;
}

/** Distance [px] of a pixel to the nearest vein, from the vein field's value `n` and its gradient length [1/px] (mirror of `veinDistance`). */
export function veinDistance(n: number, gradient: number): number {
  return Math.abs(n - 0.5) / Math.max(gradient, VEINS.minGradient);
}

/** Width factor of a vein where the swell noise (the tile's finer channel) is `b` (mirror of `veinSwell`). */
export function veinSwell(b: number): number {
  const t = Math.max(0, Math.min(1, (b - VEINS.swellFrom) / (VEINS.swellTo - VEINS.swellFrom)));
  return VEINS.swell[0] + (VEINS.swell[1] - VEINS.swell[0]) * t * t * (3 - 2 * t);
}

/** Half widths [px] of the crack and the glowing core at `strength` (0…1). Writes `out`. */
export function veinWidths(strength: number, out: { crack: number; core: number }): { crack: number; core: number } {
  const s = Math.max(0, Math.min(1, strength));
  out.crack = VEINS.crack[0] + (VEINS.crack[1] - VEINS.crack[0]) * s;
  out.core = VEINS.core[0] + (VEINS.core[1] - VEINS.core[0]) * s;
  return out;
}

/** Whether a covered pixel with patch spread `spread` lies deep enough in its patch for veins at `strength` (mirror of the shader). */
export function veinsReach(spread: number, strength: number): boolean {
  return spread > corruptionThreshold(strength) + VEINS.depth * (1 - Math.max(0, Math.min(1, strength)));
}

/**
 * Whether veins may crack a pixel (mirror of the shader): open ground of the terrain (G2.A `terrain`, set by
 * world/terrain.frag only – figures, items, flat decor and everything standing are sprites without it) whose normal
 * (`nx`, `ny`: screen xy of the G1 normal) lies flat – ramps and stairs slope.
 */
export function veinsMayCrack(terrain: boolean, nx: number, ny: number): boolean {
  return terrain && nx * nx + ny * ny < VEINS.flat;
}

/** What the corruption needs of the occluder mask (`OccluderField` of light/lightMath.ts is one). */
export interface CorruptionGround {
  /** Ground point of a pixel drawn at world (x, y) with G-buffer height `z` (`sdfGroundPoint`). */
  groundPoint(x: number, y: number, z: number): [number, number];
}

/**
 * World point where the corruption samples its patches and veins for a pixel drawn at world (x, y) with G-buffer height
 * `z` [px above level 0] (mirror of the shader): a terrain pixel is its own ground point (raised levels are drawn where
 * they lie); anything else stands on the ground of its occluder-mask texel (`field`), or – without the occluder pass –
 * on level 0.
 */
export function corruptionGroundPoint(x: number, y: number, z: number, terrain: boolean, field: CorruptionGround | null): [number, number] {
  if (terrain) return [x, y];
  return field !== null ? field.groundPoint(x, y, z) : [x, y + z];
}

/** Corruption of the frame (`RenderScene.corruption`): the region's strength at the camera, 0 = none (reset every frame). */
export class CorruptionState {
  strength = 0;

  beginFrame(): void {
    this.strength = 0;
  }
}
