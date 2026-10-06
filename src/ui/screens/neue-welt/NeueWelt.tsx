/**
 * New world (MASTERPROMPT §26 "Neue Welt (Seed, Größe, Voreinstellung, alle Regler)", §29; docs/SPIEL.md §25; M7-51):
 * the name and the seed as text fields (the seed suggested at random, "Zufall" draws another, a pasted
 * "DH-<Seed>-<Größe>" also sets the size), then the rows of `NEUE_WELT_ZEILEN` – size, preset, peaceful, day length,
 * season length, resource density, the overrides of hunger/thirst and enemy damage, the shadow flood and logistics
 * realism – stepped with left/right; under them what the chosen preset means (factors and death penalty, §29 table).
 * "Welt erschaffen" checks the form and goes on (the next step of the flow, src/ui/menu/ablauf.ts); Esc/B goes back
 * with the form kept.
 *
 * The text fields take the keyboard while focused (the game input ignores text fields): Enter or ↓ moves on to the
 * next element, ↑ to the one before, Esc leaves the screen like everywhere else.
 */
import { useRef } from 'preact/hooks';
import type { I18n } from '../../../i18n';
import type { UiInput } from '../../bridge';
import { ScreenLayer } from '../../focus/Layer';
import type { FocusElement, FocusManager } from '../../focus/manager';
import { actionPrompt } from '../../focus/prompts';
import { focusable, useFocusScope } from '../../focus/useFocusScope';
import { Button, Frame } from '../../kit';
import { ZeilenListe, zeileVon, type MenuZeile } from '../../menu/Zeilen';
import { NEUE_WELT_ZEILEN, pruefen, schritt, seedEinfuegen, voreinstellung, WORLD_NAME_MAX, type NeueWeltForm } from './modell';
import { faktorenText, todText, zeilenWert } from './texte';
import './neue-welt.css';

export interface NeueWeltProps {
  readonly i18n: I18n;
  readonly focus: FocusManager;
  readonly input: UiInput | null;
  readonly form: NeueWeltForm;
  readonly setForm: (form: NeueWeltForm) => void;
  /** Whether the form was submitted once (errors show from then on). */
  readonly geprueft: boolean;
  /** A fresh seed suggestion. */
  readonly zufallsSeed: () => number;
  /** The form passed its check: on to the next step. */
  readonly onWeiter: (form: NeueWeltForm) => void;
  /** Submitted with errors (the screen shows them). */
  readonly onFehler: () => void;
  readonly onZurueck: () => void;
}

/** Fewest rows the list shows (with less room the layer draws smaller). */
const MIN_ZEILEN = 4;

