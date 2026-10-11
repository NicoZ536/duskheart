/**
 * The mechanics of strand C in the mechanics register (docs/SPIEL.md §23 "Vermittlungs-Register"; M7-10 … M7-18, M7-46): each
 * taught by a hint (src/content/guide/gewoelbe.ts), a knowledge entry (src/content/wissen/gewoelbe.ts) and a tooltip (the item,
 * station or content record it is about).
 */
import type { MechanicInput } from './schema';

export const MECHANICS_C: readonly MechanicInput[] = [
  { id: 'mech_gewoelbe_abstieg', paragraph: '§21', task: 'M7-10', hinweis: 'funke_gewoelbe_betreten', wissen: 'wissen_gewoelbe', tooltip: { art: 'content', sammlung: 'locationTypes', id: 'gewoelbe' } },
  { id: 'mech_gewoelbe_schloss', paragraph: '§21', task: 'M7-10', hinweis: 'hinweis_gewoelbe_schloss', wissen: 'wissen_gewoelbe_schloesser', tooltip: { art: 'content', sammlung: 'items', id: 'gewoelbeschluessel' } },
  { id: 'mech_gewoelbe_raetsel', paragraph: '§21', task: 'M7-12', hinweis: 'hinweis_gewoelbe_raetseltuer', wissen: 'wissen_raetsel', tooltip: { art: 'content', sammlung: 'puzzleTypes', id: 'hebel' } },
  { id: 'mech_gewoelbe_raetsel_falsch', paragraph: '§21', task: 'M7-13', hinweis: 'funke_raetsel_falsch', wissen: 'wissen_raetsel', tooltip: { art: 'content', sammlung: 'puzzleTypes', id: 'feuerschalen' } },
  { id: 'mech_gewoelbe_fallen', paragraph: '§21', task: 'M7-14', hinweis: 'funke_falle_warnung', wissen: 'wissen_gewoelbe_fallen', tooltip: { art: 'content', sammlung: 'vaultTraps', id: 'pfeilwerfer' } },
  { id: 'mech_gewoelbe_glutsplitter', paragraph: '§21', task: 'M7-16', hinweis: 'hinweis_glutsplitter', wissen: 'wissen_gewoelbe_beute', tooltip: { art: 'content', sammlung: 'items', id: 'glutsplitter' } },
  { id: 'mech_gewoelbe_bauplan', paragraph: '§15', task: 'M7-16', hinweis: 'hinweis_bauplan', wissen: 'wissen_forschung', tooltip: { art: 'content', sammlung: 'items', id: 'bauplan_kartentisch' } },
  { id: 'mech_gewoelbe_forschungspult', paragraph: '§15', task: 'M7-18', hinweis: 'hinweis_relikt', wissen: 'wissen_forschung', tooltip: { art: 'content', sammlung: 'stations', id: 'forschungspult' } },
  { id: 'mech_gewoelbe_kartentisch', paragraph: '§15', task: 'M7-18', hinweis: 'hinweis_bauplan', wissen: 'wissen_forschung', tooltip: { art: 'content', sammlung: 'stations', id: 'kartentisch' } },
  { id: 'mech_gewoelbe_tafeln', paragraph: '§8', task: 'M7-46', hinweis: 'hinweis_erbauer_tafel', wissen: 'wissen_tafel_01', tooltip: { art: 'content', sammlung: 'tablets', id: 'tafel_01' } },
];
