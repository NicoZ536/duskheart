/**
 * A key or button glyph (M3-27, §26 "automatische Tastensymbole"): a key cap with the key's name, or the
 * face button of the controller family in use (`tasten.ts`). The accessible name travels with the text
 * around it; the glyph itself is decorative.
 */
import { HudBild } from './Bild';
import type { TastenSymbol } from './tasten';

/** Size of the button sprites [design px]. */
export const KNOPF_PX = 11;

export function HudTaste({ symbol }: { readonly symbol: TastenSymbol }) {
  if (symbol.art === 'knopf') {
    return (
      <span class="dh-hud-taste dh-hud-taste--knopf" aria-hidden="true" data-taste={symbol.name}>
        <HudBild id={symbol.sprite} frame={symbol.frame} breite={KNOPF_PX} hoehe={KNOPF_PX} />
      </span>
    );
  }
  return (
    <span class="dh-hud-taste dh-hud-taste--kappe" aria-hidden="true" data-taste={symbol.text}>
      {symbol.text}
    </span>
  );
}
