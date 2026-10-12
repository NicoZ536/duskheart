/**
 * M7-120: the tools' time limit on closing their browser session (tools/lib/zeitlimit.ts). A close that ends in time
 * passes; one that never ends is given up after the limit with a message, so `npm run bench` and `npm run shot` end after
 * their measurements; a close that fails rethrows.
 */
import { describe, expect, it } from 'vitest';
import { CLOSE_TIMEOUT_MS, mitZeitlimit } from '../../../tools/lib/zeitlimit';

describe('Zeitlimit beim Schließen der Browser-Sitzung (M7-120)', () => {
  it('ein Schließen in der Zeit gilt als beendet, ohne Meldung', async () => {
    const meldungen: string[] = [];
    expect(await mitZeitlimit(Promise.resolve(), 1000, 'Browser schließen', (t) => meldungen.push(t))).toBe(true);
    expect(meldungen).toEqual([]);
  });

  it('ein Schließen, das nicht zurückkommt, wird nach dem Limit aufgegeben und gemeldet', async () => {
    const meldungen: string[] = [];
    const never = new Promise<void>(() => undefined);
    const t0 = performance.now();
    expect(await mitZeitlimit(never, 30, 'Browser schließen', (t) => meldungen.push(t))).toBe(false);
    expect(performance.now() - t0).toBeGreaterThanOrEqual(25);
    expect(meldungen).toHaveLength(1);
    expect(meldungen[0]).toMatch(/Browser schließen.*nicht beendet/);
  });

  it('ein Fehler beim Schließen wird weitergereicht; das Limit der Werkzeuge ist eine halbe Minute', async () => {
    await expect(mitZeitlimit(Promise.reject(new Error('kaputt')), 1000, 'x', () => undefined)).rejects.toThrow('kaputt');
    expect(CLOSE_TIMEOUT_MS).toBe(30_000);
  });
});
