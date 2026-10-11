/**
 * The hints of strand I (Figur & Kreaturen; docs/SPIEL.md §17, §23; M7-17): Funke speaks up when the player first meets an
 * elite of Grünhain (the bestiary's first stage of Graufang or the Old Tusker).
 */
import type { GuideHintInput } from './schema';

export const GUIDE_HINTS_I: readonly GuideHintInput[] = [
  {
    id: 'funke_elite',
    kanal: 'funke',
    text: { de: 'Ein Elitetier! Härter als seine Art, doch es hinterlässt eine Essenz.', en: 'An elite! Tougher than its kin, but it leaves an essence behind.' },
    ausloeser: {
      art: 'eines',
      von: [
        { art: 'ereignis', ereignis: 'bestiaryUnlocked', wo: { creature: 'graufang' } },
        { art: 'ereignis', ereignis: 'bestiaryUnlocked', wo: { creature: 'alter_hauer' } },
      ],
    },
    prioritaet: 2,
    einmalig: true,
  },
];
