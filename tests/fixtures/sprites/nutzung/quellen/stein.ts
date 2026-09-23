/** Zwei Sprites: `fx_genutzt` wird in `nutzung/src/` erwähnt, `fx_ungenutzt` nirgends. */
import { sprite } from '../../../../../assets-src/lib/sprite';

const raster = `.kk.
                kaak
                kaak
                .kk.`;
const legende = { '.': null, k: 'stein.0', a: 'stein.3' } as const;

export default [
  sprite({ id: 'fx_genutzt', size: [4, 4], anchor: [2, 4], hoehe: 'kugel', legende, frames: [raster] }),
  sprite({ id: 'fx_ungenutzt', size: [4, 4], anchor: [2, 4], hoehe: 'kugel', legende, frames: [raster] }),
];
