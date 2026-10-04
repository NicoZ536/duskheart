/**
 * M6-16d Bench `sim:kreaturen-50` (Akzeptanz „Allokation je Kreatur ≤ 1 B“, §30 „Keine Allokationen in Hot-Loops“): der
 * Kreaturteil des Ticks in der echten Simulation – Körper, Sinne, Denken, Schritte und Angriffe jeder Kreatur
 * (`CreatureSystem.stepAll`) – mit 50 Kreaturen der Abenddämmerung um den Spieler (zwei Wolfsrudel, Keiler und Dachse,
 * die ihn jagen, Rehe, Hasen, Frösche und Wachteln, die grasen, ruhen und fliehen, getarnte Dornlinge, Wespenschwärme und
 * Schattenbrut – Schleicher, Kriecher und Speier, die im Dämmerlicht über ihrer Schwelle stehen, je Tick das Licht ihrer
 * Kachel lesen, ins Dunkel fliehen und Pfade mit Lichtmaske anfragen; Welt Klein, Seed 30, Frühling 18:00, ein Spieltag
 * dauert 48 Minuten, damit jede Welt vor der Nacht endet). Der Spieler (God-Modus) steht: die Jäger stellen ihn,
 * umkreisen ihn und schlagen zu, ihre Schläge machen Lärm, den alle hören.
 *
 * Gemessen wird die Heap-Zunahme jedes Aufrufs von `stepAll` (`process.memoryUsage().heapUsed` davor und danach), abzüglich
 * der Allokation des Messpaars selbst: in jedem Tick misst ein leeres Paar sie unmittelbar davor (das Ergebnisobjekt von
 * `memoryUsage`; der Heap zählt in Stufen von 0, 80 oder 160 B, im Mittel stimmt es); ein Paar, in das eine
 * Speicherbereinigung fiel, zählt mitsamt seinem leeren Paar nicht, und vor jedem Fenster räumt eine volle
 * Speicherbereinigung auf. Je Kreatur heißt: die Summe über ein Fenster geteilt durch die Kreatur-Ticks des Fensters; der
 * Messwert ist der Median dreier Fenster (wie `sim:kollision-2000`).
 *
 * Gemessen wird der eingeschwungene Zustand. V8 übersetzt eine Funktion erst nach 3 000 Aufrufen optimiert
 * (`--invocation-count-for-turbofan`; Maglev ist in Node 22 aus); davor läuft sie im Basiscompiler, wo jede
 * Gleitkommaoperation eine neue Zahl auf dem Heap anlegt – die seltenen Pfade des Kreaturtakts (Angriffsbeginn, Schlag,
 * Rudelplatz) erreichen das in einer Spielsitzung erst nach Minuten. Und jede neue Simulation verwirft beim ersten Takt
 * einmal optimierten Code, der danach erst wieder heiß werden muss. Deshalb läuft das Szenario zweimal (`rounds`): eine
 * Runde ist eine Aufwärmwelt mit der vierfachen Schar (`warmupScale`) und eine Messwelt mit 50 Kreaturen; gemessen wird die
 * Messwelt der letzten Runde. Was dann noch anfällt, sind die Ereignisse selbst (Telegraph, Schlag, Treffer, Rufe: je eines
 * ein Objekt) und die Pfade (ihre Kacheln).
 *
 * Nicht gemessen wird die feste Arbeit je Tick (Licht am Spieler, Wetter, Uhrzeit: Licht- und Wettersystem) und die Suche
 * des Pfaddienstes ohne Worker (eigener Bench `sim:pfad-200`). Die Schattenbrut gehört seit M6-16f zur Mischung: die
 * Lichtkarte wertet ihre Kacheln ohne Allokation aus (Lichtspalten, Umgebungslicht je Wetterregion und Uhrzeit,
 * Ausgabeparameter statt zurückgegebener Pegel), ihr Licht liest der Takt über `CreatureLight.tileLevelInto`.
 */
import type { CreatureSystem } from '../../src/game/creatures/system';
import { parseGameCommand, type GameCommand } from '../../src/game/commands';
import type { PlayerSystem } from '../../src/game/player/system';
import { createSimulation } from '../../src/game/setup';
import type { Simulation } from '../../src/game/sim';
import { TILE_PX } from '../../src/world/model/coords';
import type { Measurement } from './thresholds';
import { percentile } from './stats';

