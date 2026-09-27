/**
 * Haus- und Stations-Vorschau (M4-05, M4-06, M4-13; MASTERPROMPT §5 „Qualitätsschleife“): setzt die
 * modularen Bauteile so zusammen, wie der Vertrag in `assets-src/sprites/bau/_bau.ts` es dem Renderer
 * vorgibt – Nachbarmasken aus einer Baukarte, Fassung A/B per Tile-Hash, Dachreihen `nord`/`first`/
 * `sued` je Spalte, Schnitt (Dach nur Traufrand, Wände vor dem Raum auf 4 px) – und schreibt vier Bögen
 * nach `tools/out/sheets/`:
 *
 * - `bauteile-t0-t1.png` (M4-13): je Wandmaterial alle 16 Masken einzeln und ein Probegrundriss (Raum,
 *   T-Stoß, Kreuz, freies Ende) voll und im Schnitt; Böden, Dächer über einem Grundriss (außen und im
 *   Schnitt), Türen und Tor in allen Zuständen in der Wand, Fenster, Zäune, Steg über Wasser, Treppen,
 *   Leiter, Säulen.
 * - `haus-vorschau.png` (M4-13): drei komponierte Häuser (Blockhaus mit Strohdach, Steinhaus mit
 *   Schindeldach, Fachwerk-Gewächshaus mit Glasdach) außen bei Tag, im Schnitt mit Einrichtung und bei
 *   Nacht mit erleuchteten Fenstern; die Spielfigur als Maßstab.
 * - `stationen-t0.png` (M4-05) und `stationen-t1.png` (M4-06): jede Station mit allen Clips, auf Wiese
 *   bei Tag und bei Nacht (nur Emissiv leuchtet), dazu Lager und Herdfeuer.
 *
 * Nacht: Nicht-emissive Pixel werden abgedunkelt und blau verschoben, emissive bleiben voll – so ist
 * sichtbar, dass nur echte Lichtquellen leuchten (docs/ART.md §9 Punkt 9).
 *
 * CLI: `tsx tools/assets/house-preview.ts [--force]`; in `npm run assets` als Schritt „Häuser“.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TRANSPARENT, type Sprite } from '../../assets-src/lib/sprite';
import { flatPalette, paletteIndex } from '../../assets-src/palette';
import { hash2, hashToUnit } from '../../src/engine/rng';
import { hashFiles, listFiles, writeIfChanged } from '../lib/files';
import { GLYPH_H, drawText } from '../lib/font';
import { RgbaImage, hexRgba, type Rgba } from '../lib/image';

const TILE = 16;
const MARGIN = 16;
const GAP = 12;
const LABEL_SCALE = 2;
const LABEL_H = GLYPH_H * LABEL_SCALE + 8;
/** Nachtfaktor und Blauverschiebung der nicht leuchtenden Pixel. */
const NACHT_FAKTOR = 0.28;
const NACHT_BLAU = 0.12;
const PALETTE: readonly Rgba[] = flatPalette().map(hexRgba);
const FARBEN = {
  bogen: hexRgba('#1a1426'),
  text: hexRgba('#f4ecd8'),
  leise: hexRgba('#7e8393'),
} as const;

/** Nachbarbits (Vertrag `_bau.ts`). */
const N = 1;
const O = 2;
const S = 4;
const W = 8;
const MASKEN = 16;

// ---------------------------------------------------------------------------------------------
// Sprites
// ---------------------------------------------------------------------------------------------

export type Bibliothek = ReadonlyMap<string, Sprite>;

async function laden(): Promise<Bibliothek> {
  const module = await Promise.all([
    import('../../assets-src/sprites/bau/waende'),
    import('../../assets-src/sprites/bau/boeden'),
    import('../../assets-src/sprites/bau/daecher'),
    import('../../assets-src/sprites/bau/tueren'),
    import('../../assets-src/sprites/bau/fenster'),
    import('../../assets-src/sprites/bau/zaeune'),
    import('../../assets-src/sprites/bau/zugang'),
    import('../../assets-src/sprites/bau/saeulen'),
    import('../../assets-src/sprites/stationen/t0'),
    import('../../assets-src/sprites/stationen/t1'),
    import('../../assets-src/sprites/stationen/herdfeuer'),
    import('../../assets-src/sprites/lager/lager'),
    import('../../assets-src/sprites/gruenhain_basis/boden_gras'),
    import('../../assets-src/sprites/figuren/spieler_koerper'),
  ]);
  const out = new Map<string, Sprite>();
  for (const m of module) {
    const d = m.default as Sprite | readonly Sprite[];
    for (const s of Array.isArray(d) ? d : [d as Sprite]) out.set(s.id, s);
  }
  return out;
}

export function hole(lib: Bibliothek, id: string): Sprite {
  const s = lib.get(id);
  if (s === undefined) throw new Error(`Haus-Vorschau: Sprite ${id} fehlt`);
  return s;
}

