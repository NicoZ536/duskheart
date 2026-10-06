/**
 * The fishing mini-game's HUD model (M7-24; src/ui/hud/angeln/modell.ts; docs/SPIEL.md §30 "Angel-Minispiel (HUD)"): no panel
 * without a line; a line per phase; the gauge from the bite on with its zones (slack below 0.2, taut above 0.8 – the fight's
 * warnings replace the phase line); the catch names the fish in the player's language, a loss says why; the distance in whole
 * metres; a change below a gauge pixel re-renders nothing. Every key exists in DE and EN.
 */
import { describe, expect, it } from 'vitest';
import de from '../../../src/i18n/de.json';
import en from '../../../src/i18n/en.json';
import { createFishingSample } from '../../../src/game/samples/feld';
import type { FishingSample } from '../../../src/game/fishing/types';
import { ANGEL_TEXTE, angelAnsicht, angelZone, gleicheAngelAnsicht, SLACK_WARN, TAUT_WARN } from '../../../src/ui/hud/angeln/modell';

function sample(over: Partial<FishingSample>): FishingSample {
  return Object.assign(createFishingSample(), over);
}

describe('Angel-HUD (Modell)', () => {
  it('ohne Schnur kein Feld; Wurf und Warten zeigen ihre Zeile ohne Messung', () => {
    expect(angelAnsicht(sample({ phase: 'aus' }), 'de')).toBeNull();
    expect(angelAnsicht(sample({ phase: 'wurf' }), 'de')).toMatchObject({ zeile: { key: 'ui.angeln.phase.wurf' }, spannung: null, zone: null, meter: null });
    expect(angelAnsicht(sample({ phase: 'warten', tension: 0.3 }), 'de')).toMatchObject({ zeile: { key: 'ui.angeln.phase.warten' }, spannung: null });
  });

  it('der Biss zeigt die Messung ohne Zone; im Drill warnen locker und straff statt der Phasenzeile', () => {
    expect(angelAnsicht(sample({ phase: 'biss', tension: 0.45 }), 'de')).toMatchObject({ zeile: { key: 'ui.angeln.phase.biss' }, spannung: 0.45, zone: null });
    expect(angelAnsicht(sample({ phase: 'drill', tension: 0.5, distance: 4.4 }), 'de')).toMatchObject({ zeile: { key: 'ui.angeln.phase.drill' }, zone: 'gut', meter: 4 });
    expect(angelAnsicht(sample({ phase: 'drill', tension: 0.1 }), 'de')).toMatchObject({ zeile: { key: 'ui.angeln.locker' }, zone: 'locker' });
    expect(angelAnsicht(sample({ phase: 'drill', tension: 0.95 }), 'de')).toMatchObject({ zeile: { key: 'ui.angeln.straff' }, zone: 'straff' });
    expect(angelAnsicht(sample({ phase: 'drill', tension: 0.95, leaping: true }), 'de')).toMatchObject({ zeile: { key: 'ui.angeln.sprung' }, sprung: true });
    expect(angelAnsicht(sample({ phase: 'drill', tension: 1.4 }), 'de')?.spannung).toBe(1);
    expect(angelAnsicht(sample({ phase: 'drill', tension: 0.5, reeling: true }), 'de')?.einholen).toBe(true);
  });

  it('die Zonen kippen genau an den Warnschwellen', () => {
    expect([angelZone(SLACK_WARN - 0.001), angelZone(SLACK_WARN), angelZone(TAUT_WARN), angelZone(TAUT_WARN + 0.001)]).toEqual(['locker', 'gut', 'gut', 'straff']);
  });

  it('der Fang nennt den Fisch in der Sprache des Spielers; ein Verlust sagt warum', () => {
    expect(angelAnsicht(sample({ phase: 'gefangen', fish: 'forelle' }), 'de')?.zeile).toEqual({ key: 'ui.angeln.gefangen', werte: { fisch: 'Forelle' } });
    expect(angelAnsicht(sample({ phase: 'gefangen', fish: 'forelle' }), 'en')?.zeile).toEqual({ key: 'ui.angeln.gefangen', werte: { fisch: 'Trout' } });
    expect(angelAnsicht(sample({ phase: 'verloren', grund: 'gerissen' }), 'de')?.zeile.key).toBe('ui.angeln.verloren.gerissen');
    expect(angelAnsicht(sample({ phase: 'verloren', grund: 'entkommen' }), 'de')?.zeile.key).toBe('ui.angeln.verloren.entkommen');
    expect(angelAnsicht(sample({ phase: 'verloren', grund: 'verpasst' }), 'de')?.zeile.key).toBe('ui.angeln.verloren.verpasst');
  });

  it('erst eine Änderung um ein Pixel der Messung zeichnet neu', () => {
    const a = angelAnsicht(sample({ phase: 'drill', tension: 0.5 }), 'de');
    expect(gleicheAngelAnsicht(a, angelAnsicht(sample({ phase: 'drill', tension: 0.505 }), 'de'), 60)).toBe(true);
    expect(gleicheAngelAnsicht(a, angelAnsicht(sample({ phase: 'drill', tension: 0.52 }), 'de'), 60)).toBe(false);
    expect(gleicheAngelAnsicht(a, angelAnsicht(sample({ phase: 'drill', tension: 0.5, reeling: true }), 'de'), 60)).toBe(false);
    expect(gleicheAngelAnsicht(null, null, 60)).toBe(true);
    expect(gleicheAngelAnsicht(a, null, 60)).toBe(false);
  });

  it('jeder Text des Felds steht in DE und EN', () => {
    const tables = [de, en] as ReadonlyArray<Record<string, string>>;
    for (const key of ANGEL_TEXTE) for (const t of tables) expect(t[key], key).toBeTruthy();
  });
});
