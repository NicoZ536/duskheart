/**
 * Settings screen (MASTERPROMPT §29 "Einstellungen/Barrierefreiheit", §26 "Alles umbelegbar"; docs/SPIEL.md §25;
 * M7-55, M7-56), from the main menu and from the pause menu ("Alle Einstellungen"): tabs Grafik, Audio, Steuerung,
 * Spiel, Sprache and Barrierefreiheit with every key of `src/engine/settings.ts` a player sets (`EINSTELLUNGEN_ZEILEN`),
 * each a row stepped with left/right; every change takes effect at once and stays after a reload (localStorage) – the
 * language switches every text without a restart.
 *
 * The controls tab ends with the key bindings (belegung.ts): a row for the device (keyboard & mouse or controller),
 * then one row per action with its binding on that device; confirming a row waits for the new key, mouse button or
 * controller button (Esc or a click beside the prompt cancels), a binding another action already uses asks first –
 * swap, replace or cancel –, conflicting rows are marked, actions left without a binding are named.
 * Q/E (the menu's tab actions) switch the tabs; under the rows the focused row's description; "Abschnitt
 * zurücksetzen" restores the tab's section, "Alles zurücksetzen" asks first. Esc/B goes back.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { actionLabelKey, isAction, type Action } from '../../../engine/input/actions';
import type { Binding, BindingConflict, BindingDevice } from '../../../engine/input/bindings';
import type { Settings, SettingsStore } from '../../../engine/settings';
import type { I18n } from '../../../i18n';
import type { UiInput } from '../../bridge';
import { ScreenLayer } from '../../focus/Layer';
import type { FocusElement, FocusManager } from '../../focus/manager';
import { actionPrompt } from '../../focus/prompts';
import { focusable, useFocusScope } from '../../focus/useFocusScope';
import { Button, Frame } from '../../kit';
import { ZeilenListe, zeileVon, type MenuZeile } from '../../menu/Zeilen';
import { stepValue } from '../pause/settingsRows';
import {
  belegbareAktionen,
  belegungAus,
  belegungsText,
  BELEGUNGS_GERAETE,
  ersteBelegung,
  kategorieVon,
  konfliktAktionen,
  mausBelegung,
  padBelegung,
  passtZuGeraet,
  tastenBelegung,
  umbelegen,
  unbelegtText,
} from './belegung';
import { EINSTELLUNGEN_REITER, EINSTELLUNGEN_ZEILEN, naechsterReiter, qualitaetAngepasst, zeileMitId, type ReiterId } from './zeilen';
import './einstellungen.css';

/** Row id of the device switch of the key bindings. */
const GERAET_ZEILE = 'belegung.geraet';
/** Prefix of a key binding's row id. */
const BELEGUNG = 'belegung:';
/** Fewest rows the list shows. */
const MIN_ZEILEN = 5;

function belegungsAktion(id: string | null): Action | null {
  if (id === null || !id.startsWith(BELEGUNG)) return null;
  const a = id.slice(BELEGUNG.length);
  return isAction(a) ? a : null;
}

export interface EinstellungenProps {
  readonly i18n: I18n;
  readonly focus: FocusManager;
  readonly input: UiInput | null;
  readonly settings: SettingsStore;
  readonly onZurueck: () => void;
}

/** A rebinding that waits for the player's choice. */
interface Konflikt {
  readonly action: Action;
  readonly binding: Binding;
  readonly konflikte: readonly BindingConflict[];
}

type Dialog = { readonly art: 'keiner' } | { readonly art: 'erfassen'; readonly action: Action } | { readonly art: 'konflikt'; readonly konflikt: Konflikt } | { readonly art: 'allesZuruecksetzen' };

