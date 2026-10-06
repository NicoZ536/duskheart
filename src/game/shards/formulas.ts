/**
 * What used shards add (MASTERPROMPT §20.2 "Herzsplitter (+10 max. Leben)", §21 "Glutsplitter (+5 max. Ausdauer)"; docs/SPIEL.md
 * §22 "Splitter"): pure, linear in the count.
 */
import { BALANCE } from '../../content/balance';
import type { ShardKind } from './state';

const S = BALANCE.bosses.shards;

/** Maximum health the used heart shards add [HP]. */
export function shardHealthBonus(hearts: number): number {
  return hearts * S.healthPerHeart;
}

/** Maximum stamina the used ember shards add [points]. */
export function shardStaminaBonus(embers: number): number {
  return embers * S.staminaPerEmber;
}

/** What one shard of kind `kind` adds [HP or stamina points]. */
export function shardGain(kind: ShardKind): number {
  return kind === 'herz' ? S.healthPerHeart : S.staminaPerEmber;
}
