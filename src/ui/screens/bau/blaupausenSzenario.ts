/**
 * Screenshot scenario `bau-blaupausen` (M4-24, MASTERPROMPT §31.5): on the start beach at 11:00 six plank wall and
 * three plank floor blueprints are planned north of the player (`build.blueprint`, no material needed), two walls
 * are in the bags; the build mode open over them – above its status line "Blaupausen brauchen noch: 4× Holzwand, 3×
 * Holzboden" in the blueprint blue. Registered in src/debug/scenarios.ts.
 */
import { TILE_PX } from '../../../world/model/coords';
import { werkstattSzenario, type SzenarioSchritt, type WerkstattSzenario } from '../handwerk/szenarioHilfe';
import { BAU_SCREEN } from './BauModus';

/** The plan relative to the player's tile: a wall line and a floor strip south of it. */
const PLAN: ReadonlyArray<readonly [string, number, number]> = [
  ['wand_holz', -3, -4],
  ['wand_holz', -2, -4],
  ['wand_holz', -1, -4],
  ['wand_holz', 0, -4],
  ['wand_holz', 1, -4],
  ['wand_holz', 2, -4],
  ['boden_holz', -1, -3],
  ['boden_holz', 0, -3],
  ['boden_holz', 1, -3],
];

export function blaupausenSzenario(): WerkstattSzenario {
  const planen: SzenarioSchritt = (s) => {
    const at = s.state().player;
    if (at === null) return false;
    const tx = Math.floor(at.x / TILE_PX);
    const ty = Math.floor(at.y / TILE_PX);
    for (const [part, dx, dy] of PLAN) s.command({ type: 'build.blueprint', part, tx: tx + dx, ty: ty + dy });
    s.step();
    return true;
  };
  return werkstattSzenario({
    name: 'bau-blaupausen',
    description:
      'M4-24: Baumodus über geplanten Bauteilen – sechs Holzwand- und drei Holzboden-Blaupausen nördlich des Spielers, zwei Holzwände in den Taschen; über der Statuszeile „Blaupausen brauchen noch: 4× Holzwand, 3× Holzboden“ mit blauer Kante',
    items: [['wand_holz', 2]],
    schritte: [planen],
    bildschirm: BAU_SCREEN,
  });
}
