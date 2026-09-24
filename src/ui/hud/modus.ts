/**
 * What the HUD shows in which mode (MASTERPROMPT §26 "HUD (Modi: Voll / Kontextuell / Minimal)", setting
 * `game.hudMode`; M3-27). Pure rules, unit-tested (tests/unit/ui/hud-modus.test.ts):
 *
 * - **Voll** (`full`): every display always – the four bars, the thermometer, conditions, hotbar with
 *   off-hand and belt, the interaction hint, minimap and notifications.
 * - **Kontextuell** (`contextual`): a bar shows while its value is not where it rests – health and stamina
 *   below their maximum, satiety and thirst at or below the line where health stops regenerating (§11.1
 *   "Sättigung > 50, Durst > 30") – and for a while after it changed suddenly (eating, a hit, sprinting;
 *   `Aenderungswaechter`); the thermometer while the felt temperature leaves the comfort band, the core
 *   is off 37 °C or moving, or a temperature stage holds. Everything else as in Voll.
 * - **Minimal** (`minimal`): only what warns – a bar in its danger zone (health a third left, stamina a
 *   quarter, hungry, thirsty), the thermometer in a temperature stage, harmful conditions; the hotbar only
 *   for a moment after it changed; no interaction hint (the marker over the target stays) and no minimap.
 * - In every mode: the fear eye from fear 20 (§26 "Furcht-Auge (ab 20)"), the notifications.
 */
import { BALANCE } from '../../content/balance';
import type { ConditionKind } from '../../content/conditions';
import type { TemperatureStage } from '../../content/balance/survival';
import type { FearStage } from '../../content/balance/fear';
import { HUD_MODES } from '../../engine/settings';

/** HUD mode (setting `game.hudMode`). */
export type HudMode = (typeof HUD_MODES)[number];

/** Whether `v` is a HUD mode. */
export function isHudMode(v: unknown): v is HudMode {
  return (HUD_MODES as readonly unknown[]).includes(v);
}

/** The four survival bars of §11.1 in HUD order. */
export const HUD_LEISTEN = ['leben', 'ausdauer', 'saettigung', 'durst'] as const;
export type HudLeiste = (typeof HUD_LEISTEN)[number];

const S = BALANCE.survival;

/** Minimal: health is in danger with a third of its maximum left (the fill reads "almost empty" from there). */
export const MINIMAL_LEBEN_ANTEIL = 1 / 3;
/** Minimal: stamina matters with a quarter left (a roll costs a fifth, §11.1: the last one or two). */
export const MINIMAL_AUSDAUER_ANTEIL = 0.25;
/** Kontextuell: the core counts as "off" 0.2 °C away from 37 °C (two shown decimals, one arrow step). */
export const KERN_ABWEICHUNG_C = 0.2;

/** Whether bar `art` has something to say at `value` of `max` in `modus` (without recent changes). */
export function leisteRelevant(modus: HudMode, art: HudLeiste, value: number, max: number): boolean {
  if (modus === 'full') return true;
  const kontext = modus === 'contextual';
  switch (art) {
    case 'leben':
      return kontext ? value < max : value <= max * MINIMAL_LEBEN_ANTEIL;
    case 'ausdauer':
      return kontext ? value < max : value <= max * MINIMAL_AUSDAUER_ANTEIL;
    case 'saettigung':
      return kontext ? value <= S.health.regenAboveSatiety : value < S.satiety.hungryBelow;
    case 'durst':
      return kontext ? value <= S.health.regenAboveThirst : value < S.thirst.thirstyBelow;
  }
}

/** Whether a sudden change of a bar shows it (Kontextuell only: Minimal shows danger, not change). */
export function aenderungZeigt(modus: HudMode): boolean {
  return modus === 'contextual';
}

/** The temperature reading the thermometer rule needs. */
export interface ThermoLage {
  readonly coreC: number;
  readonly feltC: number;
  readonly bandLowC: number;
  readonly bandHighC: number;
  readonly stage: TemperatureStage;
  /** Trend step (`trendStufe`): 0 = steady. */
  readonly trend: number;
}

/** Whether the thermometer has something to say. */
export function thermometerRelevant(modus: HudMode, t: ThermoLage): boolean {
  if (modus === 'full') return true;
  if (t.stage !== 'normal') return true;
  if (modus === 'minimal') return false;
  return t.feltC < t.bandLowC || t.feltC > t.bandHighC || Math.abs(t.coreC - S.temperature.coreNormalC) >= KERN_ABWEICHUNG_C || t.trend !== 0;
}

/** Whether the fear eye shows (every mode, from fear 20: every stage above `ruhig`). */
export function furchtSichtbar(stage: FearStage): boolean {
  return stage !== 'ruhig';
}

/** Whether a condition of kind `art` shows (Minimal: only drawbacks and dangers). */
export function zustandSichtbar(modus: HudMode, art: ConditionKind): boolean {
  return modus !== 'minimal' || art !== 'gut';
}

/** Whether the hotbar, off-hand and belt stay on screen (Minimal: only for a moment after a change). */
export function leisteImmer(modus: HudMode): boolean {
  return modus !== 'minimal';
}

/** Whether the interaction hint at the bottom shows (Minimal keeps only the marker over the target). */
export function hinweisSichtbar(modus: HudMode): boolean {
  return modus !== 'minimal';
}

/** Whether minimap and compass bar show (Minimal: no). */
export function weltanzeigenSichtbar(modus: HudMode): boolean {
  return modus !== 'minimal';
}
