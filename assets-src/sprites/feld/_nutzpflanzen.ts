/**
 * Baukasten der Nutzpflanzen (M7-21, M7-22, Strang D; docs/SPIEL.md §20, §29 `feldfrucht_<pflanze>`): je Pflanze ein Sprite
 * mit einem Frame je Wachstumsstufe (Stufe 0 = die gesäte Saat im Acker, die letzte = reif, erntbar) und ein Sprite
 * `feldfrucht_<pflanze>_welk` (die gestorbene Pflanze: Frost, Mehltau – bis sie vergeht oder geräumt wird).
 *
 * Zelle 16×24, Fuß in der Mitte der vorletzten Zeile (der Renderer stellt ihn auf die Mitte der Ackerkachel). Laub in
 * `gras` (Kontur `gras.0`, docs/ART.md §2.4), Früchte in ihrer eigenen Rampe; oben hell, unten dunkel (AO). Die Familien
 * teilen Formen, jede Pflanze hat ihre eigene Silhouette in der Reifestufe:
 * - Rosetten (Karotte gefiedert, Rübe/Kohl/Salat breitblättrig, Kartoffel buschig mit weißen Blüten, Zwiebel und Knoblauch
 *   mit aufrechten Röhren), die Frucht zeigt sich reif am Boden (Karottenschulter, Rübenkopf, Zwiebel, Knoblauchknolle) oder
 *   als Kopf (Kohl, Salat);
 * - Halme (Weizen golden, Gerste mit Grannen, Roggen hoch und dunkler, Flachs mit blauen Blüten und Kapseln, Mais als
 *   Staude mit Kolben und Fahne);
 * - Rankende am Stab (Erbse, Bohne mit Schoten, Tomate mit roten Früchten);
 * - Kriechende (Kürbis mit Blüte und Frucht, Erdbeere mit Blüten und Beeren) und die Kamille als Busch mit Blütenkörbchen.
 */
import { MATERIAL_BITS, sprite, type Sprite } from '../../lib/sprite';
import { ICON_LEGENDE } from '../icons/_icon';
import { blatt, Raster, stufe } from './_raster';

/** Zelle und Fuß. */
export const PFLANZE_W = 16;
export const PFLANZE_H = 24;
const FX = 8;
const FY = 21;

/** Rampe nach t (oben hell … unten dunkel). */
const sh = (rampe: string, hell = 0.3, dunkel = 0.75) => (_x: number, _y: number, t: number) => stufe(rampe, t, hell, dunkel);

/** Laub: gras.2 … gras.4. */
const LAUB = 'hij';
/** Junges, helles Laub. */
const JUNG = 'ijJ';

/** Die gesäte Saat: ein flacher Hügel frischer Erde mit zwei Körnern. */
function saat(r: Raster, korn: string): void {
  r.ellipse(FX, FY, 2.6, 0.9, (_x, _y, t) => (t < 0.5 ? 's' : 'r'));
  r.set(FX - 1, FY - 1, korn).set(FX, FY - 1, korn);
}

/** Der Keimling: ein Stängel mit zwei Keimblättern. */
function keim(r: Raster, hoehe = 3): void {
  r.line(FX, FY, FX, FY - hoehe, 'h');
  blatt(r, FX, FY - hoehe, FX - 3, FY - hoehe - 1.5, 1, sh(JUNG));
  blatt(r, FX, FY - hoehe, FX + 3, FY - hoehe - 1.5, 1, sh(JUNG));
}

/** Eine Rosette aus `n` Blättern der Länge `len` und halben Breite `b`, gefächert über ±`spread` (Bogenmaß) um die Senkrechte. */
function rosette(r: Raster, n: number, len: number, b: number, spread: number, rampe = LAUB, y0 = FY): void {
  for (let k = 0; k < n; k++) {
    const a = n === 1 ? 0 : -spread + (2 * spread * k) / (n - 1);
    const l = len * (1 - 0.15 * Math.abs(a));
    blatt(r, FX, y0, FX + Math.sin(a) * l, y0 - Math.cos(a) * l * 0.95, b, sh(rampe));
  }
}

