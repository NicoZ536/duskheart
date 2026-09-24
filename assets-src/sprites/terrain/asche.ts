/**
 * Tileset Asche (M2-18, docs/ART.md §5, docs/WORLD.md §7): Ascheebenen des Aschenschlunds, direkt in
 * `nacht` gezeichnet (Grundton `nacht.3`, ungetönt). Vollfeld: weiche Aschewehen (Kuppe `nacht.4`
 * über Mulde `nacht.2`), Schlackebrocken mit Fuß `nacht.1`, selten Glutnester (`feuer.3*` im Kern,
 * `feuer.2*` am Rand – der Kern ist heller als der Rand, §9 Emissiv).
 * Asche legt sich über Erde, Sand, Gras und Lava: Front `nacht.1`/`nacht.2`, helle Oberkante
 * `nacht.4`, Seiten `nacht.2`. Kantenstücke: `GEOMETRIE_WEICH`.
 */
import { blobTileset } from '../../lib/blob';
import { GEOMETRIE_WEICH, GRUPPE_TERRAIN, bandFaerbung, varianten } from './_quelle';

const LEGENDE = { a: 'nacht.3', A: 'nacht.4', d: 'nacht.2', D: 'nacht.1', g: 'feuer.3*', G: 'feuer.2*' } as const;

const VARIANTEN = varianten('asche', LEGENDE, [
  // 0 ruhig: eine flache Wehe.
  `aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaAAAaaaa
   aaaaaaaAAAAAAaaa
   aaaaaaddddaadddd
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa`,
  // 1 Schlackebrocken und eine kurze Wehe.
  `aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaAAaaaaaaaaaa
   aaaAAdAaaaaaaaaa
   aaaDddDDaaaaaaaa
   aaaaDDDaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaAAAAaa
   aaaaaaaaAAAAAaaa
   aaaaaaaddddaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa`,
  // 2 zwei Wehen übereinander, versetzt.
  `aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaAAAAaaaaaaaaa
   aaAAAAAAAaaaaaaa
   adddaaaddaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaAAAaa
   aaaaaaaaaAAAAAAa
   aaaaaaaaddddaada
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa`,
  // 3 selten: kleines Glutnest in einer Senke (Kern `feuer.3*`, Rand `feuer.2*`).
  `aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaAAAAaaaaa
   aaaaaaadGgGdaaaa
   aaaaaaaDgGDaaaaa
   aaaaaaaaDDaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaaaaaaaaaaaaaa
   aaaAAaaaaaaaaaaa
   aaddAAaaaaaaaaaa
   aaaaddaaaaaaaaaa
   aaaaaaaaaaaaaaaa`,
]);

export default blobTileset({
  id: 'tileset_asche',
  group: GRUPPE_TERRAIN,
  art: 'ueberlagerung',
  geometrie: GEOMETRIE_WEICH,
  varianten: VARIANTEN,
  ruhig: [0, 1, 2],
  basis: 'nacht.3',
  fuellung: 'motive',
  faerbung: bandFaerbung({
    baender: { s: ['nacht.1', 'nacht.2'], n: ['nacht.4'], w: ['nacht.2'], o: ['nacht.2'] },
    breiter: {
      s: [0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0],
      n: [0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0],
    },
  }),
});
