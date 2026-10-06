/**
 * The world event lines of the HUD (MASTERPROMPT §10 "Ankündigung … HUD"; docs/SPIEL.md §18; M7-38): top centre below the
 * compass bar (below the boss bar while a boss is awake) – every announced event with the minutes to its start, every running
 * one with the minutes it still lasts, running ones first. Sampled every frame from the session (`sampleWorldEvents`, a held
 * record) and re-rendered only when a line changes (a minute passed, an event began or ended). Hidden under open screens like
 * the rest of the HUD.
 */
import { useSignal } from '@preact/signals';
import { useEffect, useMemo } from 'preact/hooks';
import type { I18n } from '../../../i18n';
import { createWorldEventSample } from '../../../game/samples/orte';
import type { UiBridge } from '../../bridge';
import { ereignisZeilen, gleicheZeilen, type EreignisZeile } from './modell';
import './ereignis.css';

export interface HudEreignisseProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
}

export function HudEreignisse({ i18n, bridge }: HudEreignisseProps) {
  const zeilen = useSignal<readonly EreignisZeile[]>([]);
  const sample = useMemo(() => createWorldEventSample(), []);
  useEffect(() => {
    const quelle = bridge.orte;
    if (quelle === null) return undefined;
    const lesen = (): void => {
      quelle.sampleWorldEvents(sample);
      const neu = ereignisZeilen(sample, i18n.lang);
      if (!gleicheZeilen(neu, zeilen.peek())) zeilen.value = neu;
    };
    lesen();
    return bridge.onFrame(lesen);
  }, [bridge, i18n, sample, zeilen]);
  const z = zeilen.value;
  if (z.length === 0) return null;
  const t = i18n.t;
  return (
    <ul class="dh-hud-ereignisse" data-testid="hud-ereignisse" role="status">
      {z.map((e) => (
        <li key={e.event} class={`dh-hud-ereignisse__zeile${e.aktiv ? ' dh-hud-ereignisse__zeile--aktiv' : ''}`} data-ereignis={e.event} data-aktiv={e.aktiv ? 'ja' : 'nein'}>
          {e.ankuendigung ?? t('ui.ereignis.aktiv', { name: e.name, minuten: e.minuten })}
        </li>
      ))}
    </ul>
  );
}
