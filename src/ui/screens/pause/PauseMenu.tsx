/**
 * Pause menu (MASTERPROMPT §26 "Pausemenü", §29 "Pausieren jederzeit; automatische Pause beim
 * Tab-Wechsel"; M3-31), opened with Esc/Start or automatically when the tab goes to the background.
 * The simulation rests while it is open (`ScreenController`, pause reason of the menu).
 *
 * - Main view: Weiter · Einstellungen · Speichern · Zum Titel. Entries whose hook the page does not
 *   provide are not shown.
 * - Einstellungen: the settings that already take effect in the game (`PAUSE_SETTING_ROWS`), each a
 *   row whose value left/right (arrow keys, D-pad, the arrows with the mouse) or confirm steps; the
 *   description of the focused row below.
 * - Speichern: saves through the page's hook and says when (game day and time) or why not.
 * - Zum Titel: asks first, saves, then leaves; a failed save keeps the game open with the reason.
 * Fully usable with keyboard or controller alone (focus frame, `useFocusScope`); Esc/B goes one view
 * back and from the main view continues the game.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Settings } from '../../../engine/settings';
import type { I18n } from '../../../i18n';
import { formatGameTime } from '../../../i18n/format';
import type { UiBridge } from '../../bridge';
import { ScreenLayer } from '../../focus/Layer';
import type { FocusElement, FocusManager, NavAction } from '../../focus/manager';
import { actionPrompt } from '../../focus/prompts';
import { focusable, useFocusScope } from '../../focus/useFocusScope';
import { Button, Frame } from '../../kit';
import type { MenuHooks, SaveOutcome } from './hooks';
import { PAUSE_SETTING_ROWS, stepValue, type SettingRow } from './settingsRows';
import './pause.css';

export interface PauseMenuProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
  readonly focus: FocusManager;
  readonly hooks: MenuHooks;
  /** Continue the game (closes the menu). */
  readonly close: () => void;
}

type View = 'haupt' | 'einstellungen' | 'titel';

type SaveState = { readonly kind: 'idle' } | { readonly kind: 'busy' } | { readonly kind: 'done'; readonly outcome: SaveOutcome };

function saveText(i18n: I18n, state: SaveState): string | null {
  if (state.kind === 'idle') return null;
  if (state.kind === 'busy') return i18n.t('ui.pause.speichertGerade');
  const o = state.outcome;
  return o.ok ? i18n.t('ui.pause.gespeichert', { tag: o.day, zeit: formatGameTime(i18n.lang, o.minuteOfDay) }) : i18n.t('ui.pause.speichernFehler', { fehler: o.error });
}

