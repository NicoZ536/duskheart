/**
 * The fishing mini-game's model in the HUD (MASTERPROMPT §14 "Minispiel (Spannung halten, Fisch zieht, Rute biegt sich)";
 * docs/SPIEL.md §30 "Angel-Minispiel (HUD) – fishCast – sampleFishing – D (ui.angeln.*)"; M7-24): what the panel beside the
 * figure shows while the line is out – a line of text per phase (casting, waiting, the bite, the fight, the catch or the
 * loss and why), and from the bite on the tension gauge with its two danger zones (slack: the fish shakes the hook off at 0;
 * taut: the line snaps at 1), whether the reel is held, how far out the fish still is and whether it leaps. Pure: the
 * component (AngelHud.tsx) feeds it the session's held sample; texts are i18n keys with their values (translated there).
 */
import { CONTENT } from '../../../content/index';
import type { FishingPhase, FishingSample } from '../../../game/fishing/types';
import type { Lang } from '../../../i18n';

/**
 * Where the gauge warns [tension 0–1]: below `SLACK_WARN` the fish is about to shake the hook off, above `TAUT_WARN` the line
 * is about to snap. The simulation's tuning keeps a fight below ~0.7 safe (src/content/balance/fishing.ts `fight`): the
 * taut warning starts above that, the slack one a little above the start of an unanswered fight's fall.
 */
export const SLACK_WARN = 0.2;
export const TAUT_WARN = 0.8;

/** Zone of the tension on the gauge. */
export type AngelZone = 'locker' | 'gut' | 'straff';

/** A text of the panel: i18n key and its values. */
export interface AngelText {
  readonly key: string;
  readonly werte?: Readonly<Record<string, string | number>>;
}

/** What the HUD shows of the line. */
export interface AngelAnsicht {
  readonly phase: Exclude<FishingPhase, 'aus'>;
  readonly zeile: AngelText;
  /** Tension 0–1 and its zone from the bite until the fight ends, else null (no gauge). */
  readonly spannung: number | null;
  readonly zone: AngelZone | null;
  /** The reel is held. */
  readonly einholen: boolean;
  /** How far out the hooked fish still is [whole tiles = metres], in the fight; else null. */
  readonly meter: number | null;
  /** The hooked fish is in the air. */
  readonly sprung: boolean;
}

/** Text key of each way a fish gets away (`FishingSample.grund`). */
const VERLOREN: Readonly<Record<string, string>> = { gerissen: 'ui.angeln.verloren.gerissen', entkommen: 'ui.angeln.verloren.entkommen', verpasst: 'ui.angeln.verloren.verpasst' };

/** The zone of `tension`. */
export function angelZone(tension: number): AngelZone {
  if (tension < SLACK_WARN) return 'locker';
  if (tension > TAUT_WARN) return 'straff';
  return 'gut';
}

/** The fish's name in `lang` (its raw item), or its id. */
function fischName(id: string, lang: Lang): string {
  const item = CONTENT.collection('items').find(id) as { readonly name?: Readonly<Record<Lang, string>> } | undefined;
  return item?.name?.[lang] ?? id;
}

/** The view of `s` in `lang`, or null while no line is out. */
export function angelAnsicht(s: Readonly<FishingSample>, lang: Lang): AngelAnsicht | null {
  const phase = s.phase;
  if (phase === 'aus') return null;
  const fight = phase === 'drill';
  const gauge = fight || phase === 'biss';
  const tension = Math.max(0, Math.min(1, s.tension));
  const zone = fight ? angelZone(tension) : null;
  let zeile: AngelText;
  if (phase === 'wurf') zeile = { key: 'ui.angeln.phase.wurf' };
  else if (phase === 'warten') zeile = { key: 'ui.angeln.phase.warten' };
  else if (phase === 'biss') zeile = { key: 'ui.angeln.phase.biss' };
  else if (phase === 'gefangen') zeile = { key: 'ui.angeln.gefangen', werte: { fisch: fischName(s.fish, lang) } };
  else if (phase === 'verloren') zeile = { key: VERLOREN[s.grund] ?? 'ui.angeln.verloren.entkommen' };
  else if (s.leaping) zeile = { key: 'ui.angeln.sprung' };
  else if (zone === 'locker') zeile = { key: 'ui.angeln.locker' };
  else if (zone === 'straff') zeile = { key: 'ui.angeln.straff' };
  else zeile = { key: 'ui.angeln.phase.drill' };
  return {
    phase,
    zeile,
    spannung: gauge ? tension : null,
    zone,
    einholen: s.reeling,
    meter: fight ? Math.max(0, Math.round(s.distance)) : null,
    sprung: fight && s.leaping,
  };
}

/** Whether two views show the same (the component re-renders only on a change; the gauge moves by whole design px). */
export function gleicheAngelAnsicht(a: AngelAnsicht | null, b: AngelAnsicht | null, gaugePx: number): boolean {
  if (a === null || b === null) return a === b;
  const px = (v: number | null): number => (v === null ? -1 : Math.round(v * gaugePx));
  return (
    a.phase === b.phase &&
    a.zeile.key === b.zeile.key &&
    a.zeile.werte?.fisch === b.zeile.werte?.fisch &&
    px(a.spannung) === px(b.spannung) &&
    a.zone === b.zone &&
    a.einholen === b.einholen &&
    a.meter === b.meter &&
    a.sprung === b.sprung
  );
}

/** Every text key the panel may show (the i18n test checks DE and EN). */
export const ANGEL_TEXTE: readonly string[] = [
  'ui.angeln.titel',
  'ui.angeln.phase.wurf',
  'ui.angeln.phase.warten',
  'ui.angeln.phase.biss',
  'ui.angeln.phase.drill',
  'ui.angeln.locker',
  'ui.angeln.straff',
  'ui.angeln.sprung',
  'ui.angeln.gefangen',
  'ui.angeln.verloren.gerissen',
  'ui.angeln.verloren.entkommen',
  'ui.angeln.verloren.verpasst',
  'ui.angeln.spannung',
  'ui.angeln.abstand',
  'ui.angeln.hilfe.einholen',
  'ui.angeln.hilfe.nachgeben',
];
