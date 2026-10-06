/**
 * Contribution of strand H (Menüs & Speichern) to the reference save of save version 4 (docs/SPIEL.md §27 "Referenzspielstand
 * v4.json": "Welt „Hart“"): the world settings, made by commands only, and their facts for the migration test – read through
 * the systems' public API (`WorldSettingsSystem`, `DeathSystem`, the calendar), never from the snapshot layout.
 *
 * Use (integrator, tools/save/fixture.ts): `playWelt(sim)` right before the save – after the fight and the base, so the
 * scenario's earlier parts keep the Normal rules they were written for (a Hart death would empty the whole grave, the
 * wolves would bite 1,3×) –, `weltFacts(sim)` beside `saveFacts`. Fixtures of versions 1–3 load with `EMPTY_WELT_FACTS`
 * (every save before M7 is a Normal world without overrides; the participant `world-settings` migrates from 0).
 */
import { z } from 'zod';
import { BALANCE } from '../../../src/content/balance';
import { DIFFICULTIES } from '../../../src/content/balance/death';
import type { GameCommand } from '../../../src/game/commands';
import type { Simulation } from '../../../src/game/sim';
import { WorldSettingsSystem } from '../../../src/game/worldsettings/system';
import { RESOURCE_DENSITIES } from '../../../src/game/worldsettings/types';

/**
 * The world settings of the reference save: Hart, a hunger override, an own shadow flood interval and logistics realism
 * (each field differs from the preset, so a lost field shows), a shorter season. Not peaceful: the scenario's creatures stay.
 * The settings come before the difficulty – the order the new-world screen sends them in.
 */
export const WELT_COMMANDS: readonly GameCommand[] = [
  { type: 'world.setSettings', hungerDurst: 1.1, schattenflut: 6, logistikRealismus: true, jahreszeitenLaenge: 5 },
  { type: 'world.setDifficulty', schwierigkeit: 'hart' },
];

/** Applies the world settings of the reference save (one tick); throws if a command was refused. */
export function playWelt(sim: Simulation): void {
  sim.step(WELT_COMMANDS);
  const refused: string[] = [];
  sim.events.drain((type, payload) => {
    if (type === 'commandRejected') refused.push(JSON.stringify(payload));
  });
  if (refused.length > 0) throw new Error(`Fixture-Szenario: Welteinstellungen abgelehnt: ${refused.join(', ')}`);
}

/** Facts of the world settings. */
export const weltFactsSchema = z
  .object({
    difficulty: z.enum(DIFFICULTIES),
    peaceful: z.boolean(),
    hungerThirst: z.number().nullable(),
    enemyDamage: z.number().nullable(),
    shadowFloodNights: z.union([z.literal('voreinstellung'), z.number()]).nullable(),
    logisticsRealism: z.boolean(),
    seasonLengthDays: z.number().int(),
    resourceDensity: z.enum(RESOURCE_DENSITIES),
  })
  .strict();
export type WeltFacts = z.output<typeof weltFactsSchema>;

/** A world before M7: Normal, nothing overridden, the default season length, normal resources. */
export const EMPTY_WELT_FACTS: WeltFacts = {
  difficulty: 'normal',
  peaceful: false,
  hungerThirst: null,
  enemyDamage: null,
  shadowFloodNights: 'voreinstellung',
  logisticsRealism: false,
  seasonLengthDays: BALANCE.calendar.defaultSeasonLengthDays,
  resourceDensity: 'normal',
};

/** The world settings of `sim`, read through the systems. */
export function weltFacts(sim: Simulation): WeltFacts {
  const ws = sim.system('world-settings');
  if (!(ws instanceof WorldSettingsSystem)) throw new Error('weltFacts: die Simulation hat kein System world-settings');
  const s = ws.state;
  return {
    difficulty: ws.difficulty(),
    peaceful: s.peaceful,
    hungerThirst: s.hungerThirst,
    enemyDamage: s.enemyDamage,
    shadowFloodNights: s.shadowFloodNights,
    logisticsRealism: s.logisticsRealism,
    seasonLengthDays: sim.world.calendar.seasonLengthDays,
    resourceDensity: sim.config.resourceDensity ?? 'normal',
  };
}
