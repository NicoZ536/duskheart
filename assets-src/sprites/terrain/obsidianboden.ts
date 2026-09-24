/**
 * Tileset Obsidianboden (M2-18, docs/ART.md §5, docs/WORLD.md §7): erstarrtes Vulkanglas der Glutadern
 * in `nacht` mit violettem Schimmer `verderb.1` (ungetönt). Vollfeld: Grundton `nacht.2`, muschelige
 * Bruchbögen – der obere Grat `nacht.4` sieht den Himmel, die Mulde darunter `nacht.1` ist verdeckt –,
 * glasige Plattenfugen, selten ein glimmender Riss (`feuer.1*`/`feuer.2*`, der Kern heller).
 * Materialflag `eis` (Glasglanz aus dem Licht). Liegt über Lava und Höhlenboden: kantige Bruchkante,
 * Front `nacht.0`/`nacht.1`, Grat `nacht.4`. Kantenstücke: `GEOMETRIE_KANTIG`.
 */
import { blobTileset } from '../../lib/blob';
import { GEOMETRIE_KANTIG, GRUPPE_TERRAIN, bandFaerbung, varianten } from './_quelle';

const LEGENDE = { o: 'nacht.2', O: 'nacht.3', h: 'nacht.4', d: 'nacht.1', D: 'nacht.0', v: 'verderb.1', g: 'feuer.2*', G: 'feuer.1*' } as const;

const VARIANTEN = varianten('obsidianboden', LEGENDE, [
  // 0 ruhig: ein muscheliger Bruchbogen.
  `oooooooooooooooo
   oooooooooooooooo
   oooooooooooooooo
   oooooooooooooooo
   oooooohhhhoooooo
   ooooohOOOOhooooo
   ooooodddddoooooo
   oooooooooooooooo
   oooooooooooooooo
   oooooooooooooooo
   oooooooooooooooo
   oooooooooooooooo
   oooooooooooooooo
   oooooooooooooooo
   oooooooooooooooo
   oooooooooooooooo`,
  // 1 Glasplatten mit Fuge und violettem Schimmer.
  `oooooooooooooooo
   oooooooooooooooo
   oooooooooooooooo
   ooovvvoooooooooo
   oovvOOOoddoooooo
   oooOOOOddooooooo
   ooooooddoooooooo
   oooooooooooooooo
   oooooooooooooooo
   oooooooooooooooo
   oooooooooohhhooo
   ooooooooohOOOdoo
   oooooooooodddooo
   oooooooooooooooo
   oooooooooooooooo
   oooooooooooooooo`,
  // 2 zwei gestaffelte Bruchbögen.
  `oooooooooooooooo
   oooooooooooooooo
   oooooooooooooooo
   oooooooooooooooo
   oooooooooooooooo
   oohhhhoooooooooo
   ohOOOOhooooooooo
   odddddoohhhhoooo
   oooooooOOOOOhooo
   ooooooodddddoooo
   oooooooooooooooo
   oooooooooooooooo
   oooooooooooooooo
   oooooooooooooooo
   oooooooooooooooo
   oooooooooooooooo`,
  // 3 selten: glimmender Riss.
  `oooooooooooooooo
   oooooooooooooooo
   oooooooooooooooo
   oooooooooooooooo
   ooooodDooooooooo
   oooooodGGDoooooo
   oooooooDgGDooooo
   ooooooooDGgDoooo
   oooooooooDGDoooo
   ooooooooooDDoooo
   oooooooooooooooo
   oooooooooooooooo
   oooooooooooooooo
   oooooooooooooooo
   oooooooooooooooo
   oooooooooooooooo`,
]);

export default blobTileset({
  id: 'tileset_obsidianboden',
  group: GRUPPE_TERRAIN,
  art: 'ueberlagerung',
  geometrie: GEOMETRIE_KANTIG,
  varianten: VARIANTEN,
  ruhig: [0, 1, 2],
  basis: 'nacht.2',
  fuellung: 'motive',
  faerbung: bandFaerbung({
    baender: { s: ['nacht.0', 'nacht.1'], n: ['nacht.4'], w: ['nacht.1'], o: ['nacht.1'] },
  }),
  material: { eis: ['nacht.2', 'nacht.3', 'nacht.4', 'verderb.1'] },
});
