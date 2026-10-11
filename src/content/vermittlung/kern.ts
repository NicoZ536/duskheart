/**
 * The mechanics of strand G in the mechanics register (docs/SPIEL.md §23 "Vermittlungs-Register"; M7-41 … M7-48): quests and
 * their tracker, the onboarding, the main quest, Funke, achievements, the chronicle's knowledge and the perks of the
 * non-combat skills.
 */
import type { MechanicInput } from './schema';

export const MECHANICS_G_KERN: readonly MechanicInput[] = [
  { id: 'mech_chronik_aufgaben', paragraph: '§23.3', task: 'M7-42', hinweis: 'hinweis_aufgaben', wissen: 'wissen_chronik', tooltip: { art: 'i18n', schluessel: 'ui.chronik.reiter.aufgaben' } },
  { id: 'mech_chronik_einstieg', paragraph: '§23.3', task: 'M7-43', hinweis: 'aufgabe:einstieg/fasern_steine', wissen: 'wissen_chronik', tooltip: { art: 'content', sammlung: 'quests', id: 'einstieg' } },
  { id: 'mech_chronik_hauptaufgabe', paragraph: '§8', task: 'M7-42', hinweis: 'aufgabe:hq_sechs_feuer_1/staette_finden', wissen: 'wissen_sechs_feuer', tooltip: { art: 'content', sammlung: 'quests', id: 'hq_sechs_feuer_1' } },
  { id: 'mech_chronik_funke', paragraph: '§8', task: 'M7-44', hinweis: 'funke_erster_abend', wissen: 'wissen_funke', tooltip: { art: 'i18n', schluessel: 'settings.game.funkeComments' } },
  { id: 'mech_chronik_erfolge', paragraph: '§23.3', task: 'M7-47', hinweis: 'hinweis_erfolg', wissen: 'wissen_chronik', tooltip: { art: 'i18n', schluessel: 'ui.chronik.reiter.erfolge' } },
  { id: 'mech_chronik_wissen', paragraph: '§23.3', task: 'M7-41', hinweis: 'funke_wissen', wissen: 'wissen_chronik', tooltip: { art: 'i18n', schluessel: 'ui.chronik.reiter.wissen' } },
  { id: 'mech_fertigkeiten_perks_m7', paragraph: '§23.2', task: 'M7-48', hinweis: 'funke_perk', wissen: 'wissen_fertigkeiten', tooltip: { art: 'i18n', schluessel: 'ui.perkwahl.titel' } },
];
