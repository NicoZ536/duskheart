/**
 * The creatures of the screenshot scenarios (M6 gate, picture review; MASTERPROMPT §31.5 "deterministisch", docs/SPIEL.md
 * §11): what the creature and combat pictures of this layer share.
 *
 * - The world's own creature stock leaves a picture's subject or its view (`clearCreatures`, `KreaturenFern`,
 *   `STOCK_CLEARING`): src/render/scenes/creatureStock.ts, re-exported here – the water pictures of the render layer, which
 *   may not import src/debug, clear their subject with it as well.
 * - The ground a picture's creatures do not stand on when it asks for the biome's own (`PAVED_GROUND`).
 * - A torch lit for a picture throws the sparks of its ignition; they must have gone out when the picture is taken
 *   (`ignitionSettleTicks`, `settleIgnition`).
 */
import { BALANCE } from '../content/balance';
import { SPARKS } from '../render/game/figureFx';

export {
  clearCreatures,
  creaturesToClear,
  livingCreatures,
  STOCK_CLEARING,
  VIEW_CLEARING_TILES,
  type ClearingSession,
  type CreatureAt,
  type KreaturenFern,
} from '../render/scenes/creatureStock';

/**
 * Ground a picture's creatures do not stand on when it asks for the biome's own ground (`naturalGround`): the grey builder
 * paving (src/content/terrain.ts `strasse`) has the tone of grey fur, of the boar and the badger – they keep only their
 * 1 px outline on it (M6 gate `kreaturen-gruenhain-gegner`, `kampf-tag`).
 */
export const PAVED_GROUND: readonly string[] = ['strasse'];

/**
 * Simulation ticks from the tick a torch is lit to the picture, at least: the sparks of the ignition (`lightIgnited`,
 * src/render/game/figureFx.ts `SPARKS.life`) end once the simulation has run their life past their event's tick plus one
 * tick of slack – the presentation time of a picture stands, only the simulation ends them. One more tick for the event's
 * own tick. A torch lit two or three ticks before the picture stood there as a frozen spark cluster on the chest (M6 gate
 * round 2 `kreaturen-kueste-nacht`, likewise `kreaturen-gruenhain-klein` and `-gegner-nacht`).
 */
export const IGNITION_TICKS = Math.ceil(SPARKS.life * BALANCE.time.tickHz) + 2;

/**
 * Steps a scenario runs right after the tick it lit a torch in, when its picture follows `ticksAfter` ticks later: as many
 * as are missing to `IGNITION_TICKS` (none when the picture comes later anyway – the forming brood, the Nachtmahr).
 */
export function ignitionSettleTicks(ticksAfter: number): number {
  return Math.max(0, IGNITION_TICKS - ticksAfter);
}

/**
 * Steps `session` right after the tick it lit a torch in, as many ticks as the sparks of the ignition still need before a
 * picture `ticksAfter` ticks later (`ignitionSettleTicks`); returns how many.
 */
export function settleIgnition(session: { step(): void }, ticksAfter: number): number {
  const n = ignitionSettleTicks(ticksAfter);
  for (let t = 0; t < n; t++) session.step();
  return n;
}
