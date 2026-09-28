/**
 * Palette colours of the water strand as linear 0…1 RGB (the pipeline treats palette values as linear, ADR-0012):
 * the mirrored sky, the default sky of scenes without a sky filler and the `#define`s of the water shaders.
 */
import { PALETTE_HEX, PALETTE_RAMPS } from '../../generated/palette';
import { parseHexColor } from '../palette/lut';
import { paletteRefHex } from '../palette/rows';

const BYTE_MAX = 255;

/** A palette colour (`rampe.stufe`) as linear 0…1 RGB. */
export function paletteRgb(ref: string): [number, number, number] {
  const [r, g, b] = parseHexColor(paletteRefHex(ref, PALETTE_RAMPS, PALETTE_HEX));
  return [r / BYTE_MAX, g / BYTE_MAX, b / BYTE_MAX];
}
