/**
 * Baum-Baukasten (M2-20, docs/ART.md §2.7, §3): Stämme mit Rinde je Art, Äste, kahle Kronen mit
 * Schnee, Baumstümpfe und Setzlinge; dazu die Montage einer Krone (`foliage.ts`) mit Stamm zu einem
 * Sprite mit Blätterdach-/Wind-Flags, Occluder am Stammfuß und Höhen-Override (Relief der Blattmassen,
 * Zylinder für Stamm und Äste).
 *
 * Konventionen:
 * - Krone in einer Laubrampe (Stufen 0…5 = Kontur … Lichtkappe), Stamm in einer eigenen Rampe
 *   (Kontur, Schatten, Mitte, Licht, optional Akzent) – ein Material, eine Rampe (ART.md §2.6).
 * - Frame 0 = belaubt; Laubbäume haben Frame 1 = kahl (Winter). Clips `fruehling`, `sommer`,
 *   `herbst`, `winter` nennen den Frame je Jahreszeit; die Palettenzeile je Jahreszeit steht in
 *   `LAUB_ZEILEN` (assets-src/paletteRows.ts).
 */
import type { Rng } from '../../src/engine/rng';
import { paletteIndex } from '../palette';
import { kronenPunkte, type Krone } from './foliage';
import { despeckle, outlineOf } from './foliageRelief';
import { MATERIAL_BITS, TRANSPARENT, spriteFromPixels, type PixelFrameInput, type PixelSpriteMeta, type Sprite } from './sprite';

/** Zeichenfläche mit Palettenindex, Emissiv, Materialflags und Höhe (px, −1 = automatisch). */
export class Bild {
  readonly index: Uint8Array;
  readonly emissive: Uint8Array;
  readonly material: Uint8Array;
  readonly hoehe: Float32Array;
  /** Gesperrte Pixel: gewollte Akzente (Glutpunkte, Glanz), die `saeubere` nicht glättet. */
  readonly fest: Uint8Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.index = new Uint8Array(w * h);
    this.emissive = new Uint8Array(w * h);
    this.material = new Uint8Array(w * h);
    this.hoehe = new Float32Array(w * h).fill(-1);
    this.fest = new Uint8Array(w * h);
  }

  /** Setzt einen Pixel und sperrt ihn gegen das Glätten (gewollter Akzent). */
  akzent(x: number, y: number, ref: string, material = 0, hoehe = -1): void {
    this.set(x, y, ref, material, hoehe);
    if (this.inside(Math.round(x), Math.round(y))) this.fest[Math.round(y) * this.w + Math.round(x)] = 1;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): number {
    return this.inside(x, y) ? (this.index[y * this.w + x] ?? TRANSPARENT) : TRANSPARENT;
  }

  /** Setzt einen Pixel; `ref` als `rampe.stufe` (mit `*` emissiv) oder Palettenindex. */
  set(x: number, y: number, ref: string | number, material = 0, hoehe = -1): void {
    x = Math.round(x);
    y = Math.round(y);
    if (!this.inside(x, y)) return;
    const p = y * this.w + x;
    const emissive = typeof ref === 'string' && ref.endsWith('*');
    this.index[p] = typeof ref === 'number' ? ref : paletteIndex(emissive ? ref.slice(0, -1) : ref);
    this.emissive[p] = emissive ? 1 : 0;
    this.material[p] = material;
    if (hoehe >= 0) this.hoehe[p] = hoehe;
  }

  clear(x: number, y: number): void {
    if (!this.inside(x, y)) return;
    const p = y * this.w + x;
    this.index[p] = TRANSPARENT;
    this.emissive[p] = 0;
    this.material[p] = 0;
    this.hoehe[p] = -1;
  }

  mask(): Uint8Array {
    return Uint8Array.from(this.index, (v) => (v === TRANSPARENT ? 0 : 1));
  }

  /** Frame für `spriteFromPixels` (Höhe gerundet und auf 0…32 px begrenzt). */
  frame(): PixelFrameInput {
    const heightOverride = Int8Array.from(this.hoehe, (v, p) => ((this.index[p] ?? 0) === TRANSPARENT || v < 0 ? -1 : Math.max(0, Math.min(32, Math.round(v)))));
    return { index: Uint8Array.from(this.index), emissive: Uint8Array.from(this.emissive), material: Uint8Array.from(this.material), heightOverride };
  }

  copy(): Bild {
    const b = new Bild(this.w, this.h);
    b.index.set(this.index);
    b.emissive.set(this.emissive);
    b.material.set(this.material);
    b.hoehe.set(this.hoehe);
    b.fest.set(this.fest);
    return b;
  }
}

