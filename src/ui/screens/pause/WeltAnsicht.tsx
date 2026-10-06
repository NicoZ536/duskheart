/**
 * The pause menu's world view (M7-51; welt.ts): the running world's changeable settings as rows, under them the
 * world's immutable config (seed to share, size, day length, resource density) and what the chosen preset means.
 * Left/right steps a row and sends its command; a locked row (an Unbarmherzig world) shows its value without arrows.
 */
import { useMemo, useRef, useState } from 'preact/hooks';
import { createWorldSettingsSample } from '../../../game/samples/weltEinstellungen';
import type { I18n } from '../../../i18n';
import type { FocusElement, FocusManager } from '../../focus/manager';
import { focusable, useFocusScope } from '../../focus/useFocusScope';
import { Button, Frame } from '../../kit';
import { ZeilenListe, zeileVon, type MenuZeile } from '../../menu/Zeilen';
import { voreinstellung } from '../neue-welt/modell';
import { faktorenText, todText, zeilenWert } from '../neue-welt/texte';
import { weltSeed } from '../weltauswahl/modell';
import type { WorldSettingsHook } from './hooks';
import { formAusProbe, WELT_ZEILEN, weltSchritt, weltZeileGesperrt } from './welt';

export interface WeltAnsichtProps {
  readonly i18n: I18n;
  readonly focus: FocusManager;
  readonly welt: WorldSettingsHook;
  readonly onBack: () => void;
}

/** Fewest rows the list shows. */
const MIN_ZEILEN = 4;

export function WeltAnsicht({ i18n, focus, welt, onBack }: WeltAnsichtProps) {
  const t = i18n.t;
  const ref = useRef<HTMLDivElement>(null);
  // Sampled once when the view opens; the changes sent since then are the player's (the simulation rests).
  const probe = useMemo(() => {
    const out = createWorldSettingsSample();
    return welt.sample(out) ? out : null;
  }, [welt]);
  const [form, setForm] = useState(() => (probe === null ? null : formAusProbe(probe)));
  const step = (id: string, dir: 1 | -1): void => {
    if (form === null) return;
    const r = weltSchritt(form, id, dir);
    if (r.befehl === null) return;
    welt.command(r.befehl);
    setForm(r.form);
  };
  useFocusScope(focus, ref, {
    initial: () => focusable(ref, '[data-zeile]'),
    onAction(action, focused: FocusElement | null) {
      const id = zeileVon(focused);
      if (id === null || (action !== 'left' && action !== 'right')) return false;
      step(id, action === 'right' ? 1 : -1);
      return true;
    },
    onBack,
  });
  if (form === null || probe === null) {
    return (
      <div ref={ref}>
        <Frame art="holz" class="dh-pause__tafel">
          <p class="dh-pause__text">{t('ui.pause.weltFehlt')}</p>
          <div class="dh-pause__liste">
            <Button data-fokus="" data-testid="welt-zurueck" onClick={onBack}>
              {t('common.back')}
            </Button>
          </div>
        </Frame>
      </div>
    );
  }
  const preset = voreinstellung(form);
  const zeilen: MenuZeile[] = WELT_ZEILEN.map((row) => ({
    id: row.id,
    name: t(row.labelKey),
    wert: zeilenWert(i18n, row, row.get(form), preset),
    testId: `welt-${row.id}`,
    gesperrt: weltZeileGesperrt(form.schwierigkeit, row.id),
  }));
  return (
    <div ref={ref}>
      <Frame art="holz" class="dh-pause__tafel dh-pause__tafel--breit" data-testid="pause-welt">
        <h2 class="dh-pause__titel">{t('ui.pause.welt')}</h2>
        <ZeilenListe
          zeilen={zeilen}
          schritt={step}
          bildschirm={ref}
          mindestens={MIN_ZEILEN}
          labelHoch={t('ui.kit.scroll.hoch')}
          labelRunter={t('ui.kit.scroll.runter')}
          ariaLabel={(z) => t('ui.pause.einstellungWert', { name: z.name, wert: z.wert })}
          testId="welt-zeilen"
        />
        <Frame art="pergament" class="dh-pause__weltinfo">
          <p data-testid="welt-faktoren">{faktorenText(i18n, preset)}</p>
          <p data-testid="welt-tod">{t('ui.newWorld.todZeile', { tod: todText(i18n, preset.tod) })}</p>
          <p data-testid="welt-config">
            {t('ui.pause.weltConfig', {
              seed: weltSeed({ seed: probe.seed, groesse: probe.groesse }),
              tag: t('ui.newWorld.minuten', { n: String(probe.tageslaenge) }),
              dichte: t(`ui.newWorld.dichte.${probe.ressourcendichte}`),
            })}
          </p>
        </Frame>
        <div class="dh-pause__liste dh-pause__liste--unten">
          <Button data-fokus="" data-testid="welt-zurueck" onClick={onBack}>
            {t('common.back')}
          </Button>
        </div>
      </Frame>
    </div>
  );
}
