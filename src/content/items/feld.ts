/**
 * Items of the field (docs/SPIEL.md §29 "Feld & Fang", MASTERPROMPT §17, §14 "Gießkanne"; M7-19 … M7-22): the eighteen
 * harvests of the crops (src/content/farming/), their seeds, the watering can and the three garden remedies.
 *
 * - **Harvests** (`id` = the crop): vegetables, pulses and fruit are raw food of low value (§18 "roh (geringer Wert)") with
 *   their shelf life (`BALANCE.farming.shelfLifeDays`); grain, flax and chamomile are raw materials – grain and chamomile
 *   go to the kitchen of M7-25 … M7-28 (planned uses), flax is broken into fibres. Their source is the harvest
 *   (`ernte:<crop>`); quality 1–3 comes from the field (src/game/farming).
 * - **Seeds** `saat_<crop>` (category `saatgut`, block `saat`): sown on a hoed field or a garden bed (use "Einpflanzen",
 *   derived from the block). Sources: the harvest of their crop, and the wild – herbs, grasses, flowers and berry bushes
 *   now and then drop the seeds of their wild kin (src/content/farming/wildsaat.ts, joined into the world object drops).
 * - **Watering can** `giesskanne` (tool kind `giesskanne`, block `ladungen`): ten charges, filled at fresh water; one
 *   charge waters a plot to full moisture (§17 "Gießkanne").
 * - **Remedies** (block `duenger`): compost +30 and bone meal +20 fertility (§17 "Kompost +30, Knochenmehl +20"), herb brew
 *   cures mildew (§17 "Mehltau … (Kräuterbrühe)").
 * Trade values [trade points, 1 = one piece of wood]: a harvest about what its seed and a day of care are worth, seeds a
 * third of their harvest, the can and the remedies their ingredients plus a fifth for the work.
 */
import { BALANCE } from '../balance';
import { CROPS } from '../farming/index';
import type { CropDef } from '../farming/schema';
import type { ItemInput } from '../schema/item';
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

const SHELF = BALANCE.farming.shelfLifeDays;
const SEASON_NAMES: Readonly<Record<string, { de: string; en: string }>> = {
  fruehling: { de: 'Frühling', en: 'spring' },
  sommer: { de: 'Sommer', en: 'summer' },
  herbst: { de: 'Herbst', en: 'autumn' },
  winter: { de: 'Winter', en: 'winter' },
};

/** What one harvest item is: its names, how it is eaten or used, and how it keeps. */
interface HarvestSpec {
  readonly name: { de: string; en: string };
  /** Seed item names. */
  readonly saat: { de: string; en: string };
  /** One sentence about the harvest. */
  readonly text: { de: string; en: string };
  /** Raw food: satiation and thirst [points of 100]; absent = a raw material. */
  readonly essbar?: { saettigung: number; durst: number };
  /** Shelf life kind (`BALANCE.farming.shelfLifeDays`); absent = keeps. */
  readonly haltbar?: keyof typeof SHELF;
  readonly tauschwert: number;
  readonly sound: string;
}

const frucht = ITEM_SFX.frucht;
const pflanze = ITEM_SFX.pflanze;
const erde = ITEM_SFX.erde;

