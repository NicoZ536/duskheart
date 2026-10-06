/**
 * Saved state of the shards (participant `shards`, version 1; docs/SPIEL.md §27 "benutzte Herz- und Glutsplitter"): how many of
 * each kind went into the player. A save without the participant (versions 1–3) loads with none.
 */
import { z } from 'zod';

/** The two kinds (`splitter.art`, src/content/schema/itemBlocks.ts). */
export const SHARD_KINDS = ['herz', 'glut'] as const;
/** One kind of shard. */
export type ShardKind = (typeof SHARD_KINDS)[number];

/** The saved form. */
export const shardsSnapshotSchema = z.object({ herz: z.number().int().min(0), glut: z.number().int().min(0) }).strict();
/** The saved form of the shards. */
export type ShardsSnapshot = z.output<typeof shardsSnapshotSchema>;
