/**
 * Contribution of strand A (Klang) to the reference save of save version 4 (docs/SPIEL.md §24, §27; M7-31): music played and
 * the net swung, made by commands only, and its facts for the migration test – read through the instruments system's
 * public API (`InstrumentsSystem.state`), never from the snapshot layout.
 *
 * `playKlang(sim)` gives the player a flute and a net, plays the flute twice (the first song stops when the second begins:
 * `lied_1`, then `lied_2`), stops it, and swings the net once over the player's own tile (a cricket or nothing – the draw is
 * a hash of the world seed and the swing counter, the same in every run). Nothing keeps playing: the fight after it would
 * end the music anyway.
 * Use (integrator, tools/save/fixture.ts): anywhere before the fight, `klangFacts(sim)` beside `saveFacts`. Fixtures of
 * versions 1–3 load with `EMPTY_KLANG_FACTS` (the participant `instruments` migrates from 0 to nothing played).
 */
import { z } from 'zod';
import type { GameCommand } from '../../../src/game/commands';
import { InstrumentsSystem, INSTRUMENTS_SYSTEM_ID } from '../../../src/game/instruments/system';
import type { InventorySystem } from '../../../src/game/inventory/system';
import type { SlotRef } from '../../../src/game/items/slots';
import type { PlayerSystem } from '../../../src/game/player/system';
import type { Simulation } from '../../../src/game/sim';
import { TILE_PX } from '../../../src/world/model/coords';

function instruments(sim: Simulation): InstrumentsSystem {
  const s = sim.system(INSTRUMENTS_SYSTEM_ID);
  if (!(s instanceof InstrumentsSystem)) throw new Error('klang: die Simulation hat kein System instruments');
  return s;
}

/** Runs `commands` in one tick; throws if a command was refused. Returns the event types seen. */
function run(sim: Simulation, what: string, commands: readonly GameCommand[]): Set<string> {
  const seen = new Set<string>();
  const refused: string[] = [];
  sim.step(commands);
  sim.events.drain((type, payload) => {
    seen.add(type);
    if (type === 'commandRejected') refused.push(JSON.stringify(payload));
  });
  if (refused.length > 0) throw new Error(`Fixture-Szenario (Klang): ${what} abgelehnt: ${refused.join(', ')}`);
  return seen;
}

/** The slot holding `item` (bags and hotbar). */
function slotOf(sim: Simulation, item: string): SlotRef {
  const s = (sim.system('inventory') as InventorySystem).state;
  for (const bereich of ['schnellleiste', 'inventar', 'rucksackfach'] as const) {
    const index = s[bereich].findIndex((x) => x !== null && x.item === item);
    if (index >= 0) return { bereich, index };
  }
  throw new Error(`Fixture-Szenario (Klang): ${item} nicht in den Taschen`);
}

/** Plays the music part of the reference save (see module comment); throws if a step does not have its effect. */
export function playKlang(sim: Simulation): void {
  const inst = instruments(sim);
  run(sim, 'Flöte und Kescher', [
    { type: 'inventory.give', item: 'floete', count: 1 },
    { type: 'inventory.give', item: 'netz', count: 1 },
  ]);
  const flute = slotOf(sim, 'floete');
  if (!run(sim, 'erstes Lied', [{ type: 'instrument.play', from: flute }]).has('instrumentPlayed')) throw new Error('Fixture-Szenario (Klang): die Flöte spielt nicht');
  run(sim, 'zweites Lied', [{ type: 'instrument.play', from: flute }]);
  if (inst.playing()?.lied !== 'lied_2') throw new Error('Fixture-Szenario (Klang): das zweite Lied spielt nicht');
  run(sim, 'aufhören', [{ type: 'instrument.stop' }]);
  const player = sim.system('player') as PlayerSystem;
  const at = { x: 0, y: 0 };
  if (!player.position(sim, at)) throw new Error('Fixture-Szenario (Klang): kein Spieler');
  const swung = run(sim, 'Kescher', [{ type: 'player.useItem', slot: slotOf(sim, 'netz'), tx: Math.floor(at.x / TILE_PX), ty: Math.floor(at.y / TILE_PX) }]);
  if (!swung.has('netSwung')) throw new Error('Fixture-Szenario (Klang): der Kescher wurde nicht geschwungen');
}

/** Facts of the instruments: what plays, how often music began, the net's swings and the swarms remembered. */
export const klangFactsSchema = z
  .object({
    spielt: z.object({ instrument: z.string().min(1), lied: z.string().min(1) }).strict().nullable(),
    gespielt: z.number().int().min(0),
    netzZuege: z.number().int().min(0),
    schwaerme: z.number().int().min(0),
  })
  .strict();
export type KlangFacts = z.output<typeof klangFactsSchema>;

/** A world before M7: nothing was ever played. */
export const EMPTY_KLANG_FACTS: KlangFacts = { spielt: null, gespielt: 0, netzZuege: 0, schwaerme: 0 };

/** The instruments' facts of `sim`, read through the instruments system. */
export function klangFacts(sim: Simulation): KlangFacts {
  const s = instruments(sim).state;
  return { spielt: s.spielt === null ? null : { instrument: s.spielt.instrument, lied: s.spielt.lied }, gespielt: s.gespielt, netzZuege: s.netzZuege, schwaerme: s.schwaerme.length };
}
