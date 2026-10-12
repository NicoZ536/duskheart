/**
 * Hinweise nach dem Laden bitgleich – Sweep (M7-105; docs/SPIEL.md §28 „Determinismus“): die Zeitlinie von
 * tests/unit/save/guide-zeitlinie.ts (ein Hinweis wartet bei abgeschaltetem Kanal erneut, dann halten zwei gleichrangige im selben
 * Schritt) wird nach jedem Tick bis über den Schritt hinaus, in dem beide halten, gespeichert und geladen, danach jede Sekunde:
 * jede geladene Kopie hat in jedem folgenden Tick denselben Zustand der Führung, denselben `hashState` und spricht dieselben
 * Hinweise wie der ununterbrochene Lauf. Läuft in `verify` (npm run test:integration), nicht in `check`.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/content/balance';
import { lauf, LINE } from '../unit/save/guide-zeitlinie';

/** Save points: every tick to a little past the step both hints hold in (151), then every second to the end. */
function savePoints(): number[] {
  const out: number[] = [];
  for (let t = 0; t <= 200; t++) out.push(t);
  for (let t = 200 + BALANCE.time.tickHz; t < LINE - 1; t += BALANCE.time.tickHz) out.push(t);
  return out;
}

describe('Hinweise nach dem Laden bitgleich (M7-105, Sweep)', () => {
  it(
    'gespeichert und geladen nach jedem Tick: Führung, hashState und gesprochene Hinweise wie ohne Laden',
    () => {
      const ref = lauf(-1);
      for (const at of savePoints()) {
        const run = lauf(at);
        for (let t = at + 1; t < LINE; t++) {
          if (run.guides[t] !== ref.guides[t]) expect(run.guides[t], `geladen nach ${at}, Tick ${t}`).toBe(ref.guides[t]);
          if (run.hashes[t] !== ref.hashes[t]) expect(run.hashes[t], `geladen nach ${at}, Tick ${t}`).toBe(ref.hashes[t]);
        }
        expect(run.said, `geladen nach ${at}`).toEqual(ref.said);
      }
    },
    600_000,
  );
});
