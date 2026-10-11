/**
 * Hand-Layer der Wassergefäße (M7-30, docs/SPIEL.md §21; strand E): `ausruestung_<itemId>`, gehalten am Sockel `hand` wie
 * die Holzeimer (assets-src/sprites/ausruestung/werkzeuge.ts) – sie hängen am Bügel oder Riemen und drehen sich nicht.
 * - **Eimer abgekochten Wassers:** der Holzeimer mit klarem, hellem Wasser (`eis`), daran vom Eimer mit Flusswasser zu
 *   unterscheiden.
 * - **Trinkschlauch:** der Lederbeutel am Riemen, der Stopfen oben.
 */
import { werkzeugSprite, type WerkzeugForm } from '../../lib/figureWerkzeug';
import { sprite } from '../../lib/sprite';

const LEGENDE = {
  '.': null,
  k: 'nacht.1',
  h: 'holz.1',
  o: 'holz.2',
  O: 'holz.3',
  r: 'sand.3',
  R: 'sand.1',
  w: 'eis.3',
  W: 'eis.4',
  l: 'erde.1',
  L: 'erde.2',
  s: 'erde.3',
} as const;

const HAENGT = { legende: LEGENDE, griffZeichen: 'r', schmier: null, spiegelbar: true, halten: 'oben' } as const;

const FORMEN: readonly WerkzeugForm[] = [
  {
    ...HAENGT,
    id: 'ausruestung_wasser_abgekocht',
    raster: `..r+r..
             .r...r.
             .kkkkk.
             kwWWwwk
             kOoooOk
             kRrRrRk
             kOoooOk
             .kkkkk.`,
    wirkpunkt: [0, 4],
  },
  {
    ...HAENGT,
    id: 'ausruestung_trinkschlauch',
    raster: `..r+r..
             .r...r.
             .rkLk..
             .kLsLk.
             kLssLLk
             kLLLLlk
             .kllllk
             ..kkkk.`,
    wirkpunkt: [0, 4],
  },
];

export default FORMEN.map((f) => sprite(werkzeugSprite(f)));