/** Materialflags der Krone: Blätterdach (Dither-Ausblendung) + Wind-Biegung. */
export const KRONE_FLAGS = MATERIAL_BITS.dach | MATERIAL_BITS.wind;

// ---------------------------------------------------------------------------------------------
// Stamm
// ---------------------------------------------------------------------------------------------

/** Rindenfarben (eine Rampe je Material). */
export interface RindenFarben {
  readonly kontur: string;
  readonly schatten: string;
  readonly mitte: string;
  readonly licht: string;
  /** Markierungen (Birkenflecken, Kirschen-Korkporen, Glutrisse, Kristalladern). */
  readonly akzent?: string;
}

/** Rindenmuster. */
export type Rinde = 'furchen' | 'glatt' | 'birke' | 'ringel' | 'schuppen' | 'glut' | 'kristall';

export interface StammParameter {
  /** Stammmitte am Fuß (x, Zellkoordinaten). */
  readonly x: number;
  /** Unterste Stammzeile (Bodenkontakt). */
  readonly fuss: number;
  /** Oberste Stammzeile (verschwindet in der Krone). */
  readonly oben: number;
  readonly breiteFuss: number;
  readonly breiteOben: number;
  /** Zusätzliche Breite je Seite am Wurzelansatz (px). */
  readonly wurzel: number;
  /** Zeilen des Wurzelansatzes. */
  readonly wurzelZeilen?: number;
  /** Versatz der Stammmitte oben (px, quadratischer Bogen – Palmen). */
  readonly neigung?: number;
  readonly rinde: Rinde;
  readonly farben: RindenFarben;
}

/** Mitte und halbe Breite des Stammes in Zeile `y`. */
export function stammSpanne(p: StammParameter, y: number): { cx: number; half: number } {
  const len = Math.max(1, p.fuss - p.oben);
  const t = Math.max(0, Math.min(1, (p.fuss - y) / len));
  const cx = p.x + (p.neigung ?? 0) * t * t;
  const rows = p.wurzelZeilen ?? 4;
  const up = p.fuss - y;
  const flare = up < rows ? p.wurzel * Math.pow((rows - up) / rows, 1.6) : 0;
  const half = (p.breiteFuss + (p.breiteOben - p.breiteFuss) * t) / 2 + flare;
  return { cx, half };
}

/**
 * Zeichnet den Stamm von `fuss` bis `oben`: Kontur außen, Schattenkante, Rindenmuster, Wurzelansatz
 * mit Bodenkontakt-Zeile. Höhe als Zylinder (Radius = halbe Breite).
 */
