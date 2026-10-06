/**
 * Knowledge entries of strand D (Wissen tab; docs/SPIEL.md §20, §23; M7-19 … M7-24): the field, growth and weather, fertiliser
 * and compost, pests, the greenhouse, saplings and fruit trees, fishing, the fish trap and ice fishing.
 */
import type { KnowledgeInput } from '../chronik/schema';

export const KNOWLEDGE_D: readonly KnowledgeInput[] = [
  {
    id: 'wissen_feld',
    titel: { de: 'Der Acker', en: 'The Field' },
    text: {
      de: 'Die Hacke macht aus Gras und Erde Acker; Hochbeete aus Holz oder Stein sind Acker ohne Hacke, auch auf gebautem Boden. Auf den Acker säst du mit Saat in der Hand. Reif erntest du mit E: die Frucht, oft neue Saat – und Erbse, Bohne, Tomate und Erdbeere tragen danach noch einmal.',
      en: 'The hoe turns grass and earth into field; raised beds of wood or stone are field without a hoe, even on built floors. Sow onto the field with seeds in your hand. When ripe, harvest with E: the crop, often new seeds – and peas, beans, tomatoes and strawberries bear again afterwards.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'plotCreated' },
  },
  {
    id: 'wissen_feld_wachstum',
    titel: { de: 'Wachstum und Wetter', en: 'Growth and Weather' },
    text: {
      de: 'Pflanzen wachsen jeden Morgen um 6 Uhr eine Stufe – wenn der Boden feucht genug ist (über 20), die Jahreszeit passt und die Nacht nicht unter 2 °C fiel. Regen gießt das ganze Feld, nahes Wasser hält es feucht, sonst trocknet es Tag für Tag. Frost tötet alles, was nicht winterhart ist.',
      en: 'Plants grow one stage every morning at 6 – if the soil is moist enough (above 20), the season fits and the night did not drop below 2 °C. Rain waters the whole field, nearby water keeps it moist, otherwise it dries day by day. Frost kills everything that is not hardy.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'cropPlanted' },
  },
  {
    id: 'wissen_feld_duenger',
    titel: { de: 'Fruchtbarkeit und Kompost', en: 'Fertility and Compost' },
    text: {
      de: 'Jede Ernte nimmt dem Boden 10 Fruchtbarkeit. Kompost gibt 30 zurück, Knochenmehl 20. Ein fruchtbarer Boden und dein Geschick bringen Ernten in Silber und Gold. Die Kompostkiste macht aus Laub, Fasern und Tang in einem Tag Kompost.',
      en: 'Every harvest takes 10 fertility from the soil. Compost gives back 30, bone meal 20. Fertile soil and your skill bring harvests of silver and gold. The compost box turns leaves, fibres and seaweed into compost in a day.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'cropHarvested' },
  },
  {
    id: 'wissen_feld_schaedlinge',
    titel: { de: 'Schädlinge', en: 'Pests' },
    text: {
      de: 'Krähen fressen Saat und Frucht, wo keine Vogelscheuche in der Nähe steht. Hasen knabbern an Beeten, die kein Zaun, keine Wand und kein Tor umschließt. Nach drei Regentagen in Folge kommt Mehltau – Kräuterbrühe heilt ihn, sonst geht die Pflanze ein.',
      en: 'Crows eat seeds and crops where no scarecrow stands nearby. Hares nibble at beds that no fence, wall or gate encloses. After three days of rain in a row mildew comes – herb brew heals it, otherwise the plant dies.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'pestAppeared' },
  },
  {
    id: 'wissen_gewaechshaus',
    titel: { de: 'Das Gewächshaus', en: 'The Greenhouse' },
    text: {
      de: 'Ein Raum mit Glasdach und Beeten ist ein Gewächshaus. Was darin wächst, kümmert sich nicht um die Jahreszeit, und kein Frost erreicht es – Tomaten im Winter.',
      en: 'A room with a glass roof and beds is a greenhouse. What grows inside does not care about the season, and no frost reaches it – tomatoes in winter.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'raum', raumtyp: 'gewaechshaus' },
  },
  {
    id: 'wissen_setzlinge',
    titel: { de: 'Setzlinge und Obstbäume', en: 'Saplings and Fruit Trees' },
    text: {
      de: 'Gefällte Bäume lassen manchmal einen Setzling fallen. Gepflanzt wächst er jeden Morgen ein Stück, bis er ein ganzer Baum ist – auch in deiner Basis. Obstbäume tragen zu ihrer Jahreszeit; ernte sie mit E wie einen Busch.',
      en: 'Felled trees sometimes drop a sapling. Planted, it grows a little every morning until it is a full tree – even in your base. Fruit trees bear in their season; harvest them with E like a bush.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'saplingPlanted' },
  },
  {
    id: 'wissen_angeln',
    titel: { de: 'Angeln', en: 'Fishing' },
    text: {
      de: 'Wirf die Angel mit E ins offene Wasser und warte. Taucht die Pose, halte E: der Fisch hängt. Dann zieht er – halte die Spannung: zu straff, und die Schnur reißt; zu locker, und er schüttelt sich los. Welcher Fisch beißt, hängt von Gewässer, Biom, Tageszeit, Wetter, Jahreszeit und Köder ab.',
      en: 'Cast the rod into open water with E and wait. When the float dips, hold E: the fish is hooked. Then it pulls – keep the tension: too tight and the line snaps; too slack and it shakes loose. Which fish bites depends on the water, biome, time of day, weather, season and bait.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'fishCast' },
  },
  {
    id: 'wissen_reusen',
    titel: { de: 'Reusen', en: 'Fish Traps' },
    text: {
      de: 'Eine Reuse fängt ohne dich: ins Wasser gesetzt, kann jeden Morgen ein Fisch darin sitzen, bis sie voll ist. Leere sie mit E.',
      en: 'A fish trap catches without you: set in the water, a fish may sit in it every morning until it is full. Empty it with E.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'fishTrapPlaced' },
  },
  {
    id: 'wissen_eisangeln',
    titel: { de: 'Eisangeln', en: 'Ice Fishing' },
    text: {
      de: 'Im Winter frieren Seen und Flüsse zu. Schlag mit der Spitzhacke ein Loch ins Eis und angle darin – unter dem Eis beißen andere Fische, allen voran die Quappe.',
      en: 'In winter lakes and rivers freeze over. Cut a hole in the ice with the pickaxe and fish through it – other fish bite under the ice, the burbot above all.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'iceHoleCut' },
  },
];