/** The harvests by crop id (raw food after §18, raw materials for the kitchen and the loom). */
const HARVESTS: Readonly<Record<string, HarvestSpec>> = {
  karotte: {
    name: { de: 'Karotte', en: 'Carrot' },
    saat: { de: 'Karottensamen', en: 'Carrot Seeds' },
    text: { de: 'Eine süße orange Wurzel mit grünem Kraut. Roh knackig, im Eintopf besser.', en: 'A sweet orange root with green tops. Crunchy raw, better in a stew.' },
    essbar: { saettigung: 6, durst: 2 },
    haltbar: 'wurzel',
    tauschwert: 3,
    sound: erde,
  },
  kartoffel: {
    name: { de: 'Kartoffel', en: 'Potato' },
    saat: { de: 'Saatkartoffel', en: 'Seed Potato' },
    text: { de: 'Eine erdige Knolle. Roh kaum genießbar – gebraten oder gekocht sättigt sie lange.', en: 'An earthy tuber. Barely edible raw – fried or boiled it fills you for long.' },
    essbar: { saettigung: 4, durst: 0 },
    haltbar: 'wurzel',
    tauschwert: 3,
    sound: erde,
  },
  ruebe: {
    name: { de: 'Rübe', en: 'Turnip' },
    saat: { de: 'Rübensamen', en: 'Turnip Seeds' },
    text: { de: 'Eine runde weiß-violette Rübe, die auch kalte Nächte übersteht.', en: 'A round white-and-purple turnip that survives cold nights too.' },
    essbar: { saettigung: 5, durst: 2 },
    haltbar: 'wurzel',
    tauschwert: 2,
    sound: erde,
  },
  zwiebel: {
    name: { de: 'Zwiebel', en: 'Onion' },
    saat: { de: 'Steckzwiebeln', en: 'Onion Sets' },
    text: { de: 'Eine goldbraune Zwiebel. Scharf, aber würzt jedes Gericht und hält sich lange.', en: 'A golden-brown onion. Sharp, but it seasons every dish and keeps for long.' },
    essbar: { saettigung: 3, durst: 1 },
    haltbar: 'zwiebel',
    tauschwert: 2,
    sound: erde,
  },
  knoblauch: {
    name: { de: 'Knoblauch', en: 'Garlic' },
    saat: { de: 'Knoblauchzehen', en: 'Garlic Cloves' },
    text: { de: 'Eine weiße Knolle aus vielen Zehen, im Herbst gesteckt. Würzt kräftig.', en: 'A white bulb of many cloves, planted in autumn. A strong seasoning.' },
    essbar: { saettigung: 2, durst: 0 },
    haltbar: 'zwiebel',
    tauschwert: 3,
    sound: erde,
  },
  kohl: {
    name: { de: 'Kohl', en: 'Cabbage' },
    saat: { de: 'Kohlsamen', en: 'Cabbage Seeds' },
    text: { de: 'Ein fester grüner Kopf, der bis in den Winter wächst. Durstig, aber ergiebig.', en: 'A firm green head that grows into winter. Thirsty, but rich.' },
    essbar: { saettigung: 7, durst: 2 },
    haltbar: 'kohl',
    tauschwert: 4,
    sound: pflanze,
  },
  salat: {
    name: { de: 'Salat', en: 'Lettuce' },
    saat: { de: 'Salatsamen', en: 'Lettuce Seeds' },
    text: { de: 'Zarte grüne Blätter, in wenigen Tagen reif. Löscht ein wenig den Durst, welkt aber schnell.', en: 'Tender green leaves, ripe in a few days. Quenches a little thirst, but wilts fast.' },
    essbar: { saettigung: 3, durst: 4 },
    haltbar: 'blatt',
    tauschwert: 2,
    sound: pflanze,
  },
  erbse: {
    name: { de: 'Erbsen', en: 'Peas' },
    saat: { de: 'Saaterbsen', en: 'Seed Peas' },
    text: { de: 'Süße grüne Erbsen in der Schote. Die Ranke trägt mehrmals.', en: 'Sweet green peas in the pod. The vine carries again and again.' },
    essbar: { saettigung: 4, durst: 1 },
    haltbar: 'huelse',
    tauschwert: 2,
    sound: pflanze,
  },
  bohne: {
    name: { de: 'Bohnen', en: 'Beans' },
    saat: { de: 'Saatbohnen', en: 'Seed Beans' },
    text: { de: 'Lange grüne Bohnen von der Stange, ein Sommergemüse. Die Pflanze trägt mehrmals.', en: 'Long green beans from the pole, a summer crop. The plant carries again and again.' },
    essbar: { saettigung: 4, durst: 0 },
    haltbar: 'huelse',
    tauschwert: 2,
    sound: pflanze,
  },
  weizen: {
    name: { de: 'Weizen', en: 'Wheat' },
    saat: { de: 'Saatweizen', en: 'Seed Wheat' },
    text: { de: 'Ein Bund goldener Ähren. Roh nicht zu essen – gemahlen wird es Mehl für Brot.', en: 'A bundle of golden ears. Not to be eaten raw – milled it becomes flour for bread.' },
    tauschwert: 2,
    sound: pflanze,
  },
  gerste: {
    name: { de: 'Gerste', en: 'Barley' },
    saat: { de: 'Saatgerste', en: 'Seed Barley' },
    text: { de: 'Ein Bund begrannter Ähren. Für Graupen, Mehl und Bier.', en: 'A bundle of bearded ears. For groats, flour and beer.' },
    tauschwert: 2,
    sound: pflanze,
  },
  roggen: {
    name: { de: 'Roggen', en: 'Rye' },
    saat: { de: 'Saatroggen', en: 'Seed Rye' },
    text: { de: 'Ein Bund langer grauer Ähren, das genügsamste Korn – wächst noch, wo Weizen friert.', en: 'A bundle of long grey ears, the hardiest grain – it still grows where wheat freezes.' },
    tauschwert: 2,
    sound: pflanze,
  },
  mais: {
    name: { de: 'Maiskolben', en: 'Corn Cob' },
    saat: { de: 'Saatmais', en: 'Seed Corn' },
    text: { de: 'Ein gelber Kolben in grünen Hüllblättern. Braucht Sommer und viel Wasser; geröstet ein Genuss.', en: 'A yellow cob in green husks. Needs summer and plenty of water; a treat roasted.' },
    essbar: { saettigung: 5, durst: 1 },
    haltbar: 'frucht',
    tauschwert: 3,
    sound: pflanze,
  },
  tomate: {
    name: { de: 'Tomate', en: 'Tomato' },
    saat: { de: 'Tomatensamen', en: 'Tomato Seeds' },
    text: { de: 'Eine pralle rote Frucht voller Saft. Die Staude trägt den Sommer über.', en: 'A plump red fruit full of juice. The plant carries all summer.' },
    essbar: { saettigung: 4, durst: 5 },
    haltbar: 'frucht',
    tauschwert: 3,
    sound: frucht,
  },
  kuerbis: {
    name: { de: 'Kürbis', en: 'Pumpkin' },
    saat: { de: 'Kürbiskerne', en: 'Pumpkin Seeds' },
    text: { de: 'Ein schwerer orangefarbener Kürbis. Wächst langsam, hält sich bis in den Winter.', en: 'A heavy orange pumpkin. Grows slowly, keeps into winter.' },
    essbar: { saettigung: 8, durst: 2 },
    haltbar: 'kuerbis',
    tauschwert: 5,
    sound: frucht,
  },
  erdbeere: {
    name: { de: 'Erdbeeren', en: 'Strawberries' },
    saat: { de: 'Erdbeerableger', en: 'Strawberry Runner' },
    text: { de: 'Große süße Gartenerdbeeren. Die Pflanze trägt viele Male und übersteht den Frost.', en: 'Big sweet garden strawberries. The plant carries many times and survives the frost.' },
    essbar: { saettigung: 4, durst: 3 },
    haltbar: 'beeren',
    tauschwert: 3,
    sound: frucht,
  },
  flachs: {
    name: { de: 'Flachs', en: 'Flax' },
    saat: { de: 'Leinsamen', en: 'Flax Seeds' },
    text: { de: 'Ein Bündel langer blau blühender Stängel. Gebrochen und gehechelt gibt es feine Fasern.', en: 'A bundle of long blue-flowering stems. Broken and hackled it gives fine fibres.' },
    tauschwert: 2,
    sound: pflanze,
  },
  kamille: {
    name: { de: 'Kamille', en: 'Chamomile' },
    saat: { de: 'Kamillensamen', en: 'Chamomile Seeds' },
    text: { de: 'Weiße Blüten mit gelbem Herz, duftend und getrocknet. Ein Heilkraut für Tee.', en: 'White flowers with a yellow heart, fragrant and dried. A healing herb for tea.' },
    tauschwert: 3,
    sound: pflanze,
  },
};

