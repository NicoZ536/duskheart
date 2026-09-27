/**
 * A glyph of the hint lines (M4-38, `glyphen.ts`): the key cap sprite `hinweis_taste` as a nine-slice frame around
 * the key's name, the mouse sprites with the lit button, the gamepad's face buttons. Decorative (`aria-hidden`):
 * the accessible name travels with the text next to it. Drawn at integer UI scale with crisp pixels.
 */
import { spriteImageUrl } from '../../screens/inventar/itemIcons';
import { HudBild } from '../Bild';
import { KAPPE_SPRITE, KNOPF_PX, MAUS_PX, type HinweisGlyphe } from './glyphen';
import './glyphe.css';

export function HinweisGlyph({ glyphe, class: extra }: { readonly glyphe: HinweisGlyphe; readonly class?: string }) {
  const cls = (art: string): string => `dh-glyphe dh-glyphe--${art}${extra === undefined ? '' : ` ${extra}`}`;
  switch (glyphe.art) {
    case 'maus':
      return (
        <span class={cls('maus')} aria-hidden="true" data-glyphe={glyphe.sprite} data-taste={glyphe.name}>
          <HudBild id={glyphe.sprite} breite={MAUS_PX} hoehe={MAUS_PX} />
        </span>
      );
    case 'knopf':
      return (
        <span class={cls('knopf')} aria-hidden="true" data-taste={glyphe.name}>
          <HudBild id={glyphe.sprite} frame={glyphe.frame} breite={KNOPF_PX} hoehe={KNOPF_PX} />
        </span>
      );
    case 'kappe': {
      const url = spriteImageUrl(KAPPE_SPRITE);
      return (
        <span class={cls('kappe')} aria-hidden="true" data-taste={glyphe.text} data-glyphe={KAPPE_SPRITE} style={url === null ? undefined : { borderImageSource: `url(${url})` }}>
          {glyphe.text}
        </span>
      );
    }
  }
}
