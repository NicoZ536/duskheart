/**
 * Contribution of strand G (Chronik & Führung) to the reference save of save version 4 (docs/SPIEL.md §27 "Aufgaben mitten im
 * Akt, Erfolge, Chronik-Einträge"; M7-41 … M7-48): made by commands only, and its facts for the migration test – read through
 * the public API of the observers (`QuestsSystem`, `AchievementsSystem`, `ChronicleSystem`, `StatsSystem`, `GuideSystem`),
 * never from the snapshot layout.
 *
 * The observers fill themselves from what the scenario before them did (the fibres in the bags, the night of the farm's day
 * jump, the death, the camp fire, the Borkenvater, the beacon, the place): statistics and milestones count, achievements fall,
 * the diary writes its entries, the knowledge opens, the onboarding stands at its second step and the main quest, Funke awake
 * after the first night, at the dead beacon's site (the site itself is never discovered by the scenario – so the act stays
 * open although its guardian has fallen). `playChronik(sim)` checks that and adds what no other part does: the onboarding
 * taken off the tracker (`quest.track {on: false}` – a switch the save keeps), so the tracker shows only the main quest.
 * Use (integrator, tools/save/fixture.ts): after `playOrte(d.sim)` and before the fight (the fight stays the last thing before
 * the save), `chronikFacts(sim)` beside `saveFacts`. Fixtures of versions 1–3 load with `emptyChronikFacts()` (the participants
 * `stats`, `achievements`, `chronicle`, `quests` and `guide` migrate from 0: nothing counted, nothing reached, no entry, no
 * quest begun, the onboarding and both guide channels on).
 */
import { z } from 'zod';
import { CONTENT } from '../../../src/content/index';
import { AchievementsSystem } from '../../../src/game/achievements/system';
import { ChronicleSystem } from '../../../src/game/chronicle/system';
import type { GameCommand } from '../../../src/game/commands';
import { GuideSystem } from '../../../src/game/guide/system';
import type { GuideConfig } from '../../../src/game/guide/types';
import { QuestsSystem } from '../../../src/game/quests/system';
import type { Simulation } from '../../../src/game/sim';
import { StatsSystem } from '../../../src/game/stats/system';

/** The quests of the reference save: the onboarding mid-way off the tracker, the main quest mid-act. */
export const CHRONIK_FIXTURE = { einstieg: 'einstieg', hauptaufgabe: 'hq_sechs_feuer_1', untracked: 'einstieg' } as const;
/** Achievements the scenario before must have earned (the first night, the Borkenvater, the first beacon). */
const EXPECTED_ACHIEVEMENTS = ['erste_nacht', 'borkenvater_besiegt', 'erstes_feuer'] as const;

function system<T>(sim: Simulation, id: string, kind: abstract new (...args: never[]) => T): T {
  const s = sim.system(id);
  if (!(s instanceof kind)) throw new Error(`chronik: die Simulation hat kein System ${id}`);
  return s;
}

/** Runs `commands` for one tick; throws if one was refused. */
function run(sim: Simulation, what: string, commands: readonly GameCommand[]): void {
  sim.step(commands);
  const refused: string[] = [];
  sim.events.drain((type, payload) => {
    if (type === 'commandRejected') refused.push(JSON.stringify(payload));
  });
  if (refused.length > 0) throw new Error(`Fixture-Szenario (Chronik): ${what} abgelehnt: ${refused.join(', ')}`);
}

/** Whether quest `quest` runs and stands past its first and before its last step. */
function midway(quests: QuestsSystem, quest: string): boolean {
  const r = quests.run(quest);
  const s = r?.state ?? null;
  return r !== undefined && s !== null && s.status === 'aktiv' && s.step > 0 && s.step < r.def.schritte.length - 1;
}

