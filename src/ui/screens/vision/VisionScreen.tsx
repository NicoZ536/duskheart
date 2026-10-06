/**
 * The vision screen (MASTERPROMPT §8 "Story-Vision"; docs/SPIEL.md §22, §30 "`vision` (pausiert) – Öffner `beaconLit`"; M7-35):
 * when a beacon blazes up, the game pauses and the vision of its biome shows – pixel stills with their lines, each turning by
 * itself after its seconds or on "Weiter", then the knowledge the beacon gave. Closing tells the simulation the vision was seen
 * (`beacon.visionSeen`), so a load does not show it again.
 */
import { useSignal } from '@preact/signals';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { I18n } from '../../../i18n';
import type { UiBridge } from '../../bridge';
import { ScreenLayer } from '../../focus/Layer';
import type { FocusManager } from '../../focus/manager';
import { focusable, useFocusScope } from '../../focus/useFocusScope';
import { HudBild } from '../../hud/Bild';
import { Button, Frame } from '../../kit/widgets';
import { visionSeiten } from './modell';
import './vision.css';

/** Id of the vision screen. */
export const VISION_SCREEN = 'vision';
/** Size of a still [design px] (assets-src/sprites/visionen/). */
export const VISION_BILD = { w: 160, h: 90 } as const;
/** Milliseconds per second (the page timer). */
const MS = 1000;

export interface VisionScreenProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
  readonly focus: FocusManager;
  readonly beacon: number;
  readonly close: () => void;
}

export function VisionScreen({ i18n, bridge, focus, beacon, close }: VisionScreenProps) {
  const root = useRef<HTMLDivElement>(null);
  useFocusScope(focus, root, { initial: () => focusable(root, '[data-standard]') });
  const seiten = useMemo(() => visionSeiten(beacon, i18n.lang), [beacon, i18n.lang]);
  const seite = useSignal(0);
  const fertig = (): void => {
    bridge.leuchtfeuer?.visionGesehen(beacon);
    close();
  };
  const aktuell = seiten[seite.value];
  const letzte = seite.value >= seiten.length - 1;
  // A still turns by itself after its seconds (the game is paused: wall-clock time).
  useEffect(() => {
    const s = aktuell?.sekunden ?? null;
    if (s === null || letzte) return undefined;
    const id = setTimeout(() => (seite.value = seite.peek() + 1), s * MS);
    return () => clearTimeout(id);
  }, [aktuell, letzte, seite]);
  if (aktuell === undefined) return null;
  const t = i18n.t;
  return (
    <ScreenLayer focus={focus} label={t('ui.vision.label')} testId="ui-vision" class="dh-vision-ebene">
      <div ref={root} class="dh-vision" data-seite={seite.value}>
        {aktuell.bild !== null ? (
          <HudBild id={aktuell.bild} breite={VISION_BILD.w} hoehe={VISION_BILD.h} class="dh-vision__bild" />
        ) : (
          <h2 class="dh-vision__wissen">{t('ui.vision.wissen')}</h2>
        )}
        <Frame art="pergament" class="dh-vision__tafel">
          {aktuell.zeilen.map((z) => (
            <p key={z} class="dh-vision__zeile">
              {z}
            </p>
          ))}
        </Frame>
        <p class="dh-vision__fuss">
          <span class="dh-vision__zaehler">{t('ui.vision.seite', { n: seite.value + 1, m: seiten.length })}</span>
          <Button data-fokus="" data-standard="" data-testid="vision-weiter" onClick={() => (letzte ? fertig() : (seite.value = seite.peek() + 1))}>
            {letzte ? t('ui.vision.schliessen') : t('ui.vision.weiter')}
          </Button>
        </p>
      </div>
    </ScreenLayer>
  );
}
