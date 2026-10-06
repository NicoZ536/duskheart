/**
 * What the Borkenvater leaves, and the pickaxe it opens (MASTERPROMPT §20.2 "Borkenvater … Drop: Kernholz", "einzigartige
 * Drops, Trophäe, Herzsplitter (+10 max. Leben)", §13.2 "Die Spitzhacke jeder Stufe ab T1 braucht den Schlüssel-Drop des
 * Bosses dieser Stufe"; docs/SPIEL.md §22, §29; M7-32, M7-34):
 *
 * - `kernholz` – the heartwood of the corrupted tree, its unique drop (only source `boss:borkenvater`) and the key of tier 1:
 *   the bronze pickaxe needs it (src/content/recipes/borkenvater.ts, the gating check of src/content/gating.ts).
 * - `borkenharz` – resin welling from its bark: three to five from the boss, now and then one from a Zweigling; it binds
 *   the Lumen of the first beacon's crafts (the Lumen workbench, the way stone).
 * - `trophaee_borkenvater` – its crown of glowing knots on a board: wall furniture (`wandmoebel`, category `trophaee`,
 *   src/content/buildPartsAlle.ts) – the proof on the wall, decoration for a trophy hall (§16.4).
 * - `herzsplitter` – the heart shard every boss leaves (`splitter` block, used once for good: +10 maximum health,
 *   src/game/shards/).
 * - `bronzespitzhacke` – the T1 pickaxe (mining power 2, §13.2), bronze bars, a haft and the Kernholz.
 * Trade values [trade points, 1 = one piece of wood]: the boss parts are priceless in kind, valued by the fight they cost.
 */
import { BALANCE } from '../balance';
import { defineBuildParts } from '../buildParts';
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

/** Tier of the Borkenvater's spoils (the gate to T1, §13.2). */
const TIER = 1;
/** The boss as an item source (`boss:<id>`, docs/SPIEL.md §29 "Neue Quellenarten"). */
const FROM_BOSS = 'boss:borkenvater';

/** Spoils of the Borkenvater and the bronze pickaxe. */
export const BORKENVATER_ITEMS = defineItemGroup('borkenvater', [
  baseItem({
    id: 'kernholz',
    name: { de: 'Kernholz', en: 'Heartwood' },
    beschreibung: {
      de: 'Das glimmende Herz des Borkenvaters, hart wie Bronze und warm in der Hand. Nur damit lässt sich eine Bronzespitzhacke schäften, die Raseneisen und Eisenerz bricht.',
      en: 'The glowing heart of the Barkfather, hard as bronze and warm in the hand. Only with it can a bronze pickaxe be hafted that breaks bog iron and iron ore.',
    },
    kategorie: 'rohstoff',
    stufe: TIER,
    raritaet: 'episch',
    tauschwert: 120,
    quellen: [FROM_BOSS],
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  baseItem({
    id: 'borkenharz',
    name: { de: 'Borkenharz', en: 'Bark Resin' },
    beschreibung: {
      de: 'Zähes, bernsteinfarbenes Harz aus der Rinde des Borkenvaters. Es hält Lumen gebunden – die Werkstätten des ersten Leuchtfeuers brauchen es.',
      en: 'Tough, amber resin from the Barkfather’s bark. It holds Lumen bound – the crafts of the first beacon need it.',
    },
    kategorie: 'rohstoff',
    stufe: TIER,
    raritaet: 'selten',
    tauschwert: 14,
    quellen: [FROM_BOSS],
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  baseItem({
    id: 'trophaee_borkenvater',
    name: { de: 'Krone des Borkenvaters', en: 'Barkfather’s Crown' },
    beschreibung: {
      de: 'Ein Kranz aus Borke mit drei erloschenen Glutknoten, auf ein Brett geschlagen. An der Wand erzählt er, wer den Wald befreit hat.',
      en: 'A wreath of bark with three spent glowing knots, nailed onto a board. On the wall it tells who set the forest free.',
    },
    kategorie: 'bauteil',
    stufe: TIER,
    raritaet: 'episch',
    tauschwert: 80,
    quellen: [FROM_BOSS],
    sounds: { aufheben: ITEM_SFX.holz },
  }),
  baseItem({
    id: 'herzsplitter',
    name: { de: 'Herzsplitter', en: 'Heart Shard' },
    beschreibung: {
      de: 'Ein warmer Splitter, der im Takt eines Herzens glimmt. Benutzt, geht er in dich über: dauerhaft 10 Leben mehr.',
      en: 'A warm shard that glows in time with a heartbeat. Used, it passes into you: 10 more maximum health for good.',
    },
    kategorie: 'rohstoff',
    stufe: TIER,
    raritaet: 'legendaer',
    // Used up for good by `item.use` (src/game/shards/) – like the splint an end in itself, no recipe asks for it.
    endprodukt: true,
    tauschwert: 150,
    quellen: [FROM_BOSS],
    splitter: { art: 'herz' },
    sounds: { aufheben: ITEM_SFX.lumen, benutzen: 'sfx_boss_herzsplitter' },
  }),
  baseItem({
    id: 'bronzespitzhacke',
    name: { de: 'Bronzespitzhacke', en: 'Bronze Pickaxe' },
    beschreibung: {
      de: 'Ein Bronzebogen am Stiel aus Kernholz. Bricht, was Stein nicht bricht: Raseneisen, Eisenerz und Torf – der Weg ins Nebelmoor und in den Tiefgrund.',
      en: 'A bronze arc on a heartwood haft. Breaks what stone cannot: bog iron, iron ore and peat – the way into the Mistmoor and the Deepground.',
    },
    kategorie: 'werkzeug',
    stufe: TIER,
    haltbarkeit: BALANCE.items.durabilityByTier[TIER] as number,
    werkzeug: { art: 'spitzhacke', abbaukraft: BALANCE.tools.miningPowerByTier[TIER] as number },
    tauschwert: 170,
    sounds: { aufheben: ITEM_SFX.werkzeug, benutzen: 'sfx_werkzeug_schwung' },
  }),
]);

/** The trophy on the wall (wall furniture, category `trophaee` – decoration of a trophy hall, §16.4). */
export const BORKENVATER_BAUTEILE = defineBuildParts('borkenvater', [{ id: 'trophaee_borkenvater', art: 'wandmoebel', material: 'holz', kategorie: 'trophaee' }]);
