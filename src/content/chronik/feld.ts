/**
 * Chronicle rules of strand D (docs/SPIEL.md §20, §23; M7-19 … M7-24): the first harvest, a crop lost to frost, the first
 * compost, a sapling grown into a tree, the first fish, a line snapped by a big one, the first catch in a fish trap.
 */
import type { ChronicleRuleInput } from './schema';

export const CHRONICLE_RULES_D: readonly ChronicleRuleInput[] = [
  {
    id: 'chronik_feld_erste_ernte',
    ereignis: 'cropHarvested',
    art: 'tagebuch',
    text: { de: 'Meine erste Ernte: {crop}.', en: 'My first harvest: {crop}.' },
    platzhalter: { crop: 'item' },
    einmalig: true,
  },
  {
    id: 'chronik_feld_frost',
    ereignis: 'cropDied',
    wo: { grund: 'frost' },
    art: 'tagebuch',
    text: { de: 'Der Frost hat mir {crop} auf dem Feld erfroren.', en: 'The frost killed my {crop} in the field.' },
    platzhalter: { crop: 'item' },
    einmalig: true,
  },
  {
    id: 'chronik_feld_kompost',
    ereignis: 'stationProduced',
    wo: { station: 'kompostkiste' },
    art: 'handwerk',
    text: { de: 'Mein erster Kompost ist fertig – der Boden wird es mir danken.', en: 'My first compost is ready – the soil will thank me.' },
    einmalig: true,
  },
  {
    id: 'chronik_feld_baum',
    ereignis: 'saplingGrown',
    art: 'tagebuch',
    text: { de: 'Aus meinem Setzling ist ein Baum geworden.', en: 'My sapling has grown into a tree.' },
    einmalig: true,
  },
  {
    id: 'chronik_angeln_erster_fang',
    ereignis: 'fishCaught',
    art: 'tagebuch',
    text: { de: 'Mein erster Fang: {fish}.', en: 'My first catch: {fish}.' },
    platzhalter: { fish: 'item' },
    einmalig: true,
  },
  {
    id: 'chronik_angeln_gerissen',
    ereignis: 'fishLost',
    wo: { grund: 'gerissen' },
    art: 'tagebuch',
    text: { de: 'Ein großer Fisch hat mir die Schnur zerrissen.', en: 'A big fish snapped my line.' },
    einmalig: true,
  },
  {
    id: 'chronik_angeln_reuse',
    ereignis: 'fishTrapEmptied',
    art: 'tagebuch',
    text: { de: 'In meiner Reuse saßen {anzahl} Fische.', en: 'My fish trap held {anzahl} fish.' },
    platzhalter: { anzahl: 'zahl' },
    einmalig: true,
  },
];
