/**
 * Kreatur-Renderer (M6, docs/ART.md §15 „Kreaturen (M6)“): setzt einen Kreaturkörper aus wenigen
 * räumlichen Grundformen zusammen und rastert ihn pixelgenau in die 3/4-Aufsicht des Spiels. Aus
 * demselben Körper entstehen so alle Blickrichtungen und Posen deckungsgleich – Proportion, Farbe und
 * Kontur bleiben in jedem Frame gleich, wie beim Figuren-Rig des Spielers (`figure.ts`).
 *
 * **Raum:** Welt +x = Bildschirm rechts, +y = Norden (vom Betrachter weg), +z = oben, Einheit 1 px.
 * **Kamera:** schräge Parallelprojektion der SNES-Aufsicht: ein Punkt (x, y, z) liegt auf dem Bildschirm
 * bei `sx = x`, `sy = z + k · y` (nach oben); der Sehstrahl läuft nach Norden und unten, die Tiefe eines
 * Punktes ist sein `y` (größer = weiter hinten). Die Neigung `k` gilt je Szene: im Profil flacher, von
 * vorn und hinten steiler, damit der Rücken hinter dem Kopf sichtbar bleibt (wie gezeichnete Sprites).
 *
 * **Grundformen:**
 * - `ellipsoid` – Rumpf, Kopf, Schnauze, Muskeln: je Pixelmitte ein Strahl, vorderster Treffer gewinnt;
 *   die Normale der Fläche liefert die Form-Schattierung (optional nur die obere Hälfte: Quallenschirm).
 * - `flaeche` – ebene, konvexe Vielecke (Ohren, Flügel, Flossen, Hauer, Scheren, Dornen).
 * - `linie` – Beine, Fühler, Tentakel, Schwanzspitzen mit fester Pixelbreite (1–3 px, ohne Jaggies:
 *   ein Pixel je Schritt der Hauptachse), Farbe als feste Rampenstufe.
 * - `punkt` – Merkmale (Augen, Nase, Glanz) als kleine Stempel an einem Oberflächenpunkt; sichtbar nur,
 *   wenn die Fläche dort zum Betrachter zeigt und nichts davor liegt. Merkmale sind geschützt: die
 *   Einzelpixel-Bereinigung lässt sie stehen.
 *
 * **Farbe (docs/ART.md §2.3):** Form-Schattierung nach Himmelsöffnung – Licht von oben und leicht vom
 * Betrachter, links und rechts gleich, dazu Umgebungsverdeckung nach Höhe über Grund (unten dunkler)
 * und Kontaktschatten hinter vorderen Massen (Pixel einer Gruppe, vor denen eine andere Gruppe liegt,
 * eine Stufe dunkler). Keine Richtungslichter: Licht kommt im Spiel über die Normalen. Die Schattierung wird innerhalb einer
 * Gruppe geglättet (keine Nähte zwischen verschmolzenen Formen), Sprenkel von Material und Stufe werden zu
 * Flächen ≥ 2 px zusammengezogen.
 *
 * **Kontur (§2.4):** 1 px außen in `nacht.1` (wie die Spielfigur) oder – Schattenbrut – keine Kontur,
 * stattdessen ein Randsaum in der Randfarbe auf den oberen Kanten. Danach löst die Bereinigung
 * verwaiste Einzelpixel nach der Regel des Paletten-Validators auf.
 */
import { resolveColor } from './sprite';

/** Punkt oder Richtung im Raum. */
export type V3 = readonly [number, number, number];
/** Drei Achsen (Bilder der lokalen Achsen vorn/seitlich/oben in Weltkoordinaten). */
export type Achsen = readonly [V3, V3, V3];

/** Bildschirmhub nach oben je px nach Norden (Neigung der Aufsicht), Standard. */
export const KAMERA_NEIGUNG = 0.6;
/**
 * Himmelslicht: von oben und vom Betrachter (links und rechts gleich) – Oberseiten hell, die dem
 * Betrachter zugewandte Flanke im Grundton, Unterseiten dunkel.
 */
const HIMMEL: V3 = normiere([0, -0.6, 1]);
/** Grundhelligkeit und Anteil des Himmelslichts an der Schattierung. */
const UMGEBUNG = 0.3;
const HIMMELSANTEIL = 0.7;
/** Umgebungsverdeckung nach Höhe: unterste Pixel × (1 − AO_TIEFE). */
const AO_TIEFE = 0.3;
/** Tiefensprung (px), ab dem eine vordere Masse einen Kontaktschatten wirft. */
const KONTAKT_SPRUNG = 1.2;
/** Tiefensprung (px), ab dem die hintere Masse an der vorderen eine Innenkontur bekommt. */
const INNENKONTUR_SPRUNG = 3;
/** Toleranz der Sichtprüfung von Merkmalen (px Tiefe). */
const MERKMAL_TOLERANZ = 0.9;
/** Versätze, mit denen ein Merkmal-Stempel auf die Oberfläche rückt (erst keiner, dann 1 px). */
const STEMPEL_VERSATZ: readonly (readonly [number, number])[] = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [0, 1],
  [0, -1],
];
/** Feste Stufe „hellste Stufe des Materials“. */
export const STUFE_HELL = 99;
/** Feste Stufe „zweithellste Stufe“ (Nachzieher im Smear). */
export const STUFE_SCHMIER = 98;

