/**
 * Commands of the guide (aggregated by src/game/commands.ts; docs/SPIEL.md §23 "Einstieg", §30 "Sim-wirksam werden nur
 * `hints`/`funkeComments` – als Befehl `guide.configure`"):
 * - `guide.configure {funke, hints}`: the settings `game.funkeComments` and `game.hints` – the UI sends them at start and on
 *   every change, so a replay sees exactly when the player switched Funke or the hints off.
 */
import { z } from 'zod';

export const guideConfigureCommandSchema = z.object({ type: z.literal('guide.configure'), funke: z.boolean(), hints: z.boolean() }).strict();

/** Schemas of the guide commands (aggregated by `gameCommandSchema`). */
export const GUIDE_COMMAND_SCHEMAS = [guideConfigureCommandSchema] as const;
