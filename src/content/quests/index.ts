/**
 * The quests of M7 (MASTERPROMPT §8 "Hauptziel „Die sechs Feuer“", §23.3 "Einstieg „Die ersten Stunden“"; docs/SPIEL.md §23
 * "Aufgaben", "Einstieg"; M7-42, M7-43 – strand G, collection `quests`).
 *
 * - `einstieg` – the first hours, the first day: fibres and stones → stone axe → a camp fire before the first night → a shelter
 *   (a room or a bed) → a workbench. Its steps read what the player carries and has made, so they also hold when the player
 *   was quicker than the guide. Switched off for the world with `quest.onboarding {on: false}`.
 * - `bronzezeit` – the side quest that follows it (the days after): copper and tin from the caves → bronze; its reward is the
 *   knowledge of bronze.
 * - `hq_sechs_feuer_1` – "Die sechs Feuer", act 1: Funke awakens after the first night → find the site of the Greengrove's
 *   beacon → defeat the Barkfather → light the beacon. It begins once the first camp fire burns (or with the first morning,
 *   when the onboarding is off). A step's `dialog` is spoken by Funke when the step becomes active (src/content/dialoge/).
 */
import type { QuestInput } from './schema';

export const QUESTS: readonly QuestInput[] = [
  {
    id: 'einstieg',
    art: 'einstieg',
    titel: { de: 'Die ersten Stunden', en: 'The First Hours' },
    beschreibung: {
      de: 'Gestrandet an einer fremden Küste. Sammle, was der Strand hergibt, mach Feuer, bevor es dunkel wird, und finde einen Weg zu besserem Werkzeug.',
      en: 'Stranded on a strange shore. Gather what the beach offers, make fire before dark and find your way to better tools.',
    },
    schritte: [
      {
        id: 'fasern_steine',
        titel: { de: 'Fasern und Steine', en: 'Fibres and stones' },
        hinweis: { de: 'Halte E an Strandhafer und Gräsern für Fasern, an Steinchen für Steine.', en: 'Hold E on beach grass and grasses for fibres, on pebbles for stones.' },
        ausloeser: {
          art: 'eines',
          von: [
            {
              art: 'alle',
              von: [
                { art: 'besitz', item: 'fasern', anzahl: 3 },
                { art: 'besitz', item: 'stein', anzahl: 2 },
              ],
            },
            { art: 'statistik', statistik: 'hergestellt', schluessel: 'steinaxt', mindestens: 1 },
          ],
        },
      },
      {
        id: 'steinaxt',
        titel: { de: 'Eine Steinaxt', en: 'A stone axe' },
        hinweis: { de: 'Drehe im Handwerk (C) aus Fasern ein Seil und binde damit Stein und Zweige zur Axt.', en: 'In crafting (C) twist fibres into a rope and bind stone and twigs into an axe.' },
        ausloeser: { art: 'statistik', statistik: 'hergestellt', schluessel: 'steinaxt', mindestens: 1 },
      },
      {
        id: 'lagerfeuer',
        titel: { de: 'Feuer vor der Nacht', en: 'Fire before nightfall' },
        hinweis: { de: 'Stell vor der ersten Nacht ein Lagerfeuer auf, leg Holz nach und entzünde es mit E.', en: 'Set up a camp fire before the first night, add wood and light it with E.' },
        ausloeser: { art: 'ereignis', ereignis: 'lightIgnited', wo: { kind: 'lagerfeuer' } },
      },
      {
        id: 'unterschlupf',
        titel: { de: 'Ein Unterschlupf', en: 'A shelter' },
        hinweis: { de: 'Schlaf in einem Bett – ein Grasbett genügt – oder bau dir einen Raum mit Dach.', en: 'Sleep in a bed – a grass bed will do – or build yourself a room with a roof.' },
        ausloeser: {
          art: 'eines',
          von: [
            { art: 'raum', innen: true },
            { art: 'ereignis', ereignis: 'sleepStarted', wo: { place: 'grasbett' } },
            { art: 'ereignis', ereignis: 'sleepStarted', wo: { place: 'bett' } },
          ],
        },
      },
      {
        id: 'werkbank',
        titel: { de: 'Eine Werkbank', en: 'A workbench' },
        hinweis: { de: 'Stelle eine Werkbank her und stell sie auf – an ihr entstehen bessere Werkzeuge.', en: 'Craft a workbench and set it up – better tools are made at it.' },
        ausloeser: { art: 'statistik', statistik: 'hergestellt', schluessel: 'werkbank', mindestens: 1 },
      },
    ],
    belohnung: { items: [{ item: 'verband', anzahl: 2 }] },
  },
  {
    id: 'bronzezeit',
    art: 'neben',
    titel: { de: 'Das Zeitalter der Bronze', en: 'The Age of Bronze' },
    beschreibung: {
      de: 'Stein trägt dich durch die ersten Tage. Für mehr brauchst du Metall: Kupfer und Zinn aus den Höhlen, zu Bronze geschmolzen.',
      en: 'Stone carries you through the first days. For more you need metal: copper and tin from the caves, melted into bronze.',
    },
    start: { art: 'aufgabe', aufgabe: 'einstieg', status: 'erledigt' },
    schritte: [
      {
        id: 'kupfer_zinn',
        titel: { de: 'Kupfer und Zinn', en: 'Copper and tin' },
        hinweis: { de: 'In den Höhlen glänzen Kupfer- und Zinnadern. Brich sie mit der Spitzhacke.', en: 'Copper and tin veins gleam in the caves. Break them with a pickaxe.' },
        ausloeser: {
          art: 'alle',
          von: [
            {
              art: 'eines',
              von: [
                { art: 'besitz', item: 'kupfererz', anzahl: 1 },
                { art: 'besitz', item: 'kupferbarren', anzahl: 1 },
              ],
            },
            {
              art: 'eines',
              von: [
                { art: 'besitz', item: 'zinnerz', anzahl: 1 },
                { art: 'besitz', item: 'zinnbarren', anzahl: 1 },
              ],
            },
          ],
        },
      },
      {
        id: 'bronze',
        titel: { de: 'Bronze', en: 'Bronze' },
        hinweis: { de: 'Schmelze im Schmelzofen drei Kupferbarren mit einem Zinnbarren zu Bronze.', en: 'In the smelting furnace, melt three copper bars with one tin bar into bronze.' },
        ausloeser: { art: 'statistik', statistik: 'hergestellt', schluessel: 'bronzebarren', mindestens: 1 },
      },
    ],
    belohnung: { wissen: 'wissen_bronze' },
  },
  {
    id: 'hq_sechs_feuer_1',
    art: 'haupt',
    akt: 1,
    titel: { de: 'Die sechs Feuer – Das erste Feuer', en: 'The Six Fires – The First Fire' },
    beschreibung: {
      de: 'Sechs Leuchtfeuer hielten einst die Nacht in Schach. Die Glut in deiner Laterne erinnert sich an das erste: im Grünhain, bewacht von seinem Hüter.',
      en: 'Six beacons once held the night at bay. The ember in your lantern remembers the first: in the Greengrove, watched over by its guardian.',
    },
    start: {
      art: 'eines',
      von: [
        { art: 'aufgabe', aufgabe: 'einstieg', schritt: 'lagerfeuer', status: 'erledigt' },
        { art: 'statistik', statistik: 'tage', mindestens: 1 },
      ],
    },
    schritte: [
      {
        id: 'funke_erwacht',
        titel: { de: 'Funke erwacht', en: 'Spark awakens' },
        hinweis: { de: 'Überstehe die Nacht. Die Glut in deiner Laterne regt sich.', en: 'Last through the night. The ember in your lantern stirs.' },
        ausloeser: { art: 'statistik', statistik: 'naechte_ueberlebt', mindestens: 1 },
      },
      {
        id: 'staette_finden',
        titel: { de: 'Die Stätte des Grünhains', en: 'The Greengrove site' },
        hinweis: { de: 'Folge Funkes Zug durch den Grünhain bis zur erloschenen Leuchtfeuer-Stätte.', en: "Follow Spark's pull through the Greengrove to the dead beacon's site." },
        ausloeser: { art: 'ort', ortstyp: 'leuchtfeuer' },
        marker: { art: 'leuchtfeuer', nummer: 1 },
        dialog: 'funke_erwachen',
      },
      {
        id: 'borkenvater',
        titel: { de: 'Der Hüter des Hains', en: 'The guardian of the grove' },
        hinweis: { de: 'Ruf den Borkenvater an seinem Altar und besiege ihn. Bronze und Feuer helfen.', en: 'Call the Barkfather at his altar and defeat him. Bronze and fire help.' },
        ausloeser: { art: 'statistik', statistik: 'bosse_besiegt', schluessel: 'borkenvater', mindestens: 1 },
        marker: { art: 'boss', boss: 'borkenvater' },
        dialog: 'funke_staette',
      },
      {
        id: 'entzuenden',
        titel: { de: 'Das erste Feuer', en: 'The first fire' },
        hinweis: { de: 'Der Hüter ist gefallen. Kehr zur Stätte zurück und entzünde das Leuchtfeuer mit E.', en: 'The guardian has fallen. Return to the site and light the beacon with E.' },
        ausloeser: { art: 'statistik', statistik: 'leuchtfeuer_entzuendet', schluessel: 'gruenhain', mindestens: 1 },
        marker: { art: 'leuchtfeuer', nummer: 1 },
        dialog: 'funke_borkenvater',
      },
    ],
  },
];