/** Halme: höchstens drei Halme der Höhe `h` (getrennt, damit jeder für sich lesbar bleibt), unten zwei Blätter; die Spitzen (x, y abwechselnd). */
function halme(r: Raster, n: number, h: number, halm: string, blattRampe: string): number[] {
  const xs: number[] = n <= 1 ? [FX] : n === 2 ? [FX - 2, FX + 2] : [FX - 4, FX, FX + 4];
  const out: number[] = [];
  blatt(r, FX, FY - 1, FX - 4, FY - 5, 0.9, sh(blattRampe));
  blatt(r, FX, FY - 2, FX + 4, FY - 6, 0.9, sh(blattRampe));
  for (const x of xs) {
    const top = Math.round(FY - h + Math.abs(x - FX) * 0.6);
    r.line(FX + (x - FX) * 0.35, FY, x, top, halm);
    out.push(x, top);
  }
  return out;
}

/** Ähren auf den Spitzen `spitzen` (x, y abwechselnd): zwei Pixel breite Körnerreihen in `rampe` (hell, mittel), optional Grannen. */
function aehren(r: Raster, spitzen: number[], laenge: number, rampe: string, grannen: string | null): void {
  for (let k = 0; k + 1 < spitzen.length; k += 2) {
    const x = spitzen[k] as number;
    const y = spitzen[k + 1] as number;
    const x0 = x <= FX ? x - 1 : x;
    for (let i = 0; i < laenge; i++) {
      r.set(x0, y - i, i % 2 === 0 ? (rampe[0] as string) : (rampe[1] as string));
      r.set(x0 + 1, y - i, i % 2 === 0 ? (rampe[1] as string) : (rampe[0] as string));
    }
    if (grannen !== null) {
      r.line(x0, y - laenge, x0 - 1, y - laenge - 2, grannen);
      r.line(x0 + 1, y - laenge, x0 + 2, y - laenge - 2, grannen);
    }
  }
}

/** Ein Stab aus Holz von unten bis `oben`. */
function stab(r: Raster, x: number, oben: number): void {
  r.line(x, FY, x, oben, 'c');
}

/** Ranke am Stab: kleine Blätter abwechselnd links und rechts bis zur Höhe `h`. */
function ranke(r: Raster, x: number, h: number, rampe = LAUB): void {
  for (let y = FY - 1, k = 0; y > FY - h; y -= 3, k++) {
    const s = k % 2 === 0 ? -1 : 1;
    blatt(r, x, y, x + s * 3.2, y - 1.5, 1.1, sh(rampe));
  }
}

/** Kleiner Fruchtkreis (Tomate, Beere): oben `hell`, unten `dunkel`. */
function frucht(r: Raster, x: number, y: number, rad: number, hell: string, dunkel: string): void {
  r.ellipse(x, y, rad, rad, (_x, yy) => (yy <= y - 0.2 ? hell : dunkel));
}

/** Eine Blüte aus vier Blättern um eine Mitte (Kartoffel, Erdbeere, Kamille). */
function bluete(r: Raster, x: number, y: number, blatt1: string, mitte: string): void {
  r.set(x - 1, y, blatt1).set(x + 1, y, blatt1).set(x, y - 1, blatt1).set(x, y + 1, blatt1).set(x, y, mitte);
}

/** Wie eine Pflanze in Stufe `s` (0 … n − 1) aussieht. */
export type Zeichner = (r: Raster, s: number, n: number) => void;

/** Wachstumsanteil der Stufe `s` (Keimling 0 … reif 1). */
function anteil(s: number, n: number): number {
  return n <= 2 ? 1 : (s - 1) / (n - 2);
}

