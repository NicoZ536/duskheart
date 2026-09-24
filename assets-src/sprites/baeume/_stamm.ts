/**
 * Gefällte Stämme für die Fall-Animation (MASTERPROMPT §14 „Der Baum fällt vom Spieler weg“, M3-11):
 * je Baumart drei liegende Stämme in der Rinde und den Schnittfarben der Art (`BaumArt.stamm`,
 * `BaumArt.stumpf.schnitt`), damit der Stamm zum stehenden Baum und zum Stumpf passt.
 *
 * - `baum_stamm_<art>`: liegt nach **rechts** vom Stumpf (Schnittfläche links am Stumpf, Aststummel
 *   oben, gesplittertes Kronenende rechts). `spiegelbar`: nach links fällt derselbe Stamm gespiegelt.
 * - `baum_stamm_<art>_nord`: liegt nach **oben** (Norden); die Schnittfläche zeigt nach Süden zur
 *   Kamera und ist unten als Ellipse zu sehen.
 * - `baum_stamm_<art>_sued`: liegt nach **unten** (Süden); die Schnittfläche zeigt vom Betrachter weg,
 *   unten ist das gesplitterte Kronenende zu sehen.
 *
 * Ablauf in der Präsentation: Der stehende Baum (`baum_<art>`) kippt über die Instanz-Rotation um seinen
 * Fußpunkt vom Spieler weg; beim Aufschlag ersetzt ihn der liegende Stamm der Fallrichtung (Sockel
 * `basis` = Ende am Stumpf), dazu `partikel_blatt` aus der Krone und `staubwolke` am Aufschlag. Nach dem
 * Liegen (Clip `liegen`) zerfällt der Stamm in Stücke (Clip `zerfallen`: Risse → Stücke mit Spänen), aus
 * denen die Drops fliegen (`partikel_splitter`). Länge ≈ halbe Baumhöhe (26–44 px), Dicke = Stammdicke am
 * Fuß, zur Krone hin verjüngt.
 */
import type { Rng } from '../../../src/engine/rng';
import { defineGenerator, type GeneratorResult } from '../../lib/generator';
import { spriteFromPixels, type Sprite } from '../../lib/sprite';
import { Bild, type Rinde, type RindenFarben, type SchnittFarben } from '../../lib/tree';
import type { BaumArt } from './_baukasten';

/** Kontaktbogen `baumfall.png` (Stämme und Fall-Effekte). */
export const STAMM_GRUPPE = 'baumfall';
/** Stammlänge in px: halbe Höhe bis zum Fuß, begrenzt. */
export const STAMM_LAENGE = { min: 26, max: 44, anteil: 0.5 } as const;
/** Richtungen der liegenden Stämme (Sprite-Id-Suffix). */
export const STAMM_RICHTUNGEN = ['', '_nord', '_sued'] as const;
/** Takt des Zerfallens (Bilder je Sekunde). */
const ZERFALL_FPS = 8;
const BODEN = 'nacht.1';

export function stammLaenge(a: BaumArt): number {
  return Math.max(STAMM_LAENGE.min, Math.min(STAMM_LAENGE.max, Math.round(a.fussY * STAMM_LAENGE.anteil)));
}

interface Farben {
  readonly rinde: Rinde;
  readonly f: RindenFarben;
  readonly s: SchnittFarben;
}

/** Rindenfarbe eines Stammpixels: `quer` ∈ [0, 1] über den Stamm (0 = oben/Mitte), `laengs` in px entlang. */
function rinde(c: Farben, quer: number, laengs: number, furche: (reihe: number, pos: number) => boolean): string {
  const { f } = c;
  const akzent = f.akzent ?? f.schatten;
  const grund = quer < 0.3 ? f.licht : quer < 0.72 ? f.mitte : f.schatten;
  switch (c.rinde) {
    case 'furchen':
      if (quer > 0.35 && quer < 0.55 && furche(0, laengs)) return f.schatten;
      if (quer >= 0.72 && furche(1, laengs)) return f.kontur;
      return grund;
    case 'glatt':
      return grund;
    case 'birke':
      // Kurze dunkle Querbänder (Lentizellen): nur die ersten zwei Pixel jedes Abschnitts, nicht über die ganze Dicke.
      if (quer > 0.3 && quer < 0.65 && furche(0, laengs) && !furche(0, laengs - 2)) return akzent;
      return quer < 0.55 ? f.licht : f.mitte;
    case 'ringel':
      if (quer > 0.15 && quer < 0.8 && laengs % 5 === 2) return f.licht;
      return quer < 0.3 ? f.mitte : grund;
    case 'schuppen':
      return (laengs + Math.round(quer * 6)) % 3 === 0 ? f.schatten : grund;
    case 'glut':
      if (quer > 0.35 && quer < 0.65 && furche(0, laengs)) return akzent;
      return grund;
    case 'kristall':
      if (laengs % 4 === 1 && quer > 0.2 && quer < 0.8) return akzent;
      return grund;
  }
}