/** Feste Stufe auf ein Material mit `n` Stufen abbilden. */
function festeStufe(fest: number, n: number): number {
  if (fest === STUFE_SCHMIER) return Math.max(0, n - 2);
  return Math.max(0, Math.min(fest, n - 1));
}

export function normiere(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
export const plus = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const minus = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mal = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const skalar = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const kreuz = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const mischeV = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Bildschirmlage eines Weltpunkts: [sx, sy nach oben, Tiefe] bei Neigung `k`. */
export function projiziere(p: V3, k: number = KAMERA_NEIGUNG): V3 {
  return [p[0], p[2] + k * p[1], p[1]];
}

/** Blickrichtung zum Betrachter (normiert) bei Neigung `k`: nach Süden und oben. */
function zumBetrachter(k: number): V3 {
  return normiere([0, -1, k]);
}

/** Material: Rampenstufen dunkel → hell (`rampe.stufe`, `*` = emissiv) und optionale Schwellen. */
export interface KreaturMaterial {
  readonly stufen: readonly string[];
  /** Aufsteigende Schwellen des Schattierungswerts 0…1 (Länge = Stufen − 1); Standard gleichmäßig. */
  readonly schwellen?: readonly number[];
}

/** Ein benanntes Teil: Standardmaterial und Gruppe (Teile einer Gruppe verschmelzen ohne Kontaktschatten). */
export interface TeilDef {
  readonly name: string;
  readonly material: string;
  readonly gruppe: string;
}

/** Stempel eines Merkmals: Pixel relativ zum projizierten Punkt mit Material und Stufe. */
export interface StempelPixel {
  readonly dx: number;
  readonly dy: number;
  readonly material: string;
  readonly stufe: number;
}

export interface EllipsoidPrim {
  readonly art: 'ellipsoid';
  readonly teil: number;
  readonly mitte: V3;
  /**
   * Spalten = Weltbilder der Halbachsen (vorn, seitlich, oben – Achse × Radius, nach Haltung, Stauchung
   * und Verkürzung). Die Lokalkoordinaten eines Treffers sind die Einheitskugel-Koordinaten.
   */
  readonly matrix: Achsen;
  /** Nur der Teil mit lokaler Höhe ≥ `schnitt` (−1…1) ist da (Quallenschirm, Panzerrand). */
  readonly schnitt?: number;
  /** Tiefenversatz (px): Smear-Kopien liegen hinter dem echten Teil. */
  readonly tiefenVersatz?: number;
  /** Feste Stufe statt Schattierung (Smear-Kopien in der hellsten Stufe). */
  readonly stufe?: number;
}

export interface FlaechePrim {
  readonly art: 'flaeche';
  readonly teil: number;
  readonly punkte: readonly V3[];
  /** Feste Stufe; sonst nach Flächennormale schattiert. */
  readonly stufe?: number;
  readonly tiefenVersatz?: number;
}

export interface LiniePrim {
  readonly art: 'linie';
  readonly teil: number;
  readonly von: V3;
  readonly bis: V3;
  /** Pixelbreite 1–3. */
  readonly breite: number;
  readonly stufe: number;
  /** Material statt des Teil-Materials. */
  readonly material?: string;
  readonly tiefenVersatz?: number;
}

export interface PunktPrim {
  readonly art: 'punkt';
  readonly teil: number;
  readonly ort: V3;
  /** Flächennormale am Ort (Sichtprüfung); `null` = immer sichtbar, wenn nichts davor liegt. */
  readonly normale: V3 | null;
  readonly stempel: readonly StempelPixel[];
  /** Stempel nach außen spiegeln (dx × Vorzeichen der Bildschirmlage): symmetrische Augenpaare. */
  readonly nachAussen?: boolean;
  /** Ohne Tiefenprüfung zeichnen (liegt immer obenauf). */
  readonly obenauf?: boolean;
}

export type Primitiv = EllipsoidPrim | FlaechePrim | LiniePrim | PunktPrim;

/** Ortsinformation eines Ellipsoid-Treffers für Zeichnungen (Fellmuster). */
export interface Trefferort {
  /** Teilname. */
  readonly teil: string;
  /** Lokale Einheitskoordinaten im Ellipsoid (vorn, seitlich, oben; −1…1). */
  readonly lokal: V3;
  /** Weltnormale. */
  readonly normale: V3;
  /** Höhe über Grund (px). */
  readonly hoehe: number;
}

/** Zeichnung: liefert für einen Treffer ein anderes Material (Bauch, Maske, Streifen) oder `null`. */
export type Zeichnung = (ort: Trefferort) => string | null;

export interface Szene {
  readonly teile: readonly TeilDef[];
  readonly materialien: Readonly<Record<string, KreaturMaterial>>;
  readonly primitive: readonly Primitiv[];
  readonly zeichnung?: Zeichnung;
  /** Höhe (px), auf die sich die Umgebungsverdeckung bezieht (Rückenhöhe). */
  readonly hoeheBezug: number;
  /** Kameraneigung `k` dieser Szene (Standard `KAMERA_NEIGUNG`). */
  readonly neigung?: number;
}

export interface RenderOptionen {
  readonly w: number;
  readonly h: number;
  /** Fußpunkt in der Zelle (Weltursprung). */
  readonly anker: readonly [number, number];
  /** Konturfarbe außen; `null` = keine Kontur (Schattenbrut). */
  readonly kontur: string | null;
  /** Randsaum auf oberen Kanten statt Kontur (Schattenbrut): Farbe. */
  readonly saum?: string;
}

/** Gerastertes Bild: Palettenindex, Emissiv und Schutz (Merkmale) je Pixel. */
export interface KreaturRaster {
  readonly w: number;
  readonly h: number;
  readonly index: Uint8Array;
  readonly emissiv: Uint8Array;
  readonly schutz: Uint8Array;
}

interface Farbe {
  readonly index: number;
  readonly emissiv: boolean;
}

const farbCache = new Map<string, Farbe>();
function farbe(ref: string): Farbe {
  let f = farbCache.get(ref);
  if (f === undefined) {
    const r = resolveColor(ref);
    if ('error' in r) throw new Error(`Kreatur: ${r.error}`);
    f = { index: r.index, emissiv: r.emissive };
    farbCache.set(ref, f);
  }
  return f;
}

/** Stufe eines Schattierungswerts nach Schwellen (gleichmäßig, wenn keine angegeben). */
function stufeVon(m: KreaturMaterial, s: number): number {
  const n = m.stufen.length;
  const sw = m.schwellen;
  if (sw !== undefined) {
    let i = 0;
    while (i < sw.length && s >= (sw[i] ?? 1)) i++;
    return Math.min(n - 1, i);
  }
  return Math.max(0, Math.min(n - 1, Math.floor(s * n)));
}

/** Arbeitspuffer eines Frames. */
class Puffer {
  readonly n: number;
  readonly tiefe: Float32Array;
  readonly teil: Int16Array;
  /** Material-Nummer (−1 = Material des Teils bzw. der Zeichnung). */
  readonly mat: Int16Array;
  /** Feste Stufe (−1 = aus der Schattierung). */
  readonly stufe: Int8Array;
  readonly licht: Float32Array;
  readonly schutz: Uint8Array;
  /** Nummer des Ellipsoid-Treffers (für Zeichnungen), −1 sonst. */
  readonly ort: Int32Array;
  readonly orte: Trefferort[] = [];

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.n = w * h;
    this.tiefe = new Float32Array(this.n).fill(Number.POSITIVE_INFINITY);
    this.teil = new Int16Array(this.n).fill(-1);
    this.mat = new Int16Array(this.n).fill(-1);
    this.stufe = new Int8Array(this.n).fill(-1);
    this.licht = new Float32Array(this.n);
    this.schutz = new Uint8Array(this.n);
    this.ort = new Int32Array(this.n).fill(-1);
  }
}

