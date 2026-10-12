/**
 * A time limit on a promise (M7-120): `npm run bench -- --nur render` once stood for 25 minutes after its last measurement –
 * closing the browser session (Chromium with SwiftShader, the dev server) never came back. The tools give such a close
 * `CLOSE_TIMEOUT_MS`; after that they go on (the report is written, the process exits) and say what they were waiting for.
 * Pure, so it is tested without a browser (tests/unit/tools/zeitlimit.test.ts).
 */

/** How long a tool waits for the browser and its dev server to close before it goes on [ms]. */
export const CLOSE_TIMEOUT_MS = 30_000;

/** Whether `promise` settled within `ms` (`true`), or the wait was given up (`false`); a rejection within the limit rethrows. */
export async function mitZeitlimit(promise: Promise<unknown>, ms: number, was: string, melden: (text: string) => void = (text) => console.warn(text)): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const limit = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    const result = await Promise.race([promise.then(() => true as const), limit]);
    if (!result) melden(`${was}: nach ${(ms / 1000).toFixed(0)} s nicht beendet – weiter ohne zu warten`);
    return result;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