/** Name des Szenarios. */
export const CREATURE_BENCH = 'sim:kreaturen-50';
/** Welt des Benchs: Klein, Seed 30, ein Spieltag in 48 Minuten (eine Spielstunde = 7 200 Ticks). */
const WORLD = { seed: 30, worldSize: 'small', dayLengthMinutes: 48 } as const;
/** Abenddämmerung im Frühling (18–20 Uhr): Wölfe, Dachse und Frösche wach, noch kein Nachtspawner. */
const START_HOUR = 18;
/** Ticks, bis der Spieler steht und die Zone geladen ist. */
const SETTLE_TICKS = 30;
/** Die einheimische Bevölkerung um den Spieler wird entfernt [Kacheln] (`MAX_DEBUG_KILL_RADIUS`); am Zonenrand bleibt ein Rest. */
const CLEAR_RADIUS_TILES = 64;
/** Die Gruppen: Kreatur, Anzahl, Versatz vom Spieler [Kacheln]. 50 Kreaturen, Jäger, Beute und Schattenbrut gemischt. */
export const CREATURE_BENCH_GROUPS: readonly (readonly [string, number, number, number])[] = [
  ['wolf', 5, 0, -12],
  ['wolf', 4, 14, 14],
  ['keiler', 4, 12, 0],
  ['dachs', 3, -12, 0],
  ['reh', 7, 0, 14],
  ['hase', 6, -14, -14],
  ['frosch', 6, -20, 6],
  ['wachtel', 4, 20, -6],
  ['dornling', 2, 6, 8],
  ['wespenschwarm', 2, -16, 16],
  ['schleicher', 3, 8, -16],
  ['kriecher', 2, -8, 18],
  ['speier', 2, 18, 10],
];
/** Ticks nach der vollen Speicherbereinigung vor jedem Fenster (1 s): das Kehren im Hintergrund ist dann fertig. */
const AFTER_GC_TICKS = 60;

/**
 * Laufparameter: Runden, Ticks und Schar der Aufwärmwelt einer Runde (Vielfaches der Gruppen, 0 = keine), Einschwingen der
 * Messwelt [Ticks], Messfenster und ihre Länge [Ticks].
 */
export interface CreatureBenchOptions {
  readonly rounds: number;
  readonly warmupTicks: number;
  readonly warmupScale: number;
  readonly settleTicks: number;
  readonly windows: number;
  readonly windowTicks: number;
}

/**
 * Zwei Runden; Aufwärmwelt 12 000 Ticks (100 s Spielzeit, 18–19:40 Uhr) mit 200 Kreaturen, Messwelt 3 600 Ticks
 * Einschwingen und drei Fenster zu 1 200 Ticks (18–19:02 Uhr mit den Pausen nach den Speicherbereinigungen): alle Welten
 * enden vor der Nacht.
 */
export const CREATURE_BENCH_OPTIONS: CreatureBenchOptions = { rounds: 2, warmupTicks: 12_000, warmupScale: 4, settleTicks: 3600, windows: 3, windowTicks: 1200 };

/** Ergebnis: Allokation je Kreatur und Tick je Fenster [B], Kreaturen im Mittel, verworfene Ticks. */
export interface CreatureBenchResult {
  readonly perCreature: readonly number[];
  readonly creatures: number;
  readonly skipped: number;
}

/** Eine Welt des Benchs: ihre Kreaturen und ein Tick. */
interface BenchWorld {
  readonly creatures: CreatureSystem;
  step(): void;
}

/** Erzwingt eine volle Speicherbereinigung; ohne `--expose-gc` ist keine Allokationsmessung möglich. */
function collectGarbage(): void {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc === undefined) throw new Error('bench: Allokationsmessung braucht `node --expose-gc` (npm run bench startet so)');
  gc();
}

