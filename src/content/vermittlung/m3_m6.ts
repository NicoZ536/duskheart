/**
 * The mechanics up to M6 in the mechanics register (MASTERPROMPT §2.2 "Jede Mechanik wird im Spiel vermittelt (Hinweis,
 * Chronik, Tooltip)"; docs/SPIEL.md §23 "Vermittlungs-Register"; M7-45 – strand G): survival, light and fear, items,
 * gathering, crafting, building, the fight, the creatures and the skills – each taught by a hint (src/content/guide/m3_m6.ts or
 * an onboarding step), a knowledge entry (src/content/wissen/m3_m6.ts) and a tooltip (the record or control it is about).
 */
import type { MechanicInput } from './schema';

export const MECHANICS_G_M3_M6: readonly MechanicInput[] = [
  // ---- Survival (§11) ----
  { id: 'mech_ueberleben_hunger', paragraph: '§11.1', task: 'M3-17', hinweis: 'hinweis_hunger', wissen: 'wissen_hunger_durst', tooltip: { art: 'content', sammlung: 'conditions', id: 'hungrig' } },
  { id: 'mech_ueberleben_essen', paragraph: '§18', task: 'M3-25', hinweis: 'funke_hunger', wissen: 'wissen_hunger_durst', tooltip: { art: 'content', sammlung: 'items', id: 'himbeeren' } },
  { id: 'mech_ueberleben_durst', paragraph: '§11.1', task: 'M3-25', hinweis: 'hinweis_durst', wissen: 'wissen_hunger_durst', tooltip: { art: 'content', sammlung: 'conditions', id: 'durstig' } },
  { id: 'mech_ueberleben_temperatur', paragraph: '§11.2', task: 'M3-18', hinweis: 'funke_kaelte', wissen: 'wissen_temperatur', tooltip: { art: 'content', sammlung: 'conditions', id: 'frierend' } },
  { id: 'mech_ueberleben_naesse', paragraph: '§11.1', task: 'M3-17', hinweis: 'hinweis_nass', wissen: 'wissen_temperatur', tooltip: { art: 'content', sammlung: 'conditions', id: 'durchnaesst' } },
  { id: 'mech_ueberleben_schlaf', paragraph: '§11.5', task: 'M3-24', hinweis: 'hinweis_muede', wissen: 'wissen_schlaf', tooltip: { art: 'content', sammlung: 'items', id: 'grasbett' } },
  { id: 'mech_ueberleben_zustaende', paragraph: '§11.3', task: 'M3-19', hinweis: 'funke_blutung', wissen: 'wissen_zustaende', tooltip: { art: 'content', sammlung: 'conditions', id: 'blutung' } },
  { id: 'mech_ueberleben_bewegung', paragraph: '§11.4', task: 'M3-08', hinweis: 'hinweis_sprint', wissen: 'wissen_bewegung', tooltip: { art: 'i18n', schluessel: 'input.action.sprint' } },
  { id: 'mech_ueberleben_schwimmen', paragraph: '§11.4', task: 'M3-09', hinweis: 'funke_schwimmen', wissen: 'wissen_bewegung', tooltip: { art: 'content', sammlung: 'conditions', id: 'ertrinkend' } },
  { id: 'mech_ueberleben_tod', paragraph: '§11.6', task: 'M3-26', hinweis: 'funke_wiedereinstieg', wissen: 'wissen_tod', tooltip: { art: 'content', sammlung: 'conditions', id: 'erschuettert' } },
  // ---- Light and fear (§12) ----
  { id: 'mech_licht_fackel', paragraph: '§12.2', task: 'M3-22', hinweis: 'hinweis_fackel', wissen: 'wissen_licht', tooltip: { art: 'content', sammlung: 'items', id: 'fackel' } },
  { id: 'mech_licht_lagerfeuer', paragraph: '§12.2', task: 'M3-22', hinweis: 'aufgabe:einstieg/lagerfeuer', wissen: 'wissen_licht', tooltip: { art: 'content', sammlung: 'items', id: 'lagerfeuer' } },
  { id: 'mech_licht_dunkelheit', paragraph: '§12.1', task: 'M3-21', hinweis: 'funke_dunkelheit', wissen: 'wissen_licht', tooltip: { art: 'i18n', schluessel: 'input.action.toggleLight' } },
  { id: 'mech_licht_furcht', paragraph: '§12.3', task: 'M3-23', hinweis: 'funke_furcht', wissen: 'wissen_furcht', tooltip: { art: 'i18n', schluessel: 'ui.hud.furcht.label' } },
  { id: 'mech_licht_nachtmahr', paragraph: '§12.3', task: 'M6-29', hinweis: 'funke_nachtmahr', wissen: 'wissen_furcht', tooltip: { art: 'content', sammlung: 'creatures', id: 'nachtmahr' } },
  { id: 'mech_licht_schattenbrut', paragraph: '§12.4', task: 'M6-28', hinweis: 'funke_schattenbrut', wissen: 'wissen_schattenbrut', tooltip: { art: 'content', sammlung: 'creatures', id: 'schleicher' } },
  { id: 'mech_licht_lichtfresser', paragraph: '§12.4', task: 'M6-26', hinweis: 'funke_lichtfresser', wissen: 'wissen_schattenbrut', tooltip: { art: 'content', sammlung: 'creatures', id: 'lichtfresser' } },
  // ---- Items, gathering, crafting (§13–§15) ----
  { id: 'mech_items_inventar', paragraph: '§13.1', task: 'M3-02', hinweis: 'hinweis_inventar', wissen: 'wissen_inventar', tooltip: { art: 'i18n', schluessel: 'input.action.inventory' } },
  { id: 'mech_items_haltbarkeit', paragraph: '§13.1', task: 'M3-15', hinweis: 'funke_kaputt', wissen: 'wissen_inventar', tooltip: { art: 'content', sammlung: 'items', id: 'steinaxt' } },
  { id: 'mech_sammeln_haende', paragraph: '§14', task: 'M3-13', hinweis: 'aufgabe:einstieg/fasern_steine', wissen: 'wissen_sammeln', tooltip: { art: 'content', sammlung: 'items', id: 'fasern' } },
  { id: 'mech_sammeln_baeume', paragraph: '§14', task: 'M3-11', hinweis: 'funke_baum', wissen: 'wissen_sammeln', tooltip: { art: 'content', sammlung: 'items', id: 'holz' } },
  { id: 'mech_sammeln_graben', paragraph: '§14', task: 'M3-14', hinweis: 'hinweis_graben', wissen: 'wissen_sammeln', tooltip: { art: 'content', sammlung: 'items', id: 'steinschaufel' } },
  { id: 'mech_handwerk_rezepte', paragraph: '§15.1', task: 'M3-16', hinweis: 'hinweis_rezept', wissen: 'wissen_handwerk', tooltip: { art: 'i18n', schluessel: 'input.action.crafting' } },
  { id: 'mech_handwerk_werkzeug', paragraph: '§15.1', task: 'M3-16', hinweis: 'aufgabe:einstieg/steinaxt', wissen: 'wissen_handwerk', tooltip: { art: 'content', sammlung: 'items', id: 'faserseil' } },
  { id: 'mech_handwerk_stationen', paragraph: '§15.2', task: 'M4-03', hinweis: 'aufgabe:einstieg/werkbank', wissen: 'wissen_handwerk', tooltip: { art: 'content', sammlung: 'stations', id: 'werkbank' } },
  { id: 'mech_handwerk_verarbeitung', paragraph: '§15.4', task: 'M4-04', hinweis: 'hinweis_station', wissen: 'wissen_handwerk', tooltip: { art: 'content', sammlung: 'stations', id: 'schmelzofen' } },
  { id: 'mech_handwerk_bronze', paragraph: '§13.2', task: 'M4-06', hinweis: 'aufgabe:bronzezeit/bronze', wissen: 'wissen_bronze', tooltip: { art: 'content', sammlung: 'items', id: 'bronzebarren' } },
  { id: 'mech_handwerk_reparatur', paragraph: '§15.1', task: 'M4-09', hinweis: 'funke_kaputt', wissen: 'wissen_inventar', tooltip: { art: 'content', sammlung: 'stations', id: 'werkbank' } },
  // ---- Building and the base (§16) ----
  { id: 'mech_bau_bauen', paragraph: '§16.6', task: 'M4-22', hinweis: 'hinweis_bauen', wissen: 'wissen_bauen', tooltip: { art: 'i18n', schluessel: 'input.action.build' } },
  { id: 'mech_bau_statik', paragraph: '§16.3', task: 'M4-14', hinweis: 'funke_einsturz', wissen: 'wissen_bauen', tooltip: { art: 'content', sammlung: 'buildParts', id: 'saeule_holz' } },
  { id: 'mech_bau_raeume', paragraph: '§16.4', task: 'M4-15', hinweis: 'funke_raum', wissen: 'wissen_raeume', tooltip: { art: 'content', sammlung: 'roomTypes', id: 'schlafraum' } },
  { id: 'mech_bau_behaglichkeit', paragraph: '§16.4', task: 'M4-18', hinweis: 'funke_raum', wissen: 'wissen_raeume', tooltip: { art: 'content', sammlung: 'conditions', id: 'behaglich' } },
  { id: 'mech_bau_herdfeuer', paragraph: '§16.5', task: 'M4-20', hinweis: 'funke_herdfeuer', wissen: 'wissen_herdfeuer', tooltip: { art: 'content', sammlung: 'items', id: 'herdfeuer' } },
  { id: 'mech_bau_lagerung', paragraph: '§16.7', task: 'M4-21', hinweis: 'hinweis_kisten', wissen: 'wissen_handwerk', tooltip: { art: 'content', sammlung: 'items', id: 'kiste_holz' } },
  { id: 'mech_bau_brand', paragraph: '§16.8', task: 'M4-28', hinweis: 'funke_brand', wissen: 'wissen_bauen', tooltip: { art: 'content', sammlung: 'items', id: 'holzeimer_wasser' } },
  // ---- The fight and the creatures (§19, §20) ----
  { id: 'mech_kampf_nahkampf', paragraph: '§19.1', task: 'M6-02', hinweis: 'hinweis_kampf', wissen: 'wissen_kampf', tooltip: { art: 'i18n', schluessel: 'input.action.attack' } },
  { id: 'mech_kampf_parade', paragraph: '§19.1', task: 'M6-04', hinweis: 'funke_parade', wissen: 'wissen_kampf', tooltip: { art: 'content', sammlung: 'items', id: 'holzschild' } },
  { id: 'mech_kampf_fernkampf', paragraph: '§19.2', task: 'M6-06', hinweis: 'hinweis_fernkampf', wissen: 'wissen_kampf', tooltip: { art: 'content', sammlung: 'items', id: 'kurzbogen' } },
  { id: 'mech_kreaturen_zerlegen', paragraph: '§14', task: 'M6-30', hinweis: 'hinweis_zerlegen', wissen: 'wissen_jagd', tooltip: { art: 'content', sammlung: 'items', id: 'steinmesser' } },
  { id: 'mech_kreaturen_fallen', paragraph: '§14', task: 'M6-30', hinweis: 'hinweis_fallen', wissen: 'wissen_jagd', tooltip: { art: 'content', sammlung: 'items', id: 'kastenfalle' } },
  { id: 'mech_kreaturen_bestiarium', paragraph: '§23.3', task: 'M6-32', hinweis: 'funke_bestiarium', wissen: 'wissen_bestiarium', tooltip: { art: 'i18n', schluessel: 'ui.chronik.reiter.bestiarium' } },
  // ---- Skills (§23.2) ----
  { id: 'mech_fertigkeiten_stufen', paragraph: '§23.2', task: 'M3-32', hinweis: 'funke_fertigkeit', wissen: 'wissen_fertigkeiten', tooltip: { art: 'content', sammlung: 'skills', id: 'holzfaellen' } },
  { id: 'mech_fertigkeiten_perks', paragraph: '§23.2', task: 'M6-34', hinweis: 'funke_perk', wissen: 'wissen_fertigkeiten', tooltip: { art: 'content', sammlung: 'perks', id: 'wuchtschlag' } },
];
