/**
 * The mechanics of strand A in the mechanics register (docs/SPIEL.md §23 "Vermittlungs-Register"; M7-31): each taught by a
 * hint, a knowledge entry and a tooltip.
 */
import type { MechanicInput } from './schema';

export const MECHANICS_A: readonly MechanicInput[] = [
  { id: 'mech_klang_musizieren', paragraph: '§11.4', task: 'M7-31', hinweis: 'funke_erstes_lied', wissen: 'wissen_musizieren', tooltip: { art: 'content', sammlung: 'items', id: 'floete' } },
  { id: 'mech_klang_kescher', paragraph: '§14', task: 'M7-31', hinweis: 'funke_erstes_gluehwuermchen', wissen: 'wissen_kescher', tooltip: { art: 'content', sammlung: 'items', id: 'netz' } },
];
