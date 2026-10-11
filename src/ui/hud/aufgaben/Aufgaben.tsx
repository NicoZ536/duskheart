/**
 * The HUD's quest tracker (MASTERPROMPT §26 "rechts Aufgaben- und Rezept-Tracker"; docs/SPIEL.md §30 "Aufgaben-Tracker (HUD,
 * über dem Rezept-Tracker)"; M7-42): right below the minimap, above the recipe tracker – one plate per tracked quest (at most
 * three): the quest's title (the main quest in the flame colour), the current step with its number and its progress when it
 * counts; the step's hint stands in the chronicle's quest tab (a plate is 116 px wide, a hint a sentence). Sampled every frame from the session (`sampleQuests`, a held record); the lines are rebuilt only when the
 * signature moved (a step, a count). Hidden under open screens like the rest of the HUD; Minimal leaves it out.
 */
import { useSignal } from '@preact/signals';
import { useEffect, useMemo } from 'preact/hooks';
import { createQuestSample } from '../../../game/samples/chronik';
import type { I18n } from '../../../i18n';
import { formatNumber } from '../../../i18n/format';
import type { UiBridge } from '../../bridge';
import { aufgabenSignatur, aufgabenZeilen, gleicheAufgaben, type AufgabenZeile } from './modell';
import './aufgaben.css';

export interface HudAufgabenProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
}

export function HudAufgaben({ i18n, bridge }: HudAufgabenProps) {
  const zeilen = useSignal<readonly AufgabenZeile[]>([]);
  const sample = useMemo(() => createQuestSample(), []);
  useEffect(() => {
    const quelle = bridge.chronik;
    if (quelle === null) return undefined;
    let signatur = Number.NaN;
    const lesen = (): void => {
      quelle.sampleQuests(sample);
      const s = aufgabenSignatur(sample);
      if (s === signatur) return;
      signatur = s;
      const neu = aufgabenZeilen(sample, i18n.lang);
      if (!gleicheAufgaben(neu, zeilen.peek())) zeilen.value = neu;
    };
    lesen();
    const aus = [bridge.onFrame(lesen), i18n.onChange(() => ((signatur = Number.NaN), lesen()))];
    return () => aus.forEach((f) => f());
  }, [bridge, i18n, sample, zeilen]);
  const z = zeilen.value;
  if (z.length === 0) return null;
  const t = i18n.t;
  const lang = i18n.lang;
  return (
    <section class="dh-hud-aufgaben" aria-label={t('ui.aufgaben.titel')} data-testid="hud-aufgaben">
      {z.map((a) => (
        <div key={a.quest} class={`dh-hud-platte dh-hud-aufgaben__block${a.haupt ? ' dh-hud-aufgaben__block--haupt' : ''}`} data-testid={`aufgabe-${a.quest}`} data-schritt={a.nr}>
          <p class="dh-hud-aufgaben__kopf">
            <span class="dh-hud-aufgaben__titel">{a.titel}</span>
            <span class="dh-hud-aufgaben__nr">{t('ui.aufgaben.schritt', { nr: a.nr, von: a.von })}</span>
          </p>
          <p class="dh-hud-aufgaben__schritt">
            <span class="dh-hud-aufgaben__ziel">{a.schritt}</span>
            {a.braucht > 0 ? (
              <span class="dh-hud-aufgaben__zahl" data-testid={`aufgabe-zahl-${a.quest}`}>
                {formatNumber(lang, a.hat)}/{formatNumber(lang, a.braucht)}
              </span>
            ) : null}
          </p>
        </div>
      ))}
    </section>
  );
}
