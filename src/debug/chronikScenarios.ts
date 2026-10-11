/**
 * Screenshot scenarios of strand G (MASTERPROMPT §31.5; M7-41, M7-44, M7-48): the chronicle's seven tabs, Funke in the HUD and
 * the perk choice – each in the same played-through morning at the start beach, built with the game's own commands and single
 * simulation steps (deterministic: fixed seed, frozen loop):
 *
 * - the onboarding up to the bronze, then finished (its reward, the diary's entries), the main quest started and moved on to the
 *   Barkfather's step (the quest tab's progress, the HUD's tracker);
 * - the three stone tools crafted by hand (Steinzeit), ten kinds of animals sighted and thirty creatures defeated by the player
 *   (bestiary, Forscher, Jäger), six place types discovered (Entdecker), the woodcutting skill at 100 with its perks of 30 and 60
 *   chosen (statistics; the choice at 90 stays open for the perk choice);
 * - four kinds of plants picked by hand (beach grass, fibre grass, bushes …: the herbarium), the player put next to each in
 *   turn and back.
 *
 * `ui-chronik-<reiter>` opens the chronicle on its tab; `funke` shows the HUD (mode Voll) with Funke speaking the first line of
 * his dialog at the dead beacon's step and the hint line; `ui-perkwahl` the perk choice that opens when the skill rises.
 * Registered in src/debug/scenarios.ts.
 */
import { BALANCE } from '../content/balance';
import { createObjectHit, GATHERING_SYSTEM_ID, GatheringSystem } from '../game/gathering/system';
import type { Simulation } from '../game/sim';
import { TILE_PX } from '../world/model/coords';
import { hudVorgabe } from '../ui/hud/Hud';
import { befehle, werkstattSzenario, type SzenarioSchritt, type WerkstattSzenario, type WerkstattSzenarioSitzung } from '../ui/screens/handwerk/szenarioHilfe';
import { CHRONIK_REITER, type ChronikReiter } from '../ui/screens/chronik/modell';

/** Simulation steps per rendered frame while a scenario plays (a frame stays well under a second; the scenario under 90 s). */
const SCHRITTE_JE_FRAME = 300;
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
/** Ticks Funke waits after a comment before a quest step's dialog may speak (`BALANCE.guide.funkeUrgentSeconds`). */
const FUNKE_DRINGEND_TICKS = BALANCE.guide.funkeUrgentSeconds * BALANCE.time.tickHz;
/** Simulation steps per frame while waiting for the hint plate (two frames stay under the 420 ticks a hint shows). */
const SCHRITTE_JE_WARTEN = 120;
/** Longest wait for a context hint [ticks]: twice the least time between two hints. */
const HINWEIS_WARTEN_MAX = 2 * BALANCE.guide.hintMinSeconds * BALANCE.time.tickHz;

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

/**
 * Runs on until Funke may speak a dialog again (`FUNKE_DRINGEND_TICKS` after his last comment) and a context hint shows on the
 * hint plate – the hints come from the morning's own triggers (an item picked up, a quest started), so the step waits for the
 * next one instead of guessing its tick.
 */
function bisHinweis(): SzenarioSchritt {
  let gelaufen = 0;
  return (s) => {
    if (gelaufen >= FUNKE_DRINGEND_TICKS && document.querySelector('[data-testid="hud-hinweiszeile"]') !== null) {
      gelaufen = 0;
      return true;
    }
    if (gelaufen >= HINWEIS_WARTEN_MAX) throw new Error(`Szenario funke: nach ${gelaufen} Ticks keine Hinweiszeile`);
    for (let i = 0; i < SCHRITTE_JE_WARTEN; i++) s.step();
    gelaufen += SCHRITTE_JE_WARTEN;
    return false;
  };
}

/** Tiles searched around the player for plants to pick (the loaded chunks around the start beach). */
const PFLANZEN_SUCHE_KACHELN = 40;
/** Kinds of plants picked for the herbarium. */
const PFLANZEN_ARTEN = 4;
/** Kinds tried at most (a bush or a mushroom out of season refuses: `notRipe`). */
const PFLANZEN_KANDIDATEN = 18;
/** Longest a picking may take [ticks] (hand picking holds E for about half a second). */
const PFLUECKEN_MAX_TICKS = 600;

/** One plant to pick: its anchor tile. */
interface Pflanze {
  readonly tx: number;
  readonly ty: number;
}

/**
 * Picks `PFLANZEN_ARTEN` kinds of hand-picked plants (bushes, herbs, flowers – the nearest of each kind, nearest kinds first;
 * one the season refuses is skipped): per frame the player stands south of one, aims and holds E until the simulation reports
 * the harvest or refuses, then he returns to where he stood. Throws if a picking neither ends nor is refused in time.
 */
