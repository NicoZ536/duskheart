/**
 * World events (docs/SPIEL.md §18 "Weltereignisse", MASTERPROMPT §10; ADR-0207; strand B, collection `worldEvents` with all 11
 * entries of §10 – the four of M7 implemented, the others with `umgesetzt: { task }`). Planned per game day from
 * `hash(seed, 'weltereignis', id, day)`, announced on every channel (sky and grading, sound, HUD with the time left, Funke,
 * chronicle). The zod schema producing `WorldEventDef` is strand B's.
 */
import type { SeasonId } from '../balance';
import type { LocalizedText } from '../schema/common';
import type { WeatherStateId } from '../weather';

export const WORLD_EVENT_PLANS = ['mond', 'naechtlich', 'taeglich', 'basis', 'wetter'] as const;
export type WorldEventPlan = (typeof WORLD_EVENT_PLANS)[number];
export interface WorldEventDef {
  readonly id: string;
  readonly name: LocalizedText;
  readonly beschreibung: LocalizedText;
  /** Big events exclude each other (Finstermond runs beside them). */
  readonly gross: boolean;
  readonly planung: {
    readonly art: WorldEventPlan;
    /** Chance per candidate day [0–1] (`mond`: on new moon 1). */
    readonly chance: number;
    readonly jahreszeiten?: readonly SeasonId[];
    readonly wetter?: readonly WeatherStateId[];
    readonly biome?: readonly string[];
    readonly tageszeit?: 'tag' | 'nacht';
  };
  readonly dauerMinuten: readonly [number, number];
  readonly ankuendigung: {
    /** Lead time before the start [game minutes]. */
    readonly vorlaufMinuten: number;
    /** HUD line with remaining time (`{minuten}`). */
    readonly hud: LocalizedText;
    /** Funke hint id (`guideHints`). */
    readonly funke: string;
    /** Sound preset of the announcement (or the music stinger `ereignis`). */
    readonly klang?: string;
    /** Sky/grading preset the renderer blends to while announced/active. */
    readonly himmel?: string;
  };
  readonly chronik: LocalizedText;
  readonly umgesetzt: true | { readonly task: string };
}
