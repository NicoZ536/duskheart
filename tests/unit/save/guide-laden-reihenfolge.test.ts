/**
 * Hinweise nach dem Laden bitgleich (M7-105; docs/SPIEL.md §28 „Determinismus“, §23 „Funke“): eine laufende Welt hält ihre
 * wartenden Hinweise in der Reihenfolge, in der sie (wieder) zu warten begannen – ein Hinweis, der bei abgeschaltetem Kanal hielt,
 * wartet danach hinten. Eine geladene Welt baute sie in Inhaltsreihenfolge neu auf: hielten zwei Hinweise gleichen Rangs im selben
 * Schritt, kam in der geladenen Kopie der andere zuerst an die Reihe – `hinweis_zerlegen` stand nur in der Kopie an,
 * `hinweis_schnellreise` fiel dort weg (strand E, ältere Fixture-Zeitlinie). Jetzt warten Hinweise auf dem Brett stets in
 * Inhaltsreihenfolge (`Armed.rank`): Speichern → Laden → dieselben Hinweise und derselbe `hashState` in jedem Tick über die
 * Zeitlinie (gespeichert an ausgewählten Ticks; an jedem ihrer Ticks: tests/integration/guide-laden-sweep.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import { lauf, LINE, SCHNELLREISE, ZERLEGEN } from './guide-zeitlinie';

describe('Hinweise nach dem Laden bitgleich (M7-105)', () => {
  it('die Zeitlinie spricht beide Hinweise; der wieder wartende steht im Inhalt vor dem anderen', () => {
    const order = CONTENT.collection('guideHints').ids();
    expect(order.indexOf(SCHNELLREISE)).toBeLessThan(order.indexOf(ZERLEGEN));
    for (const id of [SCHNELLREISE, ZERLEGEN]) expect(CONTENT.collection('guideHints').get(id)).toMatchObject({ kanal: 'hinweis', prioritaet: 1, einmalig: true });
    const { said } = lauf(-1);
    const hints = said.map((s) => s.split(':')[1]);
    expect(hints).toContain(ZERLEGEN);
    expect(hints).toContain(SCHNELLREISE);
  });

  it('gespeichert und geladen nach jedem Tick der Zeitlinie: dieselben Hinweise und derselbe hashState in jedem Tick', () => {
    const ref = lauf(-1);
    // Before the re-arming, while the hint waits again behind the others, in the step both hold, after it (the sweep over every
    // tick of the timeline is tests/integration/guide-laden-sweep.test.ts).
    for (const at of [10, 60, 149, 150, 151, 600]) {
      const run = lauf(at);
      for (let t = at + 1; t < LINE; t++) {
        expect(run.guides[t], `geladen nach ${at}, Tick ${t}`).toBe(ref.guides[t]);
        expect(run.hashes[t], `geladen nach ${at}, Tick ${t}`).toBe(ref.hashes[t]);
      }
      expect(run.said, `geladen nach ${at}`).toEqual(ref.said);
    }
  });
});