// ---------------------------------------------------------------------------------------------
// Leinwand in Palettenindizes
// ---------------------------------------------------------------------------------------------

class Leinwand {
  readonly index: Uint8Array;
  readonly leuchtet: Uint8Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.index = new Uint8Array(w * h);
    this.leuchtet = new Uint8Array(w * h);
  }

  /** Zeichnet Frame `frame` mit der linken oberen Ecke bei (x, y). */
  blit(s: Sprite, frame: number, x: number, y: number): void {
    const f = s.frames[frame] ?? s.frames[0];
    if (f === undefined) return;
    for (let sy = 0; sy < s.h; sy++) {
      for (let sx = 0; sx < s.w; sx++) {
        const v = f.index[sy * s.w + sx] ?? TRANSPARENT;
        const tx = x + sx;
        const ty = y + sy;
        if (v === TRANSPARENT || tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) continue;
        this.index[ty * this.w + tx] = v;
        this.leuchtet[ty * this.w + tx] = f.emissive[sy * s.w + sx] ?? 0;
      }
    }
  }

  /** Zeichnet mit dem Anker des Sprites bei (x, y). */
  setze(s: Sprite, frame: number, x: number, y: number): void {
    this.blit(s, frame, x - s.anchor[0], y - s.anchor[1]);
  }

  fuelle(x: number, y: number, w: number, h: number, v: number): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (xx >= 0 && yy >= 0 && xx < this.w && yy < this.h) this.index[yy * this.w + xx] = v;
  }

  male(img: RgbaImage, dx: number, dy: number, skala: number, nacht: boolean): void {
    img.drawScaled(dx, dy, this.w, this.h, skala, (x, y) => {
      const p = y * this.w + x;
      const v = this.index[p] ?? TRANSPARENT;
      if (v === TRANSPARENT) return null;
      const c = PALETTE[v - 1] ?? FARBEN.bogen;
      if (!nacht || (this.leuchtet[p] ?? 0) > 0) return c;
      const g = (c[0] + c[1] + c[2]) / 3;
      return [Math.round(c[0] * NACHT_FAKTOR), Math.round(c[1] * NACHT_FAKTOR), Math.round((c[2] * (1 - NACHT_BLAU) + g * NACHT_BLAU) * NACHT_FAKTOR + 18), 255];
    });
  }
}

const WIESE = 'boden_gras';
const WIESE_GEWICHTE = [3, 3, 3, 1];

function wiesenFrame(tx: number, ty: number): number {
  const u = hashToUnit(hash2(tx, ty, 11));
  const summe = WIESE_GEWICHTE.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < WIESE_GEWICHTE.length; i++) {
    acc += (WIESE_GEWICHTE[i] ?? 0) / summe;
    if (u < acc) return i;
  }
  return 0;
}

/** Wasser (ohne Sprite: der Renderer zeichnet es selbst) als ruhige Fläche mit Kräuseln. */
function wasser(l: Leinwand, x: number, y: number, w: number, h: number): void {
  const tief = paletteIndex('wasser.2');
  const hell = paletteIndex('wasser.3');
  l.fuelle(x, y, w, h, tief);
  for (let yy = y + 2; yy < y + h; yy += 5) {
    for (let xx = x + ((yy * 7) % 11); xx + 3 < x + w; xx += 13) l.fuelle(xx, yy, 3, 1, hell);
  }
}

// ---------------------------------------------------------------------------------------------
// Baukarte → Stücke (Vertrag `_bau.ts`)
// ---------------------------------------------------------------------------------------------

/** Ein Tile der Baukarte. */
export interface Feld {
  boden?: string;
  struktur?: string;
  dach?: string;
  wasser?: boolean;
  /** Objekt-Sprite (Station, Lager, Figur) mit Frame. */
  objekt?: { id: string; frame: number; breite?: number };
}

export type Karte = Feld[][];

function karte(w: number, h: number): Karte {
  return Array.from({ length: h }, () => Array.from({ length: w }, (): Feld => ({})));
}

export function feld(k: Karte, x: number, y: number): Feld | undefined {
  return k[y]?.[x];
}

const WANDARTIG = (id: string | undefined): boolean => id !== undefined && /^(wand_|tuer_|tor_|fenster_)/.test(id);
const ZAUNARTIG = (id: string | undefined): boolean => id !== undefined && /^(zaun_|tor_)/.test(id);

function maske(k: Karte, x: number, y: number, verbindet: (f: Feld | undefined) => boolean): number {
  let m = 0;
  if (verbindet(feld(k, x, y - 1))) m |= N;
  if (verbindet(feld(k, x + 1, y))) m |= O;
  if (verbindet(feld(k, x, y + 1))) m |= S;
  if (verbindet(feld(k, x - 1, y))) m |= W;
  return m;
}

