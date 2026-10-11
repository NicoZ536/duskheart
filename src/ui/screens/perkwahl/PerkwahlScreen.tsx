/**
 * The perk choice (MASTERPROMPT §23.2 "Bei 30/60/90 Wahl zwischen 2 Perks …, alle spürbar"; docs/SPIEL.md §30 "`perkwahl` –
 * `perkChoiceOpened` – sampleSkills"; M7-48): opens when a skill reaches 30, 60 or 90 (the game pauses) and shows the first
 * open choice – the skill and level above two cards with the perks' names and what they do. "Wählen" takes it
 * (`skills.choosePerk`); the next open choice follows, the screen closes after the last. "Später" closes it: the choice stays
 * open and waits in the chronicle's statistics tab.
 */
import { useSignal } from '@preact/signals';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { createSkillsSample } from '../../../game/samples/chronik';
import type { I18n } from '../../../i18n';
import type { UiBridge } from '../../bridge';
import { ScreenLayer } from '../../focus/Layer';
import type { FocusManager } from '../../focus/manager';
import { focusable, useFocusScope } from '../../focus/useFocusScope';
import { Button, Frame } from '../../kit/widgets';
import { perkwahlAnsicht, type PerkwahlAnsicht } from './modell';
import './perkwahl.css';

/** Id of the perk choice screen. */
export const PERKWAHL_SCREEN = 'perkwahl';

export interface PerkwahlScreenProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
  readonly focus: FocusManager;
  readonly close: () => void;
}

export function PerkwahlScreen({ i18n, bridge, focus, close }: PerkwahlScreenProps) {
  const root = useRef<HTMLDivElement>(null);
  useFocusScope(focus, root, { initial: () => focusable(root, '[data-standard]'), onBack: close });
  const sample = useMemo(() => createSkillsSample(), []);
  const ansicht = useSignal<PerkwahlAnsicht | null | undefined>(undefined);
  useEffect(() => {
    const quelle = bridge.chronik;
    if (quelle === null) return undefined;
    const lesen = (): void => {
      quelle.sampleSkills(sample);
      const a = perkwahlAnsicht(sample, i18n.lang);
      ansicht.value = a;
      if (a === null) close();
    };
    lesen();
    const aus = [bridge.onEvent('perkChosen', lesen), bridge.onEvent('perkChoiceOpened', lesen), i18n.onChange(lesen)];
    return () => aus.forEach((f) => f());
  }, [bridge, i18n, sample, ansicht, close]);
  const a = ansicht.value;
  if (a === null || a === undefined) return null;
  const t = i18n.t;
  return (
    <ScreenLayer focus={focus} label={t('ui.perkwahl.titel')} testId="ui-perkwahl">
      <div ref={root} class="dh-perkwahl" data-fertigkeit={a.fertigkeit} data-stufe={a.stufe}>
        <Frame art="holz" class="dh-perkwahl__tafel">
          <h2 class="dh-perkwahl__titel">{t('ui.perkwahl.titel')}</h2>
          <p class="dh-perkwahl__stufe">{t('ui.perkwahl.stufe', { fertigkeit: a.fertigkeitName, stufe: a.stufe })}</p>
          <div class="dh-perkwahl__karten">
            {a.karten.map((k, i) => (
              <Frame key={k.id} art="pergament" class="dh-perkwahl__karte" data-perk={k.id}>
                <h3 class="dh-perkwahl__name">{k.name}</h3>
                <p class="dh-perkwahl__text">{k.beschreibung}</p>
                <Button
                  data-fokus=""
                  data-standard={i === 0 ? '' : undefined}
                  data-testid={`perkwahl-${k.id}`}
                  onClick={() => bridge.chronik?.perkWaehlen(a.fertigkeit, a.stufe, k.wahl)}
                >
                  {t('ui.perkwahl.waehlen')}
                </Button>
              </Frame>
            ))}
          </div>
          <p class="dh-perkwahl__fuss">
            {a.weitere > 0 ? <span class="dh-perkwahl__weitere">{t('ui.perkwahl.weitere', { count: a.weitere })}</span> : <span />}
            <Button data-fokus="" data-testid="perkwahl-spaeter" onClick={close}>
              {t('ui.perkwahl.spaeter')}
            </Button>
          </p>
        </Frame>
      </div>
    </ScreenLayer>
  );
}
