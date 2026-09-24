/**
 * Blob-Generator (M2-16 … M2-18, docs/ART.md §3, docs/WORLD.md §7): setzt die 47 Blob-Frames eines
 * Terrain-Tilesets aus handgezeichneten Quellstücken zusammen, statt jeden Frame zu malen.
 *
 * **Quellstücke** je Terrain:
 * - Kantenstücke: je Seite (n, o, s, w) ein oder mehrere Profile – der Einzug der Kante in px entlang
 *   der 16 Pixel einer Seite (Zungen, Buchten, Schollen). Die ersten und letzten `FUGE` Werte sind bei
 *   allen Profilen einer Seite gleich: So stoßen Kanten verschiedener Frames nahtlos aneinander, und
 *   die Mitte darf je Frame anders verlaufen.
 * - Ecken: Radien der Außenecken und Formen (Superellipsen-Exponenten) der Innenecken, je Ecke per
 *   Hash gewählt. Die Innenecke trifft den Tile-Rand genau dort, wo die Kanten der Nachbarkacheln enden.
 * - Füllung: die handgezeichneten Vollfeld-Varianten (Frames 47+). In Kantenframes erscheinen deren
 *   Motive nur, wenn sie ganz im Innern liegen (`fuellung: 'motive'`), oder die Textur läuft durch und
 *   wird von der Kante geschnitten (`'textur'`, Pflaster, Krusten).
 * - Färbung: eine Funktion je Terrain färbt Pixel nach Seite und Tiefe (Saum, Kontur, Lippe in
 *   3/4-Sicht: Südkanten zeigen die Front, Nordkanten die Oberkante), Deko setzt Halme, Krümel, Glanz.
 *
 * **Geometrie.** Jede Kachel ist ein Feld aus vorzeichenbehafteten Abständen zur Terrainkante: Seiten
 * ohne verbundenen Nachbarn ziehen die Kante nach Profil ein, Außenecken werden gerundet, Innenecken
 * (beide Seiten verbunden, Ecke nicht) schneiden eine Kerbe. Innen ≥ 0, außen < 0; `tiefe` zählt die
 * Pixelreihen ab der Kante (0 = erste Reihe). Der Abstand hängt nur von lokalen Koordinaten und den
 * Profilenden ab – deshalb passen alle Frames in jeder Anordnung zusammen.
 *
 * Arten: `ueberlagerung` (außen transparent), `saum` (deckend; außen die Uferbank, Maske 0 = reine
 * Bank) und `kante` (nur außen gezeichnet: Klippenrand über dem Boden der Plateaukachel).
 * Nach dem Zusammensetzen entfernt `bereinige` verwaiste Einzelpixel (docs/ART.md §2.2).
 */
import { hashCombine } from '../../src/engine/rng';
import { BLOB_MASKS, MASKE_VOLL, NB } from '../../src/world/autotile';
import { PixelCanvas } from './raster';
import { MATERIAL_BITS, TRANSPARENT, resolveColor, spriteFromPixels, type MaterialFlag, type PixelFrameInput, type Sprite, type SpriteFrame } from './sprite';

/** Kachelkante in px. */
export const KACHEL = 16;
const LETZTE = KACHEL - 1;
/** Pixel am Anfang und Ende eines Profils, die bei allen Profilen einer Seite gleich sind. */
export const FUGE = 3;
/** Größter Einzug eines Profils in px. */
export const MAX_EINZUG = 7;
/** „Keine Kante in Reichweite“. */
export const WEIT = 99;

export type Seite = 'n' | 'o' | 's' | 'w';
/** Seiten in Vorrangreihenfolge bei Gleichstand (die Front wickelt sich um die Ecke). */
export const SEITEN: readonly Seite[] = ['s', 'n', 'w', 'o'];