/** "Frühling, Sommer und Herbst" / "spring, summer and autumn". */
function seasonList(c: CropDef, lang: 'de' | 'en'): string {
  const names = c.jahreszeiten.map((s) => (SEASON_NAMES[s] as { de: string; en: string })[lang]);
  if (names.length === 1) return names[0] as string;
  return `${names.slice(0, -1).join(', ')} ${lang === 'de' ? 'und' : 'and'} ${names[names.length - 1] as string}`;
}

function spec(c: CropDef): HarvestSpec {
  const h = HARVESTS[c.id];
  if (h === undefined) throw new Error(`items/feld: no harvest item described for crop ${c.id}`);
  return h;
}

/** The harvest item of crop `c`. */
function harvestItem(c: CropDef): ItemInput {
  const h = spec(c);
  return baseItem({
    id: c.id,
    name: h.name,
    beschreibung: h.text,
    kategorie: h.essbar === undefined ? 'rohstoff' : 'nahrung',
    ...(h.essbar === undefined ? {} : { essbar: h.essbar }),
    ...(h.haltbar === undefined ? {} : { frische: SHELF[h.haltbar] }),
    tauschwert: h.tauschwert,
    quellen: [`ernte:${c.id}`],
    sounds: { aufheben: h.sound },
  });
}

