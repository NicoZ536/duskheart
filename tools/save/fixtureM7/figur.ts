/**
 * Contribution of strand I (Figur & Kreaturen) to the reference save of save version 4 (docs/SPIEL.md §27 "Referenzspielstand
 * v4.json": "eigenes Aussehen"): the appearance the character creation sends, made by its command only, and its facts for the
 * migration test – read through the system's public API (`AppearanceSystem.appearance`), never from the snapshot layout.
 *
 * Use (integrator, tools/save/fixture.ts): `playFigur(sim)` as the world's first command – in `playFixtureScenario` right after
 * `createSimulation(FIXTURE_WORLD)`, before `player.spawn` (docs/SPIEL.md §26: "erster Befehl einer neuen Welt"; the new-world
 * flow sends it the same way, src/ui/menu/ablauf.ts) –, `figurFacts(sim)` beside `saveFacts` (field `figur`). Fixtures of
 * versions 1–3 load with `EMPTY_FIGUR_FACTS` (the participant `appearance` migrates from 0 to the figure as drawn up to M6,
 * not chosen).
 */
import { z } from 'zod';
import { BODY_SHAPE_IDS } from '../../../src/content/appearance/schema';
import { AppearanceSystem, defaultAppearance } from '../../../src/game/appearance';
import type { GameCommand } from '../../../src/game/commands';
import type { Simulation } from '../../../src/game/sim';

/**
 * The appearance of the reference save: every field differs from the figure as drawn (a lost field shows) – a name with
 * letters beyond ASCII (the name counts code points), the slender shape, a dark skin, two braids in copper, a green top
 * over night-dark trousers.
 */
export const FIGUR_COMMAND = { type: 'appearance.set', name: 'Ænne Ødegård', form: 'schmal', haut: 'haut_5', frisur: 'zoepfe', haar: 'haar_6', oberteil: 'kleid_3', hose: 'kleid_8' } as const satisfies GameCommand;

/** Sends the appearance of the reference save (one tick); throws if it was refused. */
export function playFigur(sim: Simulation): void {
  sim.step([FIGUR_COMMAND]);
  const refused: string[] = [];
  sim.events.drain((type, payload) => {
    if (type === 'commandRejected') refused.push(JSON.stringify(payload));
  });
  if (refused.length > 0) throw new Error(`Fixture-Szenario: Aussehen abgelehnt: ${refused.join(', ')}`);
}

/** Facts of the appearance. */
export const figurFactsSchema = z
  .object({
    name: z.string(),
    form: z.enum(BODY_SHAPE_IDS),
    haut: z.string(),
    frisur: z.string(),
    haar: z.string(),
    oberteil: z.string(),
    hose: z.string(),
    gewaehlt: z.boolean(),
  })
  .strict();
export type FigurFacts = z.output<typeof figurFactsSchema>;

/** A world before M7: the figure as drawn up to M6, not chosen (no name). */
export const EMPTY_FIGUR_FACTS: FigurFacts = { ...defaultAppearance() };

/** The appearance of `sim`, read through the system. */
export function figurFacts(sim: Simulation): FigurFacts {
  const system = sim.system('appearance');
  if (!(system instanceof AppearanceSystem)) throw new Error('figurFacts: die Simulation hat kein System appearance');
  const a = system.appearance;
  return { name: a.name, form: a.form, haut: a.haut, frisur: a.frisur, haar: a.haar, oberteil: a.oberteil, hose: a.hose, gewaehlt: a.gewaehlt };
}
