/**
 * Saplings (M3-04; docs/SPIEL.md §6; MASTERPROMPT §14 "Der Stumpf bleibt (roden: Harz/Holz); 40 %
 * Chance auf Setzling", §17 "Bäume aus Setzlingen"): one per Grünhain tree species that grows from a
 * stump. `pflanzt` names the tree that grows from the sapling; the source is the `roden` drop of that
 * tree (src/content/worldObjects.ts).
 */
import { baseItem, defineItemGroup, ITEM_SFX } from './define';
import type { ItemInput } from '../schema/item';

/** Trade value of a forest tree sapling [trade points]: a rare find (40 % per cleared stump) worth a few logs. */
const FOREST_SAPLING_VALUE = 3;
/** Trade value of a fruit tree sapling [trade points]: the tree feeds its owner every year. */
const FRUIT_SAPLING_VALUE = 6;

/** Names of one sapling and of the tree it comes from and grows into. */
interface SaplingNames {
  /** Sapling name (DE, EN). */
  readonly de: string;
  readonly en: string;
  /** The stump it is found in, with article (DE: "ein Eichenstumpf"; EN: "an oak stump"). */
  readonly stumpDe: string;
  readonly stumpEn: string;
  /** The tree it grows into, with article (DE: "eine neue Eiche"; EN: "a new oak"). */
  readonly treeDe: string;
  readonly treeEn: string;
}

/** The sapling of the tree `baum_<art>`. */
function sapling(art: string, n: SaplingNames, fruit: boolean): ItemInput {
  return baseItem({
    id: `setzling_${art}`,
    name: { de: n.de, en: n.en },
    beschreibung: {
      de: `Junger Trieb, manchmal beim Roden eines Stumpfs zu finden – hier ${n.stumpDe}. Eingepflanzt wächst daraus ${n.treeDe}.`,
      en: `A young shoot, sometimes found when clearing a stump – this one from ${n.stumpEn}. Planted, it grows into ${n.treeEn}.`,
    },
    kategorie: 'saatgut',
    tauschwert: fruit ? FRUIT_SAPLING_VALUE : FOREST_SAPLING_VALUE,
    pflanzt: `baum_${art}`,
    sounds: { aufheben: ITEM_SFX.pflanze },
  });
}

/** Saplings of the Grünhain trees. */
export const SETZLINGE = defineItemGroup('setzlinge', [
  sapling('eiche', { de: 'Eichensetzling', en: 'Oak Sapling', stumpDe: 'ein Eichenstumpf', stumpEn: 'an oak stump', treeDe: 'eine neue Eiche', treeEn: 'a new oak' }, false),
  sapling('birke', { de: 'Birkensetzling', en: 'Birch Sapling', stumpDe: 'ein Birkenstumpf', stumpEn: 'a birch stump', treeDe: 'eine neue Birke', treeEn: 'a new birch' }, false),
  sapling('buche', { de: 'Buchensetzling', en: 'Beech Sapling', stumpDe: 'ein Buchenstumpf', stumpEn: 'a beech stump', treeDe: 'eine neue Buche', treeEn: 'a new beech' }, false),
  sapling('kiefer', { de: 'Kiefernsetzling', en: 'Pine Sapling', stumpDe: 'ein Kiefernstumpf', stumpEn: 'a pine stump', treeDe: 'eine neue Kiefer', treeEn: 'a new pine' }, false),
  sapling('weide', { de: 'Weidensetzling', en: 'Willow Sapling', stumpDe: 'ein Weidenstumpf', stumpEn: 'a willow stump', treeDe: 'eine neue Weide', treeEn: 'a new willow' }, false),
  sapling('apfelbaum', { de: 'Apfelbaumsetzling', en: 'Apple Tree Sapling', stumpDe: 'ein Apfelbaumstumpf', stumpEn: 'an apple tree stump', treeDe: 'ein neuer Apfelbaum', treeEn: 'a new apple tree' }, true),
  sapling('kirschbaum', { de: 'Kirschbaumsetzling', en: 'Cherry Tree Sapling', stumpDe: 'ein Kirschbaumstumpf', stumpEn: 'a cherry tree stump', treeDe: 'ein neuer Kirschbaum', treeEn: 'a new cherry tree' }, true),
  sapling('birnbaum', { de: 'Birnbaumsetzling', en: 'Pear Tree Sapling', stumpDe: 'ein Birnbaumstumpf', stumpEn: 'a pear tree stump', treeDe: 'ein neuer Birnbaum', treeEn: 'a new pear tree' }, true),
  sapling('walnussbaum', { de: 'Walnussbaumsetzling', en: 'Walnut Tree Sapling', stumpDe: 'ein Walnussbaumstumpf', stumpEn: 'a walnut tree stump', treeDe: 'ein neuer Walnussbaum', treeEn: 'a new walnut tree' }, true),
]);
