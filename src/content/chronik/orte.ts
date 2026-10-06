/**
 * Chronicle rules of strand B (docs/SPIEL.md §17, §18; M7-07 … M7-09, M7-38 … M7-40): places discovered, cleansed and
 * plundered, the look-out tower and the shrine; the start of every world event that runs (its `chronik` text of the register)
 * and the meteorite's impact.
 */
import { WORLD_EVENTS } from '../worldEvents/index';
import type { ChronicleRuleInput } from './schema';

const PLACES: readonly ChronicleRuleInput[] = [
  {
    id: 'chronik_ort_entdeckt',
    ereignis: 'placeDiscovered',
    art: 'entdeckung',
    text: { de: 'Entdeckt: {ortstyp}.', en: 'Discovered: {ortstyp}.' },
    platzhalter: { ortstyp: 'ort' },
  },
  {
    id: 'chronik_ort_gesaeubert',
    ereignis: 'placeCleansed',
    art: 'kampf',
    text: { de: 'Die Wächter von {ortstyp} sind gefallen – für eine Weile ist der Ort frei.', en: 'The guards of {ortstyp} have fallen – the place is free for a while.' },
    platzhalter: { ortstyp: 'ort' },
  },
  {
    id: 'chronik_ort_gepluendert',
    ereignis: 'placeLooted',
    art: 'tagebuch',
    text: { de: 'Die letzte Truhe von {ortstyp} ist leer.', en: 'The last chest of {ortstyp} is empty.' },
    platzhalter: { ortstyp: 'ort' },
  },
  {
    id: 'chronik_ort_turm',
    ereignis: 'towerClimbed',
    art: 'tagebuch',
    text: { de: 'Vom Aussichtsturm aus lag die Insel weit unter mir.', en: 'From the look-out tower the island lay far below me.' },
    einmalig: true,
  },
  {
    id: 'chronik_ort_segen',
    ereignis: 'shrineBlessed',
    art: 'tagebuch',
    text: { de: 'Am Schrein der Erbauer empfing ich ihren Segen.', en: 'At the Builders’ shrine I received their blessing.' },
    einmalig: true,
  },
  {
    id: 'chronik_meteorit',
    ereignis: 'meteorImpact',
    art: 'welt',
    text: { de: 'Ein Meteorit schlug ein und ließ Sternenerz zurück.', en: 'A meteorite came down and left star ore behind.' },
  },
];

/** The start of every world event that runs, with the register's chronicle text. */
const EVENTS: readonly ChronicleRuleInput[] = WORLD_EVENTS.filter((e) => e.umgesetzt === true).map((e) => ({
  id: `chronik_ereignis_${e.id}`,
  ereignis: 'worldEventStarted',
  wo: { event: e.id },
  art: 'welt',
  text: e.chronik,
}));

export const CHRONICLE_RULES_B: readonly ChronicleRuleInput[] = [...PLACES, ...EVENTS];
