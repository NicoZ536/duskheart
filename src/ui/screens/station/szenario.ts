/**
 * Screenshot scenarios of the station screen (M4-07, MASTERPROMPT §31.5), both over the start beach at 11:00 and
 * played with the game's commands (registered in src/debug/scenarios.ts):
 *
 * - `ui-station`: a workbench set up next to the player and opened (`station.use`): the recipe book of the bench
 *   with its recipes, two palisade walls in the queue (the first a third done), the clay oven chosen – its clay is
 *   missing ("Fehlt: 12× Lehm – Graben mit der Schaufel: Lehm") –, focus frame on "Herstellen".
 * - `ui-station-ofen`: a clay oven next to the player with clay in its input and wood on the fuel slot, 84 s of
 *   work later: one pot in the output, the second 40 % fired, the wood glowing; the bags beside it (what the oven
 *   takes bright), what it makes – the brick chosen, one raw brick missing with its hint –, focus on "Alles nehmen".
 * - `ui-station-reparatur` (M4-09): the player chopped a pine near the start – two hits with the stone axe, one with
 *   the bronze axe (`werkzeugeAbnutzen`) – and stands at a workbench again; its repair tab: the stone axe (58/60) mended
 *   here, chosen, its material (a twig) missing with the hint; the bronze axe (149/150) under "Braucht eine andere
 *   Station" (Werkbank I mends tier 0 only); the tab strip with the count; focus frame on "Reparieren".
 */
import { platzieren, schritte, werkstattSzenario, type WerkstattSzenario } from '../handwerk/szenarioHilfe';
import { werkzeugeAbnutzen } from './abnutzen';

/** The first station of a fresh world gets id 1; the scenarios keep the id the simulation reports. */
let werkbank = 0;
let ofen = 0;
let reparaturBank = 0;

/** Ticks the first palisade wall has worked (of 180: a third). */
const WAND_TICKS = 60;
/** Ticks the clay oven works before the picture: one pot (60 s) and 40 % of the next [ticks at 60 Hz]. */
const OFEN_TICKS = 5040;
/** Ticks stepped per frame while the oven works (keeps every frame short). */
const TICKS_JE_FRAME = 240;

export function stationSzenario(): WerkstattSzenario {
  return werkstattSzenario({
    name: 'ui-station',
    description:
      'M4-07: Stationsbildschirm einer Werkbank neben dem Spieler – Rezeptliste der Werkbank mit Suche und Filter, gewählt der Lehmofen mit seinen Zutaten, „Fehlt: 12× Lehm – Graben mit der Schaufel: Lehm“, „Werkbank in Reichweite“, Menge; Warteschlange mit zwei Palisadenwänden (Fortschritt), Fokusrahmen auf „Herstellen“',
    items: [
      ['werkbank', 1],
      ['holz', 24],
      ['stein', 14],
      ['faserseil', 6],
      ['zweig', 12],
      ['harz', 3],
      ['fasern', 10],
      ['lehm', 4],
    ],
    schritte: [
      platzieren(
        (tx, ty) => ({ type: 'station.place', from: { bereich: 'inventar', index: 0 }, tx, ty }),
        'stationPlaced',
        (id) => (werkbank = id),
      ),
      (s) => {
        s.command({ type: 'craft.start', recipe: 'rezept_wand_palisade', count: 2 });
        s.command({ type: 'station.use', station: werkbank });
        s.step();
        return true;
      },
      schritte(WAND_TICKS),
    ],
    klicks: ['[data-rezept="rezept_lehmofen"]'],
    fokus: '[data-testid="handwerk-herstellen"]',
  });
}

export function stationOfenSzenario(): WerkstattSzenario {
  return werkstattSzenario({
    name: 'ui-station-ofen',
    description:
      'M4-07: Stationsbildschirm eines Lehmofens – Eingang mit Lehm, Pfeil mit Fortschritt (zweiter Topf zu 40 %), Ausgang mit einem Keramiktopf, Brennstoffplatz mit Holz und glimmender Glut, Statuszeile „Arbeitet: Keramiktopf“; daneben die Taschen (was der Ofen nimmt, hell) und was er herstellt, gewählt der Ziegel mit „Fehlt: 1× Rohziegel – entsteht auf dem Trockengestell“; Fokusrahmen auf „Alles nehmen“',
    items: [
      ['lehmofen', 1],
      ['lehm', 9],
      ['holz', 4],
      ['sand', 3],
      ['ziegel_roh', 1],
      ['zweig', 5],
      ['stein', 8],
    ],
    schritte: [
      platzieren(
        (tx, ty) => ({ type: 'station.place', from: { bereich: 'inventar', index: 0 }, tx, ty }),
        'stationPlaced',
        (id) => (ofen = id),
      ),
      (s) => {
        s.command({ type: 'station.put', station: ofen, from: { bereich: 'inventar', index: 1 }, bereich: 'eingang' });
        s.command({ type: 'station.put', station: ofen, from: { bereich: 'inventar', index: 2 }, bereich: 'brennstoff', count: 3 });
        s.step();
        return true;
      },
      schritte(OFEN_TICKS, TICKS_JE_FRAME),
      (s) => {
        s.command({ type: 'station.use', station: ofen });
        s.step();
        return true;
      },
    ],
    klicks: ['[data-testid="station-rezept-rezept_ziegel"]'],
    fokus: '[data-testid="station-alles-nehmen"]',
  });
}

export function stationReparaturSzenario(): WerkstattSzenario {
  return werkstattSzenario({
    name: 'ui-station-reparatur',
    description:
      'M4-09: Reiter „Reparieren“ einer Werkbank – die Steinaxt (58/60, zwei Hiebe an einer Kiefer) gewählt: Haltbarkeit, Abnutzung und anteilige Kosten, Material 0/1 Zweig mit „Fehlt: 1× Zweig – …“, „Repariert an: Werkbank“; darunter „Braucht eine andere Station“ mit der Bronzeaxt (149/150, Werkbank I repariert nur Stufe 0); Reiterleiste mit der Zahl; Fokusrahmen auf „Reparieren“',
    items: [
      ['werkbank', 1],
      ['steinaxt', 1],
      ['bronzeaxt', 1],
      ['stein', 6],
      ['faserseil', 2],
      ['holz', 8],
    ],
    schritte: [
      werkzeugeAbnutzen([
        { hotbar: 0, hiebe: 2 },
        { hotbar: 1, hiebe: 1 },
      ]),
      platzieren(
        (tx, ty) => ({ type: 'station.place', from: { bereich: 'inventar', index: 0 }, tx, ty }),
        'stationPlaced',
        (id) => (reparaturBank = id),
      ),
      (s) => {
        s.command({ type: 'station.use', station: reparaturBank });
        s.step();
        return true;
      },
    ],
    klicks: ['[data-testid="station-reiter-reparieren"]'],
    fokus: '[data-testid="reparatur-reparieren"]',
  });
}
