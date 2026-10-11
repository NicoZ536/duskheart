/**
 * Jewellery 1–5 of M7 (MASTERPROMPT §13.1 "Schmuck (≥ 30): Ringe, Amulette, Talismane"; docs/SPIEL.md §26 "Schmuck 1–5 und
 * Deko": `knochentalisman`, `federtalisman`, `muscheltalisman` beside the wolf fang necklace and the tusk amulet; M7-62,
 * strand I). Talismans of the first days, strung at the workbench from what hunting and the beach give
 * (src/content/recipes/schmuck_m7.ts); worn in the jewellery slots (`schmuck1`, `schmuck2`), two of them add up:
 *
 * - `knochentalisman` (two bones, sinew): +10 maximum stamina – the carved bone of the first prey, a tenth of the start
 *   stamina (§11.1: 100): one more sprint step or dodge before the breath runs out.
 * - `federtalisman` (three feathers, sinew): +10 % stealth – light as a bird; creatures hear the sneaking player a tenth less
 *   far (`werte.schleichen`, the noise radius of sneaking).
 * - `muscheltalisman` (three shells, sinew): +15 % poison resistance – the sea's salt against the jellyfish's sting and the
 *   wasp's (§19.3 poison: its damage over time 15 % less).
 * Small next to armour and the sets (§D: jewellery is the spice, not the meal); trade values: their parts plus a fifth.
 */
import { baseItem, defineItemGroup, ITEM_SFX } from './define';

/** The three talismans. */
export const SCHMUCK_M7 = defineItemGroup('schmuck_m7', [
  baseItem({
    id: 'knochentalisman',
    name: { de: 'Knochentalisman', en: 'Bone Talisman' },
    beschreibung: {
      de: 'Ein Knochen, in die Form eines Herdfeuers geschnitzt, an einer Sehnenschnur. Wer ihn trägt, hält länger durch: mehr Ausdauer für Sprint und Ausweichen.',
      en: 'A bone carved into the shape of a hearth fire, on a sinew cord. Whoever wears it lasts longer: more stamina for sprinting and dodging.',
    },
    kategorie: 'schmuck',
    raritaet: 'gewoehnlich',
    ausruestung: 'schmuck',
    werte: { maxAusdauer: 10 },
    tauschwert: 14,
    sounds: { aufheben: ITEM_SFX.knochen },
  }),
  baseItem({
    id: 'federtalisman',
    name: { de: 'Federtalisman', en: 'Feather Talisman' },
    beschreibung: {
      de: 'Drei Federn, mit Sehne zu einem Fächer gebunden. Leicht wie ein Vogel: Wer schleicht, wird ein Stück weniger weit gehört.',
      en: 'Three feathers bound into a fan with sinew. Light as a bird: whoever sneaks is heard a little less far.',
    },
    kategorie: 'schmuck',
    raritaet: 'gewoehnlich',
    ausruestung: 'schmuck',
    werte: { schleichen: 0.1 },
    tauschwert: 12,
    sounds: { aufheben: ITEM_SFX.federn },
  }),
  baseItem({
    id: 'muscheltalisman',
    name: { de: 'Muscheltalisman', en: 'Shell Talisman' },
    beschreibung: {
      de: 'Drei Muscheln vom Strand, gelocht und auf Sehne gereiht. Das Salz des Meeres steckt darin: Gift setzt dem Träger weniger zu.',
      en: 'Three shells from the beach, pierced and strung on sinew. The salt of the sea is in them: poison troubles the wearer less.',
    },
    kategorie: 'schmuck',
    raritaet: 'gewoehnlich',
    ausruestung: 'schmuck',
    werte: { giftresistenz: 0.15 },
    tauschwert: 13,
    sounds: { aufheben: ITEM_SFX.muschel },
  }),
]);
