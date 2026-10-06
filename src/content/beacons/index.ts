/**
 * The six beacons and the visions (MASTERPROMPT §8 "Je Biom ein Leuchtfeuer, bewacht vom Boss des Bioms. Entzünden → die
 * Region heilt sichtbar, Schutzzone, Schnellreisepunkt, neues Wissen, Story-Vision", "7 Visionen (kurze In-Engine-Sequenzen
 * mit Pixel-Standbildern)", §23.1; docs/SPIEL.md §22; strand F, collections `beacons` = `leuchtfeuer_1…6` in `BEACON_BIOMES`
 * order and `visions`; M7-35, M7-36).
 *
 * Beacon 1 (Grünhain) is playable in M7: the Borkenvater guards it, it gives `glutkern_1`, unlocks the first beacon's
 * knowledge (src/content/unlocks/index.ts) and shows vision 1. Beacons 2–6 are listed with the bosses, cores and visions
 * their tasks bring (`umgesetzt: { task }`); their beacons stay dark until then (`erloschen`).
 */
import type { BeaconInput, VisionInput } from './schema';

/** The six beacons in `BEACON_BIOMES` order. */
export const BEACONS: readonly BeaconInput[] = [
  {
    id: 'leuchtfeuer_1',
    nummer: 1,
    name: { de: 'Leuchtfeuer des Grünhains', en: 'Beacon of the Greenwood' },
    biom: 'gruenhain',
    boss: 'borkenvater',
    glutkern: 'glutkern_1',
    freischaltungen: ['lf1_lumen_werkbank', 'lf1_lumen_laterne', 'lf1_wegsteine', 'lf1_glutkern'],
    vision: 'vision_1',
    umgesetzt: true,
  },
  {
    id: 'leuchtfeuer_2',
    nummer: 2,
    name: { de: 'Leuchtfeuer des Nebelmoors', en: 'Beacon of the Mistmoor' },
    biom: 'nebelmoor',
    boss: 'sumpfmutter',
    glutkern: 'glutkern_2',
    freischaltungen: ['lf2_kanu', 'lf2_alchemie_2', 'lf2_runenaltar', 'lf2_glutkern'],
    vision: 'vision_2',
    umgesetzt: { task: 'M8-44' },
  },
  {
    id: 'leuchtfeuer_3',
    nummer: 3,
    name: { de: 'Leuchtfeuer des Frostkamms', en: 'Beacon of the Frostcomb' },
    biom: 'frostkamm',
    boss: 'hrimgar',
    glutkern: 'glutkern_3',
    freischaltungen: ['lf3_wasserrad', 'lf3_windrad', 'lf3_lumen_netz_1', 'lf3_blitzableiter', 'lf3_glutkern'],
    vision: 'vision_3',
    umgesetzt: { task: 'M8-46' },
  },
  {
    id: 'leuchtfeuer_4',
    nummer: 4,
    name: { de: 'Leuchtfeuer des Glutsands', en: 'Beacon of the Embersand' },
    biom: 'glutsand',
    boss: 'skarabaeus_koloss',
    glutkern: 'glutkern_4',
    freischaltungen: ['lf4_linsenschleifer', 'lf4_lichtwacht', 'lf4_fernrohr', 'lf4_sonnenlinse', 'lf4_glutkern'],
    vision: 'vision_4',
    umgesetzt: { task: 'M10-23' },
  },
  {
    id: 'leuchtfeuer_5',
    nummer: 5,
    name: { de: 'Leuchtfeuer des Aschenschlunds', en: 'Beacon of the Ashmaw' },
    biom: 'aschenschlund',
    boss: 'aschenschmied',
    glutkern: 'glutkern_5',
    freischaltungen: ['lf5_glutgenerator', 'lf5_foerderbaender', 'lf5_greifarme', 'lf5_sortierer', 'lf5_glutkern'],
    vision: 'vision_5',
    umgesetzt: { task: 'M10-24' },
  },
  {
    id: 'leuchtfeuer_6',
    nummer: 6,
    name: { de: 'Leuchtfeuer des Scherbenhains', en: 'Beacon of the Shardgrove' },
    biom: 'scherbenhain',
    boss: 'gefallene_hueterin',
    glutkern: 'glutkern_6',
    freischaltungen: ['lf6_prismenwerkbank', 'lf6_lumen_kern', 'lf6_sechsfach_flamme', 'lf6_glutkern'],
    vision: 'vision_6',
    umgesetzt: { task: 'M12-13' },
  },
];

/**
 * The visions (§8 "Story-Vision"): pixel stills with a few lines each, shown on their own screen when a beacon lights
 * (src/ui/screens/vision/). Vision 1 tells the first beacon's memory: the Builders lighting the six fires, the Nachtherz torn
 * open, the beacons dying one by one – and a single flame carried away to the south coast.
 */
export const VISIONS: readonly VisionInput[] = [
  {
    id: 'vision_1',
    bilder: [
      {
        sprite: 'vision_1_1',
        sekunden: 6,
        zeilen: [
          { de: 'Einst brannten sechs Feuer über Lumara.', en: 'Once six fires burned over Lumara.' },
          { de: 'Die Erbauer hatten sie entzündet, um die Nacht zu bannen.', en: 'The Builders had lit them to hold back the night.' },
        ],
      },
      {
        sprite: 'vision_1_2',
        sekunden: 6,
        zeilen: [
          { de: 'Doch sie griffen nach dem Urfeuer selbst –', en: 'But they reached for the First Fire itself –' },
          { de: 'und rissen das Nachtherz auf.', en: 'and tore the Nightheart open.' },
        ],
      },
      {
        sprite: 'vision_1_3',
        sekunden: 6,
        zeilen: [
          { de: 'Eines nach dem anderen erloschen die Feuer.', en: 'One by one the fires died.' },
          { de: 'Nur eine Glut wurde fortgetragen, nach Süden, ans Meer.', en: 'Only one ember was carried away, south, to the sea.' },
        ],
      },
      {
        sprite: 'vision_1_4',
        sekunden: 6,
        zeilen: [
          { de: 'Das erste Feuer brennt wieder.', en: 'The first fire burns again.' },
          { de: 'Fünf warten noch in der Dunkelheit.', en: 'Five still wait in the dark.' },
        ],
      },
    ],
  },
];

export * from './schema';
