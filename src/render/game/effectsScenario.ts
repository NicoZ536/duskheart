/**
 * Choreography of the screenshot scenario `sammeln-feedback` (M3-15; MASTERPROMPT §14 "Feedback: Partikel
 * je Material, materialspezifische Treffersounds, fliegende Drops mit Magnet, Fortschrittsanzeige bei großen
 * Objekten", §31.5): in the world of the boot session (seed 20260923, Mittel) the player stands west of a
 * lone birch near the start beach with a stone axe in the hand, fells it with five blows – the birch falls
 * east, away from the player – and starts to clear the stump. The picture is taken the moment the trunk has
 * landed: logs, twigs, bark and leaves fly out of it on their arcs, dust rises, leaves tumble, and over the
 * stump the progress ring stands at half after the first of its two blows, splinters flying from the blow.
 *
 * The spot is checked against the generated world and the script run headless in
 * tests/unit/game/werkzeuge.test.ts (every event at its tick); the scenario itself is registered in
 * src/debug/scenarios.ts and steps the simulation in time with the frozen presentation clock.
 */
import type { GameCommand } from '../../game/commands';
import { TILE_PX } from '../../world/model/coords';

/** Name of the scenario. */
export const FEEDBACK_SCENARIO = 'sammeln-feedback';

/** The pine and the tile west of it where the player stands (boot world, 12 tiles from the start beach, open dunes around). */
export const FEEDBACK_SPOT = { tree: 'baum_kiefer', tx: 440, ty: 1410, standTx: 439, standTy: 1410 } as const;

/** The tool in the hand. */
export const FEEDBACK_TOOL = 'steinaxt';

/** Hour of the picture (bright late morning). */
const FEEDBACK_HOUR = 11;

/** Commands of the one setup tick: the player, the time of day, the axe, the place. */
export function feedbackSetup(): GameCommand[] {
  return [
    { type: 'player.spawn' },
    { type: 'setTime', hour: FEEDBACK_HOUR, minute: 0 },
    { type: 'inventory.give', item: FEEDBACK_TOOL, count: 1 },
    { type: 'player.teleport', x: FEEDBACK_SPOT.standTx * TILE_PX + TILE_PX / 2, y: FEEDBACK_SPOT.standTy * TILE_PX + TILE_PX / 2, layer: 0 },
  ];
}

/**
 * Ticks of the script (from its first tick): the axe strikes at 20, 50, 80, 110 and 140 (§D: five blows),
 * the birch falls and lands at 200 (`BALANCE.harvest.tree.fallSeconds`); E is let go after the fall
 * starts and taken up again on the stump at 185, whose first blow lands at 205. The picture at 220: the
 * pieces of the landing are 20 ticks into their 27-tick flight, on the way down.
 */
export const FEEDBACK_TICKS = { release: 141, stump: 185, end: 220 } as const;

/** The commands of the script by tick. */
export function feedbackScript(): { readonly at: number; readonly command: GameCommand }[] {
  const target = { tx: FEEDBACK_SPOT.tx, ty: FEEDBACK_SPOT.ty };
  return [
    { at: 0, command: { type: 'player.interact', on: true, ...target } },
    { at: FEEDBACK_TICKS.release, command: { type: 'player.interact', on: false } },
    { at: FEEDBACK_TICKS.stump, command: { type: 'player.interact', on: true, ...target } },
  ];
}