/** Kantenstücke und Ecken eines Terrains. */
export interface KantenGeometrie {
  /** Profile je Seite (16 Werte: Einzug in px; n/s entlang x, w/o entlang y). */
  readonly profile: Readonly<Record<Seite, readonly (readonly number[])[]>>;
  /** Radien der Außenecken in px (Auswahl je Ecke per Hash). */
  readonly eckenRadien: readonly number[];
  /** Exponenten der Innenecken (2 = Viertelkreis, < 2 spitzer, > 2 kantiger). */
  readonly innenFormen: readonly number[];
}

/** Prüft Profile (Länge, Wertebereich, gleiche Fugen) – liefert Fehlertexte. */
export function pruefeGeometrie(geo: KantenGeometrie): string[] {
  const fehler: string[] = [];
  for (const s of SEITEN) {
    const profile = geo.profile[s];
    const erstes = profile[0];
    if (erstes === undefined) {
      fehler.push(`Seite ${s}: kein Profil`);
      continue;
    }
    profile.forEach((p, i) => {
      if (p.length !== KACHEL) fehler.push(`Seite ${s} Profil ${i}: ${p.length} Werte statt ${KACHEL}`);
      if (p.some((v) => !Number.isInteger(v) || v < 0 || v > MAX_EINZUG)) fehler.push(`Seite ${s} Profil ${i}: Werte außerhalb 0…${MAX_EINZUG}`);
      for (let k = 0; k < FUGE; k++) {
        if (p[k] !== erstes[k] || p[LETZTE - k] !== erstes[LETZTE - k]) fehler.push(`Seite ${s} Profil ${i}: Fuge weicht bei ${k} ab`);
      }
    });
    if (Math.abs((erstes[0] ?? 0) - (erstes[LETZTE] ?? 0)) > 1) fehler.push(`Seite ${s}: Profilenden springen um mehr als 1 px`);
  }
  if (geo.eckenRadien.length === 0 || geo.innenFormen.length === 0) fehler.push('Ecken: Radien und Innenformen nötig');
  return fehler;
}

/** Abstandsfeld einer Blob-Maske. */
export interface BlobFeld {
  readonly maske: number;
  /** Vorzeichenbehafteter Abstand zur Kante je Pixel (≥ 0 innen). */
  readonly abstand: Float32Array;
  /** Seite der nächsten Kante je Pixel (Index in `SEITEN`, −1 = keine). */
  readonly seite: Int8Array;
}

function waehle<T>(liste: readonly T[], maske: number, wahl: number, salz: number): T {
  const v = liste[hashCombine(hashCombine(maske, wahl), salz) % liste.length];
  if (v === undefined) throw new Error('blob: leere Auswahlliste');
  return v;
}

const SEITE_INDEX: Readonly<Record<Seite, number>> = { s: 0, n: 1, w: 2, o: 3 };

/** Profilwert (Einzug) an Position i. */
function wert(p: readonly number[], i: number): number {
  return p[Math.max(0, Math.min(LETZTE, i))] ?? 0;
}