export function zeichneStamm(b: Bild, rng: Rng, p: StammParameter): void {
  const f = p.farben;
  // Furchen: senkrechte Züge mit eigener relativer Lage und Länge (nie im gleichen Abstand).
  const furchen: Array<{ u: number; y0: number; y1: number }> = [];
  if (p.rinde === 'furchen' || p.rinde === 'glut' || p.rinde === 'kristall') {
    const n = Math.max(2, Math.round(((p.breiteFuss + p.breiteOben) / 2) * 0.55));
    for (let i = 0; i < n * 3; i++) {
      const len = rng.int(4, Math.max(5, Math.round((p.fuss - p.oben) * 0.45)));
      const y1 = rng.int(p.oben, p.fuss + 1);
      furchen.push({ u: rng.float(-0.65, 0.65), y0: y1 - len, y1 });
    }
  }
  // Querzeichen (Birke, Kirsche, Buche).
  const marken = new Map<number, Array<{ u0: number; u1: number }>>();
  if (p.rinde === 'birke' || p.rinde === 'ringel' || p.rinde === 'glatt') {
    let y = p.oben + rng.int(1, 3);
    while (y < p.fuss - 1) {
      const u0 = rng.float(-0.9, 0.3);
      const len = p.rinde === 'glatt' ? rng.float(0.25, 0.45) : rng.float(0.35, 0.8);
      marken.set(y, [...(marken.get(y) ?? []), { u0, u1: Math.min(0.9, u0 + len) }]);
      y += p.rinde === 'ringel' ? rng.int(2, 4) : p.rinde === 'glatt' ? rng.int(5, 9) : rng.int(3, 6);
    }
  }
  for (let y = p.oben; y <= p.fuss; y++) {
    const { cx, half } = stammSpanne(p, y);
    // Links und rechts runden versetzt: der Stamm verjüngt sich in einzelnen Stufen, nie beidseitig
    // in derselben Zeile (keine Treppe mitten im Stamm).
    const l = Math.round(cx - half + 0.3);
    const r = Math.round(cx + half - 0.3) - 1;
    const width = r - l + 1;
    for (let x = l; x <= r; x++) {
      const u = width <= 1 ? 0 : ((x - l) / (width - 1)) * 2 - 1;
      const radius = Math.max(0.5, width / 2);
      const hz = Math.sqrt(Math.max(0, 1 - u * u)) * radius;
      let c = f.mitte;
      const rand = x === l || x === r;
      const kante = x === l + 1 || x === r - 1;
      if (rand) c = f.kontur;
      else if (y === p.fuss) c = f.kontur;
      else if (kante && width >= 5) c = f.schatten;
      else {
        switch (p.rinde) {
          case 'furchen':
          case 'glut':
          case 'kristall': {
            const onFurche = furchen.some((fu) => y >= fu.y0 && y <= fu.y1 && Math.round(cx + fu.u * half) === x);
            const nextToFurche = furchen.some((fu) => y >= fu.y0 && y <= fu.y1 && Math.round(cx + fu.u * half) === x - 1);
            if (onFurche) c = p.rinde === 'furchen' ? f.schatten : (f.akzent ?? f.schatten);
            else if (nextToFurche && Math.abs(u) < 0.6) c = f.licht;
            else c = Math.abs(u) < 0.35 && p.rinde !== 'glut' ? f.licht : f.mitte;
            if (p.rinde === 'glut' && onFurche && y > p.fuss - 3) c = f.schatten;
            break;
          }
          case 'glatt':
            c = Math.abs(u) < 0.4 ? f.licht : f.mitte;
            break;
          case 'birke':
            c = Math.abs(u) < 0.55 ? f.licht : f.mitte;
            break;
          case 'ringel':
            c = Math.abs(u) < 0.3 ? f.licht : f.mitte;
            break;
          case 'schuppen': {
            // Blattnarben als gestapelte Winkel (^), jedes zweite Band halb versetzt: Rautenmuster
            // statt Leitersprossen.
            const band = Math.floor((p.fuss - y) / 4);
            const versatz = band % 2 === 0 ? 0 : 0.5;
            const phase = (((p.fuss - y - Math.round((Math.abs(u) + versatz) * 2)) % 4) + 4) % 4;
            c = phase === 0 ? f.schatten : phase >= 2 && Math.abs(u) < 0.3 ? f.licht : f.mitte;
            break;
          }
        }
        for (const m of marken.get(y) ?? []) {
          if (u >= m.u0 && u <= m.u1) c = p.rinde === 'glatt' ? f.schatten : (f.akzent ?? f.schatten);
        }
      }
      b.set(x, y, c, 0, hz);
    }
  }
  wurzelKerben(b, p);
}

/**
 * Trennt die Wurzeln am Fuß: je Seite eine Kerbe in den untersten zwei Zeilen zwischen Wurzelspitze
 * und Stammfuß (docs/ART.md §10: Stamm mit Wurzelansatz statt glattem Rock).
 */
function wurzelKerben(b: Bild, p: StammParameter): void {
  if (p.wurzel < 2) return;
  const koerper = stammSpanne({ ...p, wurzel: 0 }, p.fuss);
  for (const side of [-1, 1]) {
    const nx = Math.round(koerper.cx + side * (koerper.half + p.wurzel * 0.45)) - (side > 0 ? 1 : 0);
    if (b.get(nx, p.fuss) === TRANSPARENT || b.get(nx + side, p.fuss) === TRANSPARENT) continue;
    b.clear(nx, p.fuss);
    b.set(nx, p.fuss - 1, p.farben.kontur);
    b.set(nx - side, p.fuss - 1, p.farben.kontur);
    if (b.get(nx + side, p.fuss - 1) !== TRANSPARENT) b.set(nx + side, p.fuss - 1, p.farben.kontur);
  }
}

