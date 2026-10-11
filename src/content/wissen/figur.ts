/**
 * The knowledge of strand I (Figur & Kreaturen; docs/SPIEL.md §23 "Wissen"; M7-17): the elites of Grünhain – where they live,
 * that a region holds one at most, what a victory leaves and how long the lair rests (`BALANCE.elites.restDays`).
 */
import type { KnowledgeInput } from '../chronik/schema';

export const KNOWLEDGE_I: readonly KnowledgeInput[] = [
  {
    id: 'wissen_elites',
    titel: { de: 'Elitetiere', en: 'Elites' },
    text: {
      de: 'Manche Tiere sind älter, größer und gefährlicher als ihre Art: Graufang, der Leitwolf, und der Alte Hauer. Jede Gegend hat höchstens eines, nachts in seinem Revier. Besiegt hinterlässt es immer seine Essenz – danach bleibt sein Revier eine Woche still.',
      en: 'Some beasts are older, larger and more dangerous than their kin: Greyfang, the lead wolf, and the Old Tusker. Each region holds one at most, at night in its territory. Defeated it always leaves its essence – then its territory stays quiet for a week.',
    },
    quelle: 'mechanik',
    freischaltung: {
      art: 'eines',
      von: [
        { art: 'ereignis', ereignis: 'bestiaryUnlocked', wo: { creature: 'graufang' } },
        { art: 'ereignis', ereignis: 'bestiaryUnlocked', wo: { creature: 'alter_hauer' } },
      ],
    },
  },
];
