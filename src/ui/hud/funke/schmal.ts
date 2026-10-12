/**
 * Narrow signs in build mode (M7-142; MASTERPROMPT §26 "HUD … nie aufdringlich", §8 "höchstens 2 Zeilen pro Einwurf"): in
 * build mode Funke's plate and the hint plate stand at the top beside the values' row (M7-134), and at their full widths
 * (256 and 270 design px of text) they spanned the whole top strip of the world between values and minimap. There each
 * plate takes the narrowest whole width at which its text still keeps its lines (at most two – a long one-liner breaks into
 * two even lines, a short one stays one line), and both plates end flush, so the column reads as one block and the top of
 * the world stays open beside it. The DOM measures (src/ui/hud/funke/Funke.tsx); the choices are these pure functions.
 */

/** Widest one-line text [design px] that stays one line in build mode: a short hint breaks into two stubby lines otherwise. */
export const EINZEILIG_BIS_PX = 160;

/**
 * The narrowest whole width [design px] in [`min`, `max`] at which a text has at most `maxZeilen` lines – `zeilen(breite)`
 * counts them (it never grows with the width). `max` when even that needs more (the validator keeps texts within it).
 */
export function schmalsteBreite(zeilen: (breite: number) => number, min: number, max: number, maxZeilen: number): number {
  if (zeilen(max) > maxZeilen) return max;
  let lo = Math.max(1, Math.min(min, max));
  let hi = max;
  while (lo < hi) {
    const mitte = (lo + hi) >> 1;
    if (zeilen(mitte) <= maxZeilen) hi = mitte;
    else lo = mitte + 1;
  }
  return hi;
}

/** A plate's text in build mode: where it starts [design px from the column's left], its narrowest width and its widest. */
export interface SchildMass {
  readonly links: number;
  readonly breite: number;
  readonly max: number;
}

/**
 * The text widths [design px] at which the plates end flush: the right edge of the column is the farther of the two narrow
 * edges, each text reaches it (never beyond its own widest). A missing plate (`null`) keeps none.
 */
export function buendigeBreiten(a: SchildMass | null, b: SchildMass | null): readonly [number | null, number | null] {
  if (a === null || b === null) return [a?.breite ?? null, b?.breite ?? null];
  const rechts = Math.max(a.links + a.breite, b.links + b.breite);
  return [Math.min(a.max, rechts - a.links), Math.min(b.max, rechts - b.links)];
}
