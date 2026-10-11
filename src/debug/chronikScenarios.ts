/**
 * Screenshot scenarios of strand G (MASTERPROMPT §31.5; M7-41, M7-44, M7-48): the chronicle's seven tabs, Funke in the HUD and
 * the perk choice – each in the same played-through morning at the start beach, built with the game's own commands and single
 * simulation steps (deterministic: fixed seed, frozen loop):
 *
 * - the onboarding up to the bronze, then finished (its reward, the diary's entries), the main quest started and moved on to the
 *   Barkfather's step (the quest tab's progress, the HUD's tracker);
 * - the three stone tools crafted by hand (Steinzeit), ten kinds of animals sighted and thirty creatures defeated by the player
 *   (bestiary, Forscher, Jäger), six place types discovered (Entdecker), the woodcutting skill at 100 with its perks of 30 and 60
 *   chosen (statistics; the choice at 90 stays open for the perk choice).
 *
 * `ui-chronik-<reiter>` opens the chronicle on its tab; `funke` shows the HUD (mode Voll) with Funke speaking the first line of
 * his dialog at the dead beacon's step and the hint line; `ui-perkwahl` the perk choice that opens when the skill rises.
 * Registered in src/debug/scenarios.ts.
 */
import type { Simulation } from '../game/sim';
import { hudVorgabe } from '../ui/hud/Hud';
import { befehle, werkstattSzenario, type SzenarioSchritt, type WerkstattSzenario, type WerkstattSzenarioSitzung } from '../ui/screens/handwerk/szenarioHilfe';
import { CHRONIK_REITER, type ChronikReiter } from '../ui/screens/chronik/modell';

/** Simulation steps per rendered frame while a scenario plays (a frame stays short). */
const SCHRITTE_JE_FRAME = 120;
/** Ticks the animals stay in view (the bestiary's sight time is 3 s, `BALANCE.creatures.bestiary.sightSeconds`). */
const SICHT_TICKS = 300;
/** Ticks the three stone tools take in the hand (three pieces of the class `werkzeug`, with room). */
const HANDWERK_TICKS = 1500;
/** Radius of the debug kill [tiles]: every spawned animal around the player. */
const KILL_RADIUS = 30;
/** Ten kinds of animals of the coast and the Greengrove (Forscher: ten sighted). */
const TIERE = ['hase', 'reh', 'wolf', 'keiler', 'dachs', 'eichhoernchen', 'frosch', 'wachtel', 'moewe', 'krabbe'] as const;
/** Hares to defeat besides the ten (Jäger: 25 defeated). */
const HASEN = 20;
/** Place types discovered (Entdecker: six). */
const ORTSTYPEN = 6;

/** The session's simulation (the scenario context passes it along; only read). */
function simOf(s: WerkstattSzenarioSitzung): Simulation {
  const sim = (s as WerkstattSzenarioSitzung & { sim?(): Simulation }).sim?.();
  if (sim === undefined) throw new Error('Chronik-Szenario braucht die Simulation der Sitzung');
  return sim;
}

/** A step that runs `ticks` simulation steps, `SCHRITTE_JE_FRAME` per frame. */
function laufen(ticks: number): SzenarioSchritt {
  let rest = ticks;
  return (s) => {
    const n = Math.min(rest, SCHRITTE_JE_FRAME);
    for (let i = 0; i < n; i++) s.step();
    rest -= n;
    if (rest > 0) return false;
    rest = ticks;
    return true;
  };
}

/** Discovers the places of the first `n` types the world has (in slot order). */
const orteEntdecken: SzenarioSchritt = (s) => {
  const typen = new Set<string>();
  for (const p of simOf(s).world.generated.placeLayouts) {
    if (typen.has(p.type) || typen.size >= ORTSTYPEN) continue;
    typen.add(p.type);
    s.command({ type: 'place.discover', place: p.slot });
  }
  s.step();
  return true;
};