function pflanzenPfluecken(): SzenarioSchritt {
  let ziele: Pflanze[] | null = null;
  let start: { x: number; y: number; layer: number } | null = null;
  let ziel = 0;
  let gepflueckt = 0;
  return (s) => {
    const p = s.state().player;
    if (p === null) throw new Error('Chronik-Szenario: kein Spieler zum Pflücken');
    if (ziele === null) {
      start = { x: p.x, y: p.y, layer: p.layer };
      ziele = pflanzenSuchen(simOf(s), Math.floor(p.x / TILE_PX), Math.floor(p.y / TILE_PX));
      ziel = 0;
      gepflueckt = 0;
    }
    const z = ziele[ziel];
    if (z === undefined || gepflueckt >= PFLANZEN_ARTEN) {
      const st = start as { x: number; y: number; layer: number };
      s.command({ type: 'player.teleport', x: st.x, y: st.y, layer: st.layer });
      s.step();
      ziele = null;
      return true;
    }
    const vorher = s.state().events;
    const ernten = vorher.harvested;
    const abgelehnt = vorher.commandRejected;
    const x = z.tx * TILE_PX + TILE_PX / 2;
    s.command({ type: 'player.teleport', x, y: (z.ty + 1) * TILE_PX + TILE_PX / 2, layer: 0 });
    s.step();
    s.command({ type: 'player.aim', x, y: z.ty * TILE_PX + TILE_PX / 2 });
    s.command({ type: 'player.interact', on: true, tx: z.tx, ty: z.ty });
    let fertig = false;
    for (let i = 0; i < PFLUECKEN_MAX_TICKS && !fertig; i++) {
      s.step();
      const e = s.state().events;
      if (e.harvested !== ernten) {
        gepflueckt++;
        fertig = true;
      } else if (e.commandRejected !== abgelehnt) fertig = true;
    }
    if (!fertig) throw new Error(`Chronik-Szenario: Pflanze bei ${z.tx},${z.ty} weder gepflückt noch abgelehnt`);
    s.command({ type: 'player.interact', on: false });
    s.step();
    ziel++;
    return false;
  };
}

/** The nearest standing hand-picked plant of each kind around tile (cx, cy), nearest kinds first, at most `PFLANZEN_KANDIDATEN`. */
function pflanzenSuchen(sim: Simulation, cx: number, cy: number): Pflanze[] {
  const gathering = sim.system(GATHERING_SYSTEM_ID);
  if (!(gathering instanceof GatheringSystem)) throw new Error('Chronik-Szenario: kein Sammel-System');
  const hit = createObjectHit();
  const beste = new Map<string, Pflanze & { d: number }>();
  for (let ty = cy - PFLANZEN_SUCHE_KACHELN; ty <= cy + PFLANZEN_SUCHE_KACHELN; ty++) {
    for (let tx = cx - PFLANZEN_SUCHE_KACHELN; tx <= cx + PFLANZEN_SUCHE_KACHELN; tx++) {
      if (!gathering.objectAt(0, tx, ty, hit) || hit.rule === null || hit.tx !== tx || hit.ty !== ty) continue;
      const def = hit.rule.def;
      if ((def.kind !== 'pflanze' && def.kind !== 'busch') || def.tool !== 'hand' || hit.rule.standing === null) continue;
      const d = (tx - cx) * (tx - cx) + (ty - cy) * (ty - cy);
      const alt = beste.get(def.id);
      if (alt === undefined || d < alt.d) beste.set(def.id, { tx, ty, d });
    }
  }
  return [...beste.values()]
    .sort((a, b) => a.d - b.d || a.ty - b.ty || a.tx - b.tx)
    .slice(0, PFLANZEN_KANDIDATEN)
    .map(({ tx, ty }) => ({ tx, ty }));
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
    pflanzenPfluecken(),
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

/** `funke`: the HUD (Voll) with Funke speaking at the dead beacon's step and a context hint on its plate below. */
function funkeSzenario(): WerkstattSzenario {
  return werkstattSzenario({
    name: 'funke',
    description:
      'M7-44: Funke im HUD (Voll) – links unter den Werten die Laterne mit dem Flammengeist und seine erste Dialogzeile zur erloschenen Leuchtfeuer-Stätte (höchstens zwei Zeilen), darunter ein Kontext-Hinweis auf eigenem Schild (höchstens zwei Zeilen); rechts der Aufgaben-Tracker über dem Rezept-Tracker',
    items: ITEMS,
    vorher: () => {
      hudVorgabe.value = { modus: 'full' };
    },
    schritte: [
      befehle({ type: 'debug.god', on: true }, { type: 'quest.debug', quest: 'einstieg', schritt: 'werkbank' }, { type: 'craft.pin', recipe: 'rezept_steinaxt', on: true }),
      // The onboarding ends: Funke cheers (the bronze), the main quest starts on the next world tick (its start trigger).
      befehle({ type: 'quest.debug', quest: 'einstieg' }),
      bisHinweis(),
      // The site found: the jump to its step is silent, the step done moves the quest on like play – Funke speaks the
      // dialog of the Barkfather's step (at the dead beacon) beside the hint still showing.
      befehle({ type: 'quest.debug', quest: 'hq_sechs_feuer_1', schritt: 'staette_finden' }),
      befehle({ type: 'quest.debug', quest: 'hq_sechs_feuer_1' }),
      laufen(2),
      () =>
        document.querySelector('[data-testid="hud-funke"][data-funke="funke_staette:0"]') !== null &&
        document.querySelector('[data-testid="hud-hinweiszeile"]') !== null &&
        document.querySelector('[data-testid="hud-aufgaben"]') !== null,
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