/** Abstandsfeld für Maske `maske`; `wahl` streut die Profil- und Eckenwahl zusätzlich. */
export function blobFeld(maske: number, geo: KantenGeometrie, wahl = 0): BlobFeld {
  const offen = (bit: number): boolean => (maske & bit) === 0;
  const p = {
    n: waehle(geo.profile.n, maske, wahl, 1),
    s: waehle(geo.profile.s, maske, wahl, 2),
    w: waehle(geo.profile.w, maske, wahl, 3),
    o: waehle(geo.profile.o, maske, wahl, 4),
  };
  // Fugenwerte (bei allen Profilen einer Seite gleich) für die Innenecken.
  const f = { n: geo.profile.n[0] ?? [], s: geo.profile.s[0] ?? [], w: geo.profile.w[0] ?? [], o: geo.profile.o[0] ?? [] };
  const ecken: Array<{ a: Seite; b: Seite; r: number }> = [];
  const paar = (a: Seite, b: Seite, bitA: number, bitB: number, salz: number): void => {
    if (offen(bitA) && offen(bitB)) ecken.push({ a, b, r: waehle(geo.eckenRadien, maske, wahl, salz) });
  };
  paar('n', 'w', NB.N, NB.W, 11);
  paar('n', 'o', NB.N, NB.E, 12);
  paar('s', 'w', NB.S, NB.W, 13);
  paar('s', 'o', NB.S, NB.E, 14);
  interface Kerbe {
    readonly oben: boolean;
    readonly links: boolean;
    readonly rx: number;
    readonly ry: number;
    readonly e: number;
  }
  const kerben: Kerbe[] = [];
  const kerbe = (diag: number, a: number, b: number, oben: boolean, links: boolean, rx: number, ry: number, salz: number): void => {
    if (!offen(a) && !offen(b) && offen(diag)) kerben.push({ oben, links, rx: Math.max(1, rx), ry: Math.max(1, ry), e: waehle(geo.innenFormen, maske, wahl, salz) });
  };
  kerbe(NB.NW, NB.N, NB.W, true, true, wert(f.w, LETZTE), wert(f.n, LETZTE), 21);
  kerbe(NB.NE, NB.N, NB.E, true, false, wert(f.o, LETZTE), wert(f.n, 0), 22);
  kerbe(NB.SW, NB.S, NB.W, false, true, wert(f.w, 0), wert(f.s, LETZTE), 23);
  kerbe(NB.SE, NB.S, NB.E, false, false, wert(f.o, 0), wert(f.s, 0), 24);

  const abstand = new Float32Array(KACHEL * KACHEL);
  const seite = new Int8Array(KACHEL * KACHEL);
  for (let y = 0; y < KACHEL; y++) {
    for (let x = 0; x < KACHEL; x++) {
      const seiten: Record<Seite, number> = {
        s: offen(NB.S) ? LETZTE - wert(p.s, x) - y : WEIT,
        n: offen(NB.N) ? y - wert(p.n, x) : WEIT,
        w: offen(NB.W) ? x - wert(p.w, y) : WEIT,
        o: offen(NB.E) ? LETZTE - wert(p.o, y) - x : WEIT,
      };
      let best = WEIT;
      let bs = -1;
      const nimm = (v: number, s: Seite): void => {
        if (v < best) {
          best = v;
          bs = SEITE_INDEX[s];
        }
      };
      for (const s of SEITEN) nimm(seiten[s], s);
      for (const e of ecken) {
        const fa = seiten[e.a];
        const fb = seiten[e.b];
        if (fa < e.r && fb < e.r) {
          const da = e.r - fa;
          const db = e.r - fb;
          nimm(e.r - Math.hypot(da, db), da >= db ? e.a : e.b);
        }
      }
      for (const k of kerben) {
        const u = k.links ? x + 0.5 : KACHEL - x - 0.5;
        const v = k.oben ? y + 0.5 : KACHEL - y - 0.5;
        const s = ((u / k.rx) ** k.e + (v / k.ry) ** k.e) ** (1 / k.e) - 1;
        const wertK = s * ((k.rx + k.ry) / 2) - 0.5;
        const senkrecht = v / k.ry > u / k.rx;
        nimm(wertK, senkrecht ? (k.oben ? 'n' : 's') : k.links ? 'w' : 'o');
      }
      abstand[y * KACHEL + x] = best;
      seite[y * KACHEL + x] = bs;
    }
  }
  return { maske, abstand, seite };
}

/** Ob Pixel (x, y) im Terrain liegt. */
export function istInnen(feld: BlobFeld, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x > LETZTE || y > LETZTE) return false;
  return (feld.abstand[y * KACHEL + x] ?? WEIT) >= 0;
}

/** Tiefe ab der Kante: innen 0 = erste Reihe an der Kante, außen 0 = erste Reihe davor. */
export function tiefeVon(abstand: number): number {
  if (abstand >= WEIT) return WEIT;
  return abstand >= 0 ? Math.floor(abstand) : Math.max(0, Math.ceil(-abstand) - 1);
}