/** Unregelmäßige Furchen: je Reihe Abschnitte von 3–6 px mit Lücken von 1–3 px (nie im gleichen Abstand). */
function furchen(rng: Rng, laenge: number): (reihe: number, pos: number) => boolean {
  const reihen = [0, 1].map(() => {
    const an = new Uint8Array(laenge + 8);
    let x = rng.int(0, 3);
    while (x < an.length) {
      const l = rng.int(3, 7);
      for (let i = 0; i < l && x + i < an.length; i++) an[x + i] = 1;
      x += l + rng.int(1, 4);
    }
    return an;
  });
  return (reihe, pos) => (reihen[reihe]?.[pos] ?? 0) === 1;
}

/** Schnittfläche als Farbe: Rand außen, Jahresring, Holz, Kern in der Mitte. */
function schnitt(s: SchnittFarben, rel: number): string {
  if (rel > 0.8) return s.rand;
  if (rel > 0.55) return s.holz;
  if (rel > 0.3) return s.ring;
  return s.kern;
}

type Zerfall = 0 | 1 | 2;

/** Liegend nach rechts: Frames 0 liegt · 1 Risse · 2 Stücke. */
function waagerecht(c: Farben, rng: Rng, laenge: number, d0: number, d1: number, stufe: Zerfall): Bild {
  const w = laenge + 6;
  const h = d0 + 6;
  const b = new Bild(w, h);
  const xs = 2;
  const xe = xs + laenge + 1;
  const yb = h - 3;
  const dicke = (x: number): number => Math.round(d0 + ((d1 - d0) * Math.max(0, x - xs)) / (xe - xs));
  const yt = (x: number): number => yb - dicke(x) + 1;
  const risse = [xs + Math.round(laenge / 3), xs + Math.round((2 * laenge) / 3)];
  const fu = furchen(rng, w);
  const luecke = (x: number): boolean => stufe === 2 && risse.includes(x);
  for (let x = xs + 2; x <= xe; x++) {
    if (luecke(x)) continue;
    const top = yt(x);
    const d = dicke(x);
    for (let y = top; y <= yb; y++) {
      const quer = d > 1 ? (y - top) / (d - 1) : 0.5;
      const riss = stufe >= 1 && risse.includes(x) && y !== top + ((x * 7) % Math.max(1, d - 1));
      // Liegender Zylinder: Höhe als Halbkreis über den Querschnitt (Normalen oben nach Norden, unten zur Kamera).
      const u = d > 1 ? quer * 2 - 1 : 0;
      b.set(x, y, riss ? c.f.kontur : rinde(c, quer, x, fu), 0, Math.max(1, (d / 2) * Math.sqrt(Math.max(0, 1 - u * u))));
    }
    b.set(x, top - 1, c.f.kontur, 0, d);
    b.set(x, yb + 1, BODEN, 0, 0);
  }
  // Gesplittertes Kronenende: Holz sichtbar, Kontur zackig.
  const topE = yt(xe);
  for (let y = topE; y <= yb; y++) {
    const zacke = (y - topE) % 3 === 1 ? 1 : 0;
    b.set(xe - zacke, y, c.s.holz, 0, 2);
    b.set(xe + 1 - zacke, y, c.f.kontur, 0, 1);
  }
  // Schnittfläche am Stumpf-Ende (links), drei Spalten, oben und unten gerundet.
  const top0 = yt(xs);
  const mitte = (top0 + yb) / 2;
  const halb = Math.max(1, (yb - top0) / 2);
  for (let y = top0; y <= yb; y++) {
    const rel = Math.abs(y - mitte) / halb;
    const rund = y === top0 || y === yb;
    if (!rund) b.set(xs, y, c.s.rand, 0, 3);
    b.set(xs + 1, y, rund ? c.s.rand : schnitt(c.s, rel), 0, 3);
    b.set(xs + 2, y, c.s.rand, 0, 3);
    b.set(xs - 1, y, c.f.kontur, 0, 1);
  }
  b.set(xs, top0 - 1, c.f.kontur, 0, 1);
  b.set(xs, yb + 1, BODEN, 0, 0);
  b.set(xs + 1, top0 - 1, c.f.kontur, 0, 1);
  b.set(xs + 2, top0 - 1, c.f.kontur, 0, 1);
  b.set(xs + 1, yb + 1, BODEN, 0, 0);
  b.set(xs + 2, yb + 1, BODEN, 0, 0);
  // Aststummel oben (Schnittfarbe an der Bruchstelle).
  for (const anteil of [0.55, 0.8]) {
    const x = xs + Math.round(laenge * anteil);
    if (luecke(x) || luecke(x + 1)) continue;
    const top = yt(x);
    b.set(x, top - 1, c.f.mitte, 0, dicke(x) + 1);
    b.set(x + 1, top - 1, c.f.schatten, 0, dicke(x) + 1);
    b.set(x, top - 2, c.s.holz, 0, dicke(x) + 2);
    b.set(x + 1, top - 2, c.s.ring, 0, dicke(x) + 2);
    for (const [dx, dy] of [
      [-1, -1],
      [-1, -2],
      [0, -3],
      [1, -3],
      [2, -2],
      [2, -1],
    ] as const) {
      if (b.get(x + dx, top + dy) === 0) b.set(x + dx, top + dy, c.f.kontur, 0, dicke(x));
    }
  }
  // Späne über den Lücken beim Zerfallen.
  if (stufe === 2) for (const x of risse) b.set(x, yt(x) - 2, c.s.holz, 0, dicke(x) + 2);
  return b;
}

