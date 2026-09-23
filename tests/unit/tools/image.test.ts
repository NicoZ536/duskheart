/**
 * tools/lib/image.ts: Zeichenoperationen der Asset-Werkzeuge. Gebrochene Koordinaten treffen das
 * Pixel, in das sie fallen – früher landeten sie als Zwischenindex im Puffer (um eine halbe
 * Bildbreite verschoben, sichtbar an Beschriftungen der Kontaktbögen).
 */
import { describe, expect, it } from 'vitest';
import { hexRgba, OPAQUE, RgbaImage, RGBA_BYTES } from '../../../tools/lib/image';

const RED = hexRgba('#ff0000');

function lit(img: RgbaImage): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (img.data[(y * img.width + x) * RGBA_BYTES + 3] === OPAQUE) out.push([x, y]);
  return out;
}

describe('RgbaImage', () => {
  it('setPixel mit gebrochenen Koordinaten setzt genau das umgebende Pixel', () => {
    const img = new RgbaImage(8, 4);
    img.setPixel(2.5, 1.75, RED);
    expect(lit(img)).toEqual([[2, 1]]);
  });

  it('fillRect füllt von ⌊x⌋ bis ⌊x + w⌋ und schneidet am Rand ab', () => {
    const img = new RgbaImage(8, 4);
    img.fillRect(1.5, 0.5, 2, 1, RED);
    expect(lit(img)).toEqual([
      [1, 0],
      [2, 0],
    ]);
    const edge = new RgbaImage(4, 2);
    edge.fillRect(-2, -1, 4, 5, RED);
    expect(lit(edge)).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]);
  });

  it('ganzzahlige Koordinaten verhalten sich wie bisher', () => {
    const img = new RgbaImage(4, 4);
    img.strokeRect(0, 0, 4, 4, RED);
    expect(lit(img)).toHaveLength(12);
  });
});