/** Art der Dachreihe je Tile: `nord + ⌊(n − 1) / 2⌋` ist der First (Vertrag). */
function dachArt(k: Karte, x: number, y: number): number {
  let oben = y;
  while (feld(k, x, oben - 1)?.dach !== undefined) oben--;
  let unten = y;
  while (feld(k, x, unten + 1)?.dach !== undefined) unten++;
  const first = oben + Math.floor((unten - oben) / 2);
  return y < first ? 2 : y === first ? 1 : 0;
}

export interface Ansicht {
  /** Schnitt: Dach nur Traufrand, Wände unterhalb der obersten Wandreihe auf 4 px. */
  readonly schnitt: boolean;
  /** Tür-/Torzustand 0 zu, 1 halb, 2 offen. */
  readonly tuer: number;
  /** Fenster erleuchtet. */
  readonly licht: boolean;
}

interface Stueck {
  readonly s: Sprite;
  readonly frame: number;
  readonly x: number;
  readonly y: number;
  readonly ebene: 0 | 1 | 2;
}

function stuecke(lib: Bibliothek, k: Karte, a: Ansicht): Stueck[] {
  const out: Stueck[] = [];
  const obersteWand = k.findIndex((reihe) => reihe.some((f) => WANDARTIG(f.struktur)));
  k.forEach((reihe, ty) =>
    reihe.forEach((f, tx) => {
      const ax = tx * TILE + TILE / 2;
      const ay = ty * TILE + TILE - 1;
      if (f.boden !== undefined) {
        const s = hole(lib, `bau_${f.boden}`);
        const m = maske(k, tx, ty, (g) => g?.boden !== undefined && !g.boden.startsWith('steg'));
        const variante = f.boden.startsWith('boden_') ? (hashToUnit(hash2(tx, ty, 5)) < 0.5 ? 0 : MASKEN) : 0;
        const frame = f.boden.startsWith('steg') ? maske(k, tx, ty, (g) => g?.boden === f.boden) : f.boden.startsWith('treppe') || f.boden.startsWith('leiter') || f.boden.startsWith('falltuer') ? 0 : variante + m;
        out.push({ s, frame, x: tx * TILE, y: ty * TILE, ebene: 0 });
      }
      const st = f.struktur;
      if (st !== undefined) {
        const s = hole(lib, `bau_${st}`);
        // Schnitt: alles unterhalb der obersten Wandreihe ist gekappt; volle Wände verbinden nur mit vollen.
        const gekappt = (y: number): boolean => a.schnitt && y > obersteWand;
        if (st.startsWith('wand_')) {
          const m = maske(k, tx, ty, (g) => WANDARTIG(g?.struktur));
          const voll = m & (gekappt(ty + 1) ? ~S : MASKEN - 1);
          const b = hashToUnit(hash2(tx, ty, 7)) < 0.5 ? 0 : MASKEN;
          out.push({ s, frame: gekappt(ty) ? 2 * MASKEN + m : b + voll, x: ax, y: ay, ebene: 1 });
        } else if (st.startsWith('zaun_')) {
          out.push({ s, frame: maske(k, tx, ty, (g) => ZAUNARTIG(g?.struktur)), x: ax, y: ay, ebene: 1 });
        } else if (st.startsWith('tuer_')) {
          const seite = !WANDARTIG(feld(k, tx - 1, ty)?.struktur);
          out.push({ s, frame: gekappt(ty) && !seite ? 6 : (seite ? 3 : 0) + a.tuer, x: ax, y: ay, ebene: 1 });
        } else if (st.startsWith('fenster_')) {
          const seite = !WANDARTIG(feld(k, tx - 1, ty)?.struktur);
          out.push({ s, frame: gekappt(ty) && !seite ? 4 : (seite ? 1 : 0) + (a.licht ? 2 : 0), x: ax, y: ay, ebene: 1 });
        } else if (st === 'tor_holz') {
          // Das Tor belegt dieses und das östliche Tile; der Anker liegt zwischen beiden.
          if (feld(k, tx - 1, ty)?.struktur !== 'tor_holz') out.push({ s, frame: a.tuer, x: ax + TILE / 2, y: ay, ebene: 1 });
        } else if (st === 'tor_holz_seite') {
          if (feld(k, tx, ty + 1)?.struktur !== 'tor_holz_seite') out.push({ s, frame: a.tuer, x: ax, y: ay, ebene: 1 });
        } else out.push({ s, frame: 0, x: ax, y: ay, ebene: 1 });
      }
      if (f.objekt !== undefined) {
        const s = hole(lib, f.objekt.id);
        const breite = f.objekt.breite ?? 1;
        out.push({ s, frame: f.objekt.frame, x: tx * TILE + (breite * TILE) / 2, y: ay, ebene: 1 });
      }
      if (f.dach !== undefined) {
        const s = hole(lib, `bau_${f.dach}`);
        const m = maske(k, tx, ty, (g) => g?.dach !== undefined);
        out.push({ s, frame: (a.schnitt ? 3 : dachArt(k, tx, ty)) * MASKEN + m, x: ax, y: ay, ebene: 2 });
      }
    }),
  );
  return out;
}