/** The settings as content of a screen layer (the menu's screen, the pause menu's view). */
export function Einstellungen({ i18n, focus, input, settings, onZurueck }: EinstellungenProps) {
  const t = i18n.t;
  const ref = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState<Settings>(settings.get());
  useEffect(() => settings.subscribe((next) => setCurrent(next)), [settings]);
  const [reiter, setReiter] = useState<ReiterId>('graphics');
  const [geraet, setGeraet] = useState<BindingDevice>(input?.lastDevice === 'gamepad' ? 'gamepad' : 'keyboardMouse');
  const [dialog, setDialog] = useState<Dialog>({ art: 'keiner' });
  const family = input?.gamepadFamily ?? 'generic';

  const set = belegungAus(current.controls.bindings);
  const konflikte = konfliktAktionen(set);

  const anwenden = (action: Action, binding: Binding, policy: 'reject' | 'swap' | 'unbindOther'): void => {
    const r = umbelegen(settings.get().controls.bindings, action, binding, policy);
    if (r.ok) {
      settings.update({ controls: { bindings: r.bindings } });
      setDialog({ art: 'keiner' });
    } else setDialog({ art: 'konflikt', konflikt: { action, binding, konflikte: r.konflikte } });
  };

  const schritt = (id: string, dir: 1 | -1): void => {
    if (id === GERAET_ZEILE) {
      setGeraet((g) => (BELEGUNGS_GERAETE[(BELEGUNGS_GERAETE.indexOf(g) + 1) % BELEGUNGS_GERAETE.length] as BindingDevice));
      return;
    }
    const action = belegungsAktion(id);
    if (action !== null) {
      setDialog({ art: 'erfassen', action });
      return;
    }
    const row = zeileMitId(id);
    if (row !== undefined) settings.update(row.patch(stepValue(row, row.get(settings.get()), dir)));
  };

  useFocusScope(focus, ref, {
    initial: () => focusable(ref, `[data-reiter="${reiter}"]`),
    onAction(action, focused: FocusElement | null) {
      if (action === 'next' || action === 'prev') {
        setReiter((r) => naechsterReiter(r, action === 'next' ? 1 : -1));
        return true;
      }
      const id = zeileVon(focused);
      if (id === null || (action !== 'left' && action !== 'right')) return false;
      // Binding rows have no values to step: left/right stay on the row.
      if (belegungsAktion(id) === null) schritt(id, action === 'right' ? 1 : -1);
      return true;
    },
    onBack: onZurueck,
  });

  const zeilen: MenuZeile[] = EINSTELLUNGEN_ZEILEN[reiter].map((row) => {
    const value = row.get(current);
    const wert = row.format(i18n, value);
    return {
      id: row.id,
      name: t(row.labelKey),
      wert: row.id === 'graphics.quality' && qualitaetAngepasst(current) ? t('settings.graphics.quality.angepasst', { stufe: wert }) : wert,
      testId: `einstellung-${row.id}`,
    };
  });
  if (reiter === 'controls') {
    zeilen.push({ id: GERAET_ZEILE, name: t('settings.controls.bindings'), wert: t(geraet === 'gamepad' ? 'input.device.gamepad' : 'input.device.keyboard'), testId: 'einstellung-belegung-geraet' });
    let kategorie: string | null = null;
    for (const a of belegbareAktionen(current.game.developerMode)) {
      const cat = kategorieVon(a);
      const name = cat !== kategorie ? `${t(`input.category.${cat}`)}: ${t(actionLabelKey(a))}` : t(actionLabelKey(a));
      kategorie = cat;
      zeilen.push({
        id: `${BELEGUNG}${a}`,
        name,
        wert: belegungsText(i18n, ersteBelegung(set, a, geraet), family),
        testId: `belegung-${a}`,
        markiert: konflikte.has(a),
      });
    }
  }

  const focusedId = zeileVon(focus.focused.value);
  const focusedAction = belegungsAktion(focusedId);
  const focusedRow = focusedId === null ? undefined : zeileMitId(focusedId);
  const beschreibung =
    focusedAction !== null || focusedId === GERAET_ZEILE
      ? t('settings.controls.bindings.desc')
      : focusedRow !== undefined
        ? t(`${focusedRow.labelKey}.desc`)
        : t('ui.pause.einstellungenHinweis');
  const warnung = reiter === 'controls' ? unbelegtText(i18n, set) : null;
  const abschnitt = EINSTELLUNGEN_REITER.find((r) => r.id === reiter)?.abschnitt ?? 'graphics';

  return (
    <>
      <div ref={ref} class={dialog.art === 'keiner' ? undefined : 'dh-einstellungen--verdeckt'}>
        <Frame art="holz" class="dh-einstellungen__tafel">
          <h2 class="dh-einstellungen__titel">{t('settings.title')}</h2>
          <div class="dh-einstellungen__reiter" role="tablist">
            {EINSTELLUNGEN_REITER.map((r) => (
              <button
                type="button"
                key={r.id}
                role="tab"
                aria-selected={r.id === reiter}
                class={r.id === reiter ? 'dh-einstellungen__tab dh-einstellungen__tab--aktiv' : 'dh-einstellungen__tab'}
                data-fokus=""
                data-reiter={r.id}
                data-testid={`einstellungen-reiter-${r.id}`}
                onClick={() => setReiter(r.id)}
              >
                {t(`settings.tab.${r.id}`)}
              </button>
            ))}
          </div>
          <ZeilenListe
            key={reiter}
            zeilen={zeilen}
            schritt={schritt}
            bildschirm={ref}
            mindestens={MIN_ZEILEN}
            labelHoch={t('ui.kit.scroll.hoch')}
            labelRunter={t('ui.kit.scroll.runter')}
            ariaLabel={(z) => t('ui.pause.einstellungWert', { name: z.name, wert: z.wert })}
            testId="einstellungen-zeilen"
          />
          <Frame art="pergament" class="dh-einstellungen__beschreibung">
            <p data-testid="einstellungen-beschreibung">{warnung ?? beschreibung}</p>
          </Frame>
          <div class="dh-einstellungen__leiste">
            <Button data-fokus="" data-testid="einstellungen-abschnitt" onClick={() => settings.reset(abschnitt)}>
              {t('settings.resetSection')}
            </Button>
            <Button data-fokus="" data-testid="einstellungen-alles" onClick={() => setDialog({ art: 'allesZuruecksetzen' })}>
              {t('settings.resetAll')}
            </Button>
            <Button data-fokus="" data-testid="einstellungen-zurueck" onClick={onZurueck}>
              {t('common.back')}
            </Button>
          </div>
        </Frame>
      </div>
      {dialog.art === 'erfassen' ? (
        <Erfassen
          i18n={i18n}
          focus={focus}
          action={dialog.action}
          geraet={geraet}
          onBelegung={(b) => anwenden(dialog.action, b, 'reject')}
          onAbbruch={() => setDialog({ art: 'keiner' })}
        />
      ) : dialog.art === 'konflikt' ? (
        <KonfliktFrage
          i18n={i18n}
          focus={focus}
          konflikt={dialog.konflikt}
          family={family}
          onTauschen={() => anwenden(dialog.konflikt.action, dialog.konflikt.binding, 'swap')}
          onErsetzen={() => anwenden(dialog.konflikt.action, dialog.konflikt.binding, 'unbindOther')}
          onAbbruch={() => setDialog({ art: 'keiner' })}
        />
      ) : dialog.art === 'allesZuruecksetzen' ? (
        <AllesFrage
          i18n={i18n}
          focus={focus}
          onJa={() => {
            settings.reset();
            setDialog({ art: 'keiner' });
          }}
          onNein={() => setDialog({ art: 'keiner' })}
        />
      ) : null}
    </>
  );
}

