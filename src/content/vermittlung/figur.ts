/**
 * The mechanics of strand I in the mechanics register (docs/SPIEL.md §23 "Vermittlungs-Register"; M7-17): the elites, taught
 * by Funke's remark at the first meeting (src/content/guide/figur.ts), a knowledge entry (src/content/wissen/figur.ts) and the
 * creature's tooltip (its bestiary entry).
 */
import type { MechanicInput } from './schema';

export const MECHANICS_I: readonly MechanicInput[] = [
  { id: 'mech_figur_elite', paragraph: '§20.1', task: 'M7-17', hinweis: 'funke_elite', wissen: 'wissen_elites', tooltip: { art: 'content', sammlung: 'creatures', id: 'graufang' } },
];
