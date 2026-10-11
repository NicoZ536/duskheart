/**
 * The Builder tablets 1–10 (MASTERPROMPT §8 "Vermittlung über 60 Erbauer-Tafeln", "Geheimes Ende: Alle 60 Erbauer-Tafeln gefunden";
 * docs/SPIEL.md §19 "Erbauer-Tafeln", §29 `tafel_01…10`; M7-46; collection `tablets`, §C "Erbauer-Tafeln"). Each tablet has a
 * title, its text in DE and EN and where it is found: a vault (optionally the room role it prefers) or a place type (the place's
 * layout names the tablet at its mark `tafel`). E at the tablet reads it (`tablet.read`, `tabletRead`); the chronicle keeps it
 * as knowledge (strand G). The first ten tell the Builders' hope and its price – the Urfeuer, the six beacons, the wound.
 */
import type { TabletInput } from './schema';

export const TABLETS: readonly TabletInput[] = [
  {
    id: 'tafel_01',
    nummer: 1,
    titel: { de: 'Die erste Flamme', en: 'The First Flame' },
    text: {
      de: 'Wir fanden das Urfeuer unter dem Herzen des Landes. Es brannte ohne Holz, ohne Luft, ohne Ende. Wer es sah, vergaß, wie Nacht sich anfühlt.',
      en: 'We found the Primal Fire beneath the heart of the land. It burned without wood, without air, without end. Whoever saw it forgot what night felt like.',
    },
    fundort: { art: 'gewoelbe', rolle: 'start' },
  },
  {
    id: 'tafel_02',
    nummer: 2,
    titel: { de: 'Das Versprechen', en: 'The Promise' },
    text: {
      de: 'Kein Kind soll mehr im Dunkeln frieren. Kein Wanderer soll mehr den Abend fürchten. Wir bauen den ewigen Tag. So schwuren wir, und so bauten wir.',
      en: 'No child shall freeze in the dark again. No wanderer shall fear the evening again. We build the endless day. So we swore, and so we built.',
    },
    fundort: { art: 'gewoelbe', rolle: 'kammer' },
  },
  {
    id: 'tafel_03',
    nummer: 3,
    titel: { de: 'Die Gewölbe', en: 'The Vaults' },
    text: {
      de: 'Unter jedem Wald, jedem Moor, jedem Eis legten wir Kammern an. Sie sollten die Glut tragen, bis das große Werk vollendet war. Verschließt sie gut.',
      en: 'Beneath every forest, every moor, every ice we laid out chambers. They were to carry the ember until the great work was done. Seal them well.',
    },
    fundort: { art: 'gewoelbe', rolle: 'schloss' },
  },
  {
    id: 'tafel_04',
    nummer: 4,
    titel: { de: 'Rätsel und Riegel', en: 'Riddles and Bolts' },
    text: {
      de: 'Nicht Gold schützen die Riegel, sondern Geduld. Wer die Hebel kennt, die Glocken und die Schalen, der kennt auch unsere Sprache. Dem sei geöffnet.',
      en: 'The bolts guard no gold, but patience. Whoever knows the levers, the bells and the bowls also knows our tongue. To them, let it open.',
    },
    fundort: { art: 'gewoelbe', rolle: 'raetsel' },
  },
  {
    id: 'tafel_05',
    nummer: 5,
    titel: { de: 'Der Riss', en: 'The Rift' },
    text: {
      de: 'Am Tag der Bändigung hielt das Feuer still. Dann brach der Boden auf, und aus der Wunde stieg etwas, das kein Licht kennt. Wir nannten es das Nachtherz.',
      en: 'On the day of the binding the fire stood still. Then the ground broke open, and from the wound rose something that knows no light. We called it the Nightheart.',
    },
    fundort: { art: 'gewoelbe', rolle: 'schatz' },
  },
  {
    id: 'tafel_06',
    nummer: 6,
    titel: { de: 'Sechs Feuer', en: 'Six Fires' },
    text: {
      de: 'Sechs Leuchtfeuer stellten wir um die Wunde, je eines in jedem Land. Solange sie brennen, bleibt die Dunkelheit im Kreis. Wacht über sie.',
      en: 'Six beacons we raised around the wound, one in every land. As long as they burn, the darkness stays inside the circle. Watch over them.',
    },
    fundort: { art: 'gewoelbe', rolle: 'endkammer' },
  },
  {
    id: 'tafel_07',
    nummer: 7,
    titel: { de: 'Die Wächter', en: 'The Wardens' },
    text: {
      de: 'Unsere Konstrukte dienen ohne Schlaf. Gebt ihnen Wurzel und Stein, und sie halten die Gewölbe, bis wir zurückkehren. Wir kehren zurück.',
      en: 'Our constructs serve without sleep. Give them root and stone, and they will hold the vaults until we return. We will return.',
    },
    fundort: { art: 'gewoelbe', rolle: 'falle' },
  },
  {
    id: 'tafel_08',
    nummer: 8,
    titel: { de: 'Grabspruch', en: 'Epitaph' },
    text: {
      de: 'Hier ruht, wer das erste Leuchtfeuer entzündete. Er sah die Nacht zurückweichen und glaubte, es sei genug. Es war nie genug.',
      en: 'Here lies the one who lit the first beacon. He saw the night draw back and believed it was enough. It was never enough.',
    },
    fundort: { art: 'ort', ortstyp: 'friedhof' },
  },
  {
    id: 'tafel_09',
    nummer: 9,
    titel: { de: 'Der Abtrünnige', en: 'The Defector' },
    text: {
      de: 'Ich verließ den Rat, als sie tiefer graben wollten. Das Feuer spricht im Schlaf zu ihnen. Wer es hört, hört bald nichts anderes mehr.',
      en: 'I left the council when they wanted to dig deeper. The fire speaks to them in their sleep. Whoever hears it soon hears nothing else.',
    },
    fundort: { art: 'ort', ortstyp: 'eremitenhuette' },
  },
  {
    id: 'tafel_10',
    nummer: 10,
    titel: { de: 'Saatgut', en: 'Seed' },
    text: {
      de: 'Wenn die Feuer verlöschen, bleibt dem Land nur, was wächst. Pflanzt, auch im Grau. Ein Feld ist ein kleines Leuchtfeuer, das niemand bewachen muss.',
      en: 'When the fires die, the land keeps only what grows. Plant, even in the grey. A field is a small beacon that no one has to guard.',
    },
    fundort: { art: 'ort', ortstyp: 'gehoeft' },
  },
];
