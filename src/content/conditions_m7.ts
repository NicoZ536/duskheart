/**
 * Conditions of the kitchen and the herb table (MASTERPROMPT §18 "Mahlzeit-Effekte … Eintopf +20 max. Leben (10 min) ·
 * Fischsuppe +15 max. Ausdauer · Chili-Topf +8 Isolation · Minztee +6 Kühlung", §11.3 "Mahlzeit- und Trankeffekte";
 * docs/SPIEL.md §21, §29 "Zustände gestaerkt, ausdauernd, erquickt, gewaermt, gekuehlt, heilend, wundversorgt"; M7-26,
 * M7-28; strand E). Spread into `CONDITIONS` (src/content/conditions.ts); their icons are `zustand_<id>`
 * (assets-src/sprites/zustaende/zustaende.ts).
 *
 * - Group `mahlzeit` (`gruppe`): at most two different meal conditions at once (`BALANCE.meals.maxMealEffects`); a third
 *   pushes the oldest out (`ConditionsSystem.addGroupLimit`). The dishes give them (`mahlzeit.zustaende`, items/gerichte.ts).
 * - Group `trank`: the potions and the salve (`trank.gibt`, items/traenke.ts) – no limit, a potion is a cure, not a meal.
 * Durations here are the length a condition lasts when nothing else names one; the dishes and potions give their own
 * seconds (a kitchen's dish 10 % longer, `BALANCE.meals.kitchen.effect`).
 */
import type { ConditionInput } from './conditions';

/** The meal group (at most two different at once) and the potion group. */
export const MEAL_GROUP = 'mahlzeit';
export const POTION_GROUP = 'trank';

export const KUECHE_CONDITIONS: readonly ConditionInput[] = [
  {
    id: 'gestaerkt',
    name: { de: 'Gestärkt', en: 'Fortified' },
    beschreibung: {
      de: 'Ein kräftiges Mahl wärmt von innen: 20 Leben mehr als sonst, zehn Minuten lang. Höchstens zwei Mahlzeit-Wirkungen halten zugleich.',
      en: 'A hearty meal warms you from within: 20 more maximum health, for ten minutes. At most two meal effects last at once.',
    },
    art: 'gut',
    gruppe: MEAL_GROUP,
    dauer: { art: 'zeit', sekunden: 600 },
    stapel: { regel: 'erneuern' },
    wirkung: { maxLebenPlus: 20 },
    sichtbar: 'wohlig',
    sound: 'sfx_zustand_gestaerkt',
  },
  {
    id: 'ausdauernd',
    name: { de: 'Ausdauernd', en: 'Enduring' },
    beschreibung: {
      de: 'Die Suppe gibt Kraft für lange Wege: 15 Ausdauer mehr als sonst, zehn Minuten lang. Höchstens zwei Mahlzeit-Wirkungen halten zugleich.',
      en: 'The soup gives strength for long roads: 15 more maximum stamina, for ten minutes. At most two meal effects last at once.',
    },
    art: 'gut',
    gruppe: MEAL_GROUP,
    dauer: { art: 'zeit', sekunden: 600 },
    stapel: { regel: 'erneuern' },
    wirkung: { maxAusdauerPlus: 15 },
    sichtbar: 'frische',
    sound: 'sfx_zustand_ausdauernd',
  },
  {
    id: 'erquickt',
    name: { de: 'Erquickt', en: 'Refreshed' },
    beschreibung: {
      de: 'Frisches Gemüse und warmer Tee beleben: Ausdauer kehrt ein Viertel schneller zurück, fünf Minuten lang. Höchstens zwei Mahlzeit-Wirkungen halten zugleich.',
      en: 'Fresh vegetables and warm tea revive you: stamina returns a quarter faster, for five minutes. At most two meal effects last at once.',
    },
    art: 'gut',
    gruppe: MEAL_GROUP,
    dauer: { art: 'zeit', sekunden: 300 },
    stapel: { regel: 'erneuern' },
    wirkung: { ausdauerRegeneration: 1.25 },
    sichtbar: 'frische',
    sound: 'sfx_zustand_erquickt',
  },
  {
    id: 'gewaermt',
    name: { de: 'Gewärmt', en: 'Warmed' },
    beschreibung: {
      de: 'Der Wärmetrank brennt angenehm im Bauch: so warm wie 8 Punkte mehr Isolation, fünf Minuten lang – gegen Frost und kalte Nächte.',
      en: 'The warming draught burns pleasantly in your belly: as warm as 8 more points of insulation, for five minutes – against frost and cold nights.',
    },
    art: 'gut',
    gruppe: POTION_GROUP,
    dauer: { art: 'zeit', sekunden: 300 },
    stapel: { regel: 'erneuern' },
    wirkung: { isolation: 8 },
    sichtbar: 'waermeglanz',
    sound: 'sfx_zustand_gewaermt',
  },
  {
    id: 'gekuehlt',
    name: { de: 'Gekühlt', en: 'Cooled' },
    beschreibung: {
      de: 'Der Kühltrank prickelt kühl: so kühl wie 6 Punkte mehr Kühlung, fünf Minuten lang – gegen Hitze und Sonnenglut.',
      en: 'The cooling draught tingles coldly: as cool as 6 more points of cooling, for five minutes – against heat and blazing sun.',
    },
    art: 'gut',
    gruppe: POTION_GROUP,
    dauer: { art: 'zeit', sekunden: 300 },
    stapel: { regel: 'erneuern' },
    wirkung: { kuehlung: 6 },
    sichtbar: 'frische',
    sound: 'sfx_zustand_gekuehlt',
  },
  {
    id: 'heilend',
    name: { de: 'Heilend', en: 'Healing' },
    beschreibung: {
      de: 'Der Heiltrank wirkt nach: Leben kehrt zweieinhalbmal so schnell zurück, eine halbe Minute lang.',
      en: 'The healing potion keeps working: health returns two and a half times as fast, for half a minute.',
    },
    art: 'gut',
    gruppe: POTION_GROUP,
    dauer: { art: 'zeit', sekunden: 30 },
    stapel: { regel: 'erneuern' },
    wirkung: { lebensRegeneration: 2.5 },
    sichtbar: 'wohlig',
    sound: 'sfx_zustand_heilend',
  },
  {
    id: 'wundversorgt',
    name: { de: 'Wundversorgt', en: 'Wounds Dressed' },
    beschreibung: {
      de: 'Die Wundsalbe kühlt und schließt die Wunden: Leben kehrt anderthalbmal so schnell zurück, zwei Minuten lang.',
      en: 'The wound salve cools and closes the wounds: health returns one and a half times as fast, for two minutes.',
    },
    art: 'gut',
    gruppe: POTION_GROUP,
    dauer: { art: 'zeit', sekunden: 120 },
    stapel: { regel: 'erneuern' },
    wirkung: { lebensRegeneration: 1.5 },
    sichtbar: 'wohlig',
    sound: 'sfx_zustand_wundversorgt',
  },
];
