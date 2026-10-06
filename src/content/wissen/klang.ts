/**
 * Knowledge entries of strand A (Wissen tab; docs/SPIEL.md §17, §24; M7-31): making music, the net and the firefly jar.
 */
import type { KnowledgeInput } from '../chronik/schema';

export const KNOWLEDGE_A: readonly KnowledgeInput[] = [
  {
    id: 'wissen_musizieren',
    titel: { de: 'Musizieren', en: 'Making Music' },
    text: {
      de: 'Flöte und Laute spielen ihre Lieder, solange du stillstehst. Musik beruhigt: Wer sie hört, fürchtet sich um 2 Punkte je Sekunde weniger. Ein Schritt, eine andere Handlung oder ein Treffer beendet das Lied.',
      en: 'The flute and the lute play their songs as long as you stand still. Music calms: whoever hears it fears 2 points less per second. A step, another action or a blow ends the song.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'instrumentPlayed' },
  },
  {
    id: 'wissen_kescher',
    titel: { de: 'Kescher und Glühwürmchen', en: 'Bug Net and Fireflies' },
    text: {
      de: 'Durch einen Glühwürmchenschwarm geschwungen fängt der Kescher bis zu drei Glühwürmchen je Schwarm und Nacht; der Schwarm bleibt. Im Gras fängt er nachts öfter eine Grille – ein guter Köder. Drei Glühwürmchen in einem Glas leuchten als Glühwürmchenglas: schwach, aber zwei Tage je Glühwürmchen und wetterfest.',
      en: 'Swept through a swarm of fireflies the net catches up to three fireflies per swarm and night; the swarm stays. In the grass at night it catches a cricket more often – a good bait. Three fireflies in a jar make a firefly jar: faint, but two days per firefly and weatherproof.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'netSwung' },
  },
];
