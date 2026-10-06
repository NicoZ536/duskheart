/**
 * Zeichenhilfe der Feld- und Fang-Sprites (Strang D, M7-19 … M7-24): ein Zeichenraster, auf das Formen gesetzt werden –
 * Ellipsen, Vielecke, Linien, Blätter – mit einer Schattierung nach Himmelsöffnung (oben hell, unten und an Kontaktstellen
 * dunkel, docs/ART.md §2.3) und einer Kontur außen herum. Das Ergebnis ist das Textraster des `sprite()`-Formats; jede Form
 * ist von Hand gesetzt (Koordinaten, Stufen), die Hilfe erspart nur das Abzählen der Pixel.
 */

/** Ein Zeichenraster (`.` = leer). */
export class Raster {
  readonly cells: string[];

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.cells = new Array<string>(w * h).fill('.');
  }

  get(x: number, y: number): string {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return '.';
    return this.cells[y * this.w + x] as string;
  }

  set(x: number, y: number, ch: string): this {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return this;
    this.cells[yi * this.w + xi] = ch;
    return this;
  }

  /** Setzt nur auf leere Zellen. */
  under(x: number, y: number, ch: string): this {
    if (this.get(Math.round(x), Math.round(y)) === '.') this.set(x, y, ch);
    return this;
  }

  /** Gefüllte Ellipse um (cx, cy) mit den Halbachsen rx, ry; `farbe(x, y, t)` mit t = 0 oben … 1 unten. */
  ellipse(cx: number, cy: number, rx: number, ry: number, farbe: string | ((x: number, y: number, t: number) => string)): this {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / (rx + 0.35);
        const dy = (y - cy) / (ry + 0.35);
        if (dx * dx + dy * dy > 1) continue;
        const t = ry <= 0 ? 0.5 : (y - (cy - ry)) / (2 * ry);
        this.set(x, y, typeof farbe === 'string' ? farbe : farbe(x, y, t));
      }
    }
    return this;
  }

  /** Gefülltes Vieleck (Punkte im Uhrzeigersinn oder dagegen). */
  poly(points: ReadonlyArray<readonly [number, number]>, farbe: string | ((x: number, y: number, t: number) => string)): this {
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const [, y] of points) {
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      const xs: number[] = [];
      const yc = y + 0.5;
      for (let i = 0; i < points.length; i++) {
        const [ax, ay] = points[i] as readonly [number, number];
        const [bx, by] = points[(i + 1) % points.length] as readonly [number, number];
        if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.round(xs[k] as number); x < Math.round(xs[k + 1] as number); x++) {
          const t = y1 === y0 ? 0.5 : (y - y0) / (y1 - y0);
          this.set(x, y, typeof farbe === 'string' ? farbe : farbe(x, y, t));
        }
      }
    }
    return this;
  }

  /** Linie von (x0, y0) nach (x1, y1). */
  line(x0: number, y0: number, x1: number, y1: number, ch: string): this {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, ch);
    return this;
  }

  /** Kontur `ch` auf den leeren Zellen um alle gesetzten (4er-Nachbarschaft; `ecken` auch diagonal). */
  outline(ch: string, ecken = false): this {
    const add: number[] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y) !== '.') continue;
        let hit = this.get(x - 1, y) !== '.' || this.get(x + 1, y) !== '.' || this.get(x, y - 1) !== '.' || this.get(x, y + 1) !== '.';
        if (!hit && ecken) hit = this.get(x - 1, y - 1) !== '.' || this.get(x + 1, y - 1) !== '.' || this.get(x - 1, y + 1) !== '.' || this.get(x + 1, y + 1) !== '.';
        if (hit) add.push(y * this.w + x);
      }
    }
    for (const i of add) this.cells[i] = ch;
    return this;
  }

  /** Ersetzt `von` durch `zu`, wo `wo(x, y)` gilt. */
  recolor(von: string, zu: string, wo: (x: number, y: number) => boolean = () => true): this {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.get(x, y) === von && wo(x, y)) this.set(x, y, zu);
    return this;
  }

  /** Das Textraster (Zeilen mit Zeilenumbruch). */
  toString(): string {
    const rows: string[] = [];
    for (let y = 0; y < this.h; y++) rows.push(this.cells.slice(y * this.w, (y + 1) * this.w).join(''));
    return rows.join('\n');
  }
}

/** Stufe aus einer Rampe nach t (0 hell oben … 1 dunkel unten), mit `hell`/`dunkel` als Anteilen der Randstufen. */
export function stufe(rampe: string, t: number, hell = 0.3, dunkel = 0.75): string {
  const n = rampe.length;
  if (n === 1) return rampe;
  if (t < hell) return rampe[n - 1] as string;
  if (t >= dunkel) return rampe[0] as string;
  const mid = rampe.slice(1, n - 1);
  if (mid.length === 0) return rampe[n - 1] as string;
  const k = Math.min(mid.length - 1, Math.floor(((t - hell) / (dunkel - hell)) * mid.length));
  return mid[mid.length - 1 - k] as string;
}

/** Ein Blatt als gefülltes Viereck von (x0, y0) nach (x1, y1) mit der halben Breite b (Mitte am breitesten). */
export function blatt(r: Raster, x0: number, y0: number, x1: number, y1: number, b: number, farbe: string | ((x: number, y: number, t: number) => string)): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const n = Math.hypot(dx, dy) || 1;
  const px = (-dy / n) * b;
  const py = (dx / n) * b;
  const mx = x0 + dx * 0.45;
  const my = y0 + dy * 0.45;
  r.poly(
    [
      [x0, y0],
      [mx + px, my + py],
      [x1, y1],
      [mx - px, my - py],
    ],
    farbe,
  );
}
