/**
 * Loads the page gives up on its way out (DOM adapter, browser only; docs/ARCHITEKTUR.md "Schichten"): a navigation or
 * reload – the debug console's `seed` reloads the page with the new seed – cancels the fetches of the page it leaves,
 * and their promises reject with "Failed to fetch". That is no failure of the game: a loader reports its error through
 * `reportUnlessLeaving`, which lets the report wait one task and drops it once the page is being left (`pagehide`) –
 * an unloaded page runs no more tasks at all. A page that stays (a real network error) reports as before.
 */

let leaving = false;
let watching = false;

/** Starts watching the page's `pagehide`/`pageshow` (idempotent; a no-op outside a browser). */
export function watchPageExit(): void {
  if (watching || typeof addEventListener !== 'function') return;
  watching = true;
  addEventListener('pagehide', () => {
    leaving = true;
  });
  // Back from the back/forward cache: the page lives again.
  addEventListener('pageshow', () => {
    leaving = false;
  });
}

/** Whether the page is being left (`pagehide` seen, no `pageshow` since). */
export function pageLeaving(): boolean {
  return leaving;
}

/** Runs `report` in the next task unless the page is being left by then (see the module comment). */
export function reportUnlessLeaving(report: () => void): void {
  watchPageExit();
  setTimeout(() => {
    if (!leaving) report();
  }, 0);
}