/** Die Zeichner der 18 Nutzpflanzen (Stufe 0 und 1 sind bei allen Saat und Keimling, außer wo eigens gesetzt). */
export const ZEICHNER: Readonly<Record<string, Zeichner>> = {
  karotte: (r, s, n) => {
    const g = anteil(s, n);
    const reif = s === n - 1;
    rosette(r, 3 + Math.round(g * 4), 4 + g * 7, 0.8, 0.55 + g * 0.35, 'hij');
    if (reif) r.ellipse(FX, FY, 2, 1, (_x, y) => (y < FY ? 'U' : 'u'));
  },
  kartoffel: (r, s, n) => {
    const g = anteil(s, n);
    rosette(r, 3 + Math.round(g * 4), 3.5 + g * 6, 1.5 + g * 0.5, 0.7 + g * 0.5, 'ghij');
    if (s === n - 1) {
      bluete(r, FX - 3, FY - 9, '#', 'v');
      bluete(r, FX + 3, FY - 8, '#', 'v');
    }
  },
  ruebe: (r, s, n) => {
    const g = anteil(s, n);
    rosette(r, 3 + Math.round(g * 2), 4 + g * 5, 1.6, 0.6 + g * 0.3, LAUB, FY - 1);
    if (s === n - 1) r.ellipse(FX, FY - 0.5, 2.6, 1.6, (_x, y) => (y < FY ? ']' : '0'));
  },
  zwiebel: (r, s, n) => {
    const g = anteil(s, n);
    if (s === n - 1) {
      // Ripe: the tubes have fallen over, yellowing; the golden bulb sits half out of the earth.
      r.line(FX, FY - 1, FX - 2, FY - 6, 'j').line(FX - 2, FY - 6, FX - 6, FY - 5, 'j');
      r.line(FX, FY - 1, FX + 2, FY - 7, 'J').line(FX + 2, FY - 7, FX + 6, FY - 6, 'J');
      r.ellipse(FX, FY - 0.8, 2.8, 2.2, (_x, y) => (y < FY - 1 ? 'o' : 'M'));
      return;
    }
    for (const dx of [-3, 0, 3]) r.line(FX + dx * 0.25, FY, FX + dx, FY - 4 - g * 9 + Math.abs(dx) * 0.6, dx === 0 ? 'j' : 'i');
  },
  knoblauch: (r, s, n) => {
    const g = anteil(s, n);
    for (const dx of [-3, -1, 1, 3]) blatt(r, FX + dx * 0.2, FY, FX + dx, FY - 5 - g * 7 + Math.abs(dx) * 0.7, 0.6, sh('hij'));
    if (s === n - 1) r.ellipse(FX, FY - 0.5, 2.4, 1.6, (_x, y) => (y < FY - 0.5 ? '#' : '0'));
  },
  kohl: (r, s, n) => {
    const g = anteil(s, n);
    r.ellipse(FX, FY - 3 - g * 2, 2 + g * 2.5, 1.5 + g * 1.2, sh('hi'));
    r.ellipse(FX - 3 - g * 1.5, FY - 1.5, 2.2 + g * 1.2, 1.4 + g * 0.6, sh('ghi'));
    r.ellipse(FX + 3 + g * 1.5, FY - 1.5, 2.2 + g * 1.2, 1.4 + g * 0.6, sh('ghi'));
    if (g > 0.3) {
      r.ellipse(FX, FY - 2.5 - g, 1 + g * 2.4, 1 + g * 2.1, sh('ijJ', 0.35, 0.85));
      r.line(FX, FY - 1.5, FX, FY - 2 - g * 3.5, 'J');
    }
  },
  salat: (r, s, n) => {
    const g = anteil(s, n);
    rosette(r, 5, 2.5 + g * 3.5, 1.4 + g * 0.6, 1.35, 'hij');
    rosette(r, 3, 1.5 + g * 3, 1.3 + g * 0.6, 0.8, 'jJ');
    if (g > 0.6) for (const dx of [-4, -1, 2, 5]) r.set(FX + dx, FY - 3 - (dx % 2 === 0 ? 1 : 0), 'J');
  },
  erbse: (r, s, n) => {
    const g = anteil(s, n);
    const h = 5 + g * 13;
    if (g > 0.2) stab(r, FX + 2, FY - h - 1);
    r.line(FX, FY, FX + 1, FY - h, 'h');
    ranke(r, FX + 1, h);
    if (s === n - 1)
      for (const [x, y] of [
        [FX - 3, FY - 6],
        [FX + 4, FY - 9],
        [FX - 3, FY - 12],
      ] as const)
        r.line(x, y, x, y + 3, 'J').line(x + 1, y, x + 1, y + 3, 'j');
  },
  bohne: (r, s, n) => {
    const g = anteil(s, n);
    const h = 6 + g * 13;
    if (g > 0.2) stab(r, FX - 1, FY - h - 1);
    r.line(FX, FY, FX - 1, FY - h, 'h');
    ranke(r, FX - 1, h, 'ghi');
    if (s === n - 2) for (const [x, y] of [[FX + 2, FY - 10], [FX - 4, FY - 13]] as const) bluete(r, x, y, '%', ']');
    if (s === n - 1)
      for (const [x, y] of [
        [FX + 2, FY - 8],
        [FX - 4, FY - 11],
        [FX + 3, FY - 14],
      ] as const)
        r.line(x, y, x, y + 4, 'J').line(x + 1, y + 1, x + 1, y + 4, 'j');
  },
  weizen: (r, s, n) => {
    const g = anteil(s, n);
    const reif = s === n - 1;
    const spitzen = halme(r, 2 + Math.round(g * 3), 6 + g * 12, reif ? 'C' : 'i', reif ? 'CD' : LAUB);
    if (g > 0.5) aehren(r, spitzen, 4, reif ? 'ED' : 'jJ', null);
  },
  gerste: (r, s, n) => {
    const g = anteil(s, n);
    const reif = s === n - 1;
    const spitzen = halme(r, 2 + Math.round(g * 2), 5 + g * 11, reif ? 'C' : 'i', reif ? 'BC' : LAUB);
    if (g > 0.5) aehren(r, spitzen, 3, reif ? 'DC' : 'jJ', reif ? 'E' : 'J');
  },
  roggen: (r, s, n) => {
    const g = anteil(s, n);
    const reif = s === n - 1;
    const spitzen = halme(r, 2 + Math.round(g * 2), 7 + g * 13, reif ? 'B' : 'h', reif ? 'AB' : 'ghi');
    if (g > 0.5) aehren(r, spitzen, 5, reif ? 'CB' : 'ij', null);
  },
  mais: (r, s, n) => {
    const g = anteil(s, n);
    const h = Math.round(6 + g * 14);
    r.line(FX, FY, FX, FY - h, 'h').line(FX + 1, FY, FX + 1, FY - h, 'g');
    for (let k = 0; k < 1 + Math.round(g * 3); k++) {
      const y = FY - 3 - k * 4;
      const sgn = k % 2 === 0 ? -1 : 1;
      const x0 = FX + 0.5 + sgn * 0.5;
      blatt(r, x0, y, x0 + sgn * (4.5 + g * 2), y - 2.5, 1.3, sh(LAUB));
    }
    if (s === n - 1) {
      r.ellipse(FX + 3.5, FY - 9, 1.3, 2.8, (x, y) => ((x + y) % 2 === 0 ? 'v' : 'U'));
      r.line(FX + 2, FY - 6, FX + 2, FY - 11, 'i').line(FX + 5, FY - 6, FX + 5, FY - 10, 'i');
      r.line(FX, FY - h - 1, FX - 2, FY - h - 3, 'D').line(FX + 1, FY - h - 1, FX + 1, FY - h - 3, 'D').line(FX + 1, FY - h - 1, FX + 3, FY - h - 3, 'D');
    }
  },
  tomate: (r, s, n) => {
    const g = anteil(s, n);
    const h = 5 + g * 12;
    if (g > 0.2) stab(r, FX + 3, FY - h - 1);
    r.line(FX, FY, FX, FY - h, 'h');
    for (let k = 0; k < 1 + Math.round(g * 3); k++) {
      const y = FY - 3 - k * 3.5;
      blatt(r, FX, y, FX - 4, y - 1.5, 1.4, sh(LAUB));
      blatt(r, FX, y - 1.5, FX + 3, y - 3, 1.2, sh(LAUB));
    }
    if (s === n - 2) bluete(r, FX - 2, FY - 10, 'v', 'u');
    if (s === n - 1)
      for (const [x, y] of [
        [FX - 2, FY - 6],
        [FX + 1.5, FY - 9],
        [FX - 3, FY - 12],
      ] as const)
        frucht(r, x, y, 1.3, 'u', 'F');
  },
  kuerbis: (r, s, n) => {
    const g = anteil(s, n);
    for (const [dx, dy] of [
      [-5, -2],
      [4, -3],
      [-2, -5],
      [6, 0],
    ] as const)
      if (g * 4 >= Math.abs(dx) / 2) r.ellipse(FX + dx * (0.5 + g * 0.5), FY + dy * (0.5 + g * 0.5) - 1, 1.6 + g * 1.4, 1.3 + g, sh(LAUB));
    if (s === n - 3) bluete(r, FX + 2, FY - 4, 'v', 'U');
    if (s === n - 2) r.ellipse(FX + 2, FY - 1, 2, 1.5, sh('ij'));
    if (s === n - 1) r.ellipse(FX + 1.5, FY - 1.5, 3.4, 2.4, (x, _y, t) => (x === FX + 1 || x === FX + 3 ? 'u' : stufe('uUv', t, 0.35, 0.8)));
  },
  erdbeere: (r, s, n) => {
    const g = anteil(s, n);
    for (const [dx, dy] of [
      [-3, -2],
      [3, -2],
      [0, -4],
    ] as const)
      r.ellipse(FX + dx * (0.5 + g * 0.5), FY + dy * (0.6 + g * 0.6), 1.3 + g, 1 + g * 0.7, sh(LAUB));
    if (s === n - 2) {
      bluete(r, FX - 4, FY - 1, '#', 'v');
      bluete(r, FX + 4, FY - 1, '#', 'v');
    }
    if (s === n - 1)
      for (const [x, y] of [
        [FX - 4, FY - 1],
        [FX + 4, FY - 1],
        [FX + 1, FY],
      ] as const)
        frucht(r, x, y, 1.1, 'u', 'F');
  },
  flachs: (r, s, n) => {
    const g = anteil(s, n);
    const reif = s === n - 1;
    const spitzen = halme(r, 3 + Math.round(g * 2), 6 + g * 10, reif ? 'D' : 'i', reif ? 'CD' : 'ij');
    if (s >= n - 2)
      for (let k = 0; k + 1 < spitzen.length; k += 2) {
        const x = spitzen[k] as number;
        const y = spitzen[k + 1] as number;
        if (reif) r.set(x, y - 1, 'C').set(x + 1, y - 1, 'C');
        else r.set(x - 1, y - 1, 'Z').set(x, y - 1, 'z').set(x + 1, y - 1, 'Z');
      }
  },
  kamille: (r, s, n) => {
    const g = anteil(s, n);
    rosette(r, 4 + Math.round(g * 3), 3 + g * 7, 0.8, 0.8 + g * 0.3, 'hij');
    if (s === n - 1)
      for (const [x, y] of [
        [FX - 3, FY - 8],
        [FX + 3, FY - 9],
        [FX, FY - 11],
      ] as const)
        bluete(r, x, y, '#', 'v');
  },
};