/** Seite der nächsten Kante an (x, y) oder `null`. */
export function seiteVon(feld: BlobFeld, x: number, y: number): Seite | null {
  const i = feld.seite[y * KACHEL + x] ?? -1;
  return i < 0 ? null : (SEITEN[i] ?? null);
}

// ---------------------------------------------------------------------------------------------
// Färbung und Zusammensetzen
// ---------------------------------------------------------------------------------------------

/** Ein Pixel, wie ihn die Färbung sieht. */
export interface StilPixel {
  readonly x: number;
  readonly y: number;
  readonly innen: boolean;
  readonly tiefe: number;
  readonly seite: Seite | null;
  /** Position entlang der Kante (x an Nord-/Südkanten, y an West-/Ostkanten). */
  readonly entlang: number;
  readonly maske: number;
  /** Palettenindex der Füllung an dieser Stelle (0 = keine). */
  readonly fuellung: number;
}

/** Farbe (`rampe.stufe[*]`), `null` = transparent, `undefined` = Füllung behalten bzw. außen leer. */
export type Faerbung = (p: StilPixel) => string | null | undefined;
/** Nacharbeit je Frame (Halme, Krümel …) mit Zugriff auf Feld und Zeichenfläche. */
export type Deko = (k: PixelCanvas, feld: BlobFeld, maske: number) => void;

export type BlobArt = 'ueberlagerung' | 'saum' | 'kante';

export interface BlobTilesetQuelle {
  readonly id: string;
  readonly group: string;
  readonly art: BlobArt;
  readonly geometrie: KantenGeometrie;
  /** Handgezeichnete Vollfeld-Varianten (Frames 47+); Variante 0 ist zugleich der Vollfeld-Blob. */
  readonly varianten: readonly SpriteFrame[];
  /** Varianten, deren Motive die Kantenframes füllen (Standard: alle). */
  readonly ruhig?: readonly number[];
  /** Grundfarbe der Varianten (Motive = alles, was davon abweicht). */
  readonly basis: string;
  readonly fuellung: 'motive' | 'textur';
  /** Mindesttiefe, ab der ein Motiv im Kantenframe stehen bleibt (Standard 2). */
  readonly motivAbstand?: number;
  readonly faerbung: Faerbung;
  readonly deko?: Deko;
  /** Materialflags je Palettenfarbe (`nass` für Schlamm, `eis` für Eis …). */
  readonly material?: Readonly<Partial<Record<MaterialFlag, readonly string[]>>>;
  /** Begründung für gewollte Einzelpixel (Funken, Glanzpunkte). */
  readonly einzelpixel?: string;
  /** Streuung der Profil-/Eckenwahl. */
  readonly wahl?: number;
}

const farbCache = new Map<string, { index: number; emissive: boolean }>();

/** Palettenindex und Emissiv einer Farbreferenz (wirft bei Nicht-Palettenfarben). */
export function farbe(ref: string): { index: number; emissive: boolean } {
  const c = farbCache.get(ref);
  if (c !== undefined) return c;
  const r = resolveColor(ref);
  if ('error' in r) throw new Error(`blob: ${r.error}`);
  farbCache.set(ref, r);
  return r;
}

/** Setzt `ref` (mit `*` emissiv) auf (x, y). */
export function male(k: PixelCanvas, x: number, y: number, ref: string): void {
  const c = farbe(ref);
  k.set(x, y, c.index, { emissive: c.emissive });
}

/** Leinwand aus einem geparsten Frame. */
export function leinwandAus(f: SpriteFrame): PixelCanvas {
  const k = new PixelCanvas(KACHEL, KACHEL);
  k.index.set(f.index);
  k.emissive.set(f.emissive);
  k.material.set(f.material);
  return k;
}

