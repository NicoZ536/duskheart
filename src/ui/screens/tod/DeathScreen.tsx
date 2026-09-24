/**
 * Death screen (MASTERPROMPT §11.6 „Dein Licht ist erloschen.“, §26 "Todesbildschirm"; M3-26): over the
 * dimmed world it names the cause, tells what the death cost (grave with its map marker, equipment,
 * "Erschüttert", skill progress – by difficulty, §29) and offers the places to wake: the bed, a lit beacon,
 * the start beach. On Unbarmherzig the world is lost and nothing is offered.
 *
 * Keyboard and controller: the first place is focused (a bed if there is one); the focus manager moves
 * between the buttons and confirms. The screen cannot be closed – only a respawn ends it.
 */
import { useRef } from 'preact/hooks';
import type { RespawnSpot } from '../../../game/death/events';
import type { I18n, Lang } from '../../../i18n';
import { ScreenLayer } from '../../focus/Layer';
import type { FocusManager } from '../../focus/manager';
import { focusable, useFocusScope } from '../../focus/useFocusScope';
import { Button, Frame } from '../../kit/widgets';
import { causeText, penaltyLines, type DeathView } from './model';
import './tod.css';

/** The five pixels of the smoke above the snuffed candle (tod.css `dh-tod__rauch--1` … `--5`). */
const SMOKE = [1, 2, 3, 4, 5] as const;

export interface DeathScreenProps {
  readonly i18n: I18n;
  readonly lang: Lang;
  readonly view: DeathView;
  readonly focus: FocusManager;
  readonly onRespawn: (at: RespawnSpot) => void;
}

export function DeathScreen({ i18n, lang, view, focus, onRespawn }: DeathScreenProps) {
  const root = useRef<HTMLDivElement>(null);
  useFocusScope(focus, root, { initial: () => focusable(root, '[data-standard]') });
  const t = (key: string, params?: Readonly<Record<string, string | number>>): string => i18n.t(key, params);
  const lost = view.penalty.permadeath;
  return (
    <ScreenLayer focus={focus} label={t('ui.death.label')} testId="todesbildschirm" class="dh-tod-ebene">
      <div ref={root} class="dh-tod" data-lang={lang}>
        <div class="dh-tod__glut" aria-hidden="true">
          {SMOKE.map((n) => (
            <span key={n} class={`dh-tod__rauch dh-tod__rauch--${n}`} />
          ))}
          <span class="dh-tod__docht" />
          <span class="dh-tod__kerze" />
        </div>
        <h1 class="dh-tod__titel" data-testid="tod-titel">
          {t('ui.death.title')}
        </h1>
        <p class="dh-tod__ursache" data-testid="tod-ursache">
          {t('ui.death.causeLine', { ursache: causeText(i18n, lang, view.cause) })}
        </p>
        <Frame art="pergament" class="dh-tod__tafel" data-testid="tod-folgen">
          <ul class="dh-tod__folgen">
            {penaltyLines(i18n, view).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Frame>
        {lost ? null : (
          <>
            <p class="dh-tod__wahl">{t('ui.death.choose')}</p>
            <div class="dh-tod__orte">
              {view.spots.map((at, i) => (
                <Button key={at} data-fokus="" data-standard={i === 0 ? '' : undefined} data-testid={`tod-erwachen-${at}`} onClick={() => onRespawn(at)}>
                  {t(`ui.death.respawn.${at}`)}
                </Button>
              ))}
            </div>
          </>
        )}
      </div>
    </ScreenLayer>
  );
}