/** Schattierungswert aus Normale und Höhe (Himmelsöffnung + Umgebungsverdeckung). */
function schattierung(n: V3, hoehe: number, bezug: number): number {
  const himmel = Math.max(0, skalar(n, HIMMEL));
  const ao = 1 - AO_TIEFE * (1 - Math.max(0, Math.min(1, hoehe / Math.max(1, bezug))));
  return (UMGEBUNG + HIMMELSANTEIL * himmel) * ao;
}

/** Inverse einer 3×3-Matrix aus Spalten; liefert die Zeilen der Inversen. */
function inverse(m: Achsen): Achsen {
  const [c0, c1, c2] = m;
  const r0 = kreuz(c1, c2);
  const r1 = kreuz(c2, c0);
  const r2 = kreuz(c0, c1);
  const det = skalar(c0, r0);
  if (Math.abs(det) < 1e-9) return [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  return [mal(r0, 1 / det), mal(r1, 1 / det), mal(r2, 1 / det)];
}

function rastereEllipsoid(p: EllipsoidPrim, b: Puffer, szene: Szene, ax: number, ay: number): void {
  const C = p.mitte;
  // Zeilen der Inversen: q_i = w_i · (P − C); Strahl P = O + t·V mit O = (sx, 0, sy), V = (0, 1, −k).
  const [w0, w1, w2] = inverse(p.matrix);
  const W = [w0, w1, w2];
  const base = W.map((wi) => -skalar(wi, C));
  const kx = W.map((wi) => wi[0]);
  const ky = W.map((wi) => wi[2]);
  const k = szene.neigung ?? KAMERA_NEIGUNG;
  const kd = W.map((wi) => wi[1] - k * wi[2]);
  const qa = kd.reduce((s, v) => s + v * v, 0);
  if (qa < 1e-12) return;
  const [m0, m1, m2] = p.matrix;
  const ausX = Math.hypot(m0[0], m1[0], m2[0]);
  const ausY = Math.hypot(m0[2] + k * m0[1], m1[2] + k * m1[1], m2[2] + k * m2[1]);
  const [csx, csy] = projiziere(C, k);
  const x0 = Math.max(0, Math.floor(ax + csx - ausX - 1));
  const x1 = Math.min(b.w - 1, Math.ceil(ax + csx + ausX + 1));
  const y0 = Math.max(0, Math.floor(ay - csy - ausY - 1));
  const y1 = Math.min(b.h - 1, Math.ceil(ay - csy + ausY + 1));
  const versatz = p.tiefenVersatz ?? 0;
  const teilName = szene.teile[p.teil]?.name ?? '';
  const [b0, b1, b2] = base as [number, number, number];
  const [x0k, x1k, x2k] = kx as [number, number, number];
  const [y0k, y1k, y2k] = ky as [number, number, number];
  const [d0, d1, d2] = kd as [number, number, number];
  for (let y = y0; y <= y1; y++) {
    const sy = ay - (y + 0.5);
    for (let x = x0; x <= x1; x++) {
      const sx = x + 0.5 - ax;
      const q0a = b0 + sx * x0k + sy * y0k;
      const q0b = b1 + sx * x1k + sy * y1k;
      const q0c = b2 + sx * x2k + sy * y2k;
      const qb = 2 * (q0a * d0 + q0b * d1 + q0c * d2);
      const qc = q0a * q0a + q0b * q0b + q0c * q0c - 1;
      const disc = qb * qb - 4 * qa * qc;
      if (disc < 0) continue;
      const wurzel = Math.sqrt(disc);
      let t = (-qb - wurzel) / (2 * qa);
      let q: V3 = [q0a + t * d0, q0b + t * d1, q0c + t * d2];
      let innen = false;
      if (p.schnitt !== undefined && q[2] < p.schnitt) {
        t = (-qb + wurzel) / (2 * qa);
        q = [q0a + t * d0, q0b + t * d1, q0c + t * d2];
        if (q[2] < p.schnitt) continue;
        innen = true;
      }
      const tiefe = t + versatz;
      const i = y * b.w + x;
      if (tiefe >= (b.tiefe[i] ?? Number.POSITIVE_INFINITY)) continue;
      // Normale = Gradient von |q|²: Wᵀ·q.
      let n = normiere([q[0] * w0[0] + q[1] * w1[0] + q[2] * w2[0], q[0] * w0[1] + q[1] * w1[1] + q[2] * w2[1], q[0] * w0[2] + q[1] * w1[2] + q[2] * w2[2]]);
      if (innen) n = mal(n, -1);
      const hoehe = sy - k * t;
      b.tiefe[i] = tiefe;
      b.teil[i] = p.teil;
      b.mat[i] = -1;
      b.stufe[i] = p.stufe ?? -1;
      b.licht[i] = schattierung(n, hoehe, szene.hoeheBezug) - (innen ? 0.25 : 0);
      b.schutz[i] = 0;
      b.ort[i] = b.orte.length;
      b.orte.push({ teil: teilName, lokal: q, normale: n, hoehe });
    }
  }
}

function rastereFlaeche(p: FlaechePrim, b: Puffer, szene: Szene, ax: number, ay: number): void {
  if (p.punkte.length < 3) return;
  const k = szene.neigung ?? KAMERA_NEIGUNG;
  const proj = p.punkte.map((q) => projiziere(q, k));
  const p0 = p.punkte[0] as V3;
  let n = normiere(kreuz(minus(p.punkte[1] as V3, p0), minus(p.punkte[2] as V3, p0)));
  if (skalar(n, zumBetrachter(k)) < 0) n = mal(n, -1);
  const hoehe = p.punkte.reduce((s, q) => s + q[2], 0) / p.punkte.length;
  const licht = schattierung(n, hoehe, szene.hoeheBezug);
  const versatz = p.tiefenVersatz ?? 0;
  const a = proj[0] as V3;
  for (let k = 1; k + 1 < proj.length; k++) {
    const bq = proj[k] as V3;
    const c = proj[k + 1] as V3;
    // Bildschirm: x = ax + sx, y = ay − sy.
    const X = [ax + a[0], ax + bq[0], ax + c[0]];
    const Y = [ay - a[1], ay - bq[1], ay - c[1]];
    const x0 = Math.max(0, Math.floor(Math.min(...X)));
    const x1 = Math.min(b.w - 1, Math.ceil(Math.max(...X)));
    const y0 = Math.max(0, Math.floor(Math.min(...Y)));
    const y1 = Math.min(b.h - 1, Math.ceil(Math.max(...Y)));
    const [Xa, Xb, Xc] = X as [number, number, number];
    const [Ya, Yb, Yc] = Y as [number, number, number];
    const flaeche = (Xb - Xa) * (Yc - Ya) - (Xc - Xa) * (Yb - Ya);
    if (Math.abs(flaeche) < 1e-6) continue;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((Xb - px) * (Yc - py) - (Xc - px) * (Yb - py)) / flaeche;
        const w1 = ((Xc - px) * (Ya - py) - (Xa - px) * (Yc - py)) / flaeche;
        const w2 = 1 - w0 - w1;
        const eps = -1e-4;
        if (w0 < eps || w1 < eps || w2 < eps) continue;
        const tiefe = w0 * a[2] + w1 * bq[2] + w2 * c[2] + versatz;
        const i = y * b.w + x;
        if (tiefe >= (b.tiefe[i] ?? Number.POSITIVE_INFINITY)) continue;
        b.tiefe[i] = tiefe;
        b.teil[i] = p.teil;
        b.mat[i] = -1;
        b.stufe[i] = p.stufe ?? -1;
        b.licht[i] = licht;
        b.schutz[i] = 0;
        b.ort[i] = -1;
      }
    }
  }
}

