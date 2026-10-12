/**
 * Die Zeitlinie der Hinweis-Tests nach dem Laden (M7-105): eine nackte Simulation mit Statistik und Führung (Funke und Hinweise,
 * der Inhalt des Spiels), ein Einspeiser für die Ereignisse; die Hinweise schalten ab, die Wegsteine werden frei (der Hinweis
 * `hinweis_schnellreise` hält bei abgeschaltetem Kanal und wartet erneut), dann schalten die Hinweise im selben Schritt wieder an,
 * in dem ein Tier fällt (`hinweis_zerlegen`): beide halten zugleich. `lauf(at)` speichert und lädt nach Tick `at`.
 */
import { BALANCE } from '../../../src/content/balance';
import { GuideSystem } from '../../../src/game/guide/system';
import type { Simulation } from '../../../src/game/sim';
import { StatsSystem } from '../../../src/game/stats/system';
import { canonicalJson } from '../../../src/save/canonical';
import { chronikWelt, steps, type Feeder, type WorldState } from '../game/chronik-testwelt';

const PLAYER = 7;
export const ZERLEGEN = 'hinweis_zerlegen';
export const SCHNELLREISE = 'hinweis_schnellreise';

interface Welt {
  sim: Simulation;
  feeder: Feeder;
  state: WorldState;
  guide: GuideSystem;
}

function welt(): Welt {
  const w = chronikWelt();
  w.sim.setPlayer(PLAYER);
  w.sim.addSystem(new StatsSystem({ world: w.world }));
  const guide = w.sim.addSystem(new GuideSystem({ world: w.world }));
  return { sim: w.sim, feeder: w.feeder, state: w.state, guide };
}

/** A copy of `a` through its save: every participant serialized and read back into a fresh world (the world state as well). */
function laden(a: Welt): Welt {
  const snap = JSON.parse(JSON.stringify(a.sim.snapshot())) as ReturnType<Simulation['snapshot']>;
  const b = welt();
  for (const [id, p] of Object.entries(snap.participants)) b.sim.participant(id).deserialize(p.data);
  for (const u of a.state.unlocks) b.state.unlocks.add(u);
  return b;
}

/** The timeline's events of tick `t` (relative to its start), fed into world `w`. */
export function zeitlinie(w: Welt, t: number): void {
  if (t === 5) w.sim.step([{ type: 'guide.configure', funke: true, hints: false }]);
  // The waystones unlocked while the hints are off: `hinweis_schnellreise` holds on the world ticks, its channel is off – it
  // waits again, behind the others (in the content it comes before `hinweis_zerlegen`).
  if (t === 20) w.state.unlocks.add('lf1_wegsteine');
  // The hints back on and a kill in one step (a statistic counted: the state-like triggers are due): both hold together.
  if (t === 150) {
    w.feeder.push(['creatureDied', { entity: 11, creature: 'wolf', by: PLAYER, carcass: 0, loot: true, facing: 0, variant: -1, layer: 0, x: 0, y: 0 }]);
    w.sim.step([{ type: 'guide.configure', funke: true, hints: true }]);
  }
}

/** Ticks of the timeline: both hints said (the second `hintMinSeconds` after the first) and a little beyond. */
export const LINE = 151 + (BALANCE.guide.hintMinSeconds + 2) * BALANCE.time.tickHz;

/** The run of the timeline from tick 0 to `LINE`, saved and loaded after tick `at` (−1: never); hints said and hashes per tick. */
export function lauf(at: number): { said: string[]; hashes: string[]; guides: string[] } {
  let w = welt();
  const said: string[] = [];
  const hashes: string[] = [];
  const guides: string[] = [];
  for (let t = 0; t < LINE; t++) {
    zeitlinie(w, t);
    for (const [type, p] of steps(w.sim, 1)) if (type === 'guideHint') said.push(`${w.sim.tick}:${String(p.hint)}`);
    hashes.push(w.sim.hashState());
    guides.push(canonicalJson(w.guide.save.serialize()));
    if (t === at) w = laden(w);
  }
  return { said, hashes, guides };
}
