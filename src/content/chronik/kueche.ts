/**
 * Chronicle rules of strand E (docs/SPIEL.md §21, §23; M7-25 … M7-30): the first dish of the cauldron, the first bread from the
 * oven, raw meat that made the player sick, the first spoiled supplies in the bags, the first water caught by a rain collector.
 */
import type { ChronicleRuleInput } from './schema';

export const CHRONICLE_RULES_E: readonly ChronicleRuleInput[] = [
  {
    id: 'chronik_kueche_erstes_gericht',
    ereignis: 'craftCompleted',
    wo: { recipe: 'rezept_eintopf' },
    art: 'handwerk',
    text: { de: 'Mein erster Eintopf aus dem Kessel – warm bis in die Zehen.', en: 'My first stew from the cauldron – warm down to my toes.' },
    einmalig: true,
  },
  {
    id: 'chronik_kueche_erstes_brot',
    ereignis: 'stationProduced',
    wo: { station: 'backofen', item: 'brot' },
    art: 'handwerk',
    text: { de: 'Das erste Brot aus meinem Ofen. Es riecht nach Zuhause.', en: 'The first bread from my oven. It smells of home.' },
    einmalig: true,
  },
  {
    id: 'chronik_kueche_roh',
    ereignis: 'mealEaten',
    wo: { roh: true },
    art: 'tagebuch',
    text: { de: 'Rohes Fleisch war ein Fehler – mir ist speiübel.', en: 'Raw meat was a mistake – I feel sick to my stomach.' },
    einmalig: true,
  },
  {
    id: 'chronik_kueche_verdorben',
    ereignis: 'foodSpoiled',
    wo: { behaelter: 'taschen' },
    art: 'tagebuch',
    text: { de: 'Mein {item} ist in der Tasche verdorben. Vorräte gehören ins Fass.', en: 'My {item} spoiled in my bag. Supplies belong in a barrel.' },
    platzhalter: { item: 'item' },
    einmalig: true,
  },
  {
    id: 'chronik_wasser_regen',
    ereignis: 'vesselFilled',
    wo: { quelle: 'regensammler' },
    art: 'tagebuch',
    text: { de: 'Regenwasser aus meinem Sammler – sauber und ohne Fieber.', en: 'Rainwater from my collector – clean and without fever.' },
    einmalig: true,
  },
];
