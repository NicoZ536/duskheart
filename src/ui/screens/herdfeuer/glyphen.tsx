/**
 * Pixel symbols of the hearth screen (MASTERPROMPT §26 "eigener Pixel-UI-Look"), drawn like the crafting screens'
 * symbols (src/ui/screens/handwerk/glyphen.tsx: 7×7 rasters as crisp SVG rectangles in the current text colour):
 * the lock of a niche whose beacon does not burn yet, the shield of the protected base and the rising arrow of the
 * respawn point.
 */
import { SYMBOL_GROESSE } from '../handwerk/glyphen';

/** Symbol ids of the hearth screen. */
export type HerdSymbol = 'schloss' | 'schild' | 'erwachen';

const RASTER: Readonly<Record<HerdSymbol, readonly string[]>> = {
  schloss: ['..###..', '.#...#.', '.#...#.', '#######', '###.###', '###.###', '#######'],
  schild: ['#######', '#######', '###.###', '.##.##.', '.#####.', '..###..', '...#...'],
  erwachen: ['...#...', '..###..', '.#####.', '...#...', '...#...', '.......', '#######'],
};

/** Horizontal runs `[x, y, length]` of the filled pixels of `id`. */
export function herdSymbolLaeufe(id: HerdSymbol): Array<readonly [number, number, number]> {
  const runs: Array<readonly [number, number, number]> = [];
  RASTER[id].forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== '#') {
        x++;
        continue;
      }
      const start = x;
      while (row[x] === '#') x++;
      runs.push([start, y, x - start]);
    }
  });
  return runs;
}

/** Every symbol's raster (tests check the size). */
export function herdSymbolRaster(id: HerdSymbol): readonly string[] {
  return RASTER[id];
}

/** The symbol as inline SVG (7×7 design px, crisp edges, `currentColor`). */
export function HerdZeichen({ id, class: extra }: { id: HerdSymbol; class?: string }) {
  return (
    <svg class={['dh-symbol', extra ?? ''].filter(Boolean).join(' ')} viewBox={`0 0 ${SYMBOL_GROESSE} ${SYMBOL_GROESSE}`} shape-rendering="crispEdges" aria-hidden="true" data-symbol={id}>
      {herdSymbolLaeufe(id).map(([x, y, w]) => (
        <rect key={`${x}:${y}`} x={x} y={y} width={w} height={1} fill="currentColor" />
      ))}
    </svg>
  );
}