interface ErfassenProps {
  readonly i18n: I18n;
  readonly focus: FocusManager;
  readonly action: Action;
  readonly geraet: BindingDevice;
  readonly onBelegung: (binding: Binding) => void;
  readonly onAbbruch: () => void;
}

/**
 * Waits for the new binding: a key (with its held modifiers), a mouse button on the prompt or a controller button –
 * whichever belongs to the device shown. The window's listeners run in the capture phase and stop the event, so the
 * game's input never sees the pressed key; Esc or a click beside the prompt cancels.
 */
function Erfassen({ i18n, focus, action, geraet, onBelegung, onAbbruch }: ErfassenProps) {
  const t = i18n.t;
  const ref = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useFocusScope(focus, ref, { onBack: onAbbruch });
  // The handlers through a ref: the parent renders anew with every settings change, the listeners stay.
  const latest = useRef({ onBelegung, onAbbruch });
  latest.current = { onBelegung, onAbbruch };
  useEffect(() => {
    const done = (b: Binding | null): void => {
      if (b === null) latest.current.onAbbruch();
      else if (passtZuGeraet(b, geraet)) latest.current.onBelegung(b);
    };
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      done(e.code === 'Escape' ? null : tastenBelegung(e));
    };
    const onMouse = (e: MouseEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      const inside = box.current !== null && e.target instanceof Node && box.current.contains(e.target);
      if (!inside) done(null);
      else if (geraet === 'keyboardMouse') done(mausBelegung(e.button));
    };
    const swallow = (e: Event): void => {
      e.preventDefault();
      e.stopPropagation();
    };
    // Controller buttons: the first one pressed after the prompt opened (those held at its start do not count).
    const getPads = typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function' ? () => navigator.getGamepads() : () => [];
    const held = new Set<string>();
    for (const pad of getPads()) pad?.buttons.forEach((b, i) => b.pressed && held.add(`${pad.index}:${i}`));
    let frame = 0;
    const poll = (): void => {
      for (const pad of getPads()) {
        if (pad === null) continue;
        for (let i = 0; i < pad.buttons.length; i++) {
          const id = `${pad.index}:${i}`;
          const pressed = pad.buttons[i]?.pressed === true;
          if (!pressed) held.delete(id);
          else if (!held.has(id)) {
            held.add(id);
            if (geraet === 'gamepad') {
              done(padBelegung(i));
              return;
            }
          }
        }
      }
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('click', swallow, true);
    window.addEventListener('contextmenu', swallow, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      window.removeEventListener('click', swallow, true);
      window.removeEventListener('contextmenu', swallow, true);
    };
  }, [geraet]);
  return (
    <div ref={ref} class="dh-einstellungen__dialog">
      <div ref={box}>
        <Frame art="holz" class="dh-einstellungen__frage" role="alertdialog" data-testid="belegung-erfassen">
          <p>{t('input.rebind.prompt', { action: t(actionLabelKey(action)) })}</p>
          <p class="dh-einstellungen__klein">{t('input.rebind.cancelHint')}</p>
        </Frame>
      </div>
    </div>
  );
}

