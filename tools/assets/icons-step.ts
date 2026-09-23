import { join } from 'node:path';
import { EMBLEM } from '../../assets-src/emblem';
import { RAMPS, UI_COLORS, hexToRgb } from '../../assets-src/palette';
import { writeIfChanged } from '../lib/files';
import { encodePng } from '../lib/png';

function refToHex(ref: string): string {
  const [name, step] = ref.split('.');
  const ramp = RAMPS.find((r) => r.name === name);
  const hex = ramp?.colors[Number(step)];
  if (!hex) throw new Error(`Icon: unbekannte Palettenreferenz ${ref}`);
  return hex;
}

/** Rasterise the 16×16 emblem centred on a rounded dark plate. */
function renderIcon(size: number): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const bg = hexToRgb(UI_COLORS.dunkel);
  const rim = hexToRgb(UI_COLORS.rahmenHell);
  const scale = Math.floor(size / 20);
  const off = Math.floor((size - 16 * scale) / 2);
  const radius = size * 0.18;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.max(radius - x, 0, x - (size - 1 - radius));
      const cy = Math.max(radius - y, 0, y - (size - 1 - radius));
      const d = Math.hypot(cx, cy);
      if (d > radius) continue;
      const border = d > radius - scale || x < scale || y < scale || x >= size - scale || y >= size - scale;
      const c = border ? rim : bg;
      const i = (y * size + x) * 4;
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
      px[i + 3] = 255;
    }
  }
  const legend = EMBLEM.legende as Record<string, string | null>;
  EMBLEM.raster.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      const ref = legend[row[rx] ?? '.'];
      if (!ref) continue;
      const [r, g, b] = hexToRgb(refToHex(ref));
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const i = ((off + ry * scale + sy) * size + off + rx * scale + sx) * 4;
          px[i] = r;
          px[i + 1] = g;
          px[i + 2] = b;
          px[i + 3] = 255;
        }
      }
    }
  });
  return px;
}

function svgIcon(): string {
  const legend = EMBLEM.legende as Record<string, string | null>;
  const rects: string[] = [];
  EMBLEM.raster.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ref = legend[row[x] ?? '.'];
      if (ref) rects.push(`<rect x="${x + 2}" y="${y + 2}" width="1" height="1" fill="${refToHex(ref)}"/>`);
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" shape-rendering="crispEdges"><rect width="20" height="20" rx="3" fill="${UI_COLORS.dunkel}"/>${rects.join('')}</svg>\n`;
}

export function buildIcons(out: { publicGenerated: string }): string {
  for (const size of [192, 512]) writeIfChanged(join(out.publicGenerated, `icon-${size}.png`), encodePng(size, size, renderIcon(size)));
  writeIfChanged(join(out.publicGenerated, 'icon.svg'), svgIcon());
  return 'icon-192.png, icon-512.png, icon.svg';
}