/** Malt eine Baukarte: Wiese/Wasser, Böden, y-sortierte Struktur und Objekte, Dach obenauf. */
export function szene(lib: Bibliothek, k: Karte, a: Ansicht): Leinwand {
  const h = k.length;
  const w = k[0]?.length ?? 0;
  const l = new Leinwand(w * TILE, h * TILE);
  const wiese = hole(lib, WIESE);
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      if (feld(k, tx, ty)?.wasser === true) wasser(l, tx * TILE, ty * TILE, TILE, TILE);
      else l.blit(wiese, wiesenFrame(tx, ty), tx * TILE, ty * TILE);
    }
  }
  const alle = stuecke(lib, k, a);
  for (const st of alle.filter((s) => s.ebene === 0)) l.blit(st.s, st.frame, st.x - st.s.anchor[0], st.y - st.s.anchor[1]);
  const aufrecht = alle.filter((s) => s.ebene === 1).sort((p, q) => p.y - q.y || p.x - q.x);
  for (const st of aufrecht) l.setze(st.s, st.frame, st.x, st.y);
  for (const st of alle.filter((s) => s.ebene === 2)) l.setze(st.s, st.frame, st.x, st.y);
  return l;
}

/** Baukarte aus Textzeilen: je Zeichen ein Tile nach `schluessel`. */
export function ausText(zeilen: readonly string[], schluessel: Readonly<Record<string, Feld>>): Karte {
  const k = karte(Math.max(...zeilen.map((z) => z.length)), zeilen.length);
  zeilen.forEach((z, y) =>
    [...z].forEach((c, x) => {
      const f = schluessel[c];
      const ziel = k[y]?.[x];
      if (f !== undefined && ziel !== undefined) Object.assign(ziel, { ...f, objekt: f.objekt === undefined ? undefined : { ...f.objekt } });
    }),
  );
  return k;
}

/** Legt ein Dach über das Rechteck (x0, y0)–(x1, y1) (inklusive). */
export function dachUeber(k: Karte, x0: number, y0: number, x1: number, y1: number, dach: string): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const f = feld(k, x, y);
    if (f !== undefined) f.dach = dach;
  }
}

// ---------------------------------------------------------------------------------------------
// Bogen
// ---------------------------------------------------------------------------------------------

export interface Kachel {
  readonly titel: string;
  readonly bild: Leinwand;
  readonly skala: number;
  readonly nacht?: boolean;
}

export interface Abschnitt {
  readonly titel: string;
  readonly kacheln: readonly Kachel[];
}

export function bogen(titel: string, abschnitte: readonly Abschnitt[], breite = 2000): Uint8Array {
  // Layout: Kacheln fließen je Abschnitt von links nach rechts.
  interface Platz {
    readonly k: Kachel;
    readonly x: number;
    readonly y: number;
  }
  const plaetze: Platz[] = [];
  const kopf: Array<{ text: string; y: number }> = [];
  let y = MARGIN + LABEL_H + 4;
  let maxBreite = 0;
  for (const a of abschnitte) {
    kopf.push({ text: a.titel, y });
    y += LABEL_H;
    let x = MARGIN;
    let zeile = 0;
    for (const k of a.kacheln) {
      const w = k.bild.w * k.skala;
      const h = k.bild.h * k.skala + LABEL_H;
      if (x > MARGIN && x + w > breite - MARGIN) {
        x = MARGIN;
        y += zeile + GAP;
        zeile = 0;
      }
      plaetze.push({ k, x, y });
      x += w + GAP;
      maxBreite = Math.max(maxBreite, x);
      zeile = Math.max(zeile, h);
    }
    y += zeile + GAP * 2;
  }
  const img = new RgbaImage(Math.max(breite, maxBreite + MARGIN), y + MARGIN);
  img.fillRect(0, 0, img.width, img.height, FARBEN.bogen);
  drawText(img, MARGIN, MARGIN, titel, FARBEN.text, LABEL_SCALE);
  for (const k of kopf) drawText(img, MARGIN, k.y, k.text, FARBEN.text, LABEL_SCALE);
  for (const p of plaetze) {
    drawText(img, p.x, p.y, p.k.titel, FARBEN.leise, 1);
    p.k.bild.male(img, p.x, p.y + GLYPH_H + 4, p.k.skala, p.k.nacht === true);
  }
  return img.toPng();
}

