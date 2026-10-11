/**
 * Funke comments and context hints of strand G (MASTERPROMPT §8 "Funke", §23.3 "Einstieg „Die ersten Stunden“ … Funke
 * kommentiert sparsam"; docs/SPIEL.md §23; M7-42 … M7-47): the quest tracker, the chronicle, achievements and knowledge; the
 * evening of the first day, the first morning, the fire that goes out; the way to bronze; the first wolves and boars; full
 * bags. Together with the comments of the mechanics up to M6 (src/content/guide/m3_m6.ts) and those of the other strands Funke
 * has far more than the 40 comments of §23 – each said once, never two within `BALANCE.guide.funkeMinSeconds`.
 */
import type { GuideHintInput } from './schema';

/** Cooling of a returning reminder [s] (like src/content/guide/m3_m6.ts). */
const REMINDER_SECONDS = 900;

export const GUIDE_HINTS_G_KERN: readonly GuideHintInput[] = [
  // ---- Quests, chronicle, achievements, knowledge (§23) ----
  {
    id: 'hinweis_aufgaben',
    kanal: 'hinweis',
    text: { de: 'Rechts stehen deine Aufgaben. In der Chronik (J) wählst du, welchen du folgst.', en: 'Your quests are on the right. In the chronicle (J) you choose which to follow.' },
    ausloeser: { art: 'ereignis', ereignis: 'questStarted' },
    prioritaet: 1,
    einmalig: true,
  },
  {
    id: 'hinweis_erfolg',
    kanal: 'hinweis',
    text: { de: 'Erfolg errungen! Alle Erfolge stehen in der Chronik (J).', en: 'Achievement earned! All achievements are in the chronicle (J).' },
    ausloeser: { art: 'ereignis', ereignis: 'achievementUnlocked' },
    prioritaet: 1,
    einmalig: true,
  },
  {
    id: 'funke_erfolg',
    kanal: 'funke',
    text: { de: 'Das merke ich mir. Die Chronik vergisst nichts.', en: 'I will remember that. The chronicle forgets nothing.' },
    ausloeser: { art: 'ereignis', ereignis: 'achievementUnlocked', anzahl: 2 },
    prioritaet: 1,
    einmalig: true,
  },
  {
    id: 'funke_wissen',
    kanal: 'funke',
    text: { de: 'Neues Wissen. Lies es in der Chronik nach, unter Wissen.', en: 'New knowledge. Read it up in the chronicle, under Knowledge.' },
    ausloeser: { art: 'ereignis', ereignis: 'knowledgeUnlocked' },
    prioritaet: 1,
    einmalig: true,
  },
  {
    id: 'funke_einstieg_fertig',
    kanal: 'funke',
    text: { de: 'Bronze! Jetzt bist du mehr als ein Gestrandeter.', en: 'Bronze! Now you are more than a castaway.' },
    ausloeser: { art: 'ereignis', ereignis: 'questCompleted', wo: { quest: 'einstieg' } },
    prioritaet: 2,
    einmalig: true,
  },
  // ---- The first day and night ----
  {
    id: 'funke_erster_abend',
    kanal: 'funke',
    text: { de: 'Die Sonne sinkt. Ohne Feuer wird die erste Nacht hart.', en: 'The sun is sinking. Without a fire the first night will be hard.' },
    ausloeser: {
      art: 'alle',
      von: [
        { art: 'uhr', tag: 1, abStunde: 17 },
        { art: 'nicht', von: { art: 'aufgabe', aufgabe: 'einstieg', schritt: 'lagerfeuer', status: 'erledigt' } },
      ],
    },
    prioritaet: 3,
    einmalig: true,
  },
  {
    id: 'funke_erster_morgen',
    kanal: 'funke',
    text: { de: 'Morgen. Die Schatten weichen – nutz das Licht.', en: 'Morning. The shadows retreat – make use of the light.' },
    ausloeser: { art: 'statistik', statistik: 'naechte_ueberlebt', mindestens: 2 },
    prioritaet: 1,
    einmalig: true,
  },
  {
    id: 'funke_feuer_aus',
    kanal: 'funke',
    text: { de: 'Das Feuer ist ausgegangen. Leg rechtzeitig Holz nach.', en: 'The fire has gone out. Add wood in good time.' },
    ausloeser: { art: 'ereignis', ereignis: 'lightExtinguished', wo: { kind: 'lagerfeuer', reason: 'abgebrannt' } },
    prioritaet: 2,
    einmalig: true,
  },
  {
    id: 'funke_regen',
    kanal: 'funke',
    text: { de: 'Regen löscht Fackeln und Feuer unter freiem Himmel. Ein Dach schützt sie.', en: 'Rain puts out torches and fires under the open sky. A roof protects them.' },
    ausloeser: { art: 'ereignis', ereignis: 'lightExtinguished', wo: { reason: 'regen' } },
    prioritaet: 2,
    einmalig: true,
  },
  {
    id: 'funke_mitternacht',
    kanal: 'funke',
    text: { de: 'Mitternacht, und du bist draußen. Such ein Feuer, bevor die Furcht dich findet.', en: 'Midnight, and you are outside. Find a fire before fear finds you.' },
    ausloeser: {
      art: 'alle',
      von: [
        { art: 'uhr', abStunde: 23.5 },
        { art: 'raum', innen: false },
        { art: 'lichtstufe', hoechstens: 0.15 },
      ],
    },
    prioritaet: 2,
    einmalig: false,
    abklingSekunden: REMINDER_SECONDS,
  },
  {
    id: 'funke_drei_naechte',
    kanal: 'funke',
    text: { de: 'Drei Nächte. Du lernst, mit der Dunkelheit zu leben.', en: 'Three nights. You are learning to live with the dark.' },
    ausloeser: { art: 'statistik', statistik: 'naechte_ueberlebt', mindestens: 3 },
    prioritaet: 1,
    einmalig: true,
  },
  // ---- The way to bronze ----
  {
    id: 'funke_werkbank',
    kanal: 'funke',
    text: { de: 'Eine Werkbank. Jetzt wird aus Holz und Stein richtiges Werkzeug.', en: 'A workbench. Now wood and stone become real tools.' },
    ausloeser: { art: 'statistik', statistik: 'hergestellt', schluessel: 'werkbank', mindestens: 1 },
    prioritaet: 1,
    einmalig: true,
  },
  {
    id: 'funke_kupfer',
    kanal: 'funke',
    text: { de: 'Kupfer! Mit Zinn wird daraus Bronze – im Schmelzofen.', en: 'Copper! With tin it becomes bronze – in the smelting furnace.' },
    ausloeser: { art: 'besitz', item: 'kupfererz', anzahl: 1 },
    prioritaet: 1,
    einmalig: true,
  },
  {
    id: 'funke_zinn',
    kanal: 'funke',
    text: { de: 'Zinn. Ein Teil Zinn, drei Teile Kupfer – so entsteht Bronze.', en: 'Tin. One part tin, three parts copper – that is how bronze is made.' },
    ausloeser: { art: 'besitz', item: 'zinnerz', anzahl: 1 },
    prioritaet: 1,
    einmalig: true,
  },
  {
    id: 'funke_schmelzofen',
    kanal: 'funke',
    text: { de: 'Der Schmelzofen frisst Brennstoff und braucht Geduld. Er arbeitet auch ohne dich.', en: 'The smelting furnace eats fuel and needs patience. It works without you, too.' },
    ausloeser: { art: 'statistik', statistik: 'hergestellt', schluessel: 'schmelzofen', mindestens: 1 },
    prioritaet: 1,
    einmalig: true,
  },
  {
    id: 'funke_taschen_voll',
    kanal: 'funke',
    text: { de: 'Deine Taschen sind voll. Eine Kiste oder ein Rucksack schafft Platz.', en: 'Your bags are full. A chest or a backpack makes room.' },
    ausloeser: { art: 'ereignis', ereignis: 'inventoryFull' },
    prioritaet: 2,
    einmalig: true,
  },
  {
    id: 'funke_beeren',
    kanal: 'funke',
    text: { de: 'Beeren! Satt machen sie kaum, aber sie halten dich auf den Beinen.', en: 'Berries! They barely fill you, but they keep you on your feet.' },
    ausloeser: { art: 'ereignis', ereignis: 'harvested', wo: { target: 'busch_beeren' } },
    prioritaet: 1,
    einmalig: true,
  },
  // ---- The first foes of the Greengrove ----
  {
    id: 'funke_wolf',
    kanal: 'funke',
    text: { de: 'Wölfe jagen im Rudel. Dreh ihnen nie den Rücken zu.', en: 'Wolves hunt in packs. Never turn your back on them.' },
    ausloeser: { art: 'ereignis', ereignis: 'bestiaryUnlocked', wo: { creature: 'wolf', stage: 'gesichtet' } },
    prioritaet: 3,
    einmalig: true,
  },
  {
    id: 'funke_keiler',
    kanal: 'funke',
    text: { de: 'Ein Keiler! Er stürmt geradeaus – weich zur Seite aus.', en: 'A boar! It charges straight ahead – dodge to the side.' },
    ausloeser: { art: 'ereignis', ereignis: 'bestiaryUnlocked', wo: { creature: 'keiler', stage: 'gesichtet' } },
    prioritaet: 3,
    einmalig: true,
  },
];
