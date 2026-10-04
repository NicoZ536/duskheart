/**
 * The player's appearance (docs/SPIEL.md §26, MASTERPROMPT §4.5; ADR-0175; strand I – collections `bodyShapes`,
 * `hairstyles`, no §C count): three body shapes (`mittel` = today's sprites `spieler_<teil>`) and twelve hairstyles as head
 * layers. The zod schemas producing these types are strand I's.
 */
import type { LocalizedText } from '../schema/common';

export const BODY_SHAPES = ['schmal', 'mittel', 'kraeftig'] as const;
export type BodyShape = (typeof BODY_SHAPES)[number];
export interface BodyShapeDef {
  readonly id: BodyShape;
  readonly name: LocalizedText;
  /** Sprite prefix: `spieler` (mittel), `spieler_schmal`, `spieler_kraeftig`. */
  readonly sprite: string;
}
export interface HairstyleDef {
  readonly id: string;
  readonly name: LocalizedText;
  readonly sprite: string;
  readonly unterHelm: 'verdeckt' | 'maske';
}