function rastereLinie(p: LiniePrim, b: Puffer, matNr: number, ax: number, ay: number, k: number): void {
  const [sxa, sya, ta] = projiziere(p.von, k);
  const [sxb, syb, tb] = projiziere(p.bis, k);
  const xa = ax + sxa;
  const ya = ay - sya;
  const xb = ax + sxb;
  const yb = ay - syb;
  const dx = xb - xa;
  const dy = yb - ya;
  const breite = Math.max(1, Math.round(p.breite));
  const versatz = p.tiefenVersatz ?? 0;
  const setze = (x: number, y: number, tiefe: number): void => {
    if (x < 0 || y < 0 || x >= b.w || y >= b.h) return;
    const i = y * b.w + x;
    if (tiefe + versatz >= (b.tiefe[i] ?? Number.POSITIVE_INFINITY)) return;
    b.tiefe[i] = tiefe + versatz;
    b.teil[i] = p.teil;
    b.mat[i] = matNr;
    b.stufe[i] = p.stufe;
    b.schutz[i] = 0;
    b.ort[i] = -1;
  };
  if (Math.abs(dy) >= Math.abs(dx)) {
    // Steil: je Zeile ein Lauf von `breite` Pixeln um die Mittellinie.
    const r0 = Math.floor(Math.min(ya, yb));
    const r1 = Math.floor(Math.max(ya, yb) - 1e-6);
    for (let r = r0; r <= Math.max(r0, r1); r++) {
      const u = Math.abs(dy) < 1e-6 ? 0 : Math.max(0, Math.min(1, (r + 0.5 - ya) / dy));
      const xc = xa + dx * u;
      const erster = Math.floor(xc - breite / 2 + 0.5);
      for (let k = 0; k < breite; k++) setze(erster + k, r, ta + (tb - ta) * u);
    }
  } else {
    const c0 = Math.floor(Math.min(xa, xb));
    const c1 = Math.floor(Math.max(xa, xb) - 1e-6);
    for (let c = c0; c <= Math.max(c0, c1); c++) {
      const u = Math.max(0, Math.min(1, (c + 0.5 - xa) / dx));
      const yc = ya + dy * u;
      const erster = Math.floor(yc - breite / 2 + 0.5);
      for (let k = 0; k < breite; k++) setze(c, erster + k, ta + (tb - ta) * u);
    }
  }
}