const NACHBARN8: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/** Motive einer Variante: 8-zusammenhängende Pixelgruppen, die nicht die Grundfarbe tragen. */
export function motive(f: SpriteFrame, basisIndex: number): number[][] {
  const gesehen = new Uint8Array(KACHEL * KACHEL);
  const out: number[][] = [];
  for (let p = 0; p < KACHEL * KACHEL; p++) {
    const v = f.index[p] ?? TRANSPARENT;
    if (gesehen[p] === 1 || v === TRANSPARENT || v === basisIndex) continue;
    const gruppe: number[] = [];
    const stapel = [p];
    gesehen[p] = 1;
    while (stapel.length > 0) {
      const q = stapel.pop() ?? 0;
      gruppe.push(q);
      const qx = q % KACHEL;
      const qy = Math.floor(q / KACHEL);
      for (const [dx, dy] of NACHBARN8) {
        const nx = qx + dx;
        const ny = qy + dy;
        if (nx < 0 || ny < 0 || nx > LETZTE || ny > LETZTE) continue;
        const n = ny * KACHEL + nx;
        const nv = f.index[n] ?? TRANSPARENT;
        if (gesehen[n] === 1 || nv === TRANSPARENT || nv === basisIndex) continue;
        gesehen[n] = 1;
        stapel.push(n);
      }
    }
    out.push(gruppe);
  }
  return out;
}

/**
 * Entfernt verwaiste Einzelpixel (Regel des Paletten-Validators, docs/ART.md §2.2): ein Pixel ohne
 * gleichfarbigen Nachbarn, der höchstens einen deckenden Nachbarn hat, fällt weg; einer, dessen Farbe
 * im Frame nur einmal vorkommt, nimmt die häufigste Nachbarfarbe an. Wiederholt bis zur Ruhe.
 */
export function bereinige(k: PixelCanvas): void {
  for (let runde = 0; runde < KACHEL; runde++) {
    let geaendert = false;
    const anzahl = new Map<number, number>();
    for (const v of k.index) if (v !== TRANSPARENT) anzahl.set(v, (anzahl.get(v) ?? 0) + 1);
    for (let y = 0; y < k.h; y++) {
      for (let x = 0; x < k.w; x++) {
        const v = k.get(x, y);
        if (v === TRANSPARENT) continue;
        let gleich = 0;
        let deckend = 0;
        const haeufig = new Map<number, number>();
        for (const [dx, dy] of NACHBARN8) {
          const n = k.get(x + dx, y + dy);
          if (n === TRANSPARENT) continue;
          deckend++;
          if (n === v) gleich++;
          haeufig.set(n, (haeufig.get(n) ?? 0) + 1);
        }
        if (gleich > 0) continue;
        if (deckend <= 1) {
          k.clear(x, y);
          geaendert = true;
        } else if (anzahl.get(v) === 1) {
          const [ersatz] = [...haeufig.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] ?? [v];
          const p = y * k.w + x;
          const nachbar = NACHBARN8.map(([dx, dy]) => (y + dy) * k.w + x + dx).find((q) => k.index[q] === ersatz);
          k.index[p] = ersatz;
          k.emissive[p] = nachbar === undefined ? 0 : (k.emissive[nachbar] ?? 0);
          geaendert = true;
        }
      }
    }
    if (!geaendert) return;
  }
}

function materialAnwenden(k: PixelCanvas, material: BlobTilesetQuelle['material']): void {
  if (material === undefined) return;
  const bits = new Map<number, number>();
  for (const [flag, refs] of Object.entries(material) as Array<[MaterialFlag, readonly string[]]>) {
    for (const ref of refs) {
      const i = farbe(ref).index;
      bits.set(i, (bits.get(i) ?? 0) | MATERIAL_BITS[flag]);
    }
  }
  k.index.forEach((v, p) => {
    if (v !== TRANSPARENT) k.material[p] = bits.get(v) ?? 0;
  });
}

