/**
 * World events (docs/SPIEL.md §18 "Weltereignisse", MASTERPROMPT §10; ADR-0207; strand B, collection `worldEvents` with all 11
 * entries of §10 – the four of M7 implemented, the others with `umgesetzt: { task }`). Planned per game day from
 * `hash(seed, 'weltereignis', id, day)`, announced on every channel (sky and grading, sound, HUD with the time left, Funke,
 * chronicle). The zod schema producing `WorldEventDef` is strand B's.
 */
import { z } from 'zod';
import { SEASON_IDS, type SeasonId } from '../balance';
import { idSchema, localizedTextSchema, type LocalizedText } from '../schema/common';
import { weatherStateIdSchema, type WeatherStateId } from '../weather';

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

/** Task ids of PROGRESS.md (`M8-37`, `M9-23`). */
const TASK_ID = /^M[0-9]+-[0-9]+[a-z]?$/;
/** Game minutes of a day. */
const MINUTES_PER_DAY = 24 * 60;

export const worldEventSchema = z
  .object({
    id: idSchema,
    name: localizedTextSchema,
    beschreibung: localizedTextSchema,
    gross: z.boolean(),
    planung: z
      .object({
        art: z.enum(WORLD_EVENT_PLANS),
        chance: z.number().min(0).max(1),
        jahreszeiten: z.array(z.enum(SEASON_IDS)).min(1).optional(),
        wetter: z.array(weatherStateIdSchema).min(1).optional(),
        biome: z.array(idSchema).min(1).optional(),
        tageszeit: z.enum(['tag', 'nacht']).optional(),
      })
      .strict(),
    dauerMinuten: z.tuple([z.number().int().positive(), z.number().int().positive()]),
    ankuendigung: z
      .object({
        vorlaufMinuten: z.number().int().min(0).max(MINUTES_PER_DAY),
        hud: localizedTextSchema,
        funke: idSchema,
        klang: idSchema.optional(),
        himmel: idSchema.optional(),
      })
      .strict(),
    chronik: localizedTextSchema,
    umgesetzt: z.union([z.literal(true), z.object({ task: z.string().regex(TASK_ID, { message: 'task id like M8-37' }) }).strict()]),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.dauerMinuten[0] > e.dauerMinuten[1]) ctx.addIssue({ code: 'custom', path: ['dauerMinuten'], message: 'shortest duration after the longest' });
    if (e.dauerMinuten[1] > MINUTES_PER_DAY) ctx.addIssue({ code: 'custom', path: ['dauerMinuten'], message: 'an event lasts at most a day' });
    for (const lang of ['de', 'en'] as const) {
      if (!e.ankuendigung.hud[lang].includes('{minuten}')) ctx.addIssue({ code: 'custom', path: ['ankuendigung', 'hud', lang], message: 'the HUD line names the time left as {minuten}' });
    }
  }) satisfies z.ZodType<WorldEventDef>;
/** One world event as written in the content files. */
export type WorldEventInput = z.input<typeof worldEventSchema>;
