/**
 * Tileset Torf (M2-17/M2-18, docs/ART.md §3/§5, docs/WORLD.md §7): faseriger, dunkler Moorboden in
 * `holz` mit Torfmoos-Polstern in `gras` (Biomzeile Nebelmoor tönt beides nach). Vollfeld: Grundton
 * `holz.1`, kurze Faserzüge `holz.0` und trockene Fasern `holz.2`, ein Moospolster (Kappe `gras.3`,
 * Fuß `gras.1`), ein Stichgraben mit nassem Grund `erde.0`, selten Wollgras (`sand.4`).
 * Liegt über Schlamm, Pflaster und Eis: Front `holz.0`, Oberkante `holz.2`, Moosspitzen über der
 * Nordkante. Kantenstücke: `GEOMETRIE_SCHOLLE`.
 */
import { blobTileset } from '../../lib/blob';
import { GEOMETRIE_SCHOLLE, GRUPPE_TERRAIN, bandFaerbung, streuung, ueberstand, varianten } from './_quelle';

const LEGENDE = { t: 'holz.1', T: 'holz.0', f: 'holz.2', m: 'gras.1', M: 'gras.2', L: 'gras.3', e: 'erde.0', w: 'sand.4' } as const;

const VARIANTEN = varianten('torf', LEGENDE, [
  // 0 ruhig: zwei kurze Faserzüge.
  `tttttttttttttttt
   tttttttttttttttt
   tttttttttttttttt
   tttTTttttttttttt
   ttttTTTttttttttt
   tttttttttttttttt
   tttttttttttttttt
   tttttttttttttttt
   tttttttttttttttt
   tttttttttffttttt
   ttttttttttffTttt
   tttttttttttTTttt
   tttttttttttttttt
   tttttttttttttttt
   tttttttttttttttt
   tttttttttttttttt`,
  // 1 Moospolster (Kappe hell, Fuß dunkel) und ein Faserzug.
  `tttttttttttttttt
   tttttttttttttttt
   tttttttttttttttt
   tttttttttttttttt
   ttttttttttLLtttt
   tttttttttLLMLttt
   ttttttttMMLMMMtt
   ttttttttmMMMMmtt
   tttttttttmmmmttt
   tttttttttttttttt
   tttTTttttttttttt
   ttttTTTttttttttt
   tttttttttttttttt
   tttttttttttttttt
   tttttttttttttttt
   tttttttttttttttt`,
  // 2 Stichgraben: dunkler nasser Grund, oben die helle Stichkante.
  `tttttttttttttttt
   tttttttttttttttt
   tttttttttttttttt
   tttttttttttttttt
   tttttttttttttttt
   ttttfffffffttttt
   tttTeeeeeeeTtttt
   ttttTeeeeeTTtttt
   tttttTTTTTtttttt
   tttttttttttttttt
   tttttttttttttttt
   ttttttttttttLMtt
   ttttttttttttMMLt
   tttttttttttttmmt
   tttttttttttttttt
   tttttttttttttttt`,
  // 3 selten: Wollgras – weiße Köpfe auf dunklen Halmen.
  `tttttttttttttttt
   tttttttttttttttt
   ttttttwwtttttttt
   tttttwwMtwwttttt
   ttttttMMtwwMtttt
   tttttttMMMMttttt
   ttttttmMMMmttttt
   tttttttmmmtttttt
   tttttttttttttttt
   tttttttttttttttt
   tttttttttttttttt
   tttttttttttTTttt
   ttttttttttTTTTtt
   tttttttttttttttt
   tttttttttttttttt
   tttttttttttttttt`,
]);

export default blobTileset({
  id: 'tileset_torf',
  group: GRUPPE_TERRAIN,
  art: 'ueberlagerung',
  geometrie: GEOMETRIE_SCHOLLE,
  varianten: VARIANTEN,
  ruhig: [0, 1],
  basis: 'holz.1',
  fuellung: 'motive',
  faerbung: bandFaerbung({
    baender: { s: ['holz.0', 'holz.0'], n: ['holz.2'], w: ['holz.0'], o: ['holz.0'] },
    breiter: { s: [0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0] },
  }),
  deko: (k, feld, maske) => {
    ueberstand(k, feld, maske, 'n', ['gras.2', 'gras.3'], streuung(5, 1), 'gras.2');
  },
  material: { nass: ['erde.0'] },
});
