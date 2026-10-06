/**
 * The mechanics register (docs/SPIEL.md §23 "Vermittlungs-Register", MASTERPROMPT §2.2; M7-45; ADR-0207): every mechanic
 * of §11–§25 is taught three ways – a hint (an onboarding step `aufgabe:<quest>/<schritt>` or a Funke/context hint of
 * `guideHints`), a knowledge entry (`knowledge`) and a tooltip (an i18n key or a content record). The validator rule
 * `vermittlung` (strand G) fails on a missing piece; every later mechanic adds itself in its own file
 * `src/content/vermittlung/<bereich>.ts` when it is built.
 */
import { z } from 'zod';
import { idSchema } from '../schema/common';

export interface MechanicDef {
  /** `mech_<bereich>_<name>`. */
  readonly id: string;
  /** MASTERPROMPT paragraph (`§17`). */
  readonly paragraph: string;
  readonly task: string;
  /** Guide hint id or onboarding step `aufgabe:<quest>/<schritt>`. */
  readonly hinweis: string;
  /** Knowledge entry id. */
  readonly wissen: string;
  readonly tooltip: { readonly art: 'i18n'; readonly schluessel: string } | { readonly art: 'content'; readonly sammlung: string; readonly id: string };
}

/** `mech_<bereich>_<name>`. */
export const MECHANIC_ID_PATTERN = /^mech_[a-z0-9]+_[a-z0-9]+(?:_[a-z0-9]+)*$/;
/** A paragraph of the MASTERPROMPT (`§17`, `§20.2`). */
export const PARAGRAPH_PATTERN = /^§[0-9]+(?:\.[0-9]+)?$/;
/** A task id of PROGRESS.md (`M7-45`, `M6-30c`). */
export const TASK_ID_PATTERN = /^M[0-9]+-[0-9]+[a-z]?$/;
/** A hint: a guide hint id, or the onboarding step `aufgabe:<quest>/<schritt>`. */
export const MECHANIC_HINT_PATTERN = /^(?:[a-z][a-z0-9]*(?:_[a-z0-9]+)*|aufgabe:[a-z][a-z0-9]*(?:_[a-z0-9]+)*\/[a-z][a-z0-9]*(?:_[a-z0-9]+)*)$/;
/** i18n keys (`ui.item.frische`). */
const I18N_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+)+$/;
/** Collection names (`items`, `statusEffects`). */
const COLLECTION_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

export const mechanicSchema = z
  .object({
    id: idSchema.regex(MECHANIC_ID_PATTERN, { message: 'mechanic ids look like mech_<bereich>_<name>' }),
    paragraph: z.string().regex(PARAGRAPH_PATTERN, { message: 'paragraph like §17 or §20.2' }),
    task: z.string().regex(TASK_ID_PATTERN, { message: 'task like M7-45' }),
    hinweis: z.string().regex(MECHANIC_HINT_PATTERN, { message: 'hint: a guide hint id or aufgabe:<quest>/<schritt>' }),
    wissen: idSchema,
    tooltip: z.discriminatedUnion('art', [
      z.object({ art: z.literal('i18n'), schluessel: z.string().regex(I18N_KEY_PATTERN) }).strict(),
      z.object({ art: z.literal('content'), sammlung: z.string().regex(COLLECTION_PATTERN), id: idSchema }).strict(),
    ]),
  })
  .strict() satisfies z.ZodType<MechanicDef>;
/** One mechanic as written in the content files. */
export type MechanicInput = z.input<typeof mechanicSchema>;
