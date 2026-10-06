/**
 * Events of the shards (aggregated into `SimEventMap`; docs/SPIEL.md §17): `shardUsed {art, gesamt}` – a heart or ember shard
 * went into the player for good (`gesamt`: shards of that kind used in this world). The UI shows the new maximum, the
 * chronicle and statistics count it (strand G).
 */
import type { ShardKind } from './state';

export interface ShardEventMap {
  shardUsed: { readonly art: ShardKind; readonly gesamt: number; readonly item: string; readonly tick: number };
}

/** Event names of `ShardEventMap`. */
export const SHARD_EVENT_TYPES = ['shardUsed'] as const satisfies ReadonlyArray<keyof ShardEventMap>;
