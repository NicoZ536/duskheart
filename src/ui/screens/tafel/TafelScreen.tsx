/**
 * The tablet screen (MASTERPROMPT §8 "Vermittlung über 60 Erbauer-Tafeln"; docs/SPIEL.md §19 "Erbauer-Tafeln", §30 "`tafel`
 * (Tafel lesen) – Öffner `tabletRead`"; M7-46, strand C): E at a Builder tablet – in a vault or at a place's mark – pauses the
 * game and shows the stone: the tablet as it stands in the world (integer scale), its number of the sixty and its title, its
 * lines cut into the stone, where it was found. The chronicle keeps what was read (strand G); Esc or "Schließen" close it.
 */
import { useMemo, useRef } from 'preact/hooks';
import type { I18n } from '../../../i18n';
import { ScreenLayer } from '../../focus/Layer';
import type { FocusManager } from '../../focus/manager';
import { focusable, useFocusScope } from '../../focus/useFocusScope';
import { HudBild } from '../../hud/Bild';
import { Button, Frame } from '../../kit/widgets';
import { TABLETS_TOTAL, tafelSeite } from './modell';
import './tafel.css';

/** Id of the tablet screen. */
export const TAFEL_SCREEN = 'tafel';
/** The tablet's world sprite (src/content/dungeons/objekte.ts) and its size [design px]. */
const TAFEL_BILD = { id: 'ort_erbauer_tafel', w: 16, h: 28 } as const;
/** Scale of the stone above the text: big enough to read its carving, small beside the text. */
const TAFEL_BILD_SKALA = 3;

export interface TafelScreenProps {
  readonly i18n: I18n;
  readonly focus: FocusManager;
  readonly tablet: string;
  readonly close: () => void;
}

export function TafelScreen({ i18n, focus, tablet, close }: TafelScreenProps) {
  const root = useRef<HTMLDivElement>(null);
  // Esc (back) closes the stone like its button; without `onBack` an inner scope could swallow it.
  useFocusScope(focus, root, { initial: () => focusable(root, '[data-standard]'), onBack: close });
  const seite = useMemo(() => tafelSeite(tablet, i18n.lang), [tablet, i18n.lang]);
  if (seite === null) return null;
  const t = i18n.t;
  return (
    <ScreenLayer focus={focus} label={t('ui.tafel.label')} testId="ui-tafel" class="dh-tafel-ebene">
      <div ref={root} class="dh-tafel" data-tafel={seite.id}>
        <HudBild id={TAFEL_BILD.id} breite={TAFEL_BILD.w * TAFEL_BILD_SKALA} hoehe={TAFEL_BILD.h * TAFEL_BILD_SKALA} class="dh-tafel__stein" />
        <Frame art="eisen" class="dh-tafel__platte">
          <p class="dh-tafel__nummer">{t('ui.tafel.nummer', { n: seite.nummer, m: TABLETS_TOTAL })}</p>
          <h2 class="dh-tafel__titel">{seite.titel}</h2>
          {seite.zeilen.map((z) => (
            <p key={z} class="dh-tafel__zeile">
              {z}
            </p>
          ))}
          <p class="dh-tafel__fundort">{seite.ort === null ? t('ui.tafel.fundortGewoelbe') : t('ui.tafel.fundortOrt', { ort: seite.ort })}</p>
        </Frame>
        <p class="dh-tafel__fuss">
          <span class="dh-tafel__chronik">{t('ui.tafel.chronik')}</span>
          <Button data-fokus="" data-standard="" data-testid="tafel-schliessen" onClick={close}>
            {t('ui.tafel.schliessen')}
          </Button>
        </p>
      </div>
    </ScreenLayer>
  );
}
