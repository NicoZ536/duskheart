/**
 * Funke comments of strand A (docs/SPIEL.md §17, §24; M7-31): the first song, the first firefly in the net.
 */
import type { GuideHintInput } from './schema';

export const GUIDE_HINTS_A: readonly GuideHintInput[] = [
  {
    id: 'funke_erstes_lied',
    kanal: 'funke',
    text: { de: 'Wie schön! Solange du spielst, wird die Angst ganz leise. Aber bleib dabei stehen.', en: 'How lovely! As long as you play, the fear grows very quiet. But stand still while you do.' },
    ausloeser: { art: 'ereignis', ereignis: 'instrumentPlayed' },
    prioritaet: 1,
    einmalig: true,
  },
  {
    id: 'funke_erstes_gluehwuermchen',
    kanal: 'funke',
    text: { de: 'Ein Glühwürmchen! Mit dreien in einem Glas hast du ein Licht, das zwei Tage je Glühwürmchen glimmt.', en: 'A firefly! Three of them in a jar make a light that glows two days per firefly.' },
    ausloeser: { art: 'ereignis', ereignis: 'netSwung', wo: { fang: 'gluehwuermchen' } },
    prioritaet: 1,
    einmalig: true,
  },
];
