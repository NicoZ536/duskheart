/**
 * Balance values of Funke and the context hints (MASTERPROMPT §8 "Funke … höchstens 2 Zeilen pro Einwurf, nie aufdringlich,
 * abschaltbar", §23.3 "Funke kommentiert sparsam", §26 "Benachrichtigungen … nie mehr als 4 gleichzeitig"; docs/SPIEL.md §23
 * "Funke"; M7-43, M7-44) – group `BALANCE.guide` (src/content/balance.ts re-exports it). Every value states its unit and the
 * reason for it. Seconds are simulated seconds (ticks / 60): the guide never speaks while the game is paused.
 */

export const GUIDE_BALANCE = {
  /**
   * Least time between two Funke comments [s]. "Nie aufdringlich": a minute and a half lets a comment sink in and the player
   * act on it – the first hour (about 35 one-time comments of all strands) then hears one every few minutes at most.
   */
  funkeMinSeconds: 90,
  /**
   * Least time after a Funke comment before a priority-3 comment (danger, a world event announced) may follow [s]. A warning
   * comes in time even right after a chatty remark, but never cuts one off before it was read (≈ 2 lines at 4 words/s).
   */
  funkeUrgentSeconds: 12,
  /** How long a Funke comment shows [s]: two lines of about 12 words at a calm reading pace (≈ 3 words/s) plus a glance. */
  funkeShowSeconds: 8,
  /** Least time between two context hints on the hint line [s]: a hint stays and is followed, not chased by the next one. */
  hintMinSeconds: 20,
  /** How long a context hint shows [s]: one line of the hint row, like the interaction hint's notifications (§26). */
  hintShowSeconds: 7,
  /** How long one line of a Funke dialog shows [s] (a quest step's dialog speaks line by line on the Funke channel). */
  dialogLineSeconds: 6,
  /**
   * Comments and hints waiting at once per channel [entries]. §26 "nie mehr als 4 gleichzeitig": what waits beyond that
   * (the lowest priority, then the oldest) is dropped and re-armed – it may speak later when its moment comes again.
   */
  queueMax: 4,
  /** Lines of the Funke box [lines]. §8 "höchstens 2 Zeilen pro Einwurf" (validator rule `funke` measures every text). */
  funkeMaxLines: 2,
  /**
   * Width of the Funke box's text [design px]: about 50 characters of the pixel font per line (≈ 5 px each), so two lines hold
   * a short sentence or two. The box stands under the values at the HUD's left edge with the lantern (24 px) beside the text:
   * 2–288 px, clear of the minimap even at the narrowest HUD of 480 px (minimap from x ≈ 400).
   */
  funkeTextWidthPx: 256,
};
