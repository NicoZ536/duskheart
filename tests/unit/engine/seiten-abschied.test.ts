/**
 * Loads the page gives up on its way out (src/engine/pageExit.ts): a fetch that a reload cancels ("Failed to fetch",
 * the debug console's `seed` while the atlas image still loads) is no failure – its report is dropped once the page
 * is being left; a page that stays reports as before, and a page back from the back/forward cache reports again.
 */
import { describe, expect, it, vi } from 'vitest';
import { pageLeaving, reportUnlessLeaving, watchPageExit } from '../../../src/engine/pageExit';

/** One task later (the report waits one). */
const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('Seitenabschied', () => {
  it('ohne Browser: kein Zuhörer, der Bericht kommt einen Task später', async () => {
    expect(typeof (globalThis as { addEventListener?: unknown }).addEventListener).not.toBe('function');
    const reported: string[] = [];
    reportUnlessLeaving(() => reported.push('netz'));
    expect(reported).toEqual([]);
    await nextTask();
    expect(reported).toEqual(['netz']);
  });

  it('beim Verlassen der Seite (pagehide) fällt der Bericht weg; zurück aus dem Cache (pageshow) wird wieder berichtet', async () => {
    const listeners = new Map<string, () => void>();
    vi.stubGlobal('addEventListener', (type: string, listener: () => void) => listeners.set(type, listener));
    watchPageExit();
    expect([...listeners.keys()].sort()).toEqual(['pagehide', 'pageshow']);
    const reported: string[] = [];
    reportUnlessLeaving(() => reported.push('bleibt'));
    await nextTask();
    expect(reported).toEqual(['bleibt']);
    // A reload cancels the fetch: its rejection arrives while the page is being left.
    reportUnlessLeaving(() => reported.push('abgebrochen'));
    listeners.get('pagehide')?.();
    expect(pageLeaving()).toBe(true);
    await nextTask();
    expect(reported).toEqual(['bleibt']);
    listeners.get('pageshow')?.();
    expect(pageLeaving()).toBe(false);
    reportUnlessLeaving(() => reported.push('wieder'));
    await nextTask();
    expect(reported).toEqual(['bleibt', 'wieder']);
  });
});
