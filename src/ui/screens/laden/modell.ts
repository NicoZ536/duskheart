/**
 * Model of the loading screen (MASTERPROMPT §26 "Ladebildschirm (Tipps, Lore)"; docs/SPIEL.md §25; M7-50): how far
 * the world is (the world worker's generation steps, then the save and the first chunks), and which tip and which lore
 * line it shows – one of each from `src/content/tipps.ts`, chosen afresh every `TIPP_WECHSEL_MS` while it waits, never
 * the same one twice in a row. Pure; the random draw is injected (the menu scenario shows fixed texts).
 */
import type { TipDef, TipKind } from '../../../content/tipps';
import type { WorldLoadingView } from '../../App';

/** How long a tip stays before the next one [ms] (long enough to read two lines). */
export const TIPP_WECHSEL_MS = 9000;

/** Share of the bar the world generation fills; the rest is the save and the first chunks around the start. */
export const GENERIERUNG_ANTEIL = 0.9;

/** Fill of the progress bar [0, 1] for the world worker's progress (`null` before the first step and once ready). */
export function ladeAnteil(view: WorldLoadingView | null, bereit: boolean): number {
  if (bereit) return 1;
  if (view === null || view.kind === 'failed') return 0;
  return (GENERIERUNG_ANTEIL * view.index) / Math.max(1, view.count);
}

/** The tips of kind `art` in content order. */
export function tippsDerArt(tips: readonly TipDef[], art: TipKind): TipDef[] {
  return tips.filter((t) => t.art === art);
}

/**
 * The tip drawn by `zufall` ∈ [0, 1) from `tips` of kind `art`, another than `ohne` when there is another one; null
 * when there is none of that kind.
 */
export function tippWahl(tips: readonly TipDef[], art: TipKind, zufall: number, ohne: string | null = null): TipDef | null {
  const pool = tippsDerArt(tips, art);
  const rest = pool.length > 1 && ohne !== null ? pool.filter((t) => t.id !== ohne) : pool;
  if (rest.length === 0) return null;
  const i = Math.min(rest.length - 1, Math.max(0, Math.floor(zufall * rest.length)));
  return rest[i] ?? null;
}

/** Width [design px] of the filled part of a bar `breite` px wide at `anteil` – whole design pixels only. */
export function fuellBreite(breite: number, anteil: number): number {
  return Math.round(Math.min(1, Math.max(0, anteil)) * breite);
}