export function NeueWelt({ i18n, focus, input, form, setForm, geprueft, zufallsSeed, onWeiter, onFehler, onZurueck }: NeueWeltProps) {
  const t = i18n.t;
  const ref = useRef<HTMLDivElement>(null);
  const preset = voreinstellung(form);
  const fehler = pruefen(form);
  const step = (id: string, dir: 1 | -1): void => {
    const row = NEUE_WELT_ZEILEN.find((r) => r.id === id);
    if (row !== undefined) setForm(schritt(row, form, dir));
  };
  useFocusScope(focus, ref, {
    initial: () => focusable(ref, '[data-testid="neue-welt-erschaffen"]'),
    onAction(action, focused: FocusElement | null) {
      const id = zeileVon(focused);
      if (id === null || (action !== 'left' && action !== 'right')) return false;
      step(id, action === 'right' ? 1 : -1);
      return true;
    },
    onBack: onZurueck,
  });
  const erschaffen = (): void => {
    const f = pruefen(form);
    if (f.name === undefined && f.seed === undefined) onWeiter(form);
    else onFehler();
  };
  /** Keys inside a text field: the field keeps typing, these move the focus on. */
  const feldTaste = (e: KeyboardEvent): void => {
    const el = e.currentTarget;
    if (!(el instanceof HTMLElement)) return;
    const nav = e.key === 'Enter' || e.key === 'ArrowDown' ? 'down' : e.key === 'ArrowUp' ? 'up' : e.key === 'Escape' ? 'back' : null;
    if (nav === null) return;
    e.preventDefault();
    focus.keysUsed();
    focus.focus(el as unknown as FocusElement);
    focus.handle(nav);
    if (nav !== 'back') el.blur();
  };
  const zeilen: MenuZeile[] = NEUE_WELT_ZEILEN.map((row) => ({
    id: row.id,
    name: t(row.labelKey),
    wert: zeilenWert(i18n, row, row.get(form), preset),
    testId: `neue-welt-${row.id}`,
  }));
  const hint = t('ui.pause.hinweis', { waehlen: actionPrompt(i18n, input, 'uiConfirm') ?? '-', zurueck: actionPrompt(i18n, input, 'uiBack') ?? '-' });
  return (
    <ScreenLayer focus={focus} label={t('ui.menu.newWorld')} testId="ui-neue-welt">
      <div ref={ref}>
        <Frame art="holz" class="dh-neue-welt__tafel">
          <h2 class="dh-neue-welt__titel">{t('ui.menu.newWorld')}</h2>
          <div class="dh-neue-welt__felder">
            <label class="dh-neue-welt__feld">
              <span class="dh-neue-welt__feldname">{t('ui.newWorld.name')}</span>
              <input
                type="text"
                class={geprueft && fehler.name !== undefined ? 'dh-neue-welt__eingabe dh-neue-welt__eingabe--fehler' : 'dh-neue-welt__eingabe'}
                data-fokus=""
                data-testid="neue-welt-name"
                maxLength={WORLD_NAME_MAX}
                value={form.name}
                spellcheck={false}
                autocomplete="off"
                onInput={(e) => setForm({ ...form, name: e.currentTarget.value })}
                onKeyDown={feldTaste}
              />
            </label>
            <label class="dh-neue-welt__feld">
              <span class="dh-neue-welt__feldname">{t('ui.newWorld.seed')}</span>
              <input
                type="text"
                class={geprueft && fehler.seed !== undefined ? 'dh-neue-welt__eingabe dh-neue-welt__eingabe--fehler' : 'dh-neue-welt__eingabe'}
                data-fokus=""
                data-testid="neue-welt-seed"
                inputMode="text"
                value={form.seedText}
                spellcheck={false}
                autocomplete="off"
                onInput={(e) => setForm(seedEinfuegen(form, e.currentTarget.value.trim()))}
                onKeyDown={feldTaste}
              />
              <Button data-fokus="" data-testid="neue-welt-zufall" class="dh-neue-welt__zufall" onClick={() => setForm({ ...form, seedText: String(zufallsSeed()) })}>
                {t('ui.newWorld.zufall')}
              </Button>
            </label>
          </div>
          {geprueft && (fehler.name !== undefined || fehler.seed !== undefined) ? (
            <p class="dh-neue-welt__fehler" data-testid="neue-welt-fehler" role="alert">
              {[fehler.name, fehler.seed]
                .filter((k): k is string => k !== undefined)
                .map((k) => t(k, { max: WORLD_NAME_MAX }))
                .join(' ')}
            </p>
          ) : null}
          <ZeilenListe
            zeilen={zeilen}
            schritt={step}
            bildschirm={ref}
            mindestens={MIN_ZEILEN}
            labelHoch={t('ui.kit.scroll.hoch')}
            labelRunter={t('ui.kit.scroll.runter')}
            ariaLabel={(z) => t('ui.pause.einstellungWert', { name: z.name, wert: z.wert })}
            testId="neue-welt-zeilen"
          />
          <Frame art="pergament" class="dh-neue-welt__vorschau">
            <p data-testid="neue-welt-faktoren">
              <span class="dh-neue-welt__stufe">{t(`ui.newWorld.schwierigkeit.${form.schwierigkeit}`)}</span> {faktorenText(i18n, preset)}
            </p>
            <p data-testid="neue-welt-tod">{t('ui.newWorld.todZeile', { tod: todText(i18n, preset.tod) })}</p>
            {form.schwierigkeit === 'unbarmherzig' ? <p class="dh-neue-welt__warnung">{t('ui.newWorld.unbarmherzigHinweis')}</p> : null}
          </Frame>
          <div class="dh-neue-welt__leiste">
            <Button data-fokus="" data-testid="neue-welt-erschaffen" onClick={erschaffen}>
              {t('ui.newWorld.erschaffen')}
            </Button>
            <Button data-fokus="" data-testid="neue-welt-zurueck" onClick={onZurueck}>
              {t('common.back')}
            </Button>
          </div>
        </Frame>
      </div>
      <p class="dh-neue-welt__hinweis">{hint}</p>
    </ScreenLayer>
  );
}