function rasterePunkt(p: PunktPrim, b: Puffer, matNr: (name: string) => number, ax: number, ay: number, k: number): void {
  if (p.normale !== null && skalar(p.normale, zumBetrachter(k)) <= 0.05) return;
  const [sx, sy, t] = projiziere(p.ort, k);
  const x = Math.floor(ax + sx);
  const y = Math.floor(ay - sy);
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return;
  const i0 = y * b.w + x;
  if (p.obenauf !== true && (b.tiefe[i0] ?? Number.POSITIVE_INFINITY) < t - MERKMAL_TOLERANZ) return;
  const seite = p.nachAussen === true && sx < 0 ? -1 : 1;
  // Der Stempel muss ganz auf der Oberfläche liegen (sonst bliebe ein halbes Auge als Einzelpixel):
  // passt er nicht, rückt er um einen Pixel nach innen; passt er nirgends, entfällt das Merkmal.
  const passt = (ox: number, oy: number): boolean =>
    p.obenauf === true ||
    p.stempel.every((st) => {
      const xx = x + st.dx * seite + ox;
      const yy = y + st.dy + oy;
      return xx >= 0 && yy >= 0 && xx < b.w && yy < b.h && (b.teil[yy * b.w + xx] ?? -1) >= 0 && (b.tiefe[yy * b.w + xx] ?? Number.POSITIVE_INFINITY) > t - 2 * MERKMAL_TOLERANZ - 1;
    });
  const versatz = STEMPEL_VERSATZ.find(([ox, oy]) => passt(ox, oy));
  if (versatz === undefined) return;
  const [ox, oy] = versatz;
  for (const st of p.stempel) {
    const xx = x + st.dx * seite + ox;
    const yy = y + st.dy + oy;
    if (xx < 0 || yy < 0 || xx >= b.w || yy >= b.h) continue;
    const i = yy * b.w + xx;
    b.teil[i] = p.teil;
    b.mat[i] = matNr(st.material);
    b.stufe[i] = st.stufe;
    b.schutz[i] = 1;
    b.tiefe[i] = Math.min(b.tiefe[i] ?? t, t);
    b.ort[i] = -1;
  }
}

