/**
 * Funke and the hint line in the HUD (MASTERPROMPT §8 "Funke: Flammengeist in der Laterne … kommentiert sparsam, höchstens
 * 2 Zeilen pro Einwurf, nie aufdringlich, abschaltbar"; docs/SPIEL.md §23 "Funke", §30 "Funke (HUD, Laterne + ≤ 2 Zeilen),
 * Hinweiszeile – sampleGuide"; M7-43, M7-44): left below the survival values – the lantern with the flame spirit (24 px,
 * `funke_laterne`, flickering) beside a plate with at most two lines (`BALANCE.guide.funkeTextWidthPx` wide, the validator rule
 * `funke` measures every text), and below it the context hint on its own plate (a gold "?", at most two lines of
 * `BALANCE.guide.hintTextWidthPx`, measured by the same rule – on bright sand bare text would not read). Sampled every frame
 * (`sampleGuide`, a held record);
 * the view is rebuilt only when the signature moved. Comments fade in and out (none with reduced motion); the settings
 * switch them off in the simulation (`guide.configure`), so nothing here decides what is said.
 */
import { useSignal } from '@preact/signals';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { BALANCE } from '../../../content/balance';
import { createGuideSample } from '../../../game/guide/types';
import type { I18n } from '../../../i18n';
import type { UiBridge } from '../../bridge';
import { uiPx } from '../../kit/geometry';
import { HudBild } from '../Bild';
import { funkeAnsicht, funkeSignatur, KEINE_FUEHRUNG, type FunkeAnsicht } from './modell';
import './funke.css';

/** The lantern sprite and its flicker frames (assets-src/sprites/funke/laterne.ts). */
export const FUNKE_LATERNE = 'funke_laterne';
export const FUNKE_LATERNE_FRAMES = 4;
/** Lantern size [design px]. */
export const FUNKE_LATERNE_PX = 24;

/** The places of the guide column [CSS px]: below the values (`unten`), and level with their row at its right edge (`oben`, `rechts`). */
export interface FuehrungsLage {
  readonly unten: number;
  readonly oben: number;
  readonly rechts: number;
}

/**
 * The places of the guide column from the values' box `werte` (offsets in the HUD) and its first row `reihe` (offsets in the
 * box, its offset parent).
 */
export function fuehrungsLage(werte: Pick<HTMLElement, 'offsetTop' | 'offsetLeft' | 'offsetHeight'>, reihe: Pick<HTMLElement, 'offsetTop' | 'offsetLeft' | 'offsetWidth'>): FuehrungsLage {
  return { unten: werte.offsetTop + werte.offsetHeight, oben: werte.offsetTop + reihe.offsetTop, rechts: werte.offsetLeft + reihe.offsetLeft + reihe.offsetWidth };
}

export interface HudFunkeProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
  /** Reduced motion (the setting, and screenshot scenarios): no flicker, no fade. */
  readonly ruhig?: boolean;
}

export function HudFunke({ i18n, bridge, ruhig = false }: HudFunkeProps) {
  const ansicht = useSignal<FunkeAnsicht>(KEINE_FUEHRUNG);
  /** Where the values end (below) and where their row stands (top, right edge) [CSS px]: the column's two places. */
  const lage = useSignal({ unten: 0, oben: 0, rechts: 0 });
  const sample = useMemo(() => createGuideSample(), []);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const quelle = bridge.chronik;
    if (quelle === null) return undefined;
    let signatur = Number.NaN;
    const lesen = (): void => {
      quelle.sampleGuide(sample);
      const s = funkeSignatur(sample);
      if (s === signatur) return;
      signatur = s;
      ansicht.value = funkeAnsicht(sample, i18n.lang);
    };
    lesen();
    const aus = [bridge.onFrame(lesen), i18n.onChange(() => ((signatur = Number.NaN), lesen()))];
    return () => aus.forEach((f) => f());
  }, [bridge, i18n, sample, ansicht]);
  // Below the HUD's values and conditions, wherever they end (their height changes with the conditions shown); in build mode
  // right of the values' row, level with it (funke.css `.dh-hud--bau`, M7-134: below the values the build mode's overlay
  // switches stand, and the signs reached over the figure).
  useLayoutEffect(() => {
    const hud = root.current?.parentElement;
    const werte = hud?.querySelector('.dh-hud-oben');
    if (hud === null || hud === undefined || !(werte instanceof HTMLElement)) return undefined;
    const reihe = werte.querySelector('.dh-hud-oben__reihe');
    const setzen = (): void => {
      const neu = fuehrungsLage(werte, reihe instanceof HTMLElement ? reihe : { offsetTop: 0, offsetLeft: 0, offsetWidth: werte.offsetWidth });
      const alt = lage.peek();
      if (neu.unten !== alt.unten || neu.oben !== alt.oben || neu.rechts !== alt.rechts) lage.value = neu;
    };
    setzen();
    const obs = new ResizeObserver(setzen);
    obs.observe(werte);
    return () => obs.disconnect();
  }, [lage]);
  const a = ansicht.value;
  const l = lage.value;
  return (
    <div
      ref={root}
      class={`dh-hud-fuehrung${ruhig ? ' dh-hud-fuehrung--ruhig' : ''}`}
      style={{ '--dh-fuehrung-unten': `${l.unten}px`, '--dh-fuehrung-oben': `${l.oben}px`, '--dh-fuehrung-rechts': `${l.rechts}px` }}
      data-testid="hud-fuehrung"
      role="status"
      aria-live="polite"
    >
      {a.funke !== null ? (
        <div class="dh-hud-funke" data-testid="hud-funke" data-funke={a.funkeId ?? ''} aria-label={i18n.t('ui.funke.label')}>
          <span class="dh-hud-funke__laterne" style={{ width: uiPx(FUNKE_LATERNE_PX), height: uiPx(FUNKE_LATERNE_PX) }} aria-hidden="true">
            {Array.from({ length: FUNKE_LATERNE_FRAMES }, (_, f) => (
              <HudBild key={f} id={FUNKE_LATERNE} frame={f} breite={FUNKE_LATERNE_PX} hoehe={FUNKE_LATERNE_PX} class={`dh-hud-funke__flamme dh-hud-funke__flamme--${f}`} />
            ))}
          </span>
          <p class="dh-hud-platte dh-hud-funke__text">
            <span class="dh-hud-funke__zeilen" style={{ maxWidth: `calc(${BALANCE.guide.funkeTextWidthPx}px * var(--dh-ui-scale) * var(--dh-hud-text, 1))` }}>
              {a.funke}
            </span>
          </p>
        </div>
      ) : null}
      {a.hinweis !== null ? (
        <p class="dh-hud-platte dh-hud-hinweiszeile" data-testid="hud-hinweiszeile" data-hinweis={a.hinweisId ?? ''}>
          <span class="dh-hud-hinweiszeile__marke" aria-hidden="true">
            ?
          </span>
          <span class="dh-hud-hinweiszeile__text" style={{ maxWidth: `calc(${BALANCE.guide.hintTextWidthPx}px * var(--dh-ui-scale) * var(--dh-hud-text, 1))` }}>
            {a.hinweis}
          </span>
        </p>
      ) : null}
    </div>
  );
}