/** Verschattet den Stamm unter der Krone: die obersten `zeilen` Stammzeilen unter `kroneUnten`. */
export function stammUnterKrone(b: Bild, p: StammParameter, kroneUnten: number, zeilen = 3): void {
  const f = p.farben;
  const darker = new Map<number, number>([
    [paletteIndex(f.licht), paletteIndex(f.mitte)],
    [paletteIndex(f.mitte), paletteIndex(f.schatten)],
  ]);
  for (let y = kroneUnten; y < kroneUnten + zeilen; y++) {
    const { cx, half } = stammSpanne(p, y);
    for (let x = Math.round(cx - half); x < Math.round(cx + half); x++) {
      const v = b.get(x, y);
      const d = darker.get(v);
      if (d !== undefined && (y < kroneUnten + zeilen - 1 || (x + y) % 3 !== 0)) b.index[y * b.w + x] = d;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Äste
// ---------------------------------------------------------------------------------------------

/** Ein Aststück von (x0, y0) nach (x1, y1) mit Dicke am Anfang/Ende (px). */
export interface Ast {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly d0: number;
  readonly d1: number;
}

export interface AstParameter {
  /** Anzahl Verzweigungsebenen nach dem Hauptast. */
  readonly ebenen: number;
  /** Zweige je Gabelung. */
  readonly gabel: number;
  /** Öffnungswinkel der Gabelung (Bogenmaß). */
  readonly spreizung: number;
  /** Längenfaktor je Ebene. */
  readonly kuerzung: number;
  /** Zug nach oben je Ebene (0 = keiner, 1 = stark). */
  readonly auftrieb?: number;
  /** Hängen (Weide): Zug nach unten je Ebene. */
  readonly haengen?: number;
}

/** Verzweigt rekursiv von (x, y) in Richtung `winkel` (0 = rechts, −π/2 = oben). */
export function verzweige(rng: Rng, x: number, y: number, winkel: number, laenge: number, dicke: number, p: AstParameter, out: Ast[] = [], ebene = 0): Ast[] {
  const x1 = x + Math.cos(winkel) * laenge;
  const y1 = y + Math.sin(winkel) * laenge;
  const d1 = Math.max(1, dicke * 0.7);
  // Knorriger Verlauf: ein Knick quer zur Richtung, nie gerade Stäbe.
  const knick = laenge > 4 ? rng.float(-1, 1) * Math.min(1.6, laenge * 0.18) : 0;
  const mx = x + (x1 - x) * 0.5 - Math.sin(winkel) * knick;
  const my = y + (y1 - y) * 0.5 + Math.cos(winkel) * knick;
  const dm = (dicke + d1) / 2;
  out.push({ x0: x, y0: y, x1: mx, y1: my, d0: dicke, d1: dm }, { x0: mx, y0: my, x1, y1, d0: dm, d1 });
  if (ebene >= p.ebenen || laenge < 2.5) return out;
  const kinder = p.gabel + (rng.bool(0.3) ? 1 : 0) - (rng.bool(0.2) ? 1 : 0);
  for (let i = 0; i < Math.max(1, kinder); i++) {
    const t = kinder <= 1 ? 0 : i / (kinder - 1) - 0.5;
    let w = winkel + t * p.spreizung + rng.float(-0.25, 0.25);
    // Zug nach oben / unten (Richtung −π/2 bzw. +π/2).
    const up = p.auftrieb ?? 0.2;
    const down = p.haengen ?? 0;
    w += (-Math.PI / 2 - w) * up * 0.3 + (Math.PI / 2 - w) * down * 0.35;
    verzweige(rng, x1, y1, w, laenge * p.kuerzung * rng.float(0.85, 1.1), d1 * 0.8, p, out, ebene + 1);
  }
  return out;
}

/** Parameter des Astgerüsts (Raumkolonisation). */
export interface GeruestParameter {
  /** Anzahl der Anziehungspunkte in der Kronenform. */
  readonly punkte: number;
  /** Mindestabstand der Anziehungspunkte (px). */
  readonly punktAbstand?: number;
  /** Einflussradius (px): so weit „sieht“ ein Astende einen Punkt. */
  readonly einfluss?: number;
  /** Tötungsabstand (px): ein erreichter Punkt verschwindet. */
  readonly erreicht?: number;
  /** Schrittweite je Wachstumsschritt (px). */
  readonly schritt?: number;
  /** Zug nach oben je Schritt (0…1). */
  readonly auftrieb?: number;
  /** Ab so vielen getragenen Zweigspitzen wird ein Ast 2, 3, 4, 5 px dick (Standard 3/10/24/48). */
  readonly dickenStufen?: readonly number[];
  /** Ab so vielen Schritten bis zur fernsten Spitze wird ein Ast 2, 3, 4, 5 px dick (Standard 4/8/13/19). */
  readonly laengenStufen?: readonly number[];
}

/**
 * Astgerüst per Raumkolonisation (Runions et al. 2007): Anziehungspunkte füllen die Kronenform, Äste
 * wachsen vom Stammende schrittweise zum Mittel der Punkte, die sie sehen; erreichte Punkte
 * verschwinden. Die Dicke wächst stufenweise mit der Zahl der getragenen Zweigspitzen. So
 * verzweigen sich wenige dicke Äste zu vielen feinen Zweigen, deren Umriss die belaubte Krone
 * nachzeichnet.
 */
export function astGeruest(rng: Rng, form: Uint8Array, w: number, startX: number, startY: number, stammRadius: number, p: GeruestParameter): Ast[] {
  const abstand = p.punktAbstand ?? 3;
  const einfluss = p.einfluss ?? 14;
  const erreicht = p.erreicht ?? 3;
  const schritt = p.schritt ?? 2;
  const auftrieb = p.auftrieb ?? 0.15;
  const kandidaten: Array<[number, number]> = [];
  form.forEach((v, q) => {
    if (v > 0) kandidaten.push([(q % w) + 0.5, Math.floor(q / w) + 0.5]);
  });
  rng.shuffle(kandidaten);
  const punkte: Array<[number, number]> = [];
  for (const c of kandidaten) {
    if (punkte.length >= p.punkte) break;
    if (punkte.every(([x, y]) => Math.hypot(x - c[0], y - c[1]) >= abstand)) punkte.push(c);
  }
  const nx: number[] = [startX];
  const ny: number[] = [startY];
  const parent: number[] = [-1];
  let alive = punkte.map(() => true);
  /** Ob schon ein Anziehungspunkt in Sichtweite war (bis dahin wächst nur der Leitast). */
  let gewachsen = false;
  for (let iter = 0; iter < 200; iter++) {
    const zug = new Map<number, [number, number, number]>();
    punkte.forEach(([px, py], i) => {
      if (!alive[i]) return;
      let best = -1;
      let bestD = einfluss;
      for (let n = 0; n < nx.length; n++) {
        const d = Math.hypot((nx[n] ?? 0) - px, (ny[n] ?? 0) - py);
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      if (best < 0) return;
      const dx = (px - (nx[best] ?? 0)) / Math.max(0.001, bestD);
      const dy = (py - (ny[best] ?? 0)) / Math.max(0.001, bestD);
      const z = zug.get(best) ?? [0, 0, 0];
      zug.set(best, [z[0] + dx, z[1] + dy, z[2] + 1]);
    });
    if (zug.size === 0) {
      // Noch kein Punkt in Sichtweite: der Leitast wächst auf den Schwerpunkt der Krone zu.
      const offen = punkte.filter((_, i) => alive[i]);
      if (offen.length === 0 || gewachsen) break;
      const cx = offen.reduce((s0, q) => s0 + q[0], 0) / offen.length;
      const cy = offen.reduce((s0, q) => s0 + q[1], 0) / offen.length;
      const last = nx.length - 1;
      const d = Math.hypot(cx - (nx[last] ?? 0), cy - (ny[last] ?? 0));
      if (d < schritt) break;
      zug.set(last, [(cx - (nx[last] ?? 0)) / d, (cy - (ny[last] ?? 0)) / d, 1]);
    } else gewachsen = true;
    for (const [n, [sx, sy]] of zug) {
      let dx = sx;
      let dy = sy - auftrieb * Math.hypot(sx, sy);
      const len = Math.hypot(dx, dy);
      if (len < 0.001) continue;
      dx /= len;
      dy /= len;
      const x = (nx[n] ?? 0) + dx * schritt;
      const y = (ny[n] ?? 0) + dy * schritt;
      if (nx.some((ox, i) => Math.hypot(ox - x, (ny[i] ?? 0) - y) < schritt * 0.5)) continue;
      nx.push(x);
      ny.push(y);
      parent.push(n);
    }
    alive = alive.map((a, i) => {
      if (!a) return false;
      const [px, py] = punkte[i] ?? [0, 0];
      for (let n = 0; n < nx.length; n++) if (Math.hypot((nx[n] ?? 0) - px, (ny[n] ?? 0) - py) < erreicht) return false;
      return true;
    });
  }
  // Dicke in Pixelstufen nach der Zahl der Zweigspitzen, die ein Ast trägt: wenige kräftige Äste,
  // die sich über 2-px-Äste in 1-px-Zweige auflösen (statt eines stetigen Rohrmodells, das fast
  // nur 1-px-Linien ergibt).
  const kinder = nx.map(() => [] as number[]);
  parent.forEach((q, i) => {
    if (q >= 0) kinder[q]?.push(i);
  });
  const spitzen = new Array<number>(nx.length).fill(0);
  for (let i = nx.length - 1; i >= 0; i--) {
    const ks = kinder[i] ?? [];
    spitzen[i] = ks.length === 0 ? 1 : ks.reduce((s, k) => s + (spitzen[k] ?? 0), 0);
  }
  // Abstand zur fernsten Spitze (in Schritten): Äste nahe am Stamm sind dick, die Enden fein.
  const tiefe = new Array<number>(nx.length).fill(0);
  for (let i = nx.length - 1; i >= 0; i--) {
    const ks = kinder[i] ?? [];
    tiefe[i] = ks.length === 0 ? 0 : 1 + Math.max(...ks.map((k) => tiefe[k] ?? 0));
  }
  const stufen = p.dickenStufen ?? [3, 10, 24, 48];
  const laengen = p.laengenStufen ?? [4, 8, 13, 19];
  const dicke = (i: number): number => {
    const n = spitzen[i] ?? 1;
    const t = tiefe[i] ?? 0;
    return Math.min(Math.max(1, Math.round(stammRadius * 2)), 1 + Math.max(stufen.filter((x) => n >= x).length, laengen.filter((x) => t >= x).length));
  };
  const aeste: Ast[] = [];
  for (let i = 1; i < nx.length; i++) {
    const q = parent[i] ?? 0;
    aeste.push({ x0: nx[q] ?? 0, y0: ny[q] ?? 0, x1: nx[i] ?? 0, y1: ny[i] ?? 0, d0: dicke(i), d1: dicke(i) });
  }
  return aeste;
}

/** Hauptäste vom Stammende zu den Massen (für Durchblicke in der Krone und die kahle Krone). */
export function hauptaeste(ziele: ReadonlyArray<readonly [number, number]>, x: number, y: number, dicke: number): Ast[] {
  return ziele.map(([tx, ty]) => ({ x0: x, y0: y, x1: tx, y1: ty, d0: dicke, d1: Math.max(1, dicke * 0.55) }));
}

/** Zeichnet Äste in der Rindenrampe: dicke Äste mit Kontur und Mitte, dünne als Schattenlinie. */
export function zeichneAeste(b: Bild, aeste: readonly Ast[], f: RindenFarben, nurLeer = false): Uint8Array {
  const branchMask = new Uint8Array(b.w * b.h);
  const thick = new Float32Array(b.w * b.h);
  for (const a of aeste) {
    const len = Math.hypot(a.x1 - a.x0, a.y1 - a.y0);
    const steps = Math.max(1, Math.ceil(len * 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = a.x0 + (a.x1 - a.x0) * t;
      const cy = a.y0 + (a.y1 - a.y0) * t;
      const d = a.d0 + (a.d1 - a.d0) * t;
      const r = d / 2;
      for (let yy = Math.floor(cy - r); yy <= Math.ceil(cy + r); yy++) {
        for (let xx = Math.floor(cx - r); xx <= Math.ceil(cx + r); xx++) {
          if (!b.inside(xx, yy)) continue;
          const inDisc = d <= 1.5 ? xx === Math.round(cx) && yy === Math.round(cy) : Math.hypot(xx + 0.5 - cx, yy + 0.5 - cy) <= r;
          if (!inDisc) continue;
          const p = yy * b.w + xx;
          branchMask[p] = 1;
          thick[p] = Math.max(thick[p] ?? 0, d);
        }
      }
    }
  }
  const outline = outlineOf(branchMask, b.w, b.h);
  branchMask.forEach((v, p) => {
    if (v === 0) return;
    if (nurLeer && (b.index[p] ?? 0) !== TRANSPARENT) return;
    const x = p % b.w;
    const y = Math.floor(p / b.w);
    const d = thick[p] ?? 1;
    const topFree = y > 0 && (branchMask[p - b.w] ?? 0) === 0;
    // 1 px: Schattenlinie; 2 px: Mitte oben, Schatten darunter; ab 3 px: Mitte mit Licht an der Oberseite.
    const c = d < 1.8 ? f.schatten : d < 2.8 ? (topFree ? f.mitte : f.schatten) : topFree ? f.licht : f.mitte;
    b.set(x, y, c, 0, Math.min(4, d / 2));
  });
  // Kontur nur an dicken Ästen (dünne Zweige sind selbst die Linie).
  outline.forEach((v, p) => {
    if (v === 0) return;
    if ((b.index[p] ?? 0) !== TRANSPARENT) return;
    const x = p % b.w;
    const y = Math.floor(p / b.w);
    let maxD = 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const q = (y + dy) * b.w + x + dx;
      if (b.inside(x + dx, y + dy) && (branchMask[q] ?? 0) > 0) maxD = Math.max(maxD, thick[q] ?? 0);
    }
    if (maxD >= 2.8) b.set(x, y, f.kontur, 0, 0.5);
  });
  return branchMask;
}

/** Legt Schnee auf die Oberseiten der Äste (Pixel darüber frei): `hell` oben, `schatten` darunter. */
export function schneeAufAesten(b: Bild, branchMask: Uint8Array, hell: string, schatten: string, minBreite = 2): void {
  const add: Array<[number, number, string]> = [];
  for (let y = 1; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      const p = y * b.w + x;
      if ((b.index[p] ?? 0) === TRANSPARENT) continue;
      if ((b.index[p - b.w] ?? 0) !== TRANSPARENT) continue;
      // Nur auf kräftigen Ästen (mindestens drei Pixel dick): auf Zweigen hielte kein Schnee.
      if (y + 2 >= b.h || (b.index[p + b.w] ?? 0) === TRANSPARENT || (b.index[p + 2 * b.w] ?? 0) === TRANSPARENT) continue;
      // Nur auf waagerechten Stücken: links oder rechts daneben liegt ebenfalls eine Oberkante.
      let run = 1;
      for (let dx = 1; dx < 4 && (b.index[p + dx] ?? 0) !== TRANSPARENT && (b.index[p + dx - b.w] ?? 0) === TRANSPARENT && x + dx < b.w; dx++) run++;
      for (let dx = 1; dx < 4 && (b.index[p - dx] ?? 0) !== TRANSPARENT && (b.index[p - dx - b.w] ?? 0) === TRANSPARENT && x - dx >= 0; dx++) run++;
      if (run < minBreite + 1) continue;
      add.push([x, y - 1, hell]);
      if ((branchMask[p] ?? 0) > 0 && run >= minBreite + 3) add.push([x, y, schatten]);
    }
  }
  // Nur zusammenhängende Schneekappen (mindestens 2 px nebeneinander) – keine weißen Einzelpixel.
  const hellSet = new Set(add.filter((e) => e[2] === hell).map(([x, y]) => y * b.w + x));
  for (const [x, y, c] of add) {
    if (c === hell && !hellSet.has(y * b.w + x - 1) && !hellSet.has(y * b.w + x + 1)) continue;
    b.set(x, y, c, MATERIAL_BITS.eis, 1);
  }
}

// ---------------------------------------------------------------------------------------------
// Krone malen
// ---------------------------------------------------------------------------------------------

/** Farben einer Krone: Kontur + fünf Stufen (tiefster Schatten … Lichtkappe). */
export interface KronenFarben {
  readonly kontur: string;
  readonly stufen: readonly [string, string, string, string, string];
}

export const LAUB_GRAS: KronenFarben = { kontur: 'gras.0', stufen: ['gras.1', 'gras.2', 'gras.3', 'gras.4', 'gras.5'] };

/**
 * Malt die Krone über das Bild (Stufen → Farben), mit Kontur außen (auch über Stamm und Äste, damit
 * die Krone sich absetzt). Höhe: Relief der Krone + `hoeheBasis`. Setzt Blätterdach + Wind.
 */
export function maleKrone(b: Bild, k: Krone, farben: KronenFarben, hoeheBasis = 4, flags = KRONE_FLAGS, emissivAb = 99): void {
  const { w, h } = b;
  let maxH = 0;
  k.relief.mask.forEach((v, p) => {
    if (v > 0) maxH = Math.max(maxH, k.relief.height[p] ?? 0);
  });
  const scale = maxH > 0 ? Math.min(1, 14 / maxH) : 1;
  k.stufen.forEach((s, p) => {
    if (s < 0) return;
    const ref = farben.stufen[s] ?? farben.stufen[2];
    const star = s >= emissivAb ? '*' : '';
    b.set(p % w, Math.floor(p / w), `${ref}${star}`, flags, hoeheBasis + (k.relief.height[p] ?? 0) * scale);
  });
  const outline = outlineOf(k.relief.mask, w, h);
  outline.forEach((v, p) => {
    if (v === 0) return;
    const x = p % w;
    const y = Math.floor(p / w);
    const under = b.get(x, y);
    // Über Stamm/Ästen nur an der Unterkante der Krone (Trennlinie), sonst nur auf leerem Grund.
    const aboveIsCrown = y > 0 && (k.relief.mask[p - w] ?? 0) > 0;
    if (under !== TRANSPARENT && !aboveIsCrown) return;
    b.set(x, y, farben.kontur, flags, hoeheBasis);
  });
}

/** Punkte (Früchte, Blüten) als kleine Formen auf die Krone setzen. */
export interface KronenSchmuck {
  /** Form relativ zum Punkt: Liste [dx, dy, Farbe]. */
  readonly form: ReadonlyArray<readonly [number, number, string]>;
  readonly anzahl: number;
  readonly abstand: number;
  readonly minStufe?: number;
}

/** Setzt Schmuck (Früchte, Blüten) auf helle Kronenpixel; liefert die belegten Pixel. */
export function schmueckeKrone(b: Bild, rng: Rng, k: Krone, s: KronenSchmuck, flags = KRONE_FLAGS): Uint8Array {
  const used = new Uint8Array(b.w * b.h);
  for (const [x, y] of kronenPunkte(rng, k, b.w, b.h, s.anzahl, s.abstand, s.minStufe ?? 2)) {
    for (const [dx, dy, c] of s.form) {
      const xx = x + dx;
      const yy = y + dy;
      if (!b.inside(xx, yy) || (k.relief.mask[yy * b.w + xx] ?? 0) === 0) continue;
      const p = yy * b.w + xx;
      const hz = b.hoehe[p] ?? 0;
      b.set(xx, yy, c, flags, hz + 1);
      used[p] = 1;
    }
  }
  return used;
}

// ---------------------------------------------------------------------------------------------
// Schnittfläche (Stümpfe)
// ---------------------------------------------------------------------------------------------

/** Farben der Schnittfläche: Jahresringe dunkel/hell + Kern. */
export interface SchnittFarben {
  readonly rand: string;
  readonly ring: string;
  readonly holz: string;
  readonly kern: string;
}

/** Löst Einzelpixel eines fertigen Bildes auf (gleiche Regel wie `despeckle`, auf Palettenindizes). */
export function saeubere(b: Bild, locked?: Uint8Array): void {
  const steps = Int8Array.from(b.index, (v) => (v === TRANSPARENT ? -1 : 0));
  // Palettenindex → temporäre Stufe (Reihenfolge = Palettenindex, bei Gleichstand gewinnt der nähere Index).
  const vals = [...new Set(b.index)].filter((v) => v !== TRANSPARENT).sort((a, c) => a - c);
  const code = new Map(vals.map((v, i) => [v, i]));
  b.index.forEach((v, p) => {
    if (v !== TRANSPARENT) steps[p] = code.get(v) ?? 0;
  });
  const sperre = Uint8Array.from(b.fest, (v, p) => (v > 0 || (locked?.[p] ?? 0) > 0 ? 1 : 0));
  despeckle(steps, b.w, b.h, 3, sperre);
  steps.forEach((s, p) => {
    if (s < 0) return;
    const v = vals[s] ?? 0;
    if (v !== b.index[p]) {
      // Emissiv/Material vom neuen Nachbarwert übernehmen: der häufigste Nachbar mit diesem Index.
      const x = p % b.w;
      const y = Math.floor(p / b.w);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [-1, -1],
        [1, -1],
        [-1, 1],
      ] as const) {
        const q = (y + dy) * b.w + x + dx;
        if (b.inside(x + dx, y + dy) && b.index[q] === v) {
          b.emissive[p] = b.emissive[q] ?? 0;
          b.material[p] = b.material[q] ?? 0;
          break;
        }
      }
      b.index[p] = v;
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Sprite-Montage
// ---------------------------------------------------------------------------------------------

export interface BaumMeta {
  readonly id: string;
  readonly group: string;
  readonly w: number;
  readonly h: number;
  /** Stammfuß (Anker). */
  readonly fussX: number;
  readonly fussY: number;
  /** Halbe Stammbreite am Fuß (Occluder/Hitbox). */
  readonly stammHalb: number;
  /** Frame-Index je Jahreszeit (fehlt: 0). */
  readonly jahreszeiten?: Readonly<Record<'fruehling' | 'sommer' | 'herbst' | 'winter', number>>;
  /** Weitere Clips (z. B. `abgeerntet`). */
  readonly extraClips?: Readonly<Record<string, number>>;
  readonly einzelpixel?: string;
}

/** Baut das Baum-Sprite aus seinen Frames (Frame 0 belaubt). */
export function baumSprite(m: BaumMeta, frames: readonly Bild[]): Sprite {
  const clips: Record<string, { frames: number[]; fps: number; loop: boolean }> = {};
  for (const [name, f] of Object.entries(m.jahreszeiten ?? {})) clips[name] = { frames: [f], fps: 1, loop: true };
  for (const [name, f] of Object.entries(m.extraClips ?? {})) clips[name] = { frames: [f], fps: 1, loop: true };
  const half = Math.max(1, m.stammHalb);
  const meta: PixelSpriteMeta = {
    id: m.id,
    group: m.group,
    size: [m.w, m.h],
    anchor: [m.fussX, m.fussY],
    hoehe: 'kugel',
    hitbox: [Math.max(0, Math.round(m.fussX - half)), Math.max(0, m.fussY - 4), Math.max(1, Math.round(half * 2)), 5],
    occluder: { kind: 'ellipse', x: m.fussX, y: m.fussY - 1.5, rx: Math.max(1.5, half + 0.5), ry: 2 },
    ...(Object.keys(clips).length > 0 ? { clips } : {}),
    ...(m.einzelpixel !== undefined ? { einzelpixel: m.einzelpixel } : {}),
  };
  return spriteFromPixels(meta, frames.map((f) => f.frame()));
}