/** Rastert eine Szene in eine Zelle: Grundformen → Farbe → Kontaktschatten → Kontur → Bereinigung. */
export function rendere(szene: Szene, opt: RenderOptionen): KreaturRaster {
  const { w, h } = opt;
  const [ax, ay] = opt.anker;
  const b = new Puffer(w, h);
  const matNamen = Object.keys(szene.materialien);
  const matNummer = new Map(matNamen.map((m, i) => [m, i]));
  const nr = (name: string): number => {
    const i = matNummer.get(name);
    if (i === undefined) throw new Error(`Kreatur: Material ${name} fehlt`);
    return i;
  };
  const teilMat = szene.teile.map((t) => nr(t.material));
  for (const p of szene.primitive) {
    if (p.art === 'ellipsoid') rastereEllipsoid(p, b, szene, ax, ay);
    else if (p.art === 'flaeche') rastereFlaeche(p, b, szene, ax, ay);
    else if (p.art === 'linie') rastereLinie(p, b, p.material === undefined ? (teilMat[p.teil] ?? 0) : nr(p.material), ax, ay, szene.neigung ?? KAMERA_NEIGUNG);
  }
  // Merkmale zuletzt: sie prüfen die Tiefe der fertigen Oberfläche.
  for (const p of szene.primitive) if (p.art === 'punkt') rasterePunkt(p, b, nr, ax, ay, szene.neigung ?? KAMERA_NEIGUNG);

  // Weiche Form: Schattierung innerhalb einer Gruppe glätten (keine Nähte zwischen verschmolzenen Formen).
  const gruppeNr = szene.teile.map((t) => t.gruppe);
  const licht = Float32Array.from(b.licht);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const t = b.teil[i] ?? -1;
      if (t < 0 || (b.stufe[i] ?? -1) >= 0) continue;
      const g = gruppeNr[t];
      let summe = 0;
      let gewicht = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          const tj = b.teil[j] ?? -1;
          if (tj < 0 || gruppeNr[tj] !== g || (b.stufe[j] ?? -1) >= 0) continue;
          const k = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
          summe += (b.licht[j] ?? 0) * k;
          gewicht += k;
        }
      }
      licht[i] = gewicht > 0 ? summe / gewicht : (b.licht[i] ?? 0);
    }
  }

  // Material und Stufe je Pixel.
  const mat = new Int16Array(b.n).fill(-1);
  const stufe = new Int8Array(b.n).fill(-1);
  for (let i = 0; i < b.n; i++) {
    const t = b.teil[i] ?? -1;
    if (t < 0) continue;
    let m = b.mat[i] ?? -1;
    if (m < 0) {
      m = teilMat[t] ?? 0;
      const o = b.ort[i] ?? -1;
      if (o >= 0 && szene.zeichnung !== undefined) {
        const ort = b.orte[o];
        const z = ort === undefined ? null : szene.zeichnung(ort);
        if (z !== null) m = nr(z);
      }
    }
    mat[i] = m;
    const material = szene.materialien[matNamen[m] ?? ''];
    if (material === undefined) continue;
    const fest = b.stufe[i] ?? -1;
    stufe[i] = fest >= 0 ? festeStufe(fest, material.stufen.length) : stufeVon(material, licht[i] ?? 0);
  }
  entspeckle(mat, b, gruppeNr, w, h);
  entspeckle(stufe, b, gruppeNr, w, h);

  // Kontaktschatten: Pixel hinter einer vorderen Masse einer anderen Gruppe eine Stufe dunkler; liegt die
  // vordere Masse deutlich davor, wird der Pixel zur Innenkontur (dunkelste Stufe seines Materials).
  const gruppe = szene.teile.map((t) => t.gruppe);
  const dunkler = new Uint8Array(b.n);
  const innen = new Uint8Array(b.n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const t = b.teil[i] ?? -1;
      if (t < 0 || (b.schutz[i] ?? 0) > 0) continue;
      const g = gruppe[t];
      const d = b.tiefe[i] ?? 0;
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ] as const) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        const tn = b.teil[j] ?? -1;
        if (tn < 0 || gruppe[tn] === g) continue;
        const dj = b.tiefe[j] ?? 0;
        if (dj < d - KONTAKT_SPRUNG) dunkler[i] = 1;
        if (dj < d - INNENKONTUR_SPRUNG && (b.stufe[i] ?? -1) < 0) innen[i] = 1;
      }
    }
  }
  for (let i = 0; i < b.n; i++) {
    if ((innen[i] ?? 0) > 0) stufe[i] = 0;
    else if ((dunkler[i] ?? 0) > 0 && (stufe[i] ?? 0) > 0) stufe[i] = (stufe[i] ?? 1) - 1;
  }

  // Farben.
  const index = new Uint8Array(b.n);
  const emissiv = new Uint8Array(b.n);
  for (let i = 0; i < b.n; i++) {
    const m = mat[i] ?? -1;
    if (m < 0) continue;
    const material = szene.materialien[matNamen[m] ?? ''];
    const ref = material?.stufen[Math.min(stufe[i] ?? 0, material.stufen.length - 1)];
    if (ref === undefined) continue;
    const f = farbe(ref);
    index[i] = f.index;
    emissiv[i] = f.emissiv ? 1 : 0;
  }
  const schutz = Uint8Array.from(b.schutz);
  entferneKruemel(index, emissiv, schutz, w, h);

  if (opt.kontur !== null) {
    const k = farbe(opt.kontur);
    const rand: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if ((index[i] ?? 0) !== 0) continue;
        const nb = (xx: number, yy: number): boolean => xx >= 0 && yy >= 0 && xx < w && yy < h && (index[yy * w + xx] ?? 0) !== 0;
        if (nb(x + 1, y) || nb(x - 1, y) || nb(x, y + 1) || nb(x, y - 1)) rand.push(i);
      }
    }
    for (const i of rand) {
      index[i] = k.index;
      emissiv[i] = 0;
    }
  } else if (opt.saum !== undefined) {
    const s = farbe(opt.saum);
    const saum: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if ((index[i] ?? 0) === 0 || (schutz[i] ?? 0) > 0 || (emissiv[i] ?? 0) > 0) continue;
        const leer = (xx: number, yy: number): boolean => xx < 0 || yy < 0 || xx >= w || yy >= h || (index[yy * w + xx] ?? 0) === 0;
        // Saum auf oberen und seitlichen Kanten; unten löst sich der Rauch ohne Saum auf.
        if (leer(x, y - 1) || ((leer(x - 1, y) || leer(x + 1, y)) && !leer(x, y - 1) && leer(x, y - 2))) saum.push(i);
      }
    }
    for (const i of saum) index[i] = s.index;
  }

  bereinigeRaster(index, emissiv, schutz, w, h);
  return { w, h, index, emissiv, schutz };
}

