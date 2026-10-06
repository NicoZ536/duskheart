/**
 * The fishing mini-game in the HUD (MASTERPROMPT §14 "Minispiel (Spannung halten, Fisch zieht, Rute biegt sich)", §26;
 * docs/SPIEL.md §30 "Angel-Minispiel (HUD) – fishCast – sampleFishing – D (ui.angeln.*)"; M7-24): a plate right of the figure
 * while the line is out – the phase's line (casting, waiting, "A bite! Hold [E]!", the fight's warnings, the catch or how the
 * fish got away), from the bite on the tension gauge with its two danger zones (slack on the left, taut on the right), lit
 * gold while the reel is held, the fish's distance and the controls. Sampled every frame from the session (`sampleFishing`,
 * a held record) and re-rendered only when what it shows changes (the gauge by whole design px). Hidden under open screens
 * like the rest of the HUD.
 */
import { useSignal } from '@preact/signals';
import { useEffect, useMemo } from 'preact/hooks';
import type { I18n } from '../../../i18n';
import { createFishingSample } from '../../../game/samples/feld';
import type { UiBridge } from '../../bridge';
import { uiPx } from '../../kit/geometry';
import { tastenName } from '../tasten';
import { angelAnsicht, gleicheAngelAnsicht, SLACK_WARN, TAUT_WARN, type AngelAnsicht } from './modell';
import './angeln.css';

/** Inner width of the tension gauge [design px]: wide enough that a tenth of tension moves the fill by six pixels. */
const GAUGE_PX = 60;

/** What the plate reads of the bridge: the fishing sample, the menu input (the interact key's name), the frame clock. */
export type HudAngelnQuelle = Pick<UiBridge, 'feld' | 'input' | 'onFrame'>;

export interface HudAngelnProps {
  readonly i18n: I18n;
  readonly bridge: HudAngelnQuelle;
}

/** The name of the interact key on the device used last (`E` without input, a screenshot layer). */
function interactName(bridge: HudAngelnQuelle, i18n: I18n): string {
  const input = bridge.input;
  const b = input?.promptBinding('interact');
  return input === null || b === undefined ? 'E' : tastenName(b, input.gamepadFamily, (k, p) => i18n.t(k, p));
}

export function HudAngeln({ i18n, bridge }: HudAngelnProps) {
  const ansicht = useSignal<AngelAnsicht | null>(null);
  const sample = useMemo(() => createFishingSample(), []);
  useEffect(() => {
    const quelle = bridge.feld;
    if (quelle === null) return undefined;
    const lesen = (): void => {
      quelle.sampleFishing(sample);
      const neu = angelAnsicht(sample, i18n.lang);
      if (!gleicheAngelAnsicht(neu, ansicht.peek(), GAUGE_PX)) ansicht.value = neu;
    };
    lesen();
    return bridge.onFrame(lesen);
  }, [bridge, i18n, sample, ansicht]);
  const a = ansicht.value;
  if (a === null) return null;
  const t = i18n.t;
  const taste = interactName(bridge, i18n);
  const zeile = t(a.zeile.key, { ...a.zeile.werte, taste });
  const ende = a.phase === 'gefangen' || a.phase === 'verloren';
  const warnt = a.zone === 'locker' || a.zone === 'straff' || a.phase === 'verloren';
  return (
    <section
      class={`dh-hud-platte dh-hud-angeln${a.einholen ? ' dh-hud-angeln--einholen' : ''}`}
      data-testid="hud-angeln"
      data-phase={a.phase}
      data-zone={a.zone ?? undefined}
      aria-label={t('ui.angeln.titel')}
      role="status"
    >
      <p class={`dh-hud-angeln__zeile${warnt ? ' dh-hud-angeln__zeile--warnung' : ''}${a.phase === 'gefangen' ? ' dh-hud-angeln__zeile--fang' : ''}${a.sprung ? ' dh-hud-angeln__zeile--sprung' : ''}`}>{zeile}</p>
      {a.spannung === null ? null : (
        <div class="dh-hud-angeln__messung">
          <div
            class="dh-hud-angeln__rinne"
            style={{ width: uiPx(GAUGE_PX) }}
            role="meter"
            aria-label={t('ui.angeln.spannung')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(a.spannung * 100)}
          >
            <span class="dh-hud-angeln__band dh-hud-angeln__band--locker" style={{ width: uiPx(Math.round(SLACK_WARN * GAUGE_PX)) }} />
            <span class="dh-hud-angeln__band dh-hud-angeln__band--straff" style={{ width: uiPx(Math.round((1 - TAUT_WARN) * GAUGE_PX)) }} />
            <span class={`dh-hud-angeln__fuellung dh-hud-angeln__fuellung--${a.zone ?? 'gut'}`} style={{ width: uiPx(Math.round(a.spannung * GAUGE_PX)) }} />
          </div>
          {a.meter === null ? null : <span class="dh-hud-angeln__abstand">{t('ui.angeln.abstand', { meter: a.meter })}</span>}
        </div>
      )}
      {ende || a.phase === 'wurf' ? null : <p class="dh-hud-angeln__hilfe">{t('ui.angeln.hilfe', { taste })}</p>}
    </section>
  );
}
