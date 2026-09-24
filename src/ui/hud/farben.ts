/**
 * Colour tokens of the HUD (M3-27) as CSS custom properties for the inline style of its root: the plates
 * share the minimap's and notifications' tokens (`hudFarbVariablen`, same dark iron band everywhere), plus
 * the thermometer's liquid per temperature stage, its empty channel, boons, fear and the carried light's
 * flame bar. The stylesheet only
 * refers to tokens (ADR-0010); the palette stays the only source of colour.
 */
import { TEMPERATURE_STAGES } from '../../content/balance/survival';
import { PALETTE_HEX, PALETTE_RAMPS } from '../../generated/palette';
import { paletteRefHex } from '../../render/palette/rows';
import { hudFarbVariablen } from './minimap/palette';
import { rarityTokens } from '../tooltip/rarity';
import { tooltipTokens } from '../tooltip/Tooltip';
import { FUELL_FARBE, RINNE_FARBE } from './thermometer';

function hex(ref: string): string {
  return paletteRefHex(ref, PALETTE_RAMPS, PALETTE_HEX);
}

/** CSS custom property of the liquid colour of a temperature stage. */
export function fuellVar(stage: string): string {
  return `--dh-hud-thermo-${stage}`;
}

/** Every token of the HUD root. */
export function hudTokens(): Record<string, string> {
  const out: Record<string, string> = { ...hudFarbVariablen(), ...rarityTokens(), ...tooltipTokens() };
  for (const s of TEMPERATURE_STAGES) out[fuellVar(s)] = hex(FUELL_FARBE[s]);
  out['--dh-hud-rinne'] = hex(RINNE_FARBE);
  out['--dh-hud-gut'] = hex('gras.4');
  out['--dh-hud-furcht'] = hex('verderb.4');
  out['--dh-hud-flamme'] = hex('feuer.4');
  out['--dh-hud-glut'] = hex('feuer.1');
  out['--dh-hud-kappe'] = hex('nacht.3');
  out['--dh-hud-kappe-tief'] = hex('nacht.1');
  out['--dh-hud-kappe-licht'] = hex('nacht.4');
  return out;
}