/** Größte Fläche (px), die als Krümel gilt: abgelöste Rauchfetzen und Linienenden ohne Merkmal. */
const KRUEMEL_GROESSE = 3;

/**
 * Entfernt abgelöste Krümel vor Kontur und Saum: zusammenhängende Flächen (8er-Nachbarschaft) von
 * höchstens `KRUEMEL_GROESSE` px ohne geschütztes Merkmal (Augen, Funken, Insekten bleiben). Sie würden
 * sonst mit ihrer Kontur als Konfetti um die Figur stehen.
 */
function entferneKruemel(index: Uint8Array, emissiv: Uint8Array, schutz: Uint8Array, w: number, h: number): void {
  const gesehen = new Uint8Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if ((index[start] ?? 0) === 0 || (gesehen[start] ?? 0) > 0) continue;
    const flaeche: number[] = [start];
    gesehen[start] = 1;
    let geschuetzt = false;
    for (let k = 0; k < flaeche.length; k++) {
      const i = flaeche[k] ?? 0;
      if ((schutz[i] ?? 0) > 0) geschuetzt = true;
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if ((index[j] ?? 0) === 0 || (gesehen[j] ?? 0) > 0) continue;
          gesehen[j] = 1;
          flaeche.push(j);
        }
      }
    }
    if (geschuetzt || flaeche.length > KRUEMEL_GROESSE) continue;
    for (const i of flaeche) {
      index[i] = 0;
      emissiv[i] = 0;
    }
  }
}

/**
 * Entfernt Sprenkel einer Kennzahl (Material oder Stufe) innerhalb einer Gruppe: ein ungeschützter Pixel,
 * dessen Wert keiner seiner 4er-Nachbarn derselben Gruppe teilt, übernimmt den häufigsten Nachbarwert
 * (bei mindestens zwei solchen Nachbarn). So bleiben Zeichnungen und Lichtkappen Flächen ≥ 2 px.
 */
