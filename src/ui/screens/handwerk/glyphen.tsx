/**
 * Small pixel symbols of the crafting screens and the recipe tracker (MASTERPROMPT §26 "eigener Pixel-UI-Look"):
 * quality star, pin, magnifier, chest, flame (fuel), arrow (input → output), hourglass (crafting time), cancel
 * cross, tick, and the arrows of the filter selector. Each is a 7×7 raster drawn as crisp SVG rectangles in the
 * current text colour, so the stylesheet colours them with palette tokens and they sit on whole design pixels
 * next to the 10-px font.
 */

/** Raster size [design px]. */
export const SYMBOL_GROESSE = 7;

/** Symbol ids. */
export type SymbolId = 'stern' | 'nadel' | 'lupe' | 'kiste' | 'flamme' | 'pfeil' | 'uhr' | 'kreuz' | 'haken' | 'links' | 'rechts';

const RASTER: Readonly<Record<SymbolId, readonly string[]>> = {
  stern: ['...#...', '..###..', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'],
  nadel: ['....##.', '...####', '..####.', '.####..', '..##...', '.#.....', '#......'],
  lupe: ['.###...', '#...#..', '#...#..', '#...#..', '.###...', '....##.', '.....##'],
  kiste: ['.#####.', '#.....#', '#######', '#..#..#', '#.....#', '#.....#', '#######'],
  flamme: ['...#...', '..##...', '..###..', '.#####.', '.##.##.', '##...##', '.#####.'],
  pfeil: ['...#...', '...##..', '#######', '#######', '...##..', '...#...', '.......'],
  uhr: ['#######', '.#...#.', '..###..', '...#...', '..#.#..', '.#.#.#.', '#######'],
  kreuz: ['##...##', '###.###', '.#####.', '..###..', '.#####.', '###.###', '##...##'],
  haken: ['.......', '......#', '.....##', '#...##.', '##.##..', '.###...', '..#....'],
  links: ['....##.', '...###.', '..####.', '.#####.', '..####.', '...###.', '....##.'],
  rechts: ['.##....', '.###...', '.####..', '.#####.', '.####..', '.###...', '.##....'],
};

/** Horizontal runs of filled pixels of a symbol as `[x, y, length]`. */
export function symbolLaeufe(id: SymbolId): Array<readonly [number, number, number]> {
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

/** Every symbol's raster (tests check their size). */
export function symbolRaster(id: SymbolId): readonly string[] {
  return RASTER[id];
}

/** The symbol as inline SVG (7×7 design px, crisp edges, `currentColor`). */
export function Zeichen({ id, class: extra }: { id: SymbolId; class?: string }) {
  return (
    <svg class={['dh-symbol', extra ?? ''].filter(Boolean).join(' ')} viewBox={`0 0 ${SYMBOL_GROESSE} ${SYMBOL_GROESSE}`} shape-rendering="crispEdges" aria-hidden="true" data-symbol={id}>
      {symbolLaeufe(id).map(([x, y, w]) => (
        <rect key={`${x}:${y}`} x={x} y={y} width={w} height={1} fill="currentColor" />
      ))}
    </svg>
  );
}

/** Quality as stars: `anzahl` of `max` filled (the rest dim), e.g. ★★☆. */
export function Sterne({ anzahl, max, label }: { anzahl: number; max: number; label: string }) {
  const out = [];
  for (let i = 0; i < max; i++) out.push(<Zeichen key={i} id="stern" class={i < anzahl ? 'dh-stern dh-stern--voll' : 'dh-stern'} />);
  return (
    <span class="dh-sterne" role="img" aria-label={label} data-sterne={anzahl}>
      {out}
    </span>
  );
}
