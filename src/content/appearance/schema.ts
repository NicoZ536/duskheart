/**
 * Aussehen der Spielfigur (MASTERPROMPT §26 „Charaktererstellung (Name, Körperform, Haut-/Haarpaletten, Kleidungsfarben)“;
 * docs/SPIEL.md §26 „Aussehen“, M7-52 … M7-54) – Sammlungen `bodyShapes`, `hairstyles` (§29) und die Paletten (keine Sammlung).
 *
 * - **Körperform:** `schmal`, `mittel` (die Figur bis M6), `kraeftig` – je Form ein eigener Grundkörper mit allen Clips
 *   (`spieler_basis` bzw. `spieler_<form>_basis`, assets-src/sprites/figuren/spieler_formen.ts).
 * - **Frisur:** zwölf Kopf-Layer `frisur_<id>` (assets-src/sprites/frisuren/frisuren.ts); `scheitel` ist die Frisur bis M6.
 * - **Paletten:** Palettenzeilen gleichen Namens (assets-src/paletteRows.ts `AUSSEHEN_ZEILEN`): `haut_*` färben die Haut
 *   (Rampe `haut`), `haar_*` die Haare (Rampe `holz` des Haar-Layers), `kleid_*` Oberteil bzw. Hose (Rampe `wasser`). Die
 *   erste Palette jeder Art zeigt die Figur wie gezeichnet.
 * Namen DE/EN (Auswahl der Charaktererstellung). Der Validator (tools/validator/aussehen.ts) zählt 12 Frisuren und prüft
 * Sprites und Palettenzeilen; die Sammlungen zählen nicht zu §C.
 */
import { z } from 'zod';
import { idSchema, localizedTextSchema, type LocalizedText } from '../schema/common';

/** Die Körperformen in der Reihenfolge der Auswahl. */
export const BODY_SHAPE_IDS = ['schmal', 'mittel', 'kraeftig'] as const;
/** Eine Körperform. */
export type BodyShapeId = (typeof BODY_SHAPE_IDS)[number];

/** Arten der Aussehens-Paletten: Haut, Haar, Kleidung (Oberteil und Hose wählen je eine `kleid`-Palette). */
export const APPEARANCE_PALETTE_KINDS = ['haut', 'haar', 'kleid'] as const;
export type AppearancePaletteKind = (typeof APPEARANCE_PALETTE_KINDS)[number];

/** Zahl der Paletten je Art (docs/SPIEL.md §26: `haut_1…6`, `haar_1…8`, `kleid_1…8`). */
export const APPEARANCE_PALETTE_COUNTS: Readonly<Record<AppearancePaletteKind, number>> = { haut: 6, haar: 8, kleid: 8 };
/** Zahl der Frisuren (MASTERPROMPT §26 „12 Frisuren“). */
export const HAIRSTYLE_COUNT = 12;

export interface BodyShapeDef {
  readonly id: BodyShapeId;
  readonly name: LocalizedText;
}

export interface HairstyleDef {
  /** Name der Frisur; das Sprite ist `frisur_<id>`. */
  readonly id: string;
  readonly name: LocalizedText;
}

export interface AppearancePaletteDef {
  /** `<art>_<n>` = Id der Palettenzeile. */
  readonly id: string;
  readonly art: AppearancePaletteKind;
  readonly name: LocalizedText;
}

export const bodyShapeSchema = z.object({ id: z.enum(BODY_SHAPE_IDS), name: localizedTextSchema }).strict() satisfies z.ZodType<BodyShapeDef>;

export const hairstyleSchema = z.object({ id: idSchema, name: localizedTextSchema }).strict() satisfies z.ZodType<HairstyleDef>;

export const appearancePaletteSchema = z
  .object({ id: idSchema, art: z.enum(APPEARANCE_PALETTE_KINDS), name: localizedTextSchema })
  .strict()
  .refine((p) => new RegExp(`^${p.art}_[1-9]$`).test(p.id), { message: 'Paletten heißen <art>_<n>' }) satisfies z.ZodType<AppearancePaletteDef>;