function entspeckle(werte: Int16Array | Int8Array, b: Puffer, gruppe: readonly string[], w: number, h: number): void {
  for (let runde = 0; runde < 2; runde++) {
    let geaendert = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const t = b.teil[i] ?? -1;
        if (t < 0 || (b.schutz[i] ?? 0) > 0) continue;
        const g = gruppe[t];
        const v = werte[i] ?? 0;
        const zaehl = new Map<number, number>();
        let gleich = 0;
        let nachbarn = 0;
        for (const [xx, yy] of [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ] as const) {
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          const tj = b.teil[j] ?? -1;
          if (tj < 0 || gruppe[tj] !== g || (b.schutz[j] ?? 0) > 0) continue;
          nachbarn++;
          const u = werte[j] ?? 0;
          if (u === v) gleich++;
          zaehl.set(u, (zaehl.get(u) ?? 0) + 1);
        }
        if (gleich > 0 || nachbarn < 2) continue;
        const best = [...zaehl.entries()].sort((a, c) => c[1] - a[1] || a[0] - c[0])[0];
        if (best === undefined) continue;
        werte[i] = best[0];
        geaendert = true;
      }
    }
    if (!geaendert) return;
  }
}

/**
 * Löst verwaiste Einzelpixel auf (Regel des Paletten-Validators, `tools/assets/spriteChecks.ts`): ein
 * Pixel ohne gleichfarbigen Nachbarn (8er-Nachbarschaft), das höchstens einen deckenden Nachbarn hat oder
 * dessen Farbe im Bild nur einmal vorkommt. Hängt es an höchstens einem Nachbarn, fällt es weg; sonst
 * übernimmt es die häufigste Nachbarfarbe. Geschützte Merkmale bleiben; ist ein geschütztes Merkmal
 * (Auge im Profil, halb verdeckt) das einzige Pixel seiner Farbe, wächst es um ein Pixel nach innen.
 */
export function bereinigeRaster(index: Uint8Array, emissiv: Uint8Array, schutz: Uint8Array, w: number, h: number): void {
  entferneEinzelpixel(index, emissiv, schutz, w, h);
  if (ergaenzeEinzelmerkmale(index, emissiv, schutz, w, h)) entferneEinzelpixel(index, emissiv, schutz, w, h);
}

/** Zahl der deckenden Pixel in der 8er-Nachbarschaft. */
function deckendeNachbarn(index: Uint8Array, w: number, h: number, x: number, y: number): number {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if ((dx === 0 && dy === 0) || xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      if ((index[yy * w + xx] ?? 0) !== 0) n++;
    }
  }
  return n;
}

/**
 * Geschützte Einzelpixel, deren Farbe im Bild nur einmal vorkommt, übernehmen den ungeschützten
 * Nachbarn (waagerecht vor senkrecht) mit den meisten deckenden Nachbarn. Liefert, ob sich etwas änderte.
 */
function ergaenzeEinzelmerkmale(index: Uint8Array, emissiv: Uint8Array, schutz: Uint8Array, w: number, h: number): boolean {
  const anzahl = new Map<number, number>();
  for (const v of index) if (v !== 0) anzahl.set(v, (anzahl.get(v) ?? 0) + 1);
  let geaendert = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = index[i] ?? 0;
      if (v === 0 || (schutz[i] ?? 0) === 0 || (anzahl.get(v) ?? 0) !== 1) continue;
      let ziel = -1;
      let bestN = -1;
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if ((index[j] ?? 0) === 0 || (schutz[j] ?? 0) > 0) continue;
        const n = deckendeNachbarn(index, w, h, xx, yy);
        if (n > bestN) {
          bestN = n;
          ziel = j;
        }
      }
      if (ziel < 0) continue;
      index[ziel] = v;
      emissiv[ziel] = emissiv[i] ?? 0;
      schutz[ziel] = 1;
      anzahl.set(v, 2);
      geaendert = true;
    }
  }
  return geaendert;
}

function entferneEinzelpixel(index: Uint8Array, emissiv: Uint8Array, schutz: Uint8Array, w: number, h: number): void {
  for (let runde = 0; runde < 4; runde++) {
    const anzahl = new Map<number, number>();
    for (const v of index) if (v !== 0) anzahl.set(v, (anzahl.get(v) ?? 0) + 1);
    let geaendert = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const v = index[i] ?? 0;
        if (v === 0 || (schutz[i] ?? 0) > 0) continue;
        let gleich = 0;
        let deckend = 0;
        const zaehl = new Map<number, { n: number; e: number }>();
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const u = index[yy * w + xx] ?? 0;
            if (u === 0) continue;
            deckend++;
            if (u === v) gleich++;
            const z = zaehl.get(u);
            if (z === undefined) zaehl.set(u, { n: 1, e: emissiv[yy * w + xx] ?? 0 });
            else z.n++;
          }
        }
        if (gleich > 0 || (deckend > 1 && (anzahl.get(v) ?? 0) > 1)) continue;
        if (deckend <= 1) {
          index[i] = 0;
          emissiv[i] = 0;
        } else {
          const [best, info] = [...zaehl.entries()].sort((a, c) => c[1].n - a[1].n || a[0] - c[0])[0] ?? [0, { n: 0, e: 0 }];
          index[i] = best;
          emissiv[i] = info.e;
        }
        geaendert = true;
      }
    }
    if (!geaendert) return;
  }
}