export function PauseMenu({ i18n, bridge, focus, hooks, close }: PauseMenuProps) {
  const [view, setView] = useState<View>('haupt');
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const t = i18n.t;
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const runSave = async (): Promise<SaveOutcome | null> => {
    if (hooks.save === undefined || save.kind === 'busy') return null;
    setSave({ kind: 'busy' });
    let outcome: SaveOutcome;
    try {
      outcome = await hooks.save();
    } catch (err) {
      outcome = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (alive.current) setSave({ kind: 'done', outcome });
    return outcome;
  };

  const hint = t('ui.pause.hinweis', { waehlen: actionPrompt(i18n, bridge.input, 'uiConfirm') ?? '-', zurueck: actionPrompt(i18n, bridge.input, 'uiBack') ?? '-' });

  return (
    <ScreenLayer focus={focus} label={t('ui.pause.titel')} testId="ui-pause">
      {view === 'haupt' ? (
        <MainView
          i18n={i18n}
          focus={focus}
          hooks={hooks}
          status={saveText(i18n, save)}
          statusError={save.kind === 'done' && !save.outcome.ok}
          busy={save.kind === 'busy'}
          onContinue={close}
          onSettings={() => setView('einstellungen')}
          onSave={() => void runSave()}
          onTitle={() => setView('titel')}
        />
      ) : view === 'einstellungen' && hooks.settings !== undefined ? (
        <SettingsView i18n={i18n} focus={focus} settings={hooks.settings} onBack={() => setView('haupt')} />
      ) : (
        <TitleView
          i18n={i18n}
          focus={focus}
          busy={save.kind === 'busy'}
          status={save.kind === 'done' && !save.outcome.ok ? saveText(i18n, save) : null}
          onYes={() => {
            void runSave().then((outcome) => {
              if (outcome?.ok === true) hooks.toTitle?.();
            });
          }}
          onNo={() => setView('haupt')}
        />
      )}
      <p class="dh-pause__hinweis">{hint}</p>
    </ScreenLayer>
  );
}

interface MainViewProps {
  readonly i18n: I18n;
  readonly focus: FocusManager;
  readonly hooks: MenuHooks;
  readonly status: string | null;
  readonly statusError: boolean;
  readonly busy: boolean;
  readonly onContinue: () => void;
  readonly onSettings: () => void;
  readonly onSave: () => void;
  readonly onTitle: () => void;
}

function MainView({ i18n, focus, hooks, status, statusError, busy, onContinue, onSettings, onSave, onTitle }: MainViewProps) {
  const t = i18n.t;
  const ref = useRef<HTMLDivElement>(null);
  useFocusScope(focus, ref, { initial: () => focusable(ref, '[data-eintrag="weiter"]'), onBack: onContinue });
  return (
    <div ref={ref}>
      <Frame art="holz" class="dh-pause__tafel">
        <h2 class="dh-pause__titel">{t('ui.pause.titel')}</h2>
        <div class="dh-pause__liste">
          <Button data-fokus="" data-eintrag="weiter" data-testid="pause-weiter" onClick={onContinue}>
            {t('ui.menu.continue')}
          </Button>
          {hooks.settings !== undefined ? (
            <Button data-fokus="" data-eintrag="einstellungen" data-testid="pause-einstellungen" onClick={onSettings}>
              {t('ui.menu.settings')}
            </Button>
          ) : null}
          {hooks.save !== undefined ? (
            <Button data-fokus="" data-eintrag="speichern" data-testid="pause-speichern" disabled={busy} onClick={onSave}>
              {t('ui.pause.speichern')}
            </Button>
          ) : null}
          {hooks.toTitle !== undefined && hooks.save !== undefined ? (
            <Button data-fokus="" data-eintrag="titel" data-testid="pause-titel" disabled={busy} onClick={onTitle}>
              {t('ui.pause.zumTitel')}
            </Button>
          ) : null}
        </div>
        {status !== null ? (
          <p class={statusError ? 'dh-pause__status dh-pause__status--fehler' : 'dh-pause__status'} data-testid="pause-status" role="status">
            {status}
          </p>
        ) : null}
      </Frame>
    </div>
  );
}

interface SettingsViewProps {
  readonly i18n: I18n;
  readonly focus: FocusManager;
  readonly settings: NonNullable<MenuHooks['settings']>;
  readonly onBack: () => void;
}

function rowOf(el: FocusElement | null): SettingRow | undefined {
  const id = el instanceof Element ? el.getAttribute('data-einstellung') : null;
  return PAUSE_SETTING_ROWS.find((r) => r.id === id);
}

function SettingsView({ i18n, focus, settings, onBack }: SettingsViewProps) {
  const t = i18n.t;
  const ref = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState<Settings>(settings.get());
  useEffect(() => settings.subscribe((next) => setCurrent(next)), [settings]);
  const step = (row: SettingRow, dir: 1 | -1): void => {
    settings.update(row.patch(stepValue(row, row.get(settings.get()), dir)));
  };
  useFocusScope(focus, ref, {
    initial: () => focusable(ref, '[data-einstellung]'),
    onAction(action: NavAction, focused: FocusElement | null): boolean {
      const row = rowOf(focused);
      if (row === undefined || (action !== 'left' && action !== 'right')) return false;
      step(row, action === 'right' ? 1 : -1);
      return true;
    },
    onBack,
  });
  const focusedRow = rowOf(focus.focused.value);
  return (
    <div ref={ref}>
      <Frame art="holz" class="dh-pause__tafel dh-pause__tafel--breit">
        <h2 class="dh-pause__titel">{t('settings.title')}</h2>
        <div class="dh-pause__einstellungen" role="list">
          {PAUSE_SETTING_ROWS.map((row) => {
            const value = row.format(i18n, row.get(current));
            const label = t(row.labelKey);
            return (
              <button
                type="button"
                key={row.id}
                role="listitem"
                class="dh-pause__zeile"
                data-fokus=""
                data-einstellung={row.id}
                data-testid={`einstellung-${row.id}`}
                aria-label={t('ui.pause.einstellungWert', { name: label, wert: value })}
                onClick={() => step(row, 1)}
              >
                <span class="dh-pause__name">{label}</span>
                <span class="dh-pause__wahl">
                  <span
                    class="dh-pause__pfeil"
                    aria-hidden="true"
                    onClick={(e) => {
                      e.stopPropagation();
                      step(row, -1);
                    }}
                  >
                    {'<'}
                  </span>
                  <span class="dh-pause__wert" data-testid={`einstellung-${row.id}-wert`}>
                    {value}
                  </span>
                  <span
                    class="dh-pause__pfeil"
                    aria-hidden="true"
                    onClick={(e) => {
                      e.stopPropagation();
                      step(row, 1);
                    }}
                  >
                    {'>'}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <Frame art="pergament" class="dh-pause__beschreibung">
          <p data-testid="einstellung-beschreibung">{focusedRow !== undefined ? t(`${focusedRow.labelKey}.desc`) : t('ui.pause.einstellungenHinweis')}</p>
        </Frame>
        <div class="dh-pause__liste dh-pause__liste--unten">
          <Button data-fokus="" data-testid="einstellungen-zurueck" onClick={onBack}>
            {t('common.back')}
          </Button>
        </div>
      </Frame>
    </div>
  );
}

interface TitleViewProps {
  readonly i18n: I18n;
  readonly focus: FocusManager;
  readonly busy: boolean;
  readonly status: string | null;
  readonly onYes: () => void;
  readonly onNo: () => void;
}

function TitleView({ i18n, focus, busy, status, onYes, onNo }: TitleViewProps) {
  const t = i18n.t;
  const ref = useRef<HTMLDivElement>(null);
  useFocusScope(focus, ref, { initial: () => focusable(ref, '[data-nein]'), onBack: onNo });
  return (
    <div ref={ref}>
      <Frame art="holz" class="dh-pause__tafel">
        <h2 class="dh-pause__titel">{t('ui.pause.zumTitel')}</h2>
        <p class="dh-pause__text">{t('ui.pause.titelFrage')}</p>
        {status !== null ? (
          <p class="dh-pause__status dh-pause__status--fehler" role="alert">
            {status}
          </p>
        ) : null}
        <div class="dh-pause__liste">
          <Button data-fokus="" data-testid="pause-titel-ja" disabled={busy} onClick={onYes}>
            {busy ? t('ui.pause.speichertGerade') : t('ui.pause.titelJa')}
          </Button>
          <Button data-fokus="" data-nein="" data-testid="pause-titel-nein" onClick={onNo}>
            {t('common.cancel')}
          </Button>
        </div>
      </Frame>
    </div>
  );
}
