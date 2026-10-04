/**
 * Interaction hint at the bottom centre (MASTERPROMPT §26 "Mitte unten Interaktionshinweis („[E]
 * Aufheben: Feuerstein ×3")", "Fehlermeldungen sagen, was fehlt und wie man es löst"; M3-10/M3-27): the
 * glyph of the interact key on the device used last and the words of the interaction system's hint
 * (`hintText`, the same line as the marker over the target). A hint that cannot be done now ("Fällen:
 * Eiche – braucht eine Axt") shows in the warning colour. Centred on whole design pixels above the hotbar.
 * The glyph is the one of the build mode's hint lines (`hinweisGlyphe`): a key cap, a gamepad button – and for a
 * mouse button the mouse with that button lit (the primary button's "Aufstellen: Schlinge", M6-30), not a cap with
 * the button's long name.
 */
import type { ReadonlySignal } from '@preact/signals';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { hintText } from '../../game/interaction/hint';
import type { I18n } from '../../i18n';
import type { UiBridge } from '../bridge';
import { designPixel, snapCentre } from '../focus/Layer';
import { HinweisGlyph } from './bau/Glyphe';
import { hinweisGlyphe } from './bau/glyphen';
import { aktionsName, type HudGeraet } from './Schnellleiste';

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
  const input = bridge.input;
  const binding = input?.promptBinding(hint.input);
  const glyphe = input === null || binding === undefined ? null : hinweisGlyphe(binding, input.gamepadFamily, (k, p) => i18n.t(k, p));
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
      {glyphe !== null ? <HinweisGlyph glyphe={glyphe} class={`dh-hud-taste dh-hud-taste--${glyphe.art}`} /> : null}
      <span class="dh-hud-hinweis__text">{text}</span>
    </div>
  );
}
