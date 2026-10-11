/**
 * Chronicle rules for the moments up to M6 (docs/SPIEL.md §23 "Tagebuch"; M7-41 – strand G): the first tree, the first camp
 * fire, the first night, the first room and hearth, the first bronze; creatures seen for the first time, deaths and the
 * Nightmare, collapsed roofs, the perk levels of the skills. One-time rules write once per world.
 */
import type { ChronicleRuleInput } from './schema';

export const CHRONICLE_RULES_G_M3_M6: readonly ChronicleRuleInput[] = [
  {
    id: 'chronik_erster_baum',
    ereignis: 'treeFelled',
    art: 'handwerk',
    text: { de: 'Mein erster Baum fiel unter der Axt.', en: 'My first tree fell under the axe.' },
    einmalig: true,
  },
  {
    id: 'chronik_erstes_lagerfeuer',
    ereignis: 'lightIgnited',
    wo: { kind: 'lagerfeuer' },
    art: 'tagebuch',
    text: { de: 'Mein erstes Lagerfeuer brennt. Die Nacht kann kommen.', en: 'My first camp fire burns. Let the night come.' },
    einmalig: true,
  },
  {
    id: 'chronik_erste_nacht',
    ereignis: 'xpGained',
    wo: { source: 'nacht_ueberstanden' },
    art: 'tagebuch',
    text: { de: 'Die erste Nacht überstanden.', en: 'Survived the first night.' },
    einmalig: true,
  },
  {
    id: 'chronik_erster_raum',
    ereignis: 'playerRoomChanged',
    wo: { interior: true },
    art: 'handwerk',
    text: { de: 'Ein Dach über dem Kopf – zum ersten Mal seit dem Schiffbruch.', en: 'A roof over my head – for the first time since the shipwreck.' },
    einmalig: true,
  },
  {
    id: 'chronik_erstes_herdfeuer',
    ereignis: 'hearthIgnited',
    art: 'handwerk',
    text: { de: 'Ein Herdfeuer brennt. Hier ist jetzt mein Zuhause.', en: 'A hearth fire burns. This is my home now.' },
    einmalig: true,
  },
  {
    id: 'chronik_werkbank',
    ereignis: 'craftCompleted',
    wo: { item: 'werkbank' },
    art: 'handwerk',
    text: { de: 'Meine erste Werkbank steht.', en: 'My first workbench stands.' },
    einmalig: true,
  },
  {
    id: 'chronik_erste_bronze',
    ereignis: 'craftCompleted',
    wo: { item: 'bronzebarren' },
    art: 'handwerk',
    text: { de: 'Kupfer und Zinn wurden zu Bronze.', en: 'Copper and tin became bronze.' },
    einmalig: true,
  },
  {
    id: 'chronik_kreatur_gesichtet',
    ereignis: 'bestiaryUnlocked',
    wo: { stage: 'gesichtet' },
    art: 'entdeckung',
    text: { de: 'Zum ersten Mal gesehen: {creature}.', en: 'Seen for the first time: {creature}.' },
    platzhalter: { creature: 'kreatur' },
  },
  {
    id: 'chronik_tod',
    ereignis: 'playerDied',
    art: 'kampf',
    text: { de: 'Ich bin gestorben. Mein Grab hält, was ich trug.', en: 'I died. My grave holds what I carried.' },
  },
  {
    id: 'chronik_nachtmahr',
    ereignis: 'nightmareSummoned',
    art: 'kampf',
    text: { de: 'Die Furcht wurde zu viel – der Nachtmahr kam.', en: 'The fear grew too great – the Nightmare came.' },
  },
  {
    id: 'chronik_einsturz',
    ereignis: 'roofCollapsed',
    art: 'handwerk',
    text: { de: 'Ein Dach stürzte ein. Es fehlten Stützen.', en: 'A roof collapsed. It lacked supports.' },
  },
  {
    id: 'chronik_perkstufe',
    ereignis: 'perkChoiceOpened',
    art: 'tagebuch',
    text: { de: '{skill} erreicht Stufe {level}.', en: '{skill} reaches level {level}.' },
    platzhalter: { skill: 'fertigkeit', level: 'zahl' },
  },
];
