/**
 * Silhouettes of empty special slots (MASTERPROMPT §26 pixel UI): helmet, tunic, trousers, boot,
 * cloak, shield, ring, amulet, flask (belt), backpack and bin, each a 12×12 pixel raster drawn as
 * crisp SVG rectangles in the current text colour (inventar.css dims them to the frame's light wood),
 * so an empty equipment slot tells what belongs there without text.
 */
import type { EquipmentSlot } from '../../../game/items/slots';

/** Raster size [design px]. */
export const GLYPH_SIZE = 12;

/** Glyph ids. */
export type GlyphId = EquipmentSlot | 'guertel' | 'rucksack' | 'muell';

const RASTERS: Readonly<Record<GlyphId, readonly string[]>> = {
  kopf: [
    '............',
    '....####....',
    '..########..',
    '.##########.',
    '.##########.',
    '.##########.',
    '.###....###.',
    '.##......##.',
    '.##......##.',
    '.##......##.',
    '............',
    '............',
  ],
  brust: [
    '............',
    '.###....###.',
    '#####..#####',
    '############',
    '############',
    '.##########.',
    '..########..',
    '..########..',
    '..########..',
    '..########..',
    '..########..',
    '............',
  ],
  beine: [
    '............',
    '..########..',
    '..########..',
    '..########..',
    '..###..###..',
    '..###..###..',
    '..###..###..',
    '..###..###..',
    '..###..###..',
    '..###..###..',
    '..###..###..',
    '............',
  ],
  fuesse: [
    '............',
    '...####.....',
    '...####.....',
    '...####.....',
    '...####.....',
    '...####.....',
    '...####.....',
    '...#######..',
    '..#########.',
    '..#########.',
    '............',
    '............',
  ],
  ruecken: [
    '............',
    '....####....',
    '...##..##...',
    '..###..###..',
    '..########..',
    '.##########.',
    '.##########.',
    '.##########.',
    '############',
    '############',
    '#.##.##.##.#',
    '............',
  ],
  nebenhand: [
    '............',
    '.##########.',
    '.##########.',
    '.##########.',
    '.##########.',
    '.##########.',
    '..########..',
    '..########..',
    '...######...',
    '....####....',
    '.....##.....',
    '............',
  ],
  schmuck1: [
    '............',
    '.....##.....',
    '....####....',
    '.....##.....',
    '...######...',
    '..##....##..',
    '.##......##.',
    '.##......##.',
    '.##......##.',
    '..##....##..',
    '...######...',
    '............',
  ],
  schmuck2: [
    '.##......##.',
    '..##....##..',
    '...##..##...',
    '....####....',
    '.....##.....',
    '....####....',
    '...######...',
    '...######...',
    '...######...',
    '....####....',
    '.....##.....',
    '............',
  ],
  guertel: [
    '............',
    '....####....',
    '.....##.....',
    '....####....',
    '...######...',
    '..########..',
    '..########..',
    '..########..',
    '..########..',
    '...######...',
    '............',
    '............',
  ],
  rucksack: [
    '............',
    '....####....',
    '...##..##...',
    '..########..',
    '.##########.',
    '.##########.',
    '.###....###.',
    '.###....###.',
    '.##########.',
    '.##########.',
    '.##########.',
    '............',
  ],
  muell: [
    '............',
    '....####....',
    '.##########.',
    '.##########.',
    '............',
    '..########..',
    '..#.##.#.#..',
    '..#.##.#.#..',
    '..#.##.#.#..',
    '..#.##.#.#..',
    '..########..',
    '............',
  ],
};

/** Horizontal runs of filled pixels of a glyph as `[x, y, length]`. */
export function glyphRuns(id: GlyphId): Array<readonly [number, number, number]> {
  const runs: Array<readonly [number, number, number]> = [];
  RASTERS[id].forEach((row, y) => {
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

/** The glyph as inline SVG (12×12 design px, crisp edges, `currentColor`). */
export function Glyph({ id, class: extra }: { id: GlyphId; class?: string }) {
  return (
    <svg class={['dh-glyphe', extra ?? ''].filter(Boolean).join(' ')} viewBox={`0 0 ${GLYPH_SIZE} ${GLYPH_SIZE}`} shape-rendering="crispEdges" aria-hidden="true" data-glyphe={id}>
      {glyphRuns(id).map(([x, y, w]) => (
        <rect key={`${x}:${y}`} x={x} y={y} width={w} height={1} fill="currentColor" />
      ))}
    </svg>
  );
}
