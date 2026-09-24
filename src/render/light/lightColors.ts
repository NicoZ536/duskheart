/**
 * Light colours from the master palette (M1-26, MASTERPROMPT §4.1 „warme Lichtinseln in kühler,
 * bedrohlicher Dunkelheit“, §4.3, ADR-0018). A light takes its hue from the ramp of what glows – the
 * flame, the lumenite crystal, the night sky – so light and sprites share one colour world; its
 * brightness is the light's intensity, its purity (saturation) a mood decision. The composition
 * reflects every light with its spectral colour (`spectral.ts`): the more saturated a light, the more
 * it pulls what it lights towards its own hue.
 */
import { PALETTE_HEX, PALETTE_RAMPS } from '../../generated/palette';
import { parseHexColor } from '../palette/lut';
import { paletteRefHex } from '../palette/rows';

/** A light colour (linear RGB, brightest channel 1 unless stated otherwise). */
export type Rgb = readonly [number, number, number];

const BYTE_MAX = 255;
const CHANNELS = 3;

/**
 * Light colour of palette colours (`rampe.stufe`, docs/RENDER.md §1): their mean, normalised to a
 * brightest channel of 1 – the hue of what glows, the brightness left to the light's intensity.
 */
export function paletteLight(...refs: readonly string[]): Rgb {
  if (refs.length === 0) throw new Error('paletteLight: mindestens eine Palettenfarbe');
  const sum = [0, 0, 0];
  for (const ref of refs) {
    const rgb = parseHexColor(paletteRefHex(ref, PALETTE_RAMPS, PALETTE_HEX));
    for (let c = 0; c < CHANNELS; c++) sum[c] = (sum[c] ?? 0) + (rgb[c] ?? 0) / BYTE_MAX;
  }
  const peak = Math.max(...sum);
  if (!(peak > 0)) throw new Error(`paletteLight: ${refs.join(', ')} ergibt kein Licht`);
  return [(sum[0] ?? 0) / peak, (sum[1] ?? 0) / peak, (sum[2] ?? 0) / peak];
}

/**
 * `color` with its saturation (1 − min/max) set to `saturation`, hue and brightest channel kept: the
 * palette gives the hue of a light, the mood how pure it is. A grey light has no hue and stays grey.
 */
export function withSaturation(color: Rgb, saturation: number): Rgb {
  const peak = Math.max(...color);
  const own = peak > 0 ? 1 - Math.min(...color) / peak : 0;
  if (!(own > 0)) return color;
  const k = saturation / own;
  return [peak - (peak - color[0]) * k, peak - (peak - color[1]) * k, peak - (peak - color[2]) * k];
}

/**
 * Every open flame – torch, camp fire, lantern: the orange of the flame (`feuer.3`); the
 * composition's warm hue shift (`spectral.ts`) turns it amber towards the flame's yellow (`feuer.4`)
 * where the light is strongest. Lights differ in radius, intensity and flicker, not in colour.
 */
export const FIRE: Rgb = paletteLight('feuer.3');
/** Lumenite: the cold blue of its crystal (`eis.0`). */
export const LUMEN: Rgb = paletteLight('eis.0');

/**
 * Saturation of the night ambient: a clear moonlit sky, cool enough that every Grünhain material –
 * green grass included – reads blue in the dark (§4.1 „kühle, bedrohliche Dunkelheit“).
 */
export const MOONLIGHT_SATURATION = 0.6;

/**
 * Ambient light of the night and the blue hour: moonlight in the hue of the night ramp's violets
 * (`nacht.3`, `nacht.4`) and the blue of ice (`eis.0`), so the darkness reads cool blue with violet
 * shadows instead of green-black (docs/ART.md Grünhain „Nacht kühles Blau mit violetten Schatten“).
 * The scenes set its intensity (the blue hour brighter than deep night).
 */
export const MOONLIGHT: Rgb = withSaturation(paletteLight('nacht.3', 'nacht.4', 'eis.0'), MOONLIGHT_SATURATION);
