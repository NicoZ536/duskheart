/**
 * Knowledge entries of strand G (Wissen tab; docs/SPIEL.md §23; M7-41 … M7-47): the chronicle itself, Funke, and the story of
 * the six fires that Funke tells when it awakens.
 */
import type { KnowledgeInput } from '../chronik/schema';

export const KNOWLEDGE_G_KERN: readonly KnowledgeInput[] = [
  {
    id: 'wissen_chronik',
    titel: { de: 'Die Chronik', en: 'The Chronicle' },
    text: {
      de: 'J öffnet die Chronik: deine Aufgaben mit ihren Hinweisen und Zielen auf der Karte, das Bestiarium, Herbarium und Fischbuch, dieses Wissen, die Rezepte, deine Statistiken und Erfolge. Bis zu drei Aufgaben folgst du rechts im Bild.',
      en: 'J opens the chronicle: your quests with their hints and targets on the map, the bestiary, herbarium and fish book, this knowledge, the recipes, your statistics and achievements. You can follow up to three quests on the right of the screen.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'questStarted' },
  },
  {
    id: 'wissen_funke',
    titel: { de: 'Funke', en: 'Spark' },
    text: {
      de: 'Funke ist die letzte Glut eines Leuchtfeuers, ein wortkarger Flammengeist in deiner Laterne. Er spricht selten und kurz – in den Einstellungen lässt er sich zum Schweigen bringen, ebenso die Hinweise.',
      en: 'Spark is the last ember of a beacon, a taciturn flame spirit in your lantern. It speaks rarely and briefly – in the settings it can be silenced, as can the hints.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'guideHint', wo: { kanal: 'funke' } },
  },
  {
    id: 'wissen_sechs_feuer',
    titel: { de: 'Die sechs Feuer', en: 'The Six Fires' },
    text: {
      de: 'Vor dreihundert Jahren rissen die Erbauer das Nachtherz auf. Sechs Leuchtfeuer hielten die Dunkelheit in Schach, bis eines nach dem anderen erlosch. Jedes wird von einem Hüter bewacht; wer es neu entzündet, heilt seine Region.',
      en: 'Three hundred years ago the Builders tore open the Nightheart. Six beacons held the darkness at bay until one after another went out. Each is watched over by a guardian; whoever lights it again heals its region.',
    },
    quelle: 'mechanik',
    freischaltung: {
      art: 'eines',
      von: [
        { art: 'aufgabe', aufgabe: 'hq_sechs_feuer_1', schritt: 'staette_finden', status: 'aktiv' },
        { art: 'aufgabe', aufgabe: 'hq_sechs_feuer_1', schritt: 'staette_finden', status: 'erledigt' },
      ],
    },
  },
];
