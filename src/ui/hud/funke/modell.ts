/**
 * Funke's box and the hint line of the HUD (MASTERPROMPT §8 "Funke … höchstens 2 Zeilen pro Einwurf, nie aufdringlich,
 * abschaltbar"; docs/SPIEL.md §23 "Funke", §30 "Funke (HUD, Laterne + ≤ 2 Zeilen), Hinweiszeile – sampleGuide"; M7-43,
 * M7-44): what shows now – a Funke comment or the line of a Funke dialog beside the lantern, and a context hint on its own
 * line – in the current language. Pure; the component (Funke.tsx) samples every frame and builds the view only when the
 * signature moved.
 */
import { CONTENT } from '../../../content/index';
import type { GuideSample } from '../../../game/guide/types';
import type { Lang } from '../../../i18n';

/** What Funke and the hint line show. */
export interface FunkeAnsicht {
  /** Funke's text (a comment or a dialog line), or null. */
  readonly funke: string | null;
  /** The comment's or dialog's id (data attribute), or null. */
  readonly funkeId: string | null;
  /** A context hint, or null. */
  readonly hinweis: string | null;
  readonly hinweisId: string | null;
}

/** The empty view (nothing shows). */
export const KEINE_FUEHRUNG: FunkeAnsicht = { funke: null, funkeId: null, hinweis: null, hinweisId: null };

/** Whether `sample` shows Funke now (a comment or a dialog line still within its time). */
function funkeZeigt(s: Readonly<GuideSample>): boolean {
  return (s.funke !== null || s.dialog !== null) && s.tick < s.funkeUntilTick;
}

/** Whether `sample` shows a hint now. */
function hinweisZeigt(s: Readonly<GuideSample>): boolean {
  return s.hint !== null && s.tick < s.hintUntilTick;
}

/** The view of `sample` in `lang`. */
export function funkeAnsicht(sample: Readonly<GuideSample>, lang: Lang): FunkeAnsicht {
  let funke: string | null = null;
  let funkeId: string | null = null;
  if (funkeZeigt(sample)) {
    if (sample.dialog !== null) {
      const d = CONTENT.collection('dialogs').find(sample.dialog);
      const z = d?.zeilen[sample.dialogLine];
      if (z !== undefined) {
        funke = z[lang];
        funkeId = `${sample.dialog}:${sample.dialogLine}`;
      }
    } else if (sample.funke !== null) {
      const h = CONTENT.collection('guideHints').find(sample.funke);
      if (h !== undefined) {
        funke = h.text[lang];
        funkeId = h.id;
      }
    }
  }
  let hinweis: string | null = null;
  let hinweisId: string | null = null;
  if (hinweisZeigt(sample)) {
    const h = CONTENT.collection('guideHints').find(sample.hint as string);
    if (h !== undefined) {
      hinweis = h.text[lang];
      hinweisId = h.id;
    }
  }
  return funke === null && hinweis === null ? KEINE_FUEHRUNG : { funke, funkeId, hinweis, hinweisId };
}

/** Interned ids → small numbers for the signature (a few hundred hints and dialog lines; grows once per new id). */
const NUMMERN = new Map<string, number>();
function nummer(id: string | null): number {
  if (id === null) return 0;
  let n = NUMMERN.get(id);
  if (n === undefined) {
    n = NUMMERN.size + 1;
    NUMMERN.set(id, n);
  }
  return n;
}

/** A number that changes whenever the view would (another comment, line or hint, one appearing or ending) – no allocation. */
export function funkeSignatur(sample: Readonly<GuideSample>): number {
  const f = funkeZeigt(sample) ? (sample.dialog !== null ? nummer(sample.dialog) * 64 + sample.dialogLine + 1 : nummer(sample.funke)) : 0;
  const h = hinweisZeigt(sample) ? nummer(sample.hint) : 0;
  return f * 4099 + h;
}
