/**
 * A sprite of the game atlas in the HUD (M3-27): decoded once into palette colours
 * (`src/ui/screens/inventar/itemIcons.ts`, the same pixels as in the world) and shown at integer UI scale.
 * While the atlas loads nothing is drawn; the component re-renders once it is decoded.
 */
import { spriteImageUrl } from '../screens/inventar/itemIcons';
import { uiPx } from '../kit/geometry';

export interface HudBildProps {
  readonly id: string;
  readonly frame?: number;
  /** Size [design px]. */
  readonly breite: number;
  readonly hoehe: number;
  readonly class?: string;
}

export function HudBild({ id, frame = 0, breite, hoehe, class: extra }: HudBildProps) {
  const url = spriteImageUrl(id, frame);
  const style = { width: uiPx(breite), height: uiPx(hoehe) };
  if (url === null) return <span class={['dh-hud-bild', extra ?? ''].join(' ')} style={style} aria-hidden="true" />;
  return <img class={['dh-hud-bild', extra ?? ''].join(' ')} src={url} alt="" draggable={false} style={style} data-sprite={id} data-frame={frame} />;
}
