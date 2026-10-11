/**
 * Dialogs (MASTERPROMPT §8 "Funke, ein wortkarger Flammengeist … höchstens 2 Zeilen pro Einwurf", §22; docs/SPIEL.md §23
 * "Dialoge (Funke, Siedler, Händlerin) als Content in `src/content/dialoge/` mit zod-Schema (fehlender EN-Text ⇒ Fehler)";
 * M7-42 – strand G, collection `dialogs`). A quest step names its dialog (`dialog`); Funke speaks it line by line in its box
 * when the step becomes active (src/game/guide). Every line fits the Funke box in two lines (validator rule `funke`).
 * Settlers (M9) and the trader (M9-14) bring their dialogs with their tasks; the schema already knows their speakers.
 */
import type { DialogInput } from '../quests/schema';

export const DIALOGS: readonly DialogInput[] = [
  {
    id: 'funke_erwachen',
    sprecher: 'funke',
    zeilen: [
      { de: '…warm. Du hast mich durch die Nacht getragen.', en: '…warm. You carried me through the night.' },
      { de: 'Ich bin Funke. Die letzte Glut eines Leuchtfeuers.', en: "I am Spark. The last ember of a beacon." },
      { de: 'Sechs Feuer hielten die Nacht. Alle sind erloschen.', en: 'Six fires held back the night. All have gone out.' },
      { de: 'Das erste liegt im Grünhain. Ich spüre es – folge mir.', en: 'The first lies in the Greengrove. I can feel it – follow me.' },
    ],
  },
  {
    id: 'funke_staette',
    sprecher: 'funke',
    zeilen: [
      { de: 'Hier brannte es. Kalt jetzt, voller Schatten.', en: 'It burned here. Cold now, full of shadows.' },
      { de: 'Sein Hüter schläft im Hain: der Borkenvater.', en: 'Its guardian sleeps in the grove: the Barkfather.' },
      { de: 'Weck ihn an seinem Altar. Komm gut gerüstet.', en: 'Wake him at his altar. Come well equipped.' },
    ],
  },
  {
    id: 'funke_borkenvater',
    sprecher: 'funke',
    zeilen: [
      { de: 'Er ist gefallen. Das Feuer erinnert sich an dich.', en: 'He has fallen. The fire remembers you.' },
      { de: 'Geh zur Stätte und entzünde es. Lass mich helfen.', en: 'Go to the site and light it. Let me help.' },
    ],
  },
];