interface KonfliktFrageProps {
  readonly i18n: I18n;
  readonly focus: FocusManager;
  readonly konflikt: Konflikt;
  readonly family: 'xbox' | 'playstation' | 'generic';
  readonly onTauschen: () => void;
  readonly onErsetzen: () => void;
  readonly onAbbruch: () => void;
}

function KonfliktFrage({ i18n, focus, konflikt, family, onTauschen, onErsetzen, onAbbruch }: KonfliktFrageProps) {
  const t = i18n.t;
  const ref = useRef<HTMLDivElement>(null);
  useFocusScope(focus, ref, { initial: () => focusable(ref, '[data-abbruch]'), onBack: onAbbruch });
  const binding = belegungsText(i18n, konflikt.binding, family);
  return (
    <div ref={ref} class="dh-einstellungen__dialog">
      <Frame art="holz" class="dh-einstellungen__frage" role="alertdialog" data-testid="belegung-konflikt">
        {konflikt.konflikte.map((c) => (
          <p key={c.other}>{t('input.rebind.conflict', { binding, other: t(actionLabelKey(c.other)) })}</p>
        ))}
        <div class="dh-einstellungen__leiste">
          <Button data-fokus="" data-testid="belegung-tauschen" onClick={onTauschen}>
            {t('input.rebind.swap')}
          </Button>
          <Button data-fokus="" data-testid="belegung-ersetzen" onClick={onErsetzen}>
            {t('input.rebind.replace')}
          </Button>
          <Button data-fokus="" data-abbruch="" data-testid="belegung-abbrechen" onClick={onAbbruch}>
            {t('common.cancel')}
          </Button>
        </div>
      </Frame>
    </div>
  );
}

function AllesFrage({ i18n, focus, onJa, onNein }: { readonly i18n: I18n; readonly focus: FocusManager; readonly onJa: () => void; readonly onNein: () => void }) {
  const t = i18n.t;
  const ref = useRef<HTMLDivElement>(null);
  useFocusScope(focus, ref, { initial: () => focusable(ref, '[data-nein]'), onBack: onNein });
  return (
    <div ref={ref} class="dh-einstellungen__dialog">
      <Frame art="holz" class="dh-einstellungen__frage" role="alertdialog" data-testid="einstellungen-alles-frage">
        <p>{t('settings.resetConfirm')}</p>
        <div class="dh-einstellungen__leiste">
          <Button data-fokus="" data-testid="einstellungen-alles-ja" onClick={onJa}>
            {t('settings.resetAll')}
          </Button>
          <Button data-fokus="" data-nein="" data-testid="einstellungen-alles-nein" onClick={onNein}>
            {t('common.cancel')}
          </Button>
        </div>
      </Frame>
    </div>
  );
}

export type EinstellungenBildschirmProps = EinstellungenProps;

/** The settings screen of the main menu: the settings in their own screen layer with the key hints below. */
export function EinstellungenBildschirm(props: EinstellungenBildschirmProps) {
  const { i18n, input } = props;
  const t = i18n.t;
  const hint = t('ui.einstellungen.hinweis', {
    waehlen: actionPrompt(i18n, input, 'uiConfirm') ?? '-',
    reiter: `${actionPrompt(i18n, input, 'uiTabPrev') ?? '-'}/${actionPrompt(i18n, input, 'uiTabNext') ?? '-'}`,
    zurueck: actionPrompt(i18n, input, 'uiBack') ?? '-',
  });
  return (
    <ScreenLayer focus={props.focus} label={t('settings.title')} testId="ui-einstellungen">
      <Einstellungen {...props} />
      <p class="dh-einstellungen__hinweis">{hint}</p>
    </ScreenLayer>
  );
}
