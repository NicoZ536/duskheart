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
 * In build mode (M7-134) the column stands beside the values' row; there the plates are narrowed (M7-142, `schmal.ts`): each
 * text takes the narrowest whole width that keeps its lines, both plates end flush – measured once per text, not per frame.
 */
import { useSignal } from '@preact/signals';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { BALANCE } from '../../../content/balance';
import { createGuideSample } from '../../../game/guide/types';
import type { I18n } from '../../../i18n';
import type { UiBridge } from '../../bridge';
import { uiPx } from '../../kit/geometry';
import { activeGameScreens } from '../../focus/GameScreens';
import { BAU_SCREEN } from '../../screens/bau/BauModus';
import { HudBild } from '../Bild';
import { funkeAnsicht, funkeSignatur, KEINE_FUEHRUNG, type FunkeAnsicht } from './modell';
import { buendigeBreiten, EINZEILIG_BIS_PX, schmalsteBreite, type SchildMass } from './schmal';
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

/** The text widths of the two plates in build mode [design px], none outside it. */
interface SchildBreiten {
  readonly funke: number | null;
  readonly hinweis: number | null;
}
const VOLLE_BREITEN: SchildBreiten = { funke: null, hinweis: null };

/** A text's width style: the plate's widest, and in build mode its narrowed width [design px]. */
function textBreite(max: number, breite: number | null): Record<string, string> {
  const px = (n: number): string => `calc(${n}px * var(--dh-ui-scale) * var(--dh-hud-text, 1))`;
  return breite === null ? { maxWidth: px(max) } : { maxWidth: px(max), width: px(breite) };
}

/**
 * Measures the text `el` (widest `max` design px) at its left `links` [design px in the column]: the narrowest whole width
 * that keeps its lines – two at most, one for a one-liner up to `EINZEILIG_BIS_PX` (M7-142). Probes widths on the element
 * itself and restores its style; `einheit` is one design px in CSS px.
 */
function vermessen(el: HTMLElement, max: number, links: number, einheit: number): SchildMass {
  const vorher = el.style.cssText;
  const zeilenHoehe = parseFloat(getComputedStyle(el).lineHeight);
  el.style.width = '';
  const zeilen = (breite: number): number => {
    el.style.maxWidth = `${breite * einheit}px`;
    return Math.max(1, Math.round(el.getBoundingClientRect().height / zeilenHoehe));
  };
  const einzeilig = zeilen(max) === 1 && el.getBoundingClientRect().width <= EINZEILIG_BIS_PX * einheit + 0.5;
  const breite = schmalsteBreite(zeilen, 1, max, einzeilig ? 1 : 2);
  el.style.cssText = vorher;
  return { links, breite, max };
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
  const funkeText = useRef<HTMLSpanElement>(null);
  const hinweisText = useRef<HTMLSpanElement>(null);
  /** Whether the build mode is open (M7-142: the plates are narrowed there), and the narrowed widths. */
  const bau = useSignal(false);
  const breiten = useSignal<SchildBreiten>(VOLLE_BREITEN);
  useEffect(() => {
    const quelle = bridge.chronik;
    if (quelle === null) return undefined;
    let signatur = Number.NaN;
    const lesen = (): void => {
      const baut = activeGameScreens()?.controller.isOpen(BAU_SCREEN) ?? false;
      if (baut !== bau.peek()) bau.value = baut;
      quelle.sampleGuide(sample);
      const s = funkeSignatur(sample);
      if (s === signatur) return;
      signatur = s;
      ansicht.value = funkeAnsicht(sample, i18n.lang);
    };
    lesen();
    const aus = [bridge.onFrame(lesen), i18n.onChange(() => ((signatur = Number.NaN), lesen()))];
    return () => aus.forEach((f) => f());
  }, [bridge, i18n, sample, ansicht, bau]);
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
  const baut = bau.value;
  // Build mode (M7-142): the plates as narrow as their lines allow, ending flush – measured when a text or the mode changes.
  useLayoutEffect(() => {
    const spalte = root.current;
    const f = funkeText.current;
    const h = hinweisText.current;
    if (!baut || spalte === null || (f === null && h === null)) {
      if (breiten.peek() !== VOLLE_BREITEN) breiten.value = VOLLE_BREITEN;
      return;
    }
    const probe = f ?? h;
    const probeMax = f !== null ? BALANCE.guide.funkeTextWidthPx : BALANCE.guide.hintTextWidthPx;
    const einheit = parseFloat(getComputedStyle(probe as HTMLElement).maxWidth) / probeMax;
    if (!(einheit > 0)) return;
    const links0 = spalte.getBoundingClientRect().left;
    const links = (el: HTMLElement): number => Math.round((el.getBoundingClientRect().left - links0) / einheit);
    const [wf, wh] = buendigeBreiten(
      f === null ? null : vermessen(f, BALANCE.guide.funkeTextWidthPx, links(f), einheit),
      h === null ? null : vermessen(h, BALANCE.guide.hintTextWidthPx, links(h), einheit),
    );
    const alt = breiten.peek();
    if (alt.funke !== wf || alt.hinweis !== wh) breiten.value = { funke: wf, hinweis: wh };
  }, [a, baut, breiten]);
  const b = baut ? breiten.value : VOLLE_BREITEN;
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
            <span ref={funkeText} class="dh-hud-funke__zeilen" style={textBreite(BALANCE.guide.funkeTextWidthPx, b.funke)}>
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
          <span ref={hinweisText} class="dh-hud-hinweiszeile__text" style={textBreite(BALANCE.guide.hintTextWidthPx, b.hinweis)}>
            {a.hinweis}
          </span>
        </p>
      ) : null}
    </div>
  );
}
