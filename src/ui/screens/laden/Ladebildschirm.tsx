/**
 * Loading screen (MASTERPROMPT §26 "Ladebildschirm (Tipps, Lore)"; docs/SPIEL.md §25 "Boot-Ablauf"; M7-50): between
 * the menu and the game, while the world worker generates the world and the save is read – the world's name, a pixel
 * progress bar over the generation steps with the step in words, one tip and one line of lore (src/content/tipps.ts,
 * chosen afresh every `TIPP_WECHSEL_MS`). It covers the view until the world is ready; a failed generation names the
 * reason and offers the way back to the title.
 *
 * When the newest save was damaged and an older one was loaded instead (§28 "Integritätsprüfung + Wiederherstellung"),
 * a notice says so – on the loading screen and afterwards for `HINWEIS_MS` over the game.
 */
import type { ReadonlySignal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { TIPS } from '../../../content/tipps';
import type { I18n } from '../../../i18n';
import type { WorldLoadingView } from '../../App';
import { ScreenLayer } from '../../focus/Layer';
import { FocusManager } from '../../focus/manager';
import { useFocusScope } from '../../focus/useFocusScope';
import { Button, Frame } from '../../kit';
import { worldLoadingText } from '../../TitleCard';
import { fuellBreite, ladeAnteil, TIPP_WECHSEL_MS, tippWahl } from './modell';
import './laden.css';

/** What the boot gives the loading screen. */
export interface LadeQuelle {
  /** Name of the world being started. */
  readonly welt: string;
  /** The world worker's progress (`createWorldLoadingStatus`). */
  readonly fortschritt: ReadonlySignal<WorldLoadingView | null>;
  /** True once the world is ready and the game runs. */
  readonly bereit: ReadonlySignal<boolean>;
  /** Notice of a recovered save (translated), or null. */
  readonly hinweis: ReadonlySignal<string | null>;
  /** Random draw ∈ [0, 1) of the tips. */
  readonly zufall: () => number;
  /** Back to the title (offered when the world could not be generated). */
  readonly zumTitel?: () => void;
  /** Fixed tip and lore ids (the screenshot scenario); drawn when absent. */
  readonly feste?: { readonly tipp: string; readonly lore: string };
}

/** How long the recovery notice stays over the running game [ms]. */
export const HINWEIS_MS = 10000;
/** Width of the progress bar [design px]. */
const BALKEN_PX = 200;

export interface LadebildschirmProps {
  readonly i18n: I18n;
  readonly quelle: LadeQuelle;
}

export function Ladebildschirm({ i18n, quelle }: LadebildschirmProps) {
  const bereit = quelle.bereit.value;
  const hinweis = quelle.hinweis.value;
  const [hinweisAus, setHinweisAus] = useState(false);
  useEffect(() => {
    if (!bereit || hinweis === null) return;
    const id = setTimeout(() => setHinweisAus(true), HINWEIS_MS);
    return () => clearTimeout(id);
  }, [bereit, hinweis]);
  if (bereit) {
    return hinweis !== null && !hinweisAus ? (
      <p class="dh-kit dh-laden__hinweis dh-laden__hinweis--spiel" role="alert" data-testid="laden-hinweis">
        {hinweis}
      </p>
    ) : null;
  }
  return <LadeAnsicht i18n={i18n} quelle={quelle} hinweis={hinweis} />;
}

function LadeAnsicht({ i18n, quelle, hinweis }: { readonly i18n: I18n; readonly quelle: LadeQuelle; readonly hinweis: string | null }) {
  const t = i18n.t;
  const focus = useRef(new FocusManager()).current;
  const ref = useRef<HTMLDivElement>(null);
  const [tipp, setTipp] = useState(() => quelle.feste?.tipp ?? tippWahl(TIPS, 'tipp', quelle.zufall())?.id ?? null);
  const [lore, setLore] = useState(() => quelle.feste?.lore ?? tippWahl(TIPS, 'lore', quelle.zufall())?.id ?? null);
  useEffect(() => {
    if (quelle.feste !== undefined) return;
    const id = setInterval(() => {
      setTipp((was) => tippWahl(TIPS, 'tipp', quelle.zufall(), was)?.id ?? was);
      setLore((was) => tippWahl(TIPS, 'lore', quelle.zufall(), was)?.id ?? was);
    }, TIPP_WECHSEL_MS);
    return () => clearInterval(id);
  }, [quelle]);
  useFocusScope(focus, ref, {});
  const view = quelle.fortschritt.value;
  const anteil = ladeAnteil(view, false);
  const tippText = TIPS.find((x) => x.id === tipp)?.text[i18n.lang] ?? null;
  const loreText = TIPS.find((x) => x.id === lore)?.text[i18n.lang] ?? null;
  const fehler = view?.kind === 'failed';
  return (
    <ScreenLayer focus={focus} label={t('loading.title')} dim={false} class="dh-laden" testId="ui-laden">
      <div ref={ref} class="dh-laden__spalte">
        {/* Funke's emblem (the app icon, assets-src/emblem.ts): 20×20 pixels drawn at 2× design pixels. */}
        <img class="dh-laden__emblem" src="generated/icon.svg" alt="" aria-hidden="true" />
        <h2 class="dh-laden__welt" data-testid="laden-welt">
          {quelle.welt}
        </h2>
        <div class="dh-laden__balken" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(anteil * 100)} data-testid="laden-balken">
          <div class="dh-laden__fuellung" style={{ width: `calc(${fuellBreite(BALKEN_PX, anteil)}px * var(--dh-ui-scale))` }} />
        </div>
        <p class={fehler ? 'dh-laden__schritt dh-laden__schritt--fehler' : 'dh-laden__schritt'} data-testid="laden-schritt" role={fehler ? 'alert' : 'status'}>
          {view === null ? t('loading.world') : worldLoadingText(i18n, view)}
        </p>
        {hinweis !== null ? (
          <p class="dh-laden__hinweis" role="alert" data-testid="laden-hinweis">
            {hinweis}
          </p>
        ) : null}
        {fehler && quelle.zumTitel !== undefined ? (
          <div class="dh-laden__leiste">
            <Button data-fokus="" data-testid="laden-titel" onClick={quelle.zumTitel}>
              {t('ui.pause.zumTitel')}
            </Button>
          </div>
        ) : null}
        {tippText !== null ? (
          <Frame art="pergament" class="dh-laden__tipp">
            <p data-testid="laden-tipp" data-tipp={tipp ?? ''}>
              <span class="dh-laden__art">{t('loading.tip')}</span> {tippText}
            </p>
          </Frame>
        ) : null}
        {loreText !== null ? (
          <p class="dh-laden__lore" data-testid="laden-lore" data-tipp={lore ?? ''}>
            {loreText}
          </p>
        ) : null}
      </div>
    </ScreenLayer>
  );
}