/** The played-through morning (see the module comment); `bisPerk`: stop after the skill rose (the perk choice opens). */
function gespielt(bisPerk: boolean): SzenarioSchritt[] {
  const perk: SzenarioSchritt[] = [befehle({ type: 'debug.unlock', skill: 'holzfaellen' })];
  if (bisPerk) return perk;
  return [
    befehle({ type: 'debug.god', on: true }, { type: 'quest.debug', quest: 'einstieg', schritt: 'werkbank' }),
    befehle({ type: 'craft.start', recipe: 'rezept_steinaxt', count: 1 }, { type: 'craft.start', recipe: 'rezept_steinspitzhacke', count: 1 }, { type: 'craft.start', recipe: 'rezept_steinmesser', count: 1 }),
    laufen(HANDWERK_TICKS),
    befehle(...TIERE.map((creature) => ({ type: 'creature.spawn', creature, count: 1 }))),
    laufen(SICHT_TICKS),
    befehle({ type: 'creature.spawn', creature: 'hase', count: HASEN }),
    laufen(2),
    befehle({ type: 'creature.kill', radius: KILL_RADIUS }),
    befehle({ type: 'quest.debug', quest: 'einstieg' }),
    laufen(SCHRITTE_JE_FRAME),
    orteEntdecken,
    befehle({ type: 'quest.debug', quest: 'hq_sechs_feuer_1', schritt: 'borkenvater' }),
    ...perk,
    befehle({ type: 'skills.choosePerk', skill: 'holzfaellen', level: 30, choice: 0 }, { type: 'skills.choosePerk', skill: 'holzfaellen', level: 60, choice: 1 }, { type: 'skills.choosePerk', skill: 'holzfaellen', level: 90, choice: 1 }),
    laufen(SCHRITTE_JE_FRAME),
  ];
}

/** Items of the morning: what the stone tools take (the hand recipes of T0). */
const ITEMS: ReadonlyArray<readonly [string, number]> = [
  ['zweig', 8],
  ['stein', 8],
  ['faserseil', 4],
  ['feuerstein', 4],
  ['fasern', 6],
];

/** `ui-chronik-<reiter>`: the chronicle on tab `reiter` after the morning. */
function chronikSzenario(reiter: ChronikReiter): WerkstattSzenario {
  return werkstattSzenario({
    name: `ui-chronik-${reiter}`,
    description: `M7-41: die Chronik (J) auf dem Reiter „${reiter}“ nach einem durchgespielten Morgen am Startstrand – Einstieg erledigt, Hauptaufgabe beim Borkenvater, Steinwerkzeuge, zehn Tierarten gesichtet und dreißig Kreaturen besiegt, sechs Orte entdeckt, Holzfällen auf 100 mit drei Perks`,
    items: ITEMS,
    schritte: gespielt(false),
    bildschirm: 'chronik',
    klicks: reiter === 'aufgaben' ? [] : [`[data-testid="chronik-reiter-${reiter}"]`],
  });
}

/** `funke`: the HUD (Voll) with Funke speaking at the dead beacon's step and the hint line of the main quest's start. */
function funkeSzenario(): WerkstattSzenario {
  return werkstattSzenario({
    name: 'funke',
    description:
      'M7-44: Funke im HUD (Voll) – links unter den Werten die Laterne mit dem Flammengeist und seine erste Dialogzeile zur erloschenen Leuchtfeuer-Stätte (höchstens zwei Zeilen), darunter die Hinweiszeile; rechts der Aufgaben-Tracker über dem Rezept-Tracker',
    items: ITEMS,
    vorher: () => {
      hudVorgabe.value = { modus: 'full' };
    },
    schritte: [
      befehle({ type: 'debug.god', on: true }, { type: 'quest.debug', quest: 'einstieg', schritt: 'werkbank' }, { type: 'craft.pin', recipe: 'rezept_steinaxt', on: true }),
      befehle({ type: 'quest.debug', quest: 'einstieg' }),
      // The main quest starts on the next world tick (its start trigger), the hint line tells of the tracker.
      laufen(SCHRITTE_JE_FRAME),
      befehle({ type: 'quest.debug', quest: 'hq_sechs_feuer_1', schritt: 'staette_finden' }),
      laufen(2),
      () => document.querySelector('[data-testid="hud-funke"]') !== null && document.querySelector('[data-testid="hud-aufgaben"]') !== null,
    ],
  });
}

/** `ui-perkwahl`: the perk choice that opens when woodcutting reaches 30, 60 and 90 at once (the first choice, two more waiting). */
function perkwahlSzenario(): WerkstattSzenario {
  return werkstattSzenario({
    name: 'ui-perkwahl',
    description: 'M7-48: die Perk-Wahl (öffnet auf `perkChoiceOpened`, pausiert) – Holzfällen Stufe 30: „Kraftvolle Hiebe“ oder „Reiche Stämme“, zwei weitere Wahlen warten; Fokusrahmen auf der ersten Karte',
    items: [],
    schritte: [...gespielt(true), () => document.querySelector('[data-testid="ui-perkwahl"]') !== null],
    fokus: '[data-testid="perkwahl-kraftvolle_hiebe"]',
  });
}

/** The scenarios of strand G. */
export function chronikSzenarien(): WerkstattSzenario[] {
  return [...CHRONIK_REITER.map(chronikSzenario), funkeSzenario(), perkwahlSzenario()];
}
