/**
 * The mechanics of strand D in the mechanics register (docs/SPIEL.md §23 "Vermittlungs-Register"; M7-19 … M7-24): each taught
 * by a hint (src/content/guide/feld.ts), a knowledge entry (src/content/wissen/feld.ts) and a tooltip (the item, crop, station
 * or part it is about).
 */
import type { MechanicInput } from './schema';

export const MECHANICS_D: readonly MechanicInput[] = [
  { id: 'mech_feld_saeen', paragraph: '§17', task: 'M7-19', hinweis: 'hinweis_feld_saeen', wissen: 'wissen_feld', tooltip: { art: 'content', sammlung: 'items', id: 'saat_karotte' } },
  { id: 'mech_feld_giessen', paragraph: '§17', task: 'M7-19', hinweis: 'hinweis_feld_giessen', wissen: 'wissen_feld_wachstum', tooltip: { art: 'content', sammlung: 'items', id: 'giesskanne' } },
  { id: 'mech_feld_wachstum', paragraph: '§17', task: 'M7-19', hinweis: 'funke_feld_frost', wissen: 'wissen_feld_wachstum', tooltip: { art: 'content', sammlung: 'crops', id: 'karotte' } },
  { id: 'mech_feld_qualitaet', paragraph: '§17', task: 'M7-20', hinweis: 'hinweis_feld_duenger', wissen: 'wissen_feld_duenger', tooltip: { art: 'content', sammlung: 'items', id: 'kompost' } },
  { id: 'mech_feld_kompost', paragraph: '§15', task: 'M7-20', hinweis: 'hinweis_kompostkiste', wissen: 'wissen_feld_duenger', tooltip: { art: 'content', sammlung: 'stations', id: 'kompostkiste' } },
  { id: 'mech_feld_schaedlinge', paragraph: '§17', task: 'M7-20', hinweis: 'funke_feld_kraehen', wissen: 'wissen_feld_schaedlinge', tooltip: { art: 'content', sammlung: 'buildParts', id: 'vogelscheuche' } },
  { id: 'mech_feld_gewaechshaus', paragraph: '§16', task: 'M7-23', hinweis: 'hinweis_gewaechshaus', wissen: 'wissen_gewaechshaus', tooltip: { art: 'content', sammlung: 'roomTypes', id: 'gewaechshaus' } },
  { id: 'mech_feld_setzlinge', paragraph: '§14', task: 'M7-23', hinweis: 'hinweis_setzling', wissen: 'wissen_setzlinge', tooltip: { art: 'content', sammlung: 'items', id: 'setzling_apfelbaum' } },
  { id: 'mech_angeln_drill', paragraph: '§14', task: 'M7-24', hinweis: 'funke_angeln_biss', wissen: 'wissen_angeln', tooltip: { art: 'content', sammlung: 'items', id: 'angel_holz' } },
  { id: 'mech_angeln_koeder', paragraph: '§14', task: 'M7-24', hinweis: 'hinweis_angeln_koeder', wissen: 'wissen_angeln', tooltip: { art: 'content', sammlung: 'items', id: 'regenwurm' } },
  { id: 'mech_angeln_reuse', paragraph: '§14', task: 'M7-24', hinweis: 'hinweis_reuse', wissen: 'wissen_reusen', tooltip: { art: 'content', sammlung: 'items', id: 'reuse' } },
  { id: 'mech_angeln_eis', paragraph: '§14', task: 'M7-24', hinweis: 'hinweis_eisangeln', wissen: 'wissen_eisangeln', tooltip: { art: 'content', sammlung: 'fish', id: 'quappe' } },
];
