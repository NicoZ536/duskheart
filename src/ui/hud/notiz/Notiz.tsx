/**
 * The note of a place on parchment (docs/SPIEL.md §18 "Notiz … das HUD zeigt ihren Text"; M7-08, M7-09): when the player reads
 * the note at a farmstead, hermit's hut or graveyard (`placeNoteRead`), its title and text show on a parchment plate above the
 * hotbar for `NOTIZ_TICKS` simulation ticks (a pause holds it; reading another note replaces it). It takes no input – the
 * player reads it while walking on. Hidden under open screens like the rest of the HUD.
 */
import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { CONTENT } from '../../../content/index';
import type { PlaceDef } from '../../../content/places/schema';
import type { I18n } from '../../../i18n';
import type { UiBridge } from '../../bridge';
import { Frame } from '../../kit/widgets';
import './notiz.css';

/** How long a note stays [ticks]: 16 s at 60 Hz – time to read four lines twice. */
export const NOTIZ_TICKS = 960;

interface Gelesen {
  readonly ortstyp: string;
  readonly bis: number;
}

export interface HudNotizProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
}

export function HudNotiz({ i18n, bridge }: HudNotizProps) {
  const notiz = useSignal<Gelesen | null>(null);
  useEffect(() => {
    const stopp = bridge.onEvent('placeNoteRead', (e) => {
      notiz.value = { ortstyp: e.ortstyp, bis: e.tick + NOTIZ_TICKS };
    });
    const ablauf = bridge.onFrame(() => {
      const n = notiz.peek();
      if (n !== null && bridge.state.tick.peek() >= n.bis) notiz.value = null;
    });
    return () => {
      stopp();
      ablauf();
    };
  }, [bridge, notiz]);
  const n = notiz.value;
  if (n === null) return null;
  const def = CONTENT.collection('locationTypes').find(n.ortstyp) as PlaceDef | undefined;
  if (def?.notiz === undefined) return null;
  const lang = i18n.lang;
  return (
    <Frame art="pergament" class="dh-hud-notiz" data-testid="hud-notiz" data-ort={n.ortstyp} role="dialog" aria-label={i18n.t('ui.ort.notiz.titel', { ort: def.name[lang] })}>
      <p class="dh-hud-notiz__titel">{def.notiz.titel[lang]}</p>
      <p class="dh-hud-notiz__text">{def.notiz.text[lang]}</p>
    </Frame>
  );
}