/** Ein Sprite-Frame auf Wiese (Zelle plus Rand in ganzen Tiles). */
export function aufWiese(lib: Bibliothek, s: Sprite, frame: number, randTiles = 1): Leinwand {
  const tw = Math.ceil(s.w / TILE) + 2 * randTiles;
  const th = Math.ceil(s.h / TILE) + 2 * randTiles;
  const l = new Leinwand(tw * TILE, th * TILE);
  const wiese = hole(lib, WIESE);
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) l.blit(wiese, wiesenFrame(tx + 40, ty), tx * TILE, ty * TILE);
  l.blit(s, frame, randTiles * TILE, randTiles * TILE);
  return l;
}

// ---------------------------------------------------------------------------------------------
// Bögen
// ---------------------------------------------------------------------------------------------

const WAND_MATERIALIEN = ['palisade', 'holz', 'fachwerk', 'stein'] as const;

/** Probegrundriss: Raum mit Innenwand (T-Stoß), Kreuz, freies Ende, Einzelstück. */
function probeGrundriss(material: string): Karte {
  const w = { struktur: `wand_${material}` };
  return ausText(
    ['..........', '.WWWWWW...', '.W..W.W.W.', '.W..W.WWWW', '.WWWWWW.W.', '........W.', '..W.WW....', '..........'],
    { W: w },
  );
}

