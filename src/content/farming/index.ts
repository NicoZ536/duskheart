/**
 * The crops of M7 (docs/SPIEL.md §29 "Feld & Fang", MASTERPROMPT §17 "Nutzpflanzen", M7-21, M7-22; collection `crops`,
 * §C "Nutzpflanzen"): the first eighteen of §17 – vegetables, grains, fruit and fibre plants and a herb. Their harvest
 * items, seeds and icons live in src/content/items/feld.ts, their sprites `feldfrucht_<id>` in assets-src/sprites/feld/.
 *
 * Growth in days at good conditions (§17 "Wachstum täglich um 06:00"): stages × days per stage, the last stage is ripe.
 * Short crops (salad, radish-like turnips, peas, chamomile) ripen in a few days and carry the early game; slow ones
 * (pumpkin, maize, cabbage) take two to three weeks and yield more. Seasons and frost after the plant: root vegetables,
 * cabbage, garlic, rye, winter wheat and strawberries are hardy; tomatoes, beans, maize and pumpkins want the summer.
 * Peas, beans, tomatoes and strawberries carry again (`nachwuchs`), the rest is harvested once.
 */
import { defineCrops, type CropInput } from './schema';

export { cropSchema, cropSpriteId, cropWiltedSpriteId, defineCrops, ripeStage, CROP_SPRITE_PREFIX, CROP_WILTED_SUFFIX, SEED_PREFIX, WATER_NEEDS, type CropDef, type CropInput, type WaterNeed } from './schema';

/** One crop record (the seed id follows the id). */
function crop(id: string, rest: Omit<CropInput, 'id' | 'saat'>): CropInput {
  return { id, saat: `saat_${id}`, ...rest };
}

/** Crops 1–9 (M7-21) and 10–18 (M7-22). */
export const CROPS = defineCrops([
  // ---- M7-21: vegetables and pulses ----
  crop('karotte', { stufen: 5, tageJeStufe: 2, jahreszeiten: ['fruehling', 'sommer', 'herbst'], winterhart: false, wasserbedarf: 'mittel', ertrag: [2, 3], saatErtrag: [1, 2] }),
  crop('kartoffel', { stufen: 5, tageJeStufe: 2, jahreszeiten: ['fruehling', 'sommer'], winterhart: false, wasserbedarf: 'mittel', ertrag: [3, 5], saatErtrag: [1, 2] }),
  crop('ruebe', { stufen: 4, tageJeStufe: 2, jahreszeiten: ['fruehling', 'herbst', 'winter'], winterhart: true, wasserbedarf: 'gering', ertrag: [2, 3], saatErtrag: [1, 2] }),
  crop('zwiebel', { stufen: 5, tageJeStufe: 2, jahreszeiten: ['fruehling', 'sommer'], winterhart: false, wasserbedarf: 'gering', ertrag: [2, 3], saatErtrag: [1, 2] }),
  crop('knoblauch', { stufen: 4, tageJeStufe: 3, jahreszeiten: ['herbst', 'winter', 'fruehling'], winterhart: true, wasserbedarf: 'gering', ertrag: [2, 3], saatErtrag: [1, 2] }),
  crop('kohl', { stufen: 6, tageJeStufe: 2, jahreszeiten: ['fruehling', 'herbst', 'winter'], winterhart: true, wasserbedarf: 'hoch', ertrag: [1, 2], saatErtrag: [1, 2] }),
  crop('salat', { stufen: 4, tageJeStufe: 1, jahreszeiten: ['fruehling', 'sommer', 'herbst'], winterhart: false, wasserbedarf: 'hoch', ertrag: [1, 2], saatErtrag: [1, 2] }),
  crop('erbse', { stufen: 5, tageJeStufe: 1, jahreszeiten: ['fruehling', 'sommer'], winterhart: false, wasserbedarf: 'mittel', ertrag: [2, 4], saatErtrag: [1, 2], nachwuchs: { stufe: 3, ernten: 3 } }),
  crop('bohne', { stufen: 5, tageJeStufe: 2, jahreszeiten: ['sommer'], winterhart: false, wasserbedarf: 'mittel', ertrag: [2, 4], saatErtrag: [1, 2], nachwuchs: { stufe: 3, ernten: 3 } }),
  // ---- M7-22: grains, fruit vegetables, fibre and herb ----
  crop('weizen', { stufen: 6, tageJeStufe: 2, jahreszeiten: ['fruehling', 'sommer', 'herbst'], winterhart: true, wasserbedarf: 'gering', ertrag: [2, 4], saatErtrag: [1, 3] }),
  crop('gerste', { stufen: 5, tageJeStufe: 2, jahreszeiten: ['fruehling', 'sommer'], winterhart: false, wasserbedarf: 'gering', ertrag: [2, 4], saatErtrag: [1, 3] }),
  crop('roggen', { stufen: 6, tageJeStufe: 2, jahreszeiten: ['herbst', 'winter', 'fruehling'], winterhart: true, wasserbedarf: 'gering', ertrag: [2, 4], saatErtrag: [1, 3] }),
  crop('mais', { stufen: 6, tageJeStufe: 3, jahreszeiten: ['sommer'], winterhart: false, wasserbedarf: 'hoch', ertrag: [2, 3], saatErtrag: [1, 2] }),
  crop('tomate', { stufen: 6, tageJeStufe: 2, jahreszeiten: ['sommer'], winterhart: false, wasserbedarf: 'hoch', ertrag: [2, 4], saatErtrag: [1, 2], nachwuchs: { stufe: 4, ernten: 4 } }),
  crop('kuerbis', { stufen: 6, tageJeStufe: 3, jahreszeiten: ['sommer', 'herbst'], winterhart: false, wasserbedarf: 'hoch', ertrag: [1, 2], saatErtrag: [2, 3] }),
  crop('erdbeere', { stufen: 5, tageJeStufe: 2, jahreszeiten: ['fruehling', 'sommer'], winterhart: true, wasserbedarf: 'mittel', ertrag: [2, 4], saatErtrag: [1, 2], nachwuchs: { stufe: 3, ernten: 5 } }),
  crop('flachs', { stufen: 5, tageJeStufe: 2, jahreszeiten: ['fruehling', 'sommer'], winterhart: false, wasserbedarf: 'mittel', ertrag: [2, 3], saatErtrag: [1, 2] }),
  crop('kamille', { stufen: 4, tageJeStufe: 2, jahreszeiten: ['fruehling', 'sommer'], winterhart: true, wasserbedarf: 'gering', ertrag: [2, 3], saatErtrag: [1, 2] }),
]);
