/**
 * Chronicle rules of strand A (docs/SPIEL.md §17, §24; M7-31): the first song played, the first firefly caught with the net.
 */
import type { ChronicleRuleInput } from './schema';

export const CHRONICLE_RULES_A: readonly ChronicleRuleInput[] = [
  {
    id: 'chronik_erstes_lied',
    ereignis: 'instrumentPlayed',
    art: 'tagebuch',
    text: { de: 'Zum ersten Mal spielte ich auf der {instrument} – die Nacht schien ein wenig leiser.', en: 'For the first time I played the {instrument} – the night seemed a little quieter.' },
    platzhalter: { instrument: 'item' },
    einmalig: true,
  },
  {
    id: 'chronik_erstes_gluehwuermchen',
    ereignis: 'netSwung',
    wo: { fang: 'gluehwuermchen' },
    art: 'tagebuch',
    text: { de: 'Mit dem Kescher fing ich ein Glühwürmchen. In der hohlen Hand glomm es weiter.', en: 'I caught a firefly with the net. It kept glowing in my cupped hand.' },
    einmalig: true,
  },
];