/** Checks the observers' state the scenario left and takes the onboarding off the tracker; throws if something is missing. */
export function playChronik(sim: Simulation): void {
  const quests = system(sim, 'quests', QuestsSystem);
  const achievements = system(sim, 'achievements', AchievementsSystem);
  const chronicle = system(sim, 'chronicle', ChronicleSystem);
  const { einstieg, hauptaufgabe, untracked } = CHRONIK_FIXTURE;
  if (!midway(quests, einstieg)) throw new Error(`Fixture-Szenario (Chronik): der Einstieg steht nicht mitten im Weg (${JSON.stringify(quests.run(einstieg)?.state)})`);
  if (!midway(quests, hauptaufgabe)) throw new Error(`Fixture-Szenario (Chronik): die Hauptaufgabe steht nicht mitten im Akt (${JSON.stringify(quests.run(hauptaufgabe)?.state)})`);
  for (const id of EXPECTED_ACHIEVEMENTS) if (!achievements.has(id)) throw new Error(`Fixture-Szenario (Chronik): Erfolg ${id} fehlt`);
  if (chronicle.entries().length === 0 || chronicle.knowledge().length === 0) throw new Error('Fixture-Szenario (Chronik): keine Chronik-Einträge oder kein Wissen');
  run(sim, 'Einstieg nicht mehr verfolgen', [{ type: 'quest.track', quest: untracked, on: false }]);
  if (quests.run(untracked)?.state?.tracked !== false) throw new Error('Fixture-Szenario (Chronik): der Einstieg wird noch verfolgt');
}

/** Facts of the statistics, achievements, diary, knowledge, quests and the guide. */
export const chronikFactsSchema = z
  .object({
    /** Every statistic's total by id (all of §29). */
    stats: z.record(z.string(), z.number().min(0)),
    /** Milestones reached with the play time they were reached at [ticks of play], in content order. */
    milestones: z.array(z.object({ id: z.string().min(1), spielzeit: z.number().int().min(0) }).strict()),
    /** Achievements unlocked with their tick and play time, in unlock order. */
    achievements: z.array(z.object({ id: z.string().min(1), tick: z.number().int().min(0), spielzeit: z.number().int().min(0) }).strict()),
    /** The diary's entries (number and rule) and the knowledge unlocked, in their order. */
    chronicle: z.array(z.object({ nr: z.number().int().min(1), rule: z.string().min(1) }).strict()),
    knowledge: z.array(z.string().min(1)),
    /** Every quest that has begun: status, the running step (null when done), its counter, tracked. */
    quests: z.array(z.object({ quest: z.string().min(1), status: z.string().min(1), step: z.string().nullable(), count: z.number().int().min(0), tracked: z.boolean() }).strict()),
    onboarding: z.boolean(),
    guide: z.object({ funke: z.boolean(), hints: z.boolean(), said: z.array(z.string().min(1)) }).strict(),
  })
  .strict();
export type ChronikFacts = z.output<typeof chronikFactsSchema>;

/** A world before M7: nothing counted or reached, no entry, no quest begun, the onboarding and both guide channels on. */
export function emptyChronikFacts(): ChronikFacts {
  return {
    stats: Object.fromEntries(CONTENT.collection('stats').ids().map((id) => [id, 0])),
    milestones: [],
    achievements: [],
    chronicle: [],
    knowledge: [],
    quests: [],
    onboarding: true,
    guide: { funke: true, hints: true, said: [] },
  };
}

/** Reads the facts through the observers' public API. */
export function chronikFacts(sim: Simulation): ChronikFacts {
  const stats = system(sim, 'stats', StatsSystem);
  const achievements = system(sim, 'achievements', AchievementsSystem);
  const chronicle = system(sim, 'chronicle', ChronicleSystem);
  const quests = system(sim, 'quests', QuestsSystem);
  const guide = system(sim, 'guide', GuideSystem);
  const config: GuideConfig = guide.configuration({ funke: true, hints: true, onboarding: true });
  return {
    stats: Object.fromEntries(stats.defs.map((d) => [d.id, stats.value(d.id)])),
    milestones: stats.milestoneDefs.filter((m) => stats.milestoneTime(m.id) >= 0).map((m) => ({ id: m.id, spielzeit: stats.milestoneTime(m.id) })),
    achievements: achievements.unlocked().map((a) => ({ id: a.id, tick: a.tick, spielzeit: a.spielzeit })),
    chronicle: chronicle.entries().map((e) => ({ nr: e.nr, rule: e.rule })),
    knowledge: chronicle.knowledge().map((k) => k.id),
    quests: quests.runs.flatMap((r) =>
      r.state === null ? [] : [{ quest: r.def.id, status: r.state.status, step: r.state.status === 'aktiv' ? (r.def.schritte[r.state.step]?.id ?? null) : null, count: r.state.count, tracked: r.state.tracked }],
    ),
    onboarding: quests.onboarding,
    guide: { funke: config.funke, hints: config.hints, said: guide.hints.filter((h) => guide.wasSaid(h.id)).map((h) => h.id) },
  };
}