/** Die Simulation mit `scale` × den 50 Kreaturen um den Spieler, God-Modus an. */
function benchWorld(scale: number): BenchWorld {
  const sim = createSimulation(WORLD);
  const run = (commands: readonly GameCommand[], ticks = 1): void => {
    for (let i = 0; i < ticks; i++) {
      sim.step(i === 0 ? commands.map((c) => parseGameCommand(c)) : undefined);
      sim.events.drain((type, payload) => {
        if (type === 'commandRejected') throw new Error(`bench ${CREATURE_BENCH}: Befehl abgelehnt: ${JSON.stringify(payload)}`);
      });
    }
  };
  run([{ type: 'setTime', hour: START_HOUR, minute: 0 }]);
  run([{ type: 'player.spawn' }], SETTLE_TICKS);
  run([{ type: 'debug.god', on: true }]);
  run([{ type: 'creature.kill', radius: CLEAR_RADIUS_TILES }], SETTLE_TICKS);
  const player = sim.system('player') as unknown as PlayerSystem;
  const at = { x: 0, y: 0 };
  if (!player.position(sim, at)) throw new Error(`bench ${CREATURE_BENCH}: kein Spieler`);
  for (let k = 0; k < scale; k++) {
    for (const [creature, count, dx, dy] of CREATURE_BENCH_GROUPS) run([{ type: 'creature.spawn', creature, count, x: at.x + dx * TILE_PX, y: at.y + dy * TILE_PX, layer: 0 }]);
  }
  const drop = (): void => undefined;
  return {
    creatures: sim.system('creatures') as unknown as CreatureSystem,
    step(): void {
      sim.step();
      sim.events.drain(drop);
    },
  };
}

/** Eine Runde: die Aufwärmwelt, dann die Messwelt mit ihren Fenstern. */
function round(options: CreatureBenchOptions): CreatureBenchResult {
  if (options.warmupScale > 0) {
    const warm = benchWorld(options.warmupScale);
    for (let t = 0; t < options.warmupTicks; t++) warm.step();
  }
  const { creatures, step } = benchWorld(1);
  // `stepAll` wird vor dem Einschwingen umhüllt: das Ersetzen ändert die Gestalt des Objekts, was optimierten Code verwirft.
  const target = creatures as unknown as { stepAll(sim: Simulation, tick: number): void };
  const stepAll = target.stepAll.bind(creatures);
  let measuring = false;
  let allocated = 0;
  let counted = 0;
  let skipped = 0;
  target.stepAll = (s, tick): void => {
    if (!measuring) {
      stepAll(s, tick);
      return;
    }
    const bodies = creatures.store.size;
    const emptyBefore = process.memoryUsage().heapUsed;
    const emptyAfter = process.memoryUsage().heapUsed;
    const before = process.memoryUsage().heapUsed;
    stepAll(s, tick);
    const after = process.memoryUsage().heapUsed;
    if (after < before || emptyAfter < emptyBefore) {
      skipped++;
      return;
    }
    allocated += after - before - (emptyAfter - emptyBefore);
    counted += bodies;
  };
  for (let t = 0; t < options.settleTicks; t++) step();
  const perCreature: number[] = [];
  let creatureTicks = 0;
  let ticks = 0;
  for (let w = 0; w < options.windows; w++) {
    // Erst eine volle Speicherbereinigung (die Welten davor hinterließen Abfall), dann ein paar Ticks: solange der Sammler
    // im Hintergrund die alte Generation kehrt, springt `heapUsed` um ganze Seiten – das darf in kein Messpaar fallen.
    collectGarbage();
    for (let t = 0; t < AFTER_GC_TICKS; t++) step();
    allocated = 0;
    counted = 0;
    measuring = true;
    for (let t = 0; t < options.windowTicks; t++) step();
    measuring = false;
    perCreature.push(Math.max(0, allocated) / Math.max(1, counted));
    creatureTicks += counted;
    ticks += options.windowTicks;
  }
  return { perCreature, creatures: creatureTicks / Math.max(1, ticks), skipped };
}

/** Läuft das Szenario (`options.rounds` Runden, die letzte zählt); `options` verkürzt es für Tests. */
export function runCreatureBench(options: CreatureBenchOptions = CREATURE_BENCH_OPTIONS): CreatureBenchResult {
  if (options.rounds < 1) throw new RangeError(`bench ${CREATURE_BENCH}: ${options.rounds} Runden`);
  let result = round(options);
  for (let r = 1; r < options.rounds; r++) result = round(options);
  return result;
}

/** Die Messwerte des Szenarios: Allokation je Kreatur und Tick, Median der Fenster. */
export function creatureBenchMeasurements(r: CreatureBenchResult): Measurement[] {
  return [{ scenario: CREATURE_BENCH, metric: 'Allokation je Kreatur', value: percentile([...r.perCreature], 50), unit: 'B' }];
}