/** Die Farbe der Saatkörner je Pflanze. */
const KORN: Readonly<Record<string, string>> = { mais: 'v', kuerbis: 'E', bohne: 'E', erbse: 'j', tomate: 'D', erdbeere: 'v', kartoffel: 's' };

/** Laub wiegt sich im Wind (alle Grüntöne). */
const WIND_ZEICHEN = 'GghijJ';

/** Welk: die mittlere Stufe, Laub in Erde, Früchte und Blüten in dunklem Braun – vertrocknet. */
const WELK: Readonly<Record<string, string>> = { g: 'p', h: 'q', i: 'r', j: 's', J: 't', G: 'p', U: 'r', u: 'q', F: 'q', v: 's', V: 't', '#': 's', '0': 'r', ']': 'q', '[': 'q', '%': 's', o: 's', M: 'r', D: 's', E: 't', C: 'r', B: 'q', z: 'q', Z: 'r', c: 'b' };

/** Die Sprites `feldfrucht_<id>` (ein Frame je Stufe) und `feldfrucht_<id>_welk`. */
export function feldfrucht(id: string, stufen: number): Sprite[] {
  const zeichner = ZEICHNER[id];
  if (zeichner === undefined) throw new Error(`Nutzpflanze ${id}: kein Zeichner`);
  const frames: string[] = [];
  let mitte = '';
  for (let s = 0; s < stufen; s++) {
    const r = new Raster(PFLANZE_W, PFLANZE_H);
    if (s === 0) saat(r, KORN[id] ?? 'D');
    else if (s === 1) keim(r);
    else zeichner(r, s, stufen);
    r.outline('G');
    if (s === 0) r.recolor('G', '.');
    frames.push(r.toString());
    if (s === Math.max(2, Math.floor(stufen / 2))) mitte = r.toString();
  }
  const welk = mitte
    .split('')
    .map((c) => WELK[c] ?? c)
    .join('');
  const meta = {
    group: undefined,
    size: [PFLANZE_W, PFLANZE_H] as [number, number],
    anchor: [FX, FY] as [number, number],
    hoehe: 'kugel' as const,
    legende: ICON_LEGENDE,
    occluder: { kind: 'none' as const },
    einzelpixel: 'Saatkörner, Blütenmitten, Grannen und Halmspitzen: einzelne Pixel an ihrem Cluster',
  };
  return [
    sprite({ ...meta, id: `feldfrucht_${id}`, frames, material: { wind: WIND_ZEICHEN } }),
    sprite({ ...meta, id: `feldfrucht_${id}_welk`, frames: [welk] }),
  ];
}

/** Materialbit „Wind“ (für Tests der Bögen). */
export const WIND_BIT = MATERIAL_BITS.wind;
