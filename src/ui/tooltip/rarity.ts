/**
 * Rarity colours of the UI (MASTERPROMPT §4.5, docs/ART.md §6 "Überall gleich: Rahmen im Inventar,
 * Name im Tooltip, Aufsammel-Meldung, Beutestrahl"): the palette references `RARITY_REFS` resolved to
 * their palette colour, set as CSS custom properties `--dh-raritaet-<id>` on a screen root (the CSS
 * only refers to the tokens, it holds no colour values of its own).
 */
import { RARITIES, type Rarity } from '../../content/schema/common';
import { PALETTE_HEX, PALETTE_RAMPS, RARITY_REFS } from '../../generated/palette';
import { paletteRefHex } from '../../render/palette/rows';

/** Palette colour of a rarity (`#rrggbb`). */
export function rarityHex(rarity: Rarity): string {
  return paletteRefHex(RARITY_REFS[rarity], PALETTE_RAMPS, PALETTE_HEX);
}

/** CSS custom property of a rarity colour. */
export function rarityVar(rarity: Rarity): string {
  return `--dh-raritaet-${rarity}`;
}

/** Inline style that defines every rarity token (for the root element of a screen). */
export function rarityTokens(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of RARITIES) out[rarityVar(r)] = rarityHex(r);
  return out;
}

/** Position of a rarity in the order Gewöhnlich … Legendär. */
export function rarityRank(rarity: Rarity): number {
  return RARITIES.indexOf(rarity);
}
