/**
 * Interaction hint at the bottom centre (MASTERPROMPT §26 "Mitte unten Interaktionshinweis („[E]
 * Aufheben: Feuerstein ×3")", "Fehlermeldungen sagen, was fehlt und wie man es löst"; M3-10/M3-27): the
 * glyph of the interact key on the device used last and the words of the interaction system's hint
 * (`hintText`, the same line as the marker over the target). A hint that cannot be done now ("Fällen:
 * Eiche – braucht eine Axt") shows in the warning colour. Centred on whole design pixels above the hotbar.
 */
import type { ReadonlySignal } from '@preact/signals';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { hintText } from '../../game/interaction/hint';
import type { I18n } from '../../i18n';
import type { UiBridge } from '../bridge';
import { designPixel, snapCentre } from '../focus/Layer';
import { aktionsName, aktionsSymbol, type HudGeraet } from './Schnellleiste';
import { HudTaste } from './Taste';

export interface HudHinweisProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
  readonly geraet: ReadonlySignal<HudGeraet>;
}

export function HudHinweis({ i18n, bridge, geraet }: HudHinweisProps) {
  const hint = bridge.state.hud.interaction.value;
  // Reading the device subscribes: the glyph follows the device used last.
  const g = geraet.value;
  const ref = useRef<HTMLDivElement>(null);
  const text = hint === null ? '' : hintText(hint, i18n.lang, (k, p) => i18n.t(k, p));
  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (el === null || host === null || host === undefined) return;
    el.style.left = `${snapCentre(host.clientWidth, el.offsetWidth, designPixel(el))}px`;
  });
  if (hint === null) return null;
  const symbol = aktionsSymbol(bridge, i18n, hint.input);
  const gesperrt = hint.reason !== null || hint.tooHard;
  const taste = aktionsName(bridge, i18n, hint.input);
  return (
    <div
      ref={ref}
      class={`dh-hud-platte dh-hud-hinweis${gesperrt ? ' dh-hud-hinweis--gesperrt' : ''}`}
      role="status"
      aria-label={taste === null ? text : `${taste}: ${text}`}
      data-testid="hud-hinweis"
      data-arbeitet={hint.working ? '' : undefined}
      data-geraet={g.gamepad ? g.familie : 'tastatur'}
    >
      {symbol !== null ? <HudTaste symbol={symbol} /> : null}
      <span class="dh-hud-hinweis__text">{text}</span>
    </div>
  );
}
