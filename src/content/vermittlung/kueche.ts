/**
 * The mechanics of strand E in the mechanics register (docs/SPIEL.md §23 "Vermittlungs-Register"; M7-25 … M7-30): each taught
 * by a hint (src/content/guide/kueche.ts), a knowledge entry (src/content/wissen/kueche.ts) and a tooltip (the item, station or
 * room type it is about).
 */
import type { MechanicInput } from './schema';

export const MECHANICS_E: readonly MechanicInput[] = [
  { id: 'mech_kueche_kessel', paragraph: '§18', task: 'M7-25', hinweis: 'hinweis_kessel_feuer', wissen: 'wissen_kochen', tooltip: { art: 'content', sammlung: 'stations', id: 'kessel' } },
  { id: 'mech_kueche_roh', paragraph: '§18', task: 'M7-25', hinweis: 'funke_kueche_roh', wissen: 'wissen_kochen', tooltip: { art: 'content', sammlung: 'items', id: 'wildfleisch_roh' } },
  { id: 'mech_kueche_ueberdruss', paragraph: '§18', task: 'M7-26', hinweis: 'hinweis_kueche_ueberdruss', wissen: 'wissen_mahlzeiten', tooltip: { art: 'i18n', schluessel: 'ui.essen.ueberdruss' } },
  { id: 'mech_kueche_traenke', paragraph: '§18', task: 'M7-28', hinweis: 'hinweis_kraeutertisch', wissen: 'wissen_traenke', tooltip: { art: 'content', sammlung: 'stations', id: 'kraeutertisch' } },
  { id: 'mech_kueche_verderb', paragraph: '§18', task: 'M7-29', hinweis: 'funke_kueche_verdorben', wissen: 'wissen_verderb', tooltip: { art: 'content', sammlung: 'items', id: 'vorratsfass' } },
  { id: 'mech_wasser_abkochen', paragraph: '§18', task: 'M7-30', hinweis: 'hinweis_wasser_abkochen', wissen: 'wissen_wasser', tooltip: { art: 'content', sammlung: 'items', id: 'wasser_abgekocht' } },
  { id: 'mech_wasser_regensammler', paragraph: '§18', task: 'M7-30', hinweis: 'hinweis_regensammler', wissen: 'wissen_wasser', tooltip: { art: 'content', sammlung: 'items', id: 'regensammler' } },
  { id: 'mech_kueche_raum', paragraph: '§16.4', task: 'M7-30', hinweis: 'hinweis_kessel_feuer', wissen: 'wissen_kueche_raum', tooltip: { art: 'content', sammlung: 'roomTypes', id: 'kueche' } },
];
