/**
 * Knowledge entries of strand B (Wissen tab; docs/SPIEL.md §17, §18; M7-07, M7-38, M7-40): places, world events, lightning.
 */
import type { KnowledgeInput } from '../chronik/schema';

export const KNOWLEDGE_B: readonly KnowledgeInput[] = [
  {
    id: 'wissen_orte',
    titel: { de: 'Orte der Alten', en: 'Places of the Old Ones' },
    text: {
      de: 'Überall auf der Insel liegen Orte: Leuchtfeuer-Stätten, Aussichtstürme, Gehöfte, Schreine, Friedhöfe und mehr. Viele bewachen Kreaturen; fallen sie, ist der Ort gereinigt – nach sieben Tagen kehrt ein Teil zurück. Truhen öffnen sich nur einmal.',
      en: 'Places lie all over the island: beacon sites, look-out towers, farmsteads, shrines, graveyards and more. Many are guarded by creatures; once they fall the place is cleansed – after seven days some return. Chests open only once.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'placeDiscovered' },
  },
  {
    id: 'wissen_ereignisse',
    titel: { de: 'Zeichen am Himmel', en: 'Signs in the Sky' },
    text: {
      de: 'Manche Nächte und Tage sind anders: der Finstermond ohne Mond, der Lumenregen voller Scherben, die Sonnenfinsternis, das trockene Gewitter. Jedes kündigt sich an – am Himmel, im Klang und durch Funke.',
      en: 'Some nights and days are different: the moonless Darkmoon, the Lumen rain full of shards, the eclipse, the dry thunderstorm. Each announces itself – in the sky, in sound and through Funke.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'worldEventAnnounced' },
  },
  {
    id: 'wissen_blitze',
    titel: { de: 'Blitze', en: 'Lightning' },
    text: {
      de: 'Im Gewitter schlagen Blitze bevorzugt in Metall, Bäume und hohe Bauten. Sie können Bäume und Holz entzünden – im trockenen Sommer wird daraus ein Waldbrand. Wer daneben steht, wird verletzt.',
      en: 'In a thunderstorm lightning prefers metal, trees and tall buildings. It can set trees and wood alight – in a dry summer that becomes a forest fire. Whoever stands beside it gets hurt.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'lightningStruck' },
  },
];