function bauteileBogen(lib: Bibliothek): Uint8Array {
  const abschnitte: Abschnitt[] = [];
  for (const mat of WAND_MATERIALIEN) {
    const s = hole(lib, `bau_wand_${mat}`);
    const einzel: Kachel[] = Array.from({ length: MASKEN }, (_, m) => ({ titel: `M${m}`, bild: aufWiese(lib, s, m, 0), skala: 3 }));
    const grund = probeGrundriss(mat);
    abschnitte.push({
      titel: `WAND ${mat.toUpperCase()} - 16 MASKEN (N1 O2 S4 W8), GRUNDRISS VOLL UND IM SCHNITT`,
      kacheln: [
        ...einzel,
        { titel: 'GRUNDRISS', bild: szene(lib, grund, { schnitt: false, tuer: 0, licht: false }), skala: 3 },
        { titel: 'SCHNITT', bild: szene(lib, grund, { schnitt: true, tuer: 0, licht: false }), skala: 3 },
      ],
    });
  }
  // Böden, Dächer
  const bodenKacheln: Kachel[] = ['holz', 'stein', 'lehm'].map((mat) => ({
    titel: `BODEN ${mat.toUpperCase()}`,
    bild: szene(lib, ausText(['.......', '.BBBBB.', '.BBBBB.', '.BBB...', '.BBB.B.', '.......'], { B: { boden: `boden_${mat}` } }), { schnitt: false, tuer: 0, licht: false }),
    skala: 3,
  }));
  abschnitte.push({ titel: 'BOEDEN - 2 FASSUNGEN X 16 MASKEN, KANTEN AN OFFENEN SEITEN', kacheln: bodenKacheln });
  const dachKacheln: Kachel[] = [];
  for (const mat of ['stroh', 'schindel', 'glas']) {
    const k = ausText(['.........', '.WWWWWWW.', '.W.....W.', '.W.....W.', '.W.....W.', '.WWWWWWW.', '.........', '.........'], { W: { struktur: 'wand_holz' } });
    dachUeber(k, 1, 1, 7, 5, `dach_${mat}`);
    const l = ausText(['........', '.WWWWW..', '.W...W..', '.W...WWW', '.W.....W', '.WWWWWWW', '........', '........'], { W: { struktur: 'wand_stein' } });
    dachUeber(l, 1, 1, 5, 5, `dach_${mat}`);
    dachUeber(l, 6, 3, 7, 5, `dach_${mat}`);
    dachKacheln.push(
      { titel: `DACH ${mat.toUpperCase()}`, bild: szene(lib, k, { schnitt: false, tuer: 0, licht: false }), skala: 3 },
      { titel: 'L-GRUNDRISS', bild: szene(lib, l, { schnitt: false, tuer: 0, licht: false }), skala: 3 },
      { titel: 'SCHNITT', bild: szene(lib, k, { schnitt: true, tuer: 0, licht: false }), skala: 3 },
    );
  }
  abschnitte.push({ titel: 'DAECHER - NORD, FIRST, SUED JE SPALTE; SCHNITT = TRAUFRAND', kacheln: dachKacheln });
  // Türen, Tor, Fenster
  const tuerKacheln: Kachel[] = [];
  for (const id of ['tuer_holz', 'tuer_verstaerkt']) {
    for (let t = 0; t < 3; t++) {
      const k = ausText(['.......', '.WWDWW.', '.W...W.', '.D...W.', '.W...W.', '.WWWWW.', '.......'], { W: { struktur: 'wand_holz' }, D: { struktur: id } });
      tuerKacheln.push({ titel: `${id.toUpperCase()} ${['ZU', 'HALB', 'OFFEN'][t] ?? ''}`, bild: szene(lib, k, { schnitt: false, tuer: t, licht: false }), skala: 3 });
    }
  }
  for (let t = 0; t < 3; t++) {
    const k = ausText(['........', '.ZZTTZZ.', '.Z....Z.', '.T....Z.', '.T....Z.', '.ZZZZZZ.', '........'], { Z: { struktur: 'zaun_holz' }, T: { struktur: 'tor_holz' } });
    const f = feld(k, 1, 3);
    const g = feld(k, 1, 4);
    if (f !== undefined && g !== undefined) {
      f.struktur = 'tor_holz_seite';
      g.struktur = 'tor_holz_seite';
    }
    tuerKacheln.push({ titel: `TOR ${['ZU', 'HALB', 'OFFEN'][t] ?? ''}`, bild: szene(lib, k, { schnitt: false, tuer: t, licht: false }), skala: 3 });
  }
  for (const id of ['fenster_offen', 'fenster_glas']) {
    for (const licht of [false, true]) {
      const k = ausText(['.......', '.WWFWW.', '.W...W.', '.F...F.', '.W...W.', '.WWFWW.', '.......'], { W: { struktur: 'wand_fachwerk' }, F: { struktur: id } });
      tuerKacheln.push({ titel: `${id.toUpperCase()}${licht ? ' NACHT' : ''}`, bild: szene(lib, k, { schnitt: false, tuer: 0, licht }), skala: 3, nacht: licht });
    }
  }
  abschnitte.push({ titel: 'TUEREN, TOR, FENSTER - OST-WEST- UND NORD-SUED-WAND', kacheln: tuerKacheln });
  // Zäune, Steg, Treppe, Leiter, Säulen, Falltür
  const rest: Kachel[] = [];
  for (const mat of ['holz', 'stein']) {
    const k = ausText(['........', '.ZZZZZ..', '.Z...Z..', '.Z..ZZZ.', '.ZZZZ.Z.', '......Z.', '........'], { Z: { struktur: `zaun_${mat}` } });
    rest.push({ titel: `ZAUN ${mat.toUpperCase()}`, bild: szene(lib, k, { schnitt: false, tuer: 0, licht: false }), skala: 3 });
  }
  const steg = ausText(['.......', '.......', '...S...', '~~~S~~~', '~~SSSS~', '~~S~~~~', '~~~~~~~'], { S: { boden: 'steg_holz' }, '~': { wasser: true } });
  for (const f of steg.flat()) if (f.boden === 'steg_holz') f.wasser = true;
  rest.push({ titel: 'STEG UEBER WASSER', bild: szene(lib, steg, { schnitt: false, tuer: 0, licht: false }), skala: 3 });
  const treppe = hole(lib, 'bau_treppe_holz');
  for (let i = 0; i < treppe.frames.length; i++) rest.push({ titel: `TREPPE ${['NORD', 'OST', 'SUED', 'WEST'][i] ?? i}`, bild: aufWiese(lib, treppe, i), skala: 3 });
  rest.push({ titel: 'LEITER', bild: aufWiese(lib, hole(lib, 'bau_leiter_holz'), 0), skala: 3 });
  for (const id of ['bau_saeule_holz', 'bau_saeule_stein']) rest.push({ titel: id.toUpperCase(), bild: aufWiese(lib, hole(lib, id), 0), skala: 3 });
  const falltuer = hole(lib, 'bau_falltuer_holz');
  const klappe = hole(lib, 'bau_falltuer_holz_klappe');
  for (let i = 0; i < falltuer.frames.length; i++) rest.push({ titel: `FALLTUER ${i === 0 ? 'ZU' : 'OFFEN'}`, bild: aufWiese(lib, falltuer, i), skala: 3 });
  for (let i = 0; i < klappe.frames.length; i++) {
    const l = aufWiese(lib, falltuer, 1);
    l.blit(klappe, i, TILE, TILE - (klappe.h - TILE));
    rest.push({ titel: `KLAPPE ${i === 0 ? 'HALB' : 'OFFEN'}`, bild: l, skala: 3 });
  }
  abschnitte.push({ titel: 'ZAEUNE, STEG, TREPPE, LEITER, SAEULEN, FALLTUER', kacheln: rest });
  return bogen('BAUTEILE T0-T1 (M4-13) - MODULAR NACH VERTRAG ASSETS-SRC/SPRITES/BAU/_BAU.TS - 3X', abschnitte);
}