/** Füllung eines Kantenframes: Grundfarbe plus die Motive der Quelle, die ganz innen liegen. */
function fuellungFuer(q: BlobTilesetQuelle, feld: BlobFeld, quelle: SpriteFrame): PixelCanvas {
  const k = leinwandAus(quelle);
  if (q.fuellung === 'textur') return k;
  const basis = farbe(q.basis);
  const mindest = q.motivAbstand ?? 2;
  for (const gruppe of motive(quelle, basis.index)) {
    const bleibt = gruppe.every((p) => (feld.abstand[p] ?? -WEIT) >= mindest);
    if (bleibt) continue;
    for (const p of gruppe) {
      k.index[p] = basis.index;
      k.emissive[p] = basis.emissive ? 1 : 0;
      k.material[p] = 0;
    }
  }
  return k;
}

/** Ein Blob-Frame (Maske `maske`) nach den Regeln der Quelle. */
export function blobFrame(q: BlobTilesetQuelle, maske: number): PixelFrameInput {
  const voll = (maske & MASKE_VOLL) === MASKE_VOLL;
  const v0 = q.varianten[0];
  if (v0 === undefined) throw new Error(`${q.id}: keine Vollfeld-Variante`);
  if (voll && q.art !== 'kante') {
    const k = leinwandAus(v0);
    materialAnwenden(k, q.material);
    return k.toFrame();
  }
  const feld = blobFeld(maske, q.geometrie, q.wahl ?? 0);
  // Saum ohne verbundene Nachbarn: reine Uferbank (kein Innenbereich).
  const nurBank = q.art === 'saum' && maske === 0;
  const ruhig = q.ruhig ?? q.varianten.map((_, i) => i);
  const quelleIndex = ruhig[hashCombine(maske, q.wahl ?? 0) % ruhig.length] ?? 0;
  const quelle = q.varianten[quelleIndex] ?? v0;
  const fuellung = q.art === 'kante' ? new PixelCanvas(KACHEL, KACHEL) : fuellungFuer(q, feld, quelle);
  const k = new PixelCanvas(KACHEL, KACHEL);
  for (let y = 0; y < KACHEL; y++) {
    for (let x = 0; x < KACHEL; x++) {
      const p = y * KACHEL + x;
      const a = nurBank ? -WEIT : (feld.abstand[p] ?? WEIT);
      const innen = a >= 0;
      const seite = nurBank ? null : seiteVon(feld, x, y);
      const pixel: StilPixel = {
        x,
        y,
        innen,
        tiefe: nurBank ? WEIT : tiefeVon(a),
        seite,
        entlang: seite === 'n' || seite === 's' ? x : y,
        maske,
        fuellung: fuellung.index[p] ?? TRANSPARENT,
      };
      const r = q.faerbung(pixel);
      if (r === null) continue;
      if (r !== undefined) {
        male(k, x, y, r);
        continue;
      }
      const behalten = q.art === 'kante' ? false : innen || q.art === 'saum';
      if (behalten) {
        k.index[p] = fuellung.index[p] ?? TRANSPARENT;
        k.emissive[p] = fuellung.emissive[p] ?? 0;
      }
    }
  }
  q.deko?.(k, feld, maske);
  bereinige(k);
  materialAnwenden(k, q.material);
  return k.toFrame();
}

/**
 * Tileset-Sprite `tileset_<terrain>`: Frames 0–46 nach `BLOB_MASKS`, danach die Vollfeld-Varianten
 * (docs/WORLD.md §7). Wirft, wenn die Kantenstücke nicht zusammenpassen.
 */
export function blobTileset(q: BlobTilesetQuelle): Sprite {
  const fehler = pruefeGeometrie(q.geometrie);
  if (fehler.length > 0) throw new Error(`${q.id}: ${fehler.join('; ')}`);
  const frames: PixelFrameInput[] = BLOB_MASKS.map((m) => blobFrame(q, m));
  for (const v of q.varianten) {
    const k = leinwandAus(v);
    materialAnwenden(k, q.material);
    frames.push(k.toFrame());
  }
  return spriteFromPixels(
    {
      id: q.id,
      group: q.group,
      size: [KACHEL, KACHEL],
      anchor: [0, 0],
      hoehe: 'flach',
      ...(q.einzelpixel === undefined ? {} : { einzelpixel: q.einzelpixel }),
    },
    frames,
  );
}
