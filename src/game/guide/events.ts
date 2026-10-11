/**
 * Events of the guide (aggregated into `SimEventMap`; docs/SPIEL.md §17 "Ereignisse zwischen Strängen"):
 * - `guideHint {hint, kanal, zeile}`: Funke speaks a comment (`kanal: 'funke'`, `hint` a hint id, `zeile` −1) or a line of a
 *   dialog (`hint` the dialog id, `zeile` its line), or the hint line shows a context hint (`kanal: 'hinweis'`) – the HUD shows
 *   it, Funke's crackle or the hint's soft tone plays (src/audio/eventMap.ts).
 */
import type { GuideChannel } from '../../content/guide/schema';

export interface GuideEventMap {
  guideHint: { readonly hint: string; readonly kanal: GuideChannel; readonly zeile: number; readonly tick: number };
}

/** Event names of `GuideEventMap`. */
export const GUIDE_EVENT_TYPES = ['guideHint'] as const satisfies ReadonlyArray<keyof GuideEventMap>;

/** Sounds of the guide (src/content/sfx/funke.ts): Funke's comment, a dialog's next line, a context hint. */
export const GUIDE_SFX = { funke: 'sfx_funke_spricht', line: 'sfx_funke_zeile', hint: 'sfx_funke_hinweis' } as const;
