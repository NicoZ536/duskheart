/**
 * The travel screen (MASTERPROMPT §25 "Schnellreise zwischen entzündeten Leuchtfeuern, Herdfeuern und Wegsteinen (Lumen-Kosten nach
 * Distanz)"; docs/SPIEL.md §22, §30 "`reisen` – E am Reisepunkt – sampleTravel"; M7-37): opens when the player uses a travel
 * point (`travelOpened`) – the point he stands at, the Lumen shards in his bags, every destination with its price; a click
 * travels (`travel.go`, the screen closes on `travelled`); at a way stone it can be named (`travel.rename`). What blocks travel
 * now (a fight, a boss awake, ores and bars under logistics realism) stands above the list and greys it out.
 */
import { useSignal } from '@preact/signals';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { BALANCE } from '../../../content/balance';
import { createTravelSample } from '../../../game/samples/leuchtfeuer';
import type { I18n } from '../../../i18n';
import type { UiBridge } from '../../bridge';
import { ScreenLayer } from '../../focus/Layer';
import type { FocusManager } from '../../focus/manager';
import { focusable, useFocusScope } from '../../focus/useFocusScope';
import { HudBild } from '../../hud/Bild';
import { Button, Frame } from '../../kit/widgets';
import { reiseAnsicht, type ReiseAnsicht } from './modell';
import './reisen.css';

/** Id of the travel screen. */
export const REISEN_SCREEN = 'reisen';
/** Icon of the Lumen shard (the price). */
const LUMEN_ICON = `icon_${BALANCE.travel.currency}`;

export interface ReisenScreenProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
  readonly focus: FocusManager;
  readonly close: () => void;
}

function lumenInBags(bridge: UiBridge): number {
  const bags = bridge.state.bags.peek();
  if (bags === null) return 0;
  let n = 0;
  for (const area of ['inventar', 'schnellleiste', 'rucksackfach'] as const) for (const s of bags[area]) if (s?.item === BALANCE.travel.currency) n += s.count;
  return n;
}

export function ReisenScreen({ i18n, bridge, focus, close }: ReisenScreenProps) {
  const root = useRef<HTMLDivElement>(null);
  useFocusScope(focus, root, { initial: () => focusable(root, '[data-standard]') });
  const sample = useMemo(() => createTravelSample(), []);
  const ansicht = useSignal<ReiseAnsicht | null>(null);
  const name = useSignal('');
  useEffect(() => {
    const quelle = bridge.leuchtfeuer;
    if (quelle === null) return undefined;
    const lesen = (): void => {
      quelle.sampleTravel(sample);
      ansicht.value = reiseAnsicht(i18n, sample, lumenInBags(bridge));
    };
    lesen();
    const aus = [bridge.onEvent('travelled', () => close()), bridge.onEvent('travelPointRenamed', lesen), bridge.onEvent('inventoryChanged', lesen)];
    return () => aus.forEach((f) => f());
  }, [bridge, i18n, sample, ansicht, close]);
  const a = ansicht.value;
  const t = i18n.t;
  if (a === null) return null;
  return (
    <ScreenLayer focus={focus} label={t('ui.reisen.label')} testId="ui-reisen">
      <div ref={root} class="dh-reisen">
        <Frame art="holz" class="dh-reisen__tafel">
          <h2 class="dh-reisen__titel">{t('ui.reisen.label')}</h2>
          <p class="dh-reisen__von">{t('ui.reisen.von', { ort: a.von })}</p>
          <p class="dh-reisen__lumen" data-testid="reisen-lumen">
            <HudBild id={LUMEN_ICON} breite={16} hoehe={16} />
            <span>{t('ui.reisen.lumen', { count: a.lumen })}</span>
          </p>
          {a.gesperrt !== null ? (
            <p class="dh-reisen__gesperrt" data-testid="reisen-gesperrt">
              {a.gesperrt}
            </p>
          ) : null}
          {a.ziele.length === 0 ? <p class="dh-reisen__leer">{t('ui.reisen.keine')}</p> : null}
          <ul class="dh-reisen__liste">
            {a.ziele.map((z, i) => (
              <li key={z.id} class="dh-reisen__ziel" data-ziel={z.id}>
                <span class="dh-reisen__name">{z.name}</span>
                <span class={`dh-reisen__preis${z.bezahlbar ? '' : ' dh-reisen__preis--fehlt'}`}>{t('ui.reisen.kosten', { count: z.kosten })}</span>
                <Button data-fokus="" data-standard={i === 0 ? '' : undefined} data-testid={`reisen-${z.id}`} disabled={a.gesperrt !== null || !z.bezahlbar} onClick={() => bridge.leuchtfeuer?.reisen(z.id)}>
                  {t('ui.reisen.reisen')}
                </Button>
              </li>
            ))}
          </ul>
          {a.wegstein !== null ? (
            <div class="dh-reisen__umbenennen">
              <label class="dh-reisen__feld">
                <span>{t('ui.reisen.name')}</span>
                <input data-fokus="" maxLength={BALANCE.travel.nameMaxLength} value={name.value} onInput={(ev) => (name.value = (ev.target as HTMLInputElement).value)} data-testid="reisen-name" />
              </label>
              <Button
                data-fokus=""
                data-testid="reisen-umbenennen"
                onClick={() => {
                  const nr = a.wegstein;
                  if (nr !== null) bridge.leuchtfeuer?.umbenennen(nr, name.peek());
                }}
              >
                {t('ui.reisen.umbenennen')}
              </Button>
            </div>
          ) : null}
          <Button data-fokus="" data-testid="reisen-schliessen" onClick={close}>
            {t('ui.reisen.schliessen')}
          </Button>
        </Frame>
      </div>
    </ScreenLayer>
  );
}