/** The seed of crop `c`: how long it takes and when it grows, in the tooltip. */
function seedItem(c: CropDef): ItemInput {
  const h = spec(c);
  const days = c.stufen * c.tageJeStufe - c.tageJeStufe;
  const frost = c.winterhart ? { de: ' Übersteht Frost.', en: ' Survives frost.' } : { de: ' Frost tötet die Pflanze im Freien.', en: ' Frost kills the plant outdoors.' };
  const again = c.nachwuchs === undefined ? { de: '', en: '' } : { de: ` Trägt bis zu ${c.nachwuchs.ernten}-mal.`, en: ` Carries up to ${c.nachwuchs.ernten} times.` };
  return baseItem({
    id: c.saat,
    name: h.saat,
    beschreibung: {
      de: `Auf einem gehackten Acker oder Beet ausgesät, reift daraus in etwa ${days} Tagen ${h.name.de} – wächst im ${seasonList(c, 'de')}.${frost.de}${again.de}`,
      en: `Sown on a hoed field or a garden bed, it ripens into ${h.name.en} in about ${days} days – grows in ${seasonList(c, 'en')}.${frost.en}${again.en}`,
    },
    kategorie: 'saatgut',
    saat: { pflanze: c.id },
    tauschwert: Math.max(1, Math.round(h.tauschwert / 3)),
    quellen: [`ernte:${c.id}`],
    sounds: { aufheben: ITEM_SFX.pflanze },
  });
}

/** Mining power and durability of the watering can (T0: a wooden tool, §D "T0 60 Nutzungen"). */
const T0_POWER = BALANCE.tools.miningPowerByTier[0] as number;
const T0_DURABILITY = BALANCE.items.durabilityByTier[0] as number;

/** Harvests, seeds, the watering can and the remedies. */
export const FELD = defineItemGroup('feld', [
  ...CROPS.map(harvestItem),
  ...CROPS.map(seedItem),
  baseItem({
    id: 'giesskanne',
    name: { de: 'Gießkanne', en: 'Watering Can' },
    beschreibung: {
      de: 'Eine Kanne aus Holzdauben mit Ausgussrohr. An Fluss, See oder Quelle gefüllt, gießt sie zehn Beete – gegossene Pflanzen wachsen auch an trockenen Tagen.',
      en: 'A can of wooden staves with a spout. Filled at a river, lake or spring, it waters ten plots – watered plants grow on dry days too.',
    },
    kategorie: 'werkzeug',
    haltbarkeit: T0_DURABILITY,
    // A can mines nothing; tool data names its kind (the schema's lowest power stands for "none needed").
    werkzeug: { art: 'giesskanne', abbaukraft: T0_POWER },
    ladungen: { max: BALANCE.farming.canCharges, inhalt: 'wasser', fuellen: ['wasser'] },
    tauschwert: 20,
    sounds: { aufheben: ITEM_SFX.holz, benutzen: 'sfx_feld_giessen' },
  }),
  baseItem({
    id: 'kompost',
    name: { de: 'Kompost', en: 'Compost' },
    beschreibung: {
      de: 'Dunkle, krümelige Erde aus der Kompostkiste. Auf einen Acker gestreut: +30 Fruchtbarkeit – fruchtbarer Boden gibt bessere Ernten.',
      en: 'Dark, crumbly soil from the compost box. Spread on a field: +30 fertility – rich soil gives better harvests.',
    },
    kategorie: 'rohstoff',
    duenger: { fruchtbarkeit: 30 },
    // Spread on a field by the farming system (block `duenger`) – no recipe or part takes it, like the traps of M6.
    endprodukt: true,
    tauschwert: 2,
    sounds: { aufheben: ITEM_SFX.erde, benutzen: 'sfx_feld_duengen' },
  }),
  baseItem({
    id: 'knochenmehl',
    name: { de: 'Knochenmehl', en: 'Bone Meal' },
    beschreibung: {
      de: 'Zu Mehl zerstoßene Knochen. Auf einen Acker gestreut: +20 Fruchtbarkeit.',
      en: 'Bones crushed to meal. Spread on a field: +20 fertility.',
    },
    kategorie: 'rohstoff',
    duenger: { fruchtbarkeit: 20 },
    endprodukt: true,
    tauschwert: 3,
    sounds: { aufheben: ITEM_SFX.knochen, benutzen: 'sfx_feld_duengen' },
  }),
  baseItem({
    id: 'kraeuterbruehe',
    name: { de: 'Kräuterbrühe', en: 'Herb Brew' },
    beschreibung: {
      de: 'Ein bitterer Sud aus Schafgarbe und Wegerich. Über eine Pflanze gegossen heilt er Mehltau und gibt dem Boden ein wenig Kraft (+5).',
      en: 'A bitter brew of yarrow and plantain. Poured over a plant it cures mildew and gives the soil a little strength (+5).',
    },
    kategorie: 'rohstoff',
    duenger: { fruchtbarkeit: 5, heilt: 'mehltau' },
    endprodukt: true,
    tauschwert: 7,
    sounds: { aufheben: ITEM_SFX.pflanze, benutzen: 'sfx_feld_giessen' },
  }),
]);