/** Einrichtung für Innenansichten. */
const EINRICHTUNG: Readonly<Record<string, Feld>> = {
  W: { struktur: 'wand_holz' },
  S: { struktur: 'wand_stein' },
  F: { struktur: 'wand_fachwerk' },
  P: { struktur: 'wand_palisade' },
  D: { struktur: 'tuer_holz' },
  V: { struktur: 'tuer_verstaerkt' },
  G: { struktur: 'fenster_glas' },
  O: { struktur: 'fenster_offen' },
  Z: { struktur: 'zaun_holz' },
  '#': { struktur: 'saeule_holz' },
};

function hausKarten(): Array<{ titel: string; k: Karte }> {
  const blockhaus = ausText(
    ['............', '.WWWGWWWW...', '.W.......W..', '.W.......G..', '.W.......W..', '.WWWDWGWWW..', '............', '............'],
    EINRICHTUNG,
  );
  dachUeber(blockhaus, 1, 1, 9, 5, 'dach_stroh');
  for (const [x, y, id, br] of [
    [2, 2, 'obj_werkbank', 2],
    [6, 2, 'obj_truhe', 1],
    [7, 2, 'obj_kiste_holz', 1],
    [2, 4, 'obj_herdfeuer', 2],
    [7, 4, 'obj_lagerregal', 2],
  ] as const) {
    const f = feld(blockhaus, x, y);
    if (f !== undefined) f.objekt = { id, frame: 0, breite: br };
  }
  for (let y = 2; y <= 4; y++) for (let x = 2; x <= 8; x++) {
    const f = feld(blockhaus, x, y);
    if (f !== undefined) f.boden = 'boden_holz';
  }
  const steinhaus = ausText(
    ['............', '.SSSSGSSS...', '.S.......S..', '.O.......S..', '.S.......S..', '.SSSVSSGSS..', '.....Z......', '............'],
    EINRICHTUNG,
  );
  dachUeber(steinhaus, 1, 1, 9, 5, 'dach_schindel');
  for (let y = 2; y <= 4; y++) for (let x = 2; x <= 8; x++) {
    const f = feld(steinhaus, x, y);
    if (f !== undefined) f.boden = 'boden_stein';
  }
  for (const [x, y, id, br] of [
    [2, 2, 'obj_schmelzofen', 2],
    [5, 2, 'obj_amboss_bronze', 1],
    [6, 2, 'obj_schleifstein', 2],
    [2, 4, 'obj_werkbank_2', 2],
    [7, 4, 'obj_spinnrad', 1],
  ] as const) {
    const f = feld(steinhaus, x, y);
    if (f !== undefined) f.objekt = { id, frame: 0, breite: br };
  }
  const glashaus = ausText(
    ['............', '.FFFFFFFF...', '.F......F...', '.G......G...', '.F......F...', '.FFFDFFFF...', '............', '............'],
    EINRICHTUNG,
  );
  dachUeber(glashaus, 1, 1, 8, 5, 'dach_glas');
  for (let y = 2; y <= 4; y++) for (let x = 2; x <= 7; x++) {
    const f = feld(glashaus, x, y);
    if (f !== undefined) f.boden = 'boden_lehm';
  }
  for (const [x, y, id, br] of [
    [2, 2, 'obj_trockengestell', 2],
    [5, 2, 'obj_saegebock', 2],
    [2, 4, 'obj_steinmetzbank', 2],
  ] as const) {
    const f = feld(glashaus, x, y);
    if (f !== undefined) f.objekt = { id, frame: 0, breite: br };
  }
  // Spielfigur als Maßstab vor der Tür.
  for (const k of [blockhaus, steinhaus, glashaus]) {
    const f = feld(k, 6, 6);
    if (f !== undefined && f.struktur === undefined) f.objekt = { id: 'spieler_koerper', frame: 0 };
  }
  return [
    { titel: 'BLOCKHAUS, STROHDACH', k: blockhaus },
    { titel: 'STEINHAUS, SCHINDELDACH', k: steinhaus },
    { titel: 'FACHWERK-GEWAECHSHAUS, GLASDACH', k: glashaus },
  ];
}

function hausBogen(lib: Bibliothek): Uint8Array {
  const abschnitte: Abschnitt[] = hausKarten().map(({ titel, k }) => ({
    titel,
    kacheln: [
      { titel: 'AUSSEN TAG', bild: szene(lib, k, { schnitt: false, tuer: 0, licht: false }), skala: 3 },
      { titel: 'SCHNITT (DACH AUS, WAENDE VORN GEKAPPT)', bild: szene(lib, k, { schnitt: true, tuer: 2, licht: false }), skala: 3 },
      { titel: 'NACHT, RAUM ERLEUCHTET', bild: szene(lib, k, { schnitt: false, tuer: 0, licht: true }), skala: 3, nacht: true },
    ],
  }));
  return bogen('HAUS-VORSCHAU (M4-13) - KOMPONIERT WIE DER RENDERER - 3X', abschnitte);
}

