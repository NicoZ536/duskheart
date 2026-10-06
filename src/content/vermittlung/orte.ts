/**
 * The mechanics of strand B in the mechanics register (docs/SPIEL.md §23 "Vermittlungs-Register"; M7-07, M7-38, M7-40): each
 * taught by a hint, a knowledge entry and a tooltip.
 */
import type { MechanicInput } from './schema';

export const MECHANICS_B: readonly MechanicInput[] = [
  { id: 'mech_orte_entdecken', paragraph: '§21', task: 'M7-07', hinweis: 'funke_ort_erster', wissen: 'wissen_orte', tooltip: { art: 'content', sammlung: 'locationTypes', id: 'gehoeft' } },
  { id: 'mech_ereignisse_ankuendigung', paragraph: '§10', task: 'M7-38', hinweis: 'funke_ereignis_finstermond', wissen: 'wissen_ereignisse', tooltip: { art: 'content', sammlung: 'worldEvents', id: 'finstermond' } },
  { id: 'mech_wetter_blitze', paragraph: '§10', task: 'M7-40', hinweis: 'funke_blitz', wissen: 'wissen_blitze', tooltip: { art: 'content', sammlung: 'worldEvents', id: 'waldbrand' } },
];
