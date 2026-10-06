/**
 * Main menu (MASTERPROMPT §26 "Hauptmenü mit lebendiger Pixel-Szene"; docs/SPIEL.md §25; M7-50): over the menu scene
 * (the coast camp in time-lapse, src/render/world/menuScene.ts) – no dimming, the scene is the picture – stands a column
 * on the left: the title, the subtitle and a wooden panel with Weiter (the world played last; only when there is one),
 * Neue Welt, Welten and Einstellungen; under it the world "Weiter" continues, the key hints and the version.
 * The column lies on whole design pixels (fixed offsets in design px), fully usable with keyboard or controller.
 */
import { useRef } from 'preact/hooks';
import type { I18n } from '../../../i18n';
import type { FocusManager } from '../../focus/manager';
import { actionPrompt } from '../../focus/prompts';
import { focusable, useFocusScope } from '../../focus/useFocusScope';
import type { UiInput } from '../../bridge';
import { Button, Frame } from '../../kit';
import type { WeltEintrag } from '../../menu/hooks';
import './hauptmenue.css';

export interface HauptmenueProps {
  readonly i18n: I18n;
  readonly focus: FocusManager;
  readonly input: UiInput | null;
  /** The world played last (Weiter), or null (none, or the list is still being read). */
  readonly zuletzt: WeltEintrag | null;
  readonly version: string;
  /** A world that could not be loaded, and why (shown under the panel), or null. */
  readonly meldung: string | null;
  readonly onWeiter: (welt: WeltEintrag) => void;
  readonly onNeueWelt: () => void;
  readonly onWelten: () => void;
  readonly onEinstellungen: () => void;
}

export function Hauptmenue({ i18n, focus, input, zuletzt, version, meldung, onWeiter, onNeueWelt, onWelten, onEinstellungen }: HauptmenueProps) {
  const t = i18n.t;
  const ref = useRef<HTMLDivElement>(null);
  useFocusScope(focus, ref, { initial: () => focusable(ref, '[data-eintrag]') });
  const hint = t('ui.hauptmenue.hinweis', { waehlen: actionPrompt(i18n, input, 'uiConfirm') ?? '-' });
  return (
    <div class="dh-kit dh-ebene dh-hauptmenue" role="dialog" aria-label={t('game.title')} data-testid="ui-hauptmenue">
      <div ref={ref} class="dh-hauptmenue__spalte">
        <h1 class="dh-hauptmenue__titel">{t('game.title')}</h1>
        <p class="dh-hauptmenue__untertitel">{t('game.subtitle')}</p>
        <Frame art="holz" class="dh-hauptmenue__tafel">
          <div class="dh-hauptmenue__liste">
            {zuletzt !== null ? (
              <Button data-fokus="" data-eintrag="weiter" data-testid="menue-weiter" onClick={() => onWeiter(zuletzt)}>
                {t('ui.menu.continue')}
              </Button>
            ) : null}
            <Button data-fokus="" data-eintrag="neue-welt" data-testid="menue-neue-welt" onClick={onNeueWelt}>
              {t('ui.menu.newWorld')}
            </Button>
            <Button data-fokus="" data-eintrag="welten" data-testid="menue-welten" onClick={onWelten}>
              {t('ui.menu.worlds')}
            </Button>
            <Button data-fokus="" data-eintrag="einstellungen" data-testid="menue-einstellungen" onClick={onEinstellungen}>
              {t('ui.menu.settings')}
            </Button>
          </div>
        </Frame>
        {zuletzt !== null ? (
          <p class="dh-hauptmenue__zuletzt" data-testid="menue-zuletzt">
            {t('ui.hauptmenue.zuletzt', { name: zuletzt.name, tag: zuletzt.tag })}
          </p>
        ) : null}
        {meldung !== null ? (
          <p class="dh-hauptmenue__meldung" role="alert" data-testid="menue-meldung">
            {t('ui.hauptmenue.ladenFehler', { fehler: meldung })}
          </p>
        ) : null}
        <p class="dh-hauptmenue__hinweis">{hint}</p>
      </div>
      <p class="dh-hauptmenue__version" data-testid="menue-version">
        {t('game.version', { version })}
      </p>
    </div>
  );
}
