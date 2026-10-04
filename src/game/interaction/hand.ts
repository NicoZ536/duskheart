/**
 * Setting things up from the hand (MASTERPROMPT §2.2 "Alles ist erreichbar und erklärt", §14 "Fallen (Schlinge,
 * Kastenfalle)"; docs/SPIEL.md §11 "Beute, Jagen, Fallen"; M6-30): a trap in the hand is set up like a torch – the primary
 * button (LMB/RT, `player.useItem`) puts it on the aimed tile when that lies within reach, else on the tile in front of the
 * figure. Before the click the interaction system describes that target every tick beside its E focus
 * (`InteractionFocus.hand*`, src/game/interaction/system.ts): the presentation draws the preview there, green or red
 * (src/render/game/placement.ts), and the HUD hint says "Aufstellen: Schlinge" with the primary button's glyph while E has
 * nothing else in view.
 *
 * A `HandPlacer` is the system that owns the command (the traps, src/game/creatures/traps.ts): it answers read-only, by the
 * rules of its own command, so the preview never promises what the click would refuse.
 */
import { TILE_PX, pxToTile, type Layer } from '../../world/model/coords';
import type { Facing } from '../player/state';
import type { Simulation } from '../sim';
import { facingUnit } from './formulas';

/** Unit vector of the facing (scratch, written and read within `handTile`). */
const AHEAD = { x: 0, y: 0 };

/** Why the thing in the hand cannot be set up on its target tile now (the reason its command would give). */
export type HandPlaceBlock = 'tooFar' | 'blocked';

/** Where the primary button would set the thing in the hand up, and whether it may. */
export interface HandTarget {
  layer: Layer;
  tx: number;
  ty: number;
  /** The reason the command would refuse it there, or `null`. */
  block: HandPlaceBlock | null;
}

/** A fresh target record. */
export function createHandTarget(): HandTarget {
  return { layer: 0, tx: 0, ty: 0, block: null };
}

/** A system that sets items up from the hand (bound with `InteractionSystem.addPlacer`). */
export interface HandPlacer {
  /**
   * Fills `out` with the tile the primary button would set item `item` up on – the aimed point `aim` (`player.aim`, or
   * `null`) – and the reason its command would refuse it there. False – leaving `out` – when `item` is none of its
   * things or the player cannot act. Read-only.
   */
  handTarget(sim: Simulation, item: string, aim: Readonly<{ x: number; y: number }> | null, out: HandTarget): boolean;
}

/**
 * The tile a thing set up from the hand goes to (the rule of torches and camp fires, src/game/tools/system.ts `setUp`):
 * the aimed tile when its centre lies within `reachPx` of the feet (`feetX`, `feetY`) – so the aimed tile is never out
 * of reach –, else the tile ahead of the figure facing `facing`. Writes the tile into `out`.
 */
export function handTile(feetX: number, feetY: number, facing: Facing, aim: Readonly<{ x: number; y: number }> | null, reachPx: number, out: { tx: number; ty: number }): { tx: number; ty: number } {
  if (aim !== null) {
    const tx = pxToTile(aim.x);
    const ty = pxToTile(aim.y);
    const dx = (tx + 1 / 2) * TILE_PX - feetX;
    const dy = (ty + 1 / 2) * TILE_PX - feetY;
    if (dx * dx + dy * dy <= reachPx * reachPx) {
      out.tx = tx;
      out.ty = ty;
      return out;
    }
  }
  const ahead = facingUnit(facing, AHEAD);
  out.tx = pxToTile(feetX + ahead.x * TILE_PX);
  out.ty = pxToTile(feetY + ahead.y * TILE_PX);
  return out;
}