const STATIONEN_T0 = ['obj_lagerfeuer', 'obj_werkbank', 'obj_saegebock', 'obj_steinmetzbank', 'obj_trockengestell', 'obj_koehlermeiler', 'obj_lehmofen'] as const;
const STATIONEN_T1 = ['obj_werkbank_2', 'obj_schmelzofen', 'obj_amboss_bronze', 'obj_schleifstein', 'obj_spinnrad'] as const;
const LAGER = ['obj_kiste_holz', 'obj_truhe', 'obj_lagerregal', 'obj_herdfeuer', 'obj_herdfeuer_glutkern'] as const;

function stationsAbschnitte(lib: Bibliothek, ids: readonly string[]): Abschnitt[] {
  return ids.map((id) => {
    const s = hole(lib, id);
    const kacheln: Kachel[] = [];
    for (const [clip, c] of Object.entries(s.clips)) {
      const frames = [...new Set(c.frames)];
      frames.forEach((f, i) => kacheln.push({ titel: `${clip.toUpperCase()} ${i}`, bild: aufWiese(lib, s, f, 0), skala: 3 }));
      const erster = frames[0];
      if (erster !== undefined && s.frames[erster]?.emissive.some((v) => v > 0) === true) kacheln.push({ titel: `${clip.toUpperCase()} NACHT`, bild: aufWiese(lib, s, erster, 0), skala: 3, nacht: true });
    }
    if (Object.keys(s.clips).length === 0) kacheln.push({ titel: 'FRAME 0', bild: aufWiese(lib, s, 0, 0), skala: 3 });
    return { titel: `${id.toUpperCase()} - ${s.w}X${s.h}, ANKER ${s.anchor[0]},${s.anchor[1]}`, kacheln };
  });
}

/** Namen der Bögen dieses Schritts. */
export const HAUS_BOEGEN = ['bauteile-t0-t1.png', 'haus-vorschau.png', 'stationen-t0.png', 'stationen-t1.png'] as const;

const EINGABEN = [
  'assets-src/sprites/bau',
  'assets-src/sprites/stationen',
  'assets-src/sprites/lager',
  'assets-src/sprites/platzierbar',
  'assets-src/sprites/icons/_icon.ts',
  'assets-src/sprites/gruenhain_basis',
  'assets-src/sprites/figuren',
  'assets-src/lib',
  'assets-src/palette.ts',
  'src/engine/rng.ts',
  'tools/lib',
  'tools/assets/house-preview.ts',
] as const;

function eingabeHash(root: string): string {
  const dateien = EINGABEN.flatMap((e) => {
    const pfad = join(root, e);
    return e.endsWith('.ts') ? (existsSync(pfad) ? [pfad] : []) : listFiles(pfad);
  });
  return hashFiles(root, dateien);
}

/**
 * Schreibt die Haus- und Stationsbögen; „unverändert“, wenn der Quell-Hash seit dem letzten Lauf gleich
 * ist und alle Bögen existieren (Cache `<sheets>/../cache/haeuser.json`, `--force` ignoriert ihn).
 */
export async function housePreviewStep(outDir: string, root = process.cwd()): Promise<string> {
  const cacheDatei = join(dirname(outDir), 'cache', 'haeuser.json');
  const hash = eingabeHash(root);
  const force = process.argv.includes('--force');
  if (!force && existsSync(cacheDatei) && HAUS_BOEGEN.every((n) => existsSync(join(outDir, n)))) {
    try {
      if ((JSON.parse(readFileSync(cacheDatei, 'utf8')) as { hash?: unknown }).hash === hash) return 'unverändert';
    } catch {
      // Beschädigter Cache: neu erzeugen.
    }
  }
  const lib = await laden();
  const boegen: Readonly<Record<(typeof HAUS_BOEGEN)[number], () => Uint8Array>> = {
    'bauteile-t0-t1.png': () => bauteileBogen(lib),
    'haus-vorschau.png': () => hausBogen(lib),
    'stationen-t0.png': () => bogen('STATIONEN T0 (M4-05) - ALLE CLIPS, TAG UND NACHT - 3X', stationsAbschnitte(lib, STATIONEN_T0)),
    'stationen-t1.png': () => bogen('STATIONEN T1 (M4-06), LAGER (M4-21), HERDFEUER (M4-20) - 3X', stationsAbschnitte(lib, [...STATIONEN_T1, ...LAGER])),
  };
  for (const name of HAUS_BOEGEN) writeIfChanged(join(outDir, name), boegen[name]());
  writeIfChanged(cacheDatei, `${JSON.stringify({ hash, files: [...HAUS_BOEGEN] })}\n`);
  return HAUS_BOEGEN.join(', ');
}

const isMain = import.meta.url === `file://${process.argv[1] ?? ''}`;
if (isMain) console.info(`house-preview: ${await housePreviewStep(join(process.cwd(), 'tools/out/sheets'))}`);
