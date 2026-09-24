/**
 * Fear of the player (MASTERPROMPT §12.3): the value, its stage, the hallucinations around the player and
 * the Nachtmahr's pursuit. Saved by the participant `fear`.
 */
import { z } from 'zod';
import { FEAR_STAGES, type FearStage } from '../../content/balance/fear';

/** Deepest world layer (docs/WORLD.md §1). */
const LAYER_MIN = -3;

/** A hallucination (§12.3 "Trugbilder"): a shape that creeps towards the player out of the dark. */
export interface Hallucination {
  /** Running number (unique within a world). */
  readonly id: number;
  /** Position [world px]. */
  x: number;
  y: number;
  readonly layer: number;
  /** It hurts when it reaches the player (spawned from fear 80). */
  readonly harmful: boolean;
  /** Age [ticks]. */
  ageTicks: number;
}

/** Fear state. */
export interface FearState {
  /** Fear 0–100. */
  value: number;
  stage: FearStage;
  /** The Nachtmahr hunts the player (from fear 100 until glaring light or its defeat). */
  pursued: boolean;
  hallucinations: Hallucination[];
  /** Ticks until the next hallucination may appear. */
  nextHallucinationTicks: number;
  /** Id of the next hallucination. */
  nextHallucinationId: number;
}

/** Fear of a new player. */
export function createFearState(): FearState {
  return { value: 0, stage: 'ruhig', pursued: false, hallucinations: [], nextHallucinationTicks: 0, nextHallucinationId: 1 };
}

const hallucinationSchema = z
  .object({
    id: z.number().int().min(1),
    x: z.number(),
    y: z.number(),
    layer: z.number().int().min(LAYER_MIN).max(0),
    harmful: z.boolean(),
    ageTicks: z.number().int().min(0),
  })
  .strict();

/** Saved fear (participant `fear`, version 1). */
export const fearStateSchema = z
  .object({
    value: z.number().min(0),
    stage: z.enum(FEAR_STAGES),
    pursued: z.boolean(),
    hallucinations: z.array(hallucinationSchema),
    nextHallucinationTicks: z.number().int().min(0),
    nextHallucinationId: z.number().int().min(1),
  })
  .strict();

/** Copy of a fear state (saves must not share the live object). */
export function copyFearState(s: FearState): FearState {
  return { ...s, hallucinations: s.hallucinations.map((h) => ({ ...h })) };
}
