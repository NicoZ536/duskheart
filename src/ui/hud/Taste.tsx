/**
 * A key or button glyph of the HUD (M3-27, §26 "automatische Tastensymbole"; M4-38): the key cap sprite
 * `hinweis_taste` with the key's name, or the face button of the controller family in use (`tasten.ts`) – the
 * same glyphs as the build mode's hints (`HinweisGlyph`, src/ui/hud/bau/Glyphe.tsx). The accessible name travels
 * with the text around it; the glyph itself is decorative.
 */
import { HinweisGlyph } from './bau/Glyphe';
import type { TastenSymbol } from './tasten';

/** Size of the button sprites [design px]. */
export { KNOPF_PX } from './bau/glyphen';

export function HudTaste({ symbol }: { readonly symbol: TastenSymbol }) {
  return <HinweisGlyph glyphe={symbol} class={`dh-hud-taste dh-hud-taste--${symbol.art}`} />;
}
