/**
 * Aussehen der Spielfigur (docs/SPIEL.md §26, M7-52 … M7-54): die drei Körperformen, die zwölf Frisuren und die Paletten für
 * Haut, Haar und Kleidung (Schema und Bedeutung: ./schema.ts).
 */
import { z } from 'zod';
import { appearancePaletteSchema, type AppearancePaletteDef, type BodyShapeDef, type HairstyleDef } from './schema';

export * from './schema';

export const BODY_SHAPES: readonly BodyShapeDef[] = [
  { id: 'schmal', name: { de: 'Schmal', en: 'Slender' } },
  { id: 'mittel', name: { de: 'Mittel', en: 'Medium' } },
  { id: 'kraeftig', name: { de: 'Kräftig', en: 'Sturdy' } },
];

/** Die zwölf Frisuren in der Reihenfolge der Auswahl (dieselbe wie `FRISUREN` in assets-src/sprites/frisuren/frisuren.ts). */
export const HAIRSTYLES: readonly HairstyleDef[] = [
  { id: 'scheitel', name: { de: 'Seitenscheitel', en: 'Side parting' } },
  { id: 'pony', name: { de: 'Pony mit Bob', en: 'Bob with fringe' } },
  { id: 'lang', name: { de: 'Lang und offen', en: 'Long and loose' } },
  { id: 'zopf', name: { de: 'Zopf', en: 'Braid' } },
  { id: 'pferdeschwanz', name: { de: 'Pferdeschwanz', en: 'Ponytail' } },
  { id: 'dutt', name: { de: 'Dutt', en: 'Bun' } },
  { id: 'zoepfe', name: { de: 'Zwei Zöpfe', en: 'Two braids' } },
  { id: 'irokese', name: { de: 'Irokese', en: 'Mohawk' } },
  { id: 'stacheln', name: { de: 'Stachelkopf', en: 'Spikes' } },
  { id: 'locken', name: { de: 'Locken', en: 'Curls' } },
  { id: 'wuschel', name: { de: 'Zerzaust', en: 'Tousled' } },
  { id: 'straehne', name: { de: 'Stirnsträhne', en: 'Swept fringe' } },
];

/**
 * Die Paletten von Haut, Haar und Kleidung in Auswahlreihenfolge – keine Sammlung (sie benennen Palettenzeilen des Atlas,
 * assets-src/paletteRows.ts), deshalb hier beim Laden gegen das Schema geprüft und eingefroren.
 */
export const APPEARANCE_PALETTES: readonly AppearancePaletteDef[] = Object.freeze(z.array(appearancePaletteSchema).parse([
  { id: 'haut_1', art: 'haut', name: { de: 'Pfirsich', en: 'Peach' } },
  { id: 'haut_2', art: 'haut', name: { de: 'Hell', en: 'Fair' } },
  { id: 'haut_3', art: 'haut', name: { de: 'Oliv', en: 'Olive' } },
  { id: 'haut_4', art: 'haut', name: { de: 'Hellbraun', en: 'Tan' } },
  { id: 'haut_5', art: 'haut', name: { de: 'Braun', en: 'Brown' } },
  { id: 'haut_6', art: 'haut', name: { de: 'Dunkelbraun', en: 'Dark brown' } },
  { id: 'haar_1', art: 'haar', name: { de: 'Braun', en: 'Brown' } },
  { id: 'haar_2', art: 'haar', name: { de: 'Dunkelbraun', en: 'Dark brown' } },
  { id: 'haar_3', art: 'haar', name: { de: 'Schwarz', en: 'Black' } },
  { id: 'haar_4', art: 'haar', name: { de: 'Blond', en: 'Blond' } },
  { id: 'haar_5', art: 'haar', name: { de: 'Rotbraun', en: 'Auburn' } },
  { id: 'haar_6', art: 'haar', name: { de: 'Kupfer', en: 'Copper' } },
  { id: 'haar_7', art: 'haar', name: { de: 'Grau', en: 'Grey' } },
  { id: 'haar_8', art: 'haar', name: { de: 'Weiß', en: 'White' } },
  { id: 'kleid_1', art: 'kleid', name: { de: 'Blau', en: 'Blue' } },
  { id: 'kleid_2', art: 'kleid', name: { de: 'Rot', en: 'Red' } },
  { id: 'kleid_3', art: 'kleid', name: { de: 'Grün', en: 'Green' } },
  { id: 'kleid_4', art: 'kleid', name: { de: 'Leinen', en: 'Linen' } },
  { id: 'kleid_5', art: 'kleid', name: { de: 'Grau', en: 'Grey' } },
  { id: 'kleid_6', art: 'kleid', name: { de: 'Weinrot', en: 'Wine' } },
  { id: 'kleid_7', art: 'kleid', name: { de: 'Senf', en: 'Mustard' } },
  { id: 'kleid_8', art: 'kleid', name: { de: 'Nachtdunkel', en: 'Night' } },
]).map((p) => Object.freeze(p)));

/** Die Paletten einer Art in Auswahlreihenfolge. */
export function palettesOf(art: AppearancePaletteDef['art']): readonly AppearancePaletteDef[] {
  return APPEARANCE_PALETTES.filter((p) => p.art === art);
}
