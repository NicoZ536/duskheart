/**
 * M3-27: what the HUD shows in which mode (src/ui/hud/modus.ts, MASTERPROMPT §26 "HUD (Modi: Voll /
 * Kontextuell / Minimal)", §11.1 thresholds from the balance, §26 "Furcht-Auge (ab 20)").
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { HUD_MODES } from '../../../src/engine/settings';
import {
  aenderungZeigt,
  furchtSichtbar,
  HUD_LEISTEN,
  hinweisSichtbar,
  isHudMode,
  KERN_ABWEICHUNG_C,
  leisteImmer,
  leisteRelevant,
  MINIMAL_AUSDAUER_ANTEIL,
  MINIMAL_LEBEN_ANTEIL,
  thermometerRelevant,
  weltanzeigenSichtbar,
  zustandSichtbar,
  type ThermoLage,
} from '../../../src/ui/hud/modus';

const S = BALANCE.survival;
const RUHIG: ThermoLage = { coreC: 37, feltC: 22, bandLowC: 18, bandHighC: 26, stage: 'normal', trend: 0 };

describe('HUD-Modi: Leisten', () => {
  it('Voll zeigt jede Leiste bei jedem Wert', () => {
    for (const art of HUD_LEISTEN) {
      expect(leisteRelevant('full', art, 100, 100)).toBe(true);
      expect(leisteRelevant('full', art, 0, 100)).toBe(true);
    }
  });

  it('Kontextuell: Leben und Ausdauer unter dem Maximum, Sättigung und Durst ab der Heilgrenze (§11.1)', () => {
    expect(leisteRelevant('contextual', 'leben', 100, 100)).toBe(false);
    expect(leisteRelevant('contextual', 'leben', 99.9, 100)).toBe(true);
    expect(leisteRelevant('contextual', 'ausdauer', 110, 110)).toBe(false);
    expect(leisteRelevant('contextual', 'ausdauer', 100, 110)).toBe(true);
    expect(leisteRelevant('contextual', 'saettigung', S.health.regenAboveSatiety + 0.1, 100)).toBe(false);
    expect(leisteRelevant('contextual', 'saettigung', S.health.regenAboveSatiety, 100)).toBe(true);
    expect(leisteRelevant('contextual', 'durst', S.health.regenAboveThirst + 0.1, 100)).toBe(false);
    expect(leisteRelevant('contextual', 'durst', S.health.regenAboveThirst, 100)).toBe(true);
  });

  it('Minimal: nur Gefahr – ein Drittel Leben, ein Viertel Ausdauer, hungrig, durstig', () => {
    expect(leisteRelevant('minimal', 'leben', 50, 100)).toBe(false);
    expect(leisteRelevant('minimal', 'leben', 100 * MINIMAL_LEBEN_ANTEIL, 100)).toBe(true);
    expect(leisteRelevant('minimal', 'ausdauer', 30, 100)).toBe(false);
    expect(leisteRelevant('minimal', 'ausdauer', 100 * MINIMAL_AUSDAUER_ANTEIL, 100)).toBe(true);
    expect(leisteRelevant('minimal', 'saettigung', S.satiety.hungryBelow, 100)).toBe(false);
    expect(leisteRelevant('minimal', 'saettigung', S.satiety.hungryBelow - 0.1, 100)).toBe(true);
    expect(leisteRelevant('minimal', 'durst', S.thirst.thirstyBelow, 100)).toBe(false);
    expect(leisteRelevant('minimal', 'durst', S.thirst.thirstyBelow - 0.1, 100)).toBe(true);
  });

  it('plötzliche Änderungen zeigen eine Leiste nur im kontextuellen Modus', () => {
    expect(aenderungZeigt('contextual')).toBe(true);
    expect(aenderungZeigt('full')).toBe(false);
    expect(aenderungZeigt('minimal')).toBe(false);
  });
});

describe('HUD-Modi: Thermometer', () => {
  it('Voll immer; Kontextuell bei Stufe, außerhalb des Bands, Kern abseits von 37 °C oder in Bewegung', () => {
    expect(thermometerRelevant('full', RUHIG)).toBe(true);
    expect(thermometerRelevant('contextual', RUHIG)).toBe(false);
    expect(thermometerRelevant('contextual', { ...RUHIG, feltC: 17.9 })).toBe(true);
    expect(thermometerRelevant('contextual', { ...RUHIG, feltC: 26.1 })).toBe(true);
    expect(thermometerRelevant('contextual', { ...RUHIG, coreC: 37 - KERN_ABWEICHUNG_C - 0.01 })).toBe(true);
    expect(thermometerRelevant('contextual', { ...RUHIG, coreC: 37 - KERN_ABWEICHUNG_C / 2 })).toBe(false);
    expect(thermometerRelevant('contextual', { ...RUHIG, trend: -1 })).toBe(true);
    expect(thermometerRelevant('contextual', { ...RUHIG, stage: 'erhitzt' })).toBe(true);
  });

  it('Minimal nur in einer Temperaturstufe', () => {
    expect(thermometerRelevant('minimal', { ...RUHIG, feltC: 5, trend: -2 })).toBe(false);
    for (const stage of ['erfrierend', 'unterkuehlt', 'frierend', 'erhitzt', 'ueberhitzt', 'hitzschlag'] as const) expect(thermometerRelevant('minimal', { ...RUHIG, stage })).toBe(true);
  });
});

describe('HUD-Modi: übrige Anzeigen', () => {
  it('Furcht-Auge ab 20 (jede Stufe über „ruhig“) in jedem Modus', () => {
    expect(furchtSichtbar('ruhig')).toBe(false);
    for (const s of ['unruhig', 'fluestern', 'trugbilder', 'bedrohlich', 'nachtmahr'] as const) expect(furchtSichtbar(s)).toBe(true);
    expect(BALANCE.fear.stages.eyeFrom).toBe(20);
  });

  it('Minimal zeigt nur schädliche Zustände, keine Schnellleiste auf Dauer, keinen Hinweis, keine Karte', () => {
    expect(zustandSichtbar('minimal', 'gut')).toBe(false);
    expect(zustandSichtbar('minimal', 'schlecht')).toBe(true);
    expect(zustandSichtbar('minimal', 'kritisch')).toBe(true);
    expect(zustandSichtbar('contextual', 'gut')).toBe(true);
    expect(leisteImmer('minimal')).toBe(false);
    expect(hinweisSichtbar('minimal')).toBe(false);
    expect(weltanzeigenSichtbar('minimal')).toBe(false);
    for (const m of ['full', 'contextual'] as const) {
      expect(leisteImmer(m)).toBe(true);
      expect(hinweisSichtbar(m)).toBe(true);
      expect(weltanzeigenSichtbar(m)).toBe(true);
    }
  });

  it('kennt genau die Modi der Einstellung game.hudMode', () => {
    for (const m of HUD_MODES) expect(isHudMode(m)).toBe(true);
    expect(isHudMode('voll')).toBe(false);
  });
});