/** Liegend nach Norden (`nord`: Schnittfläche unten sichtbar) oder Süden (`sued`: Kronenende unten). */
function senkrecht(c: Farben, rng: Rng, laenge: number, d0: number, d1: number, richtung: 'nord' | 'sued', stufe: Zerfall): Bild {
  const flaeche = Math.max(3, Math.round(d0 / 2));
  // Seitlich Platz für die Aststummel (2 px + Kontur), oben für die Splitter des Kronenendes, 1 px Luft.
  const w = d0 + 8;
  const h = laenge + flaeche + 6;
  const b = new Bild(w, h);
  const cx = (w - 1) / 2;
  // Stumpf-Ende und Kronenende (Zeilen) je Richtung.
  const basis = richtung === 'nord' ? h - 3 - flaeche : 3;
  const krone = richtung === 'nord' ? 3 : h - 3 - flaeche;
  const von = Math.min(basis, krone);
  const bis = Math.max(basis, krone);
  const dicke = (y: number): number => Math.round(d0 + ((d1 - d0) * Math.abs(y - basis)) / Math.max(1, bis - von));
  const risse = [von + Math.round((bis - von) / 3), von + Math.round((2 * (bis - von)) / 3)];
  const fu = furchen(rng, h);
  const luecke = (y: number): boolean => stufe === 2 && risse.includes(y);
  for (let y = von; y <= bis; y++) {
    if (luecke(y)) continue;
    const d = dicke(y);
    const x0 = Math.round(cx - (d - 1) / 2);
    for (let i = 0; i < d; i++) {
      const u = d > 1 ? (i / (d - 1)) * 2 - 1 : 0;
      const quer = Math.abs(u);
      const riss = stufe >= 1 && risse.includes(y) && i !== (y * 5) % d;
      b.set(x0 + i, y, riss ? c.f.kontur : rinde(c, quer, y, fu), 0, Math.max(1, (d / 2) * Math.sqrt(Math.max(0, 1 - u * u))));
    }
    b.set(x0 - 1, y, c.f.kontur, 0, 1);
    b.set(x0 + d, y, c.f.kontur, 0, 1);
  }
  // Oberes Ende: Nord = gesplittertes Kronenende, Süd = gerundete Rinde am Stumpf.
  const dTop = dicke(von);
  const xTop = Math.round(cx - (dTop - 1) / 2);
  for (let i = 0; i < dTop; i++) b.set(xTop + i, von - 1, richtung === 'nord' && i % 3 === 1 ? c.s.holz : c.f.kontur, 0, 1);
  if (richtung === 'nord') for (let i = 0; i < dTop; i++) if (i % 3 === 1) b.set(xTop + i, von - 2, c.f.kontur, 0, 1);
  // Unteres Ende: Nord = Schnittfläche (Ellipse zur Kamera), Süd = Bruchfläche mit Holz und Zacken.
  const dBot = dicke(bis);
  const xBot = Math.round(cx - (dBot - 1) / 2);
  const rx = (dBot - 1) / 2;
  const ry = (flaeche - 1) / 2;
  const fy = bis + 1 + ry;
  for (let y = bis + 1; y <= bis + flaeche; y++) {
    for (let i = -1; i <= dBot; i++) {
      const x = xBot + i;
      const nx = rx > 0 ? (x - cx) / (rx + 0.5) : 0;
      const ny = ry > 0 ? (y - fy) / (ry + 0.5) : 0;
      const r = Math.sqrt(nx * nx + ny * ny);
      if (r > 1) continue;
      const aussen = r > 0.78 || i < 0 || i >= dBot;
      if (richtung === 'nord') b.set(x, y, aussen ? c.s.rand : schnitt(c.s, r), 0, 2);
      else b.set(x, y, aussen ? c.f.schatten : (x + y) % 3 === 0 ? c.s.ring : c.s.holz, 0, 2);
    }
  }
  // Kontur um das untere Ende, Bodenkontakt in der letzten Zeile.
  const maske = b.mask();
  for (let y = bis + 1; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((maske[y * w + x] ?? 0) > 0) continue;
      const nachbar = [
        [1, 0],
        [-1, 0],
        [0, -1],
        [0, 1],
      ].some(([dx, dy]) => (maske[(y + (dy ?? 0)) * w + x + (dx ?? 0)] ?? 0) > 0 && x + (dx ?? 0) >= 0 && x + (dx ?? 0) < w);
      if (nachbar) b.set(x, y, y >= bis + flaeche ? BODEN : c.f.kontur, 0, 0);
    }
  }
  // Aststummel seitlich.
  for (const [anteil, seite] of [
    [0.55, -1],
    [0.8, 1],
  ] as const) {
    const y = Math.round(basis + (krone - basis) * anteil);
    if (luecke(y) || luecke(y + 1)) continue;
    const d = dicke(y);
    const x = seite < 0 ? Math.round(cx - (d - 1) / 2) - 1 : Math.round(cx - (d - 1) / 2) + d;
    b.set(x, y, c.f.mitte, 0, d / 2);
    b.set(x, y + 1, c.f.schatten, 0, d / 2);
    b.set(x + seite, y, c.s.holz, 0, d / 2);
    b.set(x + seite, y + 1, c.s.ring, 0, d / 2);
    for (const [dx, dy] of [
      [0, -1],
      [seite, -1],
      [2 * seite, 0],
      [2 * seite, 1],
      [seite, 2],
      [0, 2],
    ] as const) {
      if (b.get(x + dx, y + dy) === 0) b.set(x + dx, y + dy, c.f.kontur, 0, 1);
    }
  }
  // Späne neben den Lücken (außerhalb des Stammes, die Stücke bleiben getrennt).
  if (stufe === 2) for (const y of risse) b.set(Math.round(cx - (dicke(y) - 1) / 2) - 2, y, c.s.holz, 0, 2);
  return b;
}

