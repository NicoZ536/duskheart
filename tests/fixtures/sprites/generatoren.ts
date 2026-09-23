/** Fixture-Generator: geseedete Felsen aus verformter Ellipse, Form-Schattierung und selektiver Outline. */
import { defineGenerator } from '../../../assets-src/lib/generator';
import { PixelCanvas, blobMask } from '../../../assets-src/lib/raster';
import { spriteFromPixels } from '../../../assets-src/lib/sprite';

export interface FelsParameter {
  readonly anzahl: number;
  readonly groesse: number;
}

export const felsGenerator = defineGenerator('fixture_felsen', (rng, p: FelsParameter) =>
  Array.from({ length: p.anzahl }, (_, i) => {
    const c = new PixelCanvas(p.groesse, p.groesse);
    const mask = blobMask(rng, p.groesse, p.groesse, p.groesse / 2, p.groesse * 0.6, p.groesse * 0.38, p.groesse * 0.3, 0.2);
    c.shadeMask(mask, ['stein.1', 'stein.2', 'stein.3', 'stein.4']);
    c.outline();
    return spriteFromPixels({ id: `fx_fels_${i}`, size: [p.groesse, p.groesse], anchor: [p.groesse / 2, p.groesse - 1], hoehe: 'kugel' }, [c.toFrame()]);
  }),
);