/** Die drei liegenden Stämme einer Art. */
export function staemme(a: BaumArt): GeneratorResult {
  return defineGenerator<undefined>(`baum_stamm_${a.art}`, (rng) => {
    const c: Farben = { rinde: a.stamm.rinde, f: a.stamm.farben, s: a.stumpf.schnitt };
    const laenge = stammLaenge(a);
    const d0 = Math.max(5, Math.min(11, a.stamm.breiteFuss));
    const d1 = Math.max(4, Math.min(d0, a.stamm.breiteOben));
    const clips = {
      liegen: { frames: [0], fps: 1, loop: true },
      zerfallen: { frames: [1, 2], fps: ZERFALL_FPS, loop: false },
    };
    const einzelpixel = 'Späne über den Bruchstellen beim Zerfallen und der Kern der Schnittfläche';
    const zerfall: readonly Zerfall[] = [0, 1, 2];
    const liegend = zerfall.map((s) => waagerecht(c, rng, laenge, d0, d1, s));
    const quer = liegend[0] ?? new Bild(1, 1);
    const sprites: Sprite[] = [
      spriteFromPixels(
        {
          id: `baum_stamm_${a.art}`,
          group: STAMM_GRUPPE,
          size: [quer.w, quer.h],
          anchor: [2, quer.h - 2],
          hoehe: 'block',
          clips,
          sockets: { basis: [[2, quer.h - 2]], mitte: [[Math.round(quer.w / 2), quer.h - 2]] },
          occluder: { kind: 'none' },
          schatten: 'none',
          spiegelbar: true,
          einzelpixel,
        },
        liegend.map((f) => f.frame()),
      ),
    ];
    for (const richtung of ['nord', 'sued'] as const) {
      const bilder = zerfall.map((s) => senkrecht(c, rng, laenge, d0, d1, richtung, s));
      const erstes = bilder[0] ?? new Bild(1, 1);
      const mx = Math.round((erstes.w - 1) / 2);
      sprites.push(
        spriteFromPixels(
          {
            id: `baum_stamm_${a.art}_${richtung}`,
            group: STAMM_GRUPPE,
            size: [erstes.w, erstes.h],
            anchor: [mx, erstes.h - 2],
            hoehe: 'block',
            clips,
            sockets: { basis: [[mx, richtung === 'nord' ? erstes.h - 2 : 1]], mitte: [[mx, Math.round(erstes.h / 2)]] },
            occluder: { kind: 'none' },
            schatten: 'none',
            einzelpixel,
          },
          bilder.map((f) => f.frame()),
        ),
      );
    }
    return sprites;
  }).generate(a.seed, undefined);
}
