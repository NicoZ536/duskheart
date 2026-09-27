/**
 * Baukasten der modularen Bauteil-Sprites (M4-13; docs/SPIEL.md §8 „Bauteile modular `bau_<id>`“,
 * MASTERPROMPT §4.4 „Gebäude modular aus Tiles“, §16.1 Ebenen). Die Stücke werden nicht Frame für Frame
 * gemalt, sondern aus handgezeichneten Quellmustern je Material zusammengesetzt (wie die Klippen,
 * docs/ART.md §12): Kappe (Oberseite), Front (16 px sichtbare Wand), Pfosten (Ecke, Ende), Knoten
 * (Kreuzung von oben), Dachflächen, Dielen. Ein Muster ist waagerecht (und bei Flächen senkrecht)
 * kachelbar, deshalb passen alle Frames in jeder Anordnung zusammen.
 *
 * ## Vertrag für Simulation und Renderer (verbindlich)
 * **Nachbarmaske** `maske = n·1 + o·2 + s·4 + w·8` (Nord, Ost, Süd, West: Nachbar-Tile trägt ein
 * verbindendes Teil derselben Art – Wände verbinden mit Wänden, Türen, Toren und Fenstern; Zäune mit
 * Zäunen und Toren; Dächer mit Dächern jedes Materials; Böden mit Böden jedes Materials; Stege mit
 * Stegen).
 *
 * **Aufrechte Teile** (Ebene Struktur, y-sortiert wie Welt-Objekte): Zelle 16×32 (Tor 32×32 bzw. 16×48),
 * Anker `[8, 31]` = Mitte der untersten Tile-Zeile – platziert wie `objectAnchor` (Fuß auf der letzten
 * Pixelzeile des Tiles, **ohne** Zufallsversatz). Die unteren 16 Zeilen der Zelle decken die Standfläche,
 * die oberen 16 die Wandhöhe darüber.
 * - Wände `bau_wand_<material>` (`palisade`, `holz`, `fachwerk`, `stein`): dünne Wand im Band
 *   `BAND_VON`…`BAND_BIS` (y 5–10, bei Nord-Süd-Läufen x 5–10) mit 16 px Front. Frames `0–15` =
 *   Maske (Fassung A), `16–31` = Fassung B (`16 + maske`; Wahl per Tile-Hash gegen das Raster),
 *   `32–47` = Schnitt (`32 + maske`, auf 4 px gekappte Wand für den Blick ins Haus, M4-27). Clips `a`,
 *   `b`, `schnitt` sind dieselben Tabellen (Clip-Position = Maske).
 *   Die Wandfront einer Wand auf Tile (tx, ty) reicht von Welt-y `ty·16 − 5` (Oberkante) bis
 *   `ty·16 + 10` (Fußzeile); südlich davon bleiben 5 px Boden des Tiles sichtbar. Wandobjekte hängen
 *   auf dieser Front (M4-19).
 * - Zäune `bau_zaun_<material>` (`holz`, `stein`): Frames = Maske (0–15), Höhe 12 bzw. 8 px.
 * - Türen `bau_tuer_<id>` (`holz`, `verstaerkt`): Frames 0–2 zu/halb/offen in einer Ost-West-Wand,
 *   3–5 in einer Nord-Süd-Wand, 6 Schnitt (Ost-West, auf 4 px gekappt); Clips `zu`, `offen`,
 *   `oeffnen`, `schliessen`, `…_seite` und `schnitt`.
 * - Tor `bau_tor_holz` (32×32, Anker `[16, 31]`, 2 Tiles Ost-West) und `bau_tor_holz_seite` (16×48,
 *   Anker `[8, 47]`, 2 Tiles Nord-Süd; Anker auf dem südlichen Tile): Frames zu/halb/offen, Clips wie
 *   bei Türen.
 * - Fenster `bau_fenster_<id>` (`offen`, `glas`): Frame 0 in einer Ost-West-Wand, 1 in einer
 *   Nord-Süd-Wand, 2/3 dieselben mit erleuchtetem Raum dahinter (emissiv, Raum mit Licht bei Nacht),
 *   4 Schnitt (Ost-West); Clips `sued`, `seite`, `sued_licht`, `seite_licht`, `schnitt`.
 * - Schnitt (Blick ins Haus, M4-27): Wände vor dem Spieler zeigen Frame `32 + maske`, Türen und
 *   Fenster in Ost-West-Wänden ihren Clip `schnitt`, das Dach den Clip `schnitt`. Volle und gekappte
 *   Wände verbinden sich nicht: die Maske einer vollen Wand zählt nur volle Nachbarn (sonst endet ihr
 *   Arm im Leeren), eine gekappte Wand zählt alle.
 * - Säulen `bau_saeule_<material>` (`holz`, `stein`): ein Frame, freistehend.
 *
 * **Dach** `bau_dach_<material>` (`stroh`, `schindel`, `glas`; Ebene Dach, über allen Objekten, Pixel mit
 * Materialflag `dach` für die Kreis-Ausblendung): Zelle 16×32, Anker `[8, 31]` wie die Wände, die
 * Dachfläche liegt auf Wandhöhe (Zeilen 0–15, Traufe bis Zeile 13). Dachtiles liegen auf allen Tiles
 * des Hauses einschließlich der Wand-Tiles; offene Seiten enden mit Überstand 2 px über dem Wandband.
 * Frames `art · 16 + maske` mit `art` 0 = `sued` (Vorderseite, zur Kamera), 1 = `first` (Firstreihe),
 * 2 = `nord` (Rückseite), 3 = `schnitt` (nur der Rand an Rückseite und Giebeln, für den Blick ins Haus;
 * innen und vorn leer).
 * Empfohlen: je Nord-Süd-Spalte eines Dachs liegt der First auf der Reihe `nord + ⌊(n − 1) / 2⌋`, darüber
 * `nord`, darunter `sued`.
 *
 * **Bodenstücke** (Ebene Boden, vor allen Objekten gezeichnet, wie Bodentiles): Anker `[0, 0]` = linke
 * obere Ecke der Standfläche.
 * - Böden `bau_boden_<material>` (`holz`, `stein`, `lehm`): 16×16, Frames `fassung · 16 + maske`
 *   (2 Fassungen), offene Seiten mit Kante.
 * - Steg `bau_steg_holz`: 16×24, Frames = Maske; an offener Südseite ragen Stirnbalken und Pfähle
 *   8 px ins Tile darunter (Wasser).
 * - Falltür `bau_falltuer_holz`: 16×16, Frames zu/offen (Schacht mit Leiter), dazu die aufgestellte
 *   Klappe `bau_falltuer_holz_klappe` (aufrecht, 16×32, Anker `[8, 31]`, Frames halb/offen).
 * - Treppe `bau_treppe_holz`: 16×16 auf dem Wand-Tile einer Höhenstufe (wie Klippentreppen), Frames
 *   0–3 = Aufstieg nach Nord, Ost, Süd, West.
 * - Leiter `bau_leiter_holz`: 16×20 an einer 16-px-Wand (Klippe, Schacht), Anker `[0, 4]`: die Holme
 *   ragen 4 px über die Oberkante.
 *
 * **Licht und Normalen:** Alles, was an Nachbarn anschließt, ist `flach` – der Normalengenerator
 * behandelt den Zellrand als Höhe 0, eine Relief-Höhe am Rand zöge an jeder Tile-Grenze eine Kante ins
 * Licht. Die Formschattierung (Oberseiten hell, Fugen und Fuß dunkel) steht im Albedo; die Höhe über
 * Grund liefert der Renderer aus dem Anker (aufrechte Ebenen). Freistehende Teile (Säulen) haben
 * Relief.
 *
 * Kontur: selektiv in der dunkelsten Stufe des Materials, Bodenkontakt `nacht.1`; an verbundenen Seiten
 * läuft das Muster ohne Kontur in den Nachbarn weiter (die Kontur entsteht in einer 3×3-Nachbarschaft
 * mit durchlaufenden Nachbarstücken und wird danach auf das eigene Tile zugeschnitten).
 */
import { MATERIAL_BITS, TRANSPARENT, rasterRows, resolveColor, spriteFromPixels, type MaterialFlag, type PixelFrameInput, type PixelSpriteMeta, type Sprite } from '../../lib/sprite';
import { bereinige } from '../../lib/blob';
import { PixelCanvas } from '../../lib/raster';
import { ICON_LEGENDE } from '../icons/_icon';

/** Kontaktbogen `bauteile.png`. */
export const BAU_GRUPPE = 'bauteile';
/** Präfix der Bauteil-Sprites (docs/SPIEL.md §8). */
export const BAU_PRAEFIX = 'bau_';
/** Kachelkante in px. */
export const KACHEL = 16;
/** Nachbarbits der Maske. */
export const MASKE = { n: 1, o: 2, s: 4, w: 8 } as const;
/** Anzahl der Masken (0–15). */
export const MASKEN = 16;
/** Sichtbare Wandhöhe in px (eine Höhenstufe, MASTERPROMPT §4.4). */
export const WAND_HOEHE = 16;
/** Höhe der Schnittwand (Blick ins Haus). */
export const SCHNITT_HOEHE = 4;
/** Wandband (Standfläche der dünnen Wand) in Tile-Koordinaten: [von, bis). */
export const BAND_VON = 5;
export const BAND_BIS = 11;
export const BAND = BAND_BIS - BAND_VON;
/** Zelle und Anker der aufrechten 1×1-Teile. */
export const AUFRECHT_ZELLE: [number, number] = [KACHEL, KACHEL + WAND_HOEHE];
export const AUFRECHT_ANKER: [number, number] = [KACHEL / 2, KACHEL + WAND_HOEHE - 1];
/** Lage der linken oberen Standflächen-Ecke in der aufrechten Zelle. */
export const AUFRECHT_URSPRUNG: [number, number] = [0, WAND_HOEHE];
/** Dachüberstand über das Wandband an offenen Seiten. */
export const DACH_UEBERSTAND = 2;
/** Dacharten in Frame-Reihenfolge (`art · 16 + maske`). */
export const DACH_ARTEN = ['sued', 'first', 'nord', 'schnitt'] as const;
export type DachArt = (typeof DACH_ARTEN)[number];

/** Gemeinsame Legende (dieselbe wie die Icons: jede Farbe überall mit demselben Zeichen). */
export const BAU_LEGENDE: Readonly<Record<string, string | null>> = ICON_LEGENDE;

/** Art eines gesetzten Pixels: Oberseite, Front (Fuß bekommt Bodenkontakt) oder ohne Kontur. */
export type PixelArt = 'kappe' | 'front' | 'frei';

/** Setzt Zeichen `c` an Zellkoordinate (x, y); `.` lässt frei. */
export type Stift = (x: number, y: number, c: string, art?: PixelArt) => void;
/** Zeichnet ein Stück mit Nachbarmaske `maske` in seine Zelle. */
export type Zeichner = (maske: number, stift: Stift) => void;

export interface Stil {
  /** Zusätzliche oder ersetzte Legendenzeichen (über `BAU_LEGENDE`). */
  readonly legende?: Readonly<Record<string, string | null>>;
  /** Materialflags je Zeichen. */
  readonly material?: Partial<Record<MaterialFlag, string>>;
  /** Materialflag für alle deckenden Pixel (z. B. `dach`). */
  readonly materialAlle?: MaterialFlag;
  /** Konturzeichen (dunkelste Stufe des Materials). */
  readonly kontur: string;
  /** Bodenkontakt unter Frontpixeln (Standard `k` = nacht.1). */
  readonly fuss?: string;
  /** Zeichen, die nie zur Kontur werden (selbst gezeichnete Spitzen, Glut). */
  readonly ohneKontur?: string;
}

/** Geometrie einer Zelle: Größe und Lage der Standflächen-Ecke darin. */
export interface ZellGeometrie {
  readonly zelle: readonly [number, number];
  readonly ursprung: readonly [number, number];
}

export const AUFRECHT: ZellGeometrie = { zelle: AUFRECHT_ZELLE, ursprung: AUFRECHT_URSPRUNG };
export const BODEN: ZellGeometrie = { zelle: [KACHEL, KACHEL], ursprung: [0, 0] };

// ---------------------------------------------------------------------------------------------
// Muster
// ---------------------------------------------------------------------------------------------

/** Ein handgezeichnetes Quellmuster; `at` wiederholt es in beide Richtungen (kachelbar). */
export class Muster {
  readonly zeilen: readonly string[];
  readonly w: number;
  readonly h: number;

  constructor(
    readonly name: string,
    text: string,
    w?: number,
    h?: number,
  ) {
    this.zeilen = rasterRows(text);
    this.h = this.zeilen.length;
    this.w = this.zeilen[0]?.length ?? 0;
    if (this.h === 0 || this.w === 0) throw new Error(`Muster ${name}: leer`);
    for (const [i, z] of this.zeilen.entries()) if (z.length !== this.w) throw new Error(`Muster ${name}: Zeile ${i} hat ${z.length} statt ${this.w} Zeichen`);
    if (w !== undefined && this.w !== w) throw new Error(`Muster ${name}: Breite ${this.w}, erwartet ${w}`);
    if (h !== undefined && this.h !== h) throw new Error(`Muster ${name}: Höhe ${this.h}, erwartet ${h}`);
  }

  at(x: number, y: number): string {
    const zy = ((y % this.h) + this.h) % this.h;
    const zx = ((x % this.w) + this.w) % this.w;
    return this.zeilen[zy]?.charAt(zx) ?? '.';
  }
}

// ---------------------------------------------------------------------------------------------
// Zusammensetzen mit Nachbarschaft
// ---------------------------------------------------------------------------------------------

interface Aufgeloest {
  readonly index: number;
  readonly emissive: boolean;
  readonly material: number;
}

function aufloesen(stil: Stil): Map<string, Aufgeloest | null> {
  const legende = { ...BAU_LEGENDE, ...stil.legende };
  const bits = new Map<string, number>();
  for (const [flag, zeichen] of Object.entries(stil.material ?? {}) as Array<[MaterialFlag, string]>) {
    for (const c of zeichen) bits.set(c, (bits.get(c) ?? 0) | MATERIAL_BITS[flag]);
  }
  const alle = stil.materialAlle === undefined ? 0 : MATERIAL_BITS[stil.materialAlle];
  const out = new Map<string, Aufgeloest | null>();
  for (const [c, ref] of Object.entries(legende)) {
    if (ref === null) {
      out.set(c, null);
      continue;
    }
    const r = resolveColor(ref);
    if ('error' in r) throw new Error(`Bau-Legende "${c}": ${r.error}`);
    out.set(c, { index: r.index, emissive: r.emissive, material: (bits.get(c) ?? 0) | alle });
  }
  return out;
}

/** Richtungen der Maske mit Tile-Versatz und Gegenbit. */
const RICHTUNGEN = [
  { bit: MASKE.n, dx: 0, dy: -1, gegen: MASKE.s },
  { bit: MASKE.o, dx: 1, dy: 0, gegen: MASKE.w },
  { bit: MASKE.s, dx: 0, dy: 1, gegen: MASKE.n },
  { bit: MASKE.w, dx: -1, dy: 0, gegen: MASKE.o },
] as const;

/** Eine gezeichnete Ebene (Zeichen, Art, Besitzer-Tile) auf der Nachbarschaftsfläche. */
class Flaeche {
  readonly zeichen: string[];
  readonly art: PixelArt[];
  readonly besitzer: Int8Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.zeichen = new Array<string>(w * h).fill('.');
    this.art = new Array<PixelArt>(w * h).fill('frei');
    this.besitzer = new Int8Array(w * h).fill(-1);
  }

  deckend(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.zeichen[y * this.w + x] !== '.';
  }
}

/**
 * Fortsetzung verbundener Seiten beim Konturziehen: `gerade` (Linienstücke wie Wände: der Nachbar läuft
 * gerade weiter) oder `flaeche` (Flächen wie Dächer und Böden: der Nachbar setzt die Kanten quer zur
 * Verbindung fort – eine offene Traufe läuft weiter, eine volle Fläche bleibt voll; die Diagonalen
 * kennt die Maske nicht, Innenecken bleiben deshalb ohne Kontur).
 */
export type Fortsetzung = 'gerade' | 'flaeche';

/**
 * Setzt das Stück mit Maske `maske` in eine 3×3-Nachbarschaft (verbundene Seiten tragen ein
 * Durchlaufstück), zieht die Kontur und schneidet das eigene Tile heraus.
 */
export function maskenFrame(geo: ZellGeometrie, stil: Stil, zeichner: Zeichner, maske: number, fortsetzung: Fortsetzung = 'gerade'): PixelFrameInput {
  const farben = aufloesen(stil);
  const [zw, zh] = geo.zelle;
  const [ox, oy] = geo.ursprung;
  // Fläche: Tiles −1…1 in beide Richtungen; Zelle von Tile (tx, ty) liegt bei (tx·16 − ox, ty·16 − oy).
  const minX = -KACHEL - ox;
  const minY = -KACHEL - oy;
  const w = 2 * KACHEL + zw;
  const h = 2 * KACHEL + zh;
  const welt = new Flaeche(w, h);
  const eigen = new Flaeche(w, h);
  const stuecke: Array<{ dx: number; dy: number; maske: number; id: number }> = [{ dx: 0, dy: 0, maske, id: 0 }];
  RICHTUNGEN.forEach((r, i) => {
    if ((maske & r.bit) === 0) return;
    // Fläche: der Nachbar setzt die Kanten quer zur Verbindung fort (Traufe läuft weiter, innen voll).
    const quer = r.dx === 0 ? MASKE.o | MASKE.w : MASKE.n | MASKE.s;
    stuecke.push({ dx: r.dx, dy: r.dy, maske: fortsetzung === 'flaeche' ? (maske & quer) | r.bit | r.gegen : r.bit | r.gegen, id: i + 1 });
  });
  // Malerreihenfolge wie der Renderer: weiter südlich liegt vorn.
  stuecke.sort((a, b) => a.dy - b.dy || a.dx - b.dx);
  for (const s of stuecke) {
    const bx = s.dx * KACHEL - ox - minX;
    const by = s.dy * KACHEL - oy - minY;
    zeichner(s.maske, (x, y, c, art = 'kappe') => {
      if (c === '.' || x < 0 || y < 0 || x >= zw || y >= zh) return;
      const p = (by + y) * w + bx + x;
      welt.zeichen[p] = c;
      welt.art[p] = art;
      welt.besitzer[p] = s.id;
      if (s.id === 0) {
        eigen.zeichen[p] = c;
        eigen.art[p] = art;
      }
    });
  }
  const index = new Uint8Array(zw * zh);
  const emissive = new Uint8Array(zw * zh);
  const material = new Uint8Array(zw * zh);
  const bx = -ox - minX;
  const by = -oy - minY;
  for (let y = 0; y < zh; y++) {
    for (let x = 0; x < zw; x++) {
      const wx = bx + x;
      const wy = by + y;
      const p = wy * w + wx;
      let c = eigen.zeichen[p] ?? '.';
      if (c === '.') continue;
      const art = eigen.art[p] ?? 'frei';
      if (art !== 'frei' && !(stil.ohneKontur ?? '').includes(c)) {
        const leer = (qx: number, qy: number): boolean => !welt.deckend(qx, qy) && !eigen.deckend(qx, qy);
        if (leer(wx, wy + 1)) c = art === 'front' ? (stil.fuss ?? 'k') : stil.kontur;
        else if (leer(wx - 1, wy) || leer(wx + 1, wy) || leer(wx, wy - 1)) c = stil.kontur;
      }
      const f = farben.get(c);
      if (f === undefined) throw new Error(`Bau-Stück: Zeichen "${c}" fehlt in der Legende`);
      if (f === null) continue;
      const q = y * zw + x;
      index[q] = f.index;
      emissive[q] = f.emissive ? 1 : 0;
      material[q] = f.material;
    }
  }
  // Wo Kanten ein Muster anschneiden, bleiben einzelne Pixel stehen: wie bei den Tilesets bereinigen.
  const k = new PixelCanvas(zw, zh);
  k.index.set(index);
  k.emissive.set(emissive);
  k.material.set(material);
  bereinige(k);
  return k.toFrame();
}

/** Frame ohne Nachbarschaft aus einem Raster (Türen, Fenster, Treppen …). */
export function rasterFrame(stil: Stil, raster: string, zelle: readonly [number, number]): PixelFrameInput {
  const farben = aufloesen(stil);
  const [zw, zh] = zelle;
  const zeilen = rasterRows(raster);
  if (zeilen.length !== zh) throw new Error(`Bau-Raster: ${zeilen.length} Zeilen, erwartet ${zh}`);
  const index = new Uint8Array(zw * zh);
  const emissive = new Uint8Array(zw * zh);
  const material = new Uint8Array(zw * zh);
  zeilen.forEach((z, y) => {
    if (z.length !== zw) throw new Error(`Bau-Raster Zeile ${y}: ${z.length} statt ${zw} Zeichen`);
    for (let x = 0; x < zw; x++) {
      const f = farben.get(z.charAt(x));
      if (f === undefined) throw new Error(`Bau-Raster (${x}, ${y}): Zeichen "${z.charAt(x)}" fehlt in der Legende`);
      if (f === null) continue;
      const q = y * zw + x;
      index[q] = f.index;
      emissive[q] = f.emissive ? 1 : 0;
      material[q] = f.material;
    }
  });
  return { index, emissive, material };
}

/** Clips als Nachschlagetabellen (Clip-Position = Maske bzw. Zustand), ohne Abspielbedeutung. */
export function tabellenClips(tabellen: Readonly<Record<string, readonly number[]>>): Record<string, { frames: number[]; fps: number; loop: boolean }> {
  return Object.fromEntries(Object.entries(tabellen).map(([name, frames]) => [name, { frames: [...frames], fps: 1, loop: false }]));
}

/** Frames `start … start + 15` (eine Maskentabelle). */
export function maskenTabelle(start: number): number[] {
  return Array.from({ length: MASKEN }, (_, m) => start + m);
}

/** Baut das Sprite `bau_<teil>` aus Pixel-Frames. */
export function bauSprite(meta: Omit<PixelSpriteMeta, 'group'>, frames: readonly PixelFrameInput[]): Sprite {
  return spriteFromPixels({ group: BAU_GRUPPE, ...meta }, frames);
}

/** Ob ein Frame an (x, y) deckt (Tests, Vorschau). */
export function deckt(f: PixelFrameInput, w: number, x: number, y: number): boolean {
  return (f.index[y * w + x] ?? TRANSPARENT) !== TRANSPARENT;
}

// ---------------------------------------------------------------------------------------------
// Wände und Mauern
// ---------------------------------------------------------------------------------------------

/** Quellmuster einer Wand (alle Zeichen aus der Stil-Legende, `.` = frei). */
export interface WandMuster {
  /** Oberseite eines Ost-West-Laufs: `BAND` Zeilen × 16, waagerecht kachelbar. */
  readonly kappeQuer: string;
  /** Oberseite eines Nord-Süd-Laufs: 16 Zeilen × `BAND`, senkrecht kachelbar. */
  readonly kappeLaengs: string;
  /** Oberseite von Ecke, Kreuzung und Einzelstück: `BAND` × `BAND`. */
  readonly knoten: string;
  /** Front (Fassungen), je `hoehe` Zeilen × 16, waagerecht kachelbar; oben = Oberkante. */
  readonly front: readonly string[];
  /** Front unter dem Knoten an Ecken und Enden (`hoehe` Zeilen × `BAND`). */
  readonly pfosten: string;
  /** Schnittkappen (optional, sonst die normalen Kappen). */
  readonly schnitt?: { readonly kappeQuer: string; readonly kappeLaengs: string; readonly knoten: string };
}

interface WandQuellen {
  readonly quer: Muster;
  readonly laengs: Muster;
  readonly knoten: Muster;
  readonly front: Muster;
  readonly pfosten: Muster;
}

/** Ob (x, gy) in der Standfläche einer Wand mit Maske `m` liegt. */
export function inBand(m: number, x: number, gy: number): boolean {
  const inX = x >= BAND_VON && x < BAND_BIS;
  const inY = gy >= BAND_VON && gy < BAND_BIS;
  if (inX && inY) return true;
  if (inY && x < BAND_VON) return (m & MASKE.w) !== 0;
  if (inY && x >= BAND_BIS) return (m & MASKE.o) !== 0;
  if (inX && gy < BAND_VON) return (m & MASKE.n) !== 0;
  if (inX && gy >= BAND_BIS) return (m & MASKE.s) !== 0;
  return false;
}

/**
 * Zeichner einer dünnen Wand der Höhe `hoehe` (Front-Muster haben `texturHoehe` Zeilen; niedrigere
 * Wände zeigen deren untere Zeilen). Die Kappe liegt `hoehe` px über der Standfläche.
 */
function wandZeichner(q: WandQuellen, hoehe: number, geo: ZellGeometrie): Zeichner {
  const [, oy] = geo.ursprung;
  const texturHoehe = q.front.h;
  return (m, stift) => {
    const quer = (m & (MASKE.o | MASKE.w)) !== 0;
    const laengs = (m & (MASKE.n | MASKE.s)) !== 0;
    for (let gy = 0; gy < KACHEL; gy++) {
      for (let x = 0; x < KACHEL; x++) {
        if (!inBand(m, x, gy)) continue;
        const inMitte = x >= BAND_VON && x < BAND_BIS && gy >= BAND_VON && gy < BAND_BIS;
        let c: string;
        if (inMitte) {
          if (quer && !laengs) c = q.quer.at(x, gy - BAND_VON);
          else if (laengs && !quer) c = q.laengs.at(x - BAND_VON, gy);
          else c = q.knoten.at(x - BAND_VON, gy - BAND_VON);
        } else if (gy >= BAND_VON && gy < BAND_BIS) c = q.quer.at(x, gy - BAND_VON);
        else c = q.laengs.at(x - BAND_VON, gy);
        stift(x, oy + gy - hoehe, c, 'kappe');
      }
    }
    // Front unter jeder Südkante der Standfläche innerhalb des Tiles.
    const pfostenMitte = (m & MASKE.n) !== 0 || !quer;
    for (let x = 0; x < KACHEL; x++) {
      for (let gy = 0; gy < KACHEL - 1; gy++) {
        if (!inBand(m, x, gy) || inBand(m, x, gy + 1)) continue;
        const mitte = x >= BAND_VON && x < BAND_BIS;
        for (let r = 0; r < hoehe; r++) {
          const ty = texturHoehe - hoehe + r;
          const c = mitte && pfostenMitte ? q.pfosten.at(x - BAND_VON, ty) : q.front.at(x, ty);
          stift(x, oy + gy + 1 - hoehe + r, c, 'front');
        }
      }
    }
  };
}

export interface WandOptionen {
  readonly id: string;
  readonly stil: Stil;
  readonly muster: WandMuster;
  /** Sichtbare Höhe (Standard `WAND_HOEHE`). */
  readonly hoehe?: number;
  /** Schnittfassung (Frames 32–47) erzeugen. */
  readonly schnitt?: boolean;
}

/** Wand- bzw. Mauer-Sprite: Maskentabellen je Fassung, optional die Schnittfassung. */
export function wandSprite(o: WandOptionen): Sprite {
  const hoehe = o.hoehe ?? WAND_HOEHE;
  const quellen = (front: string, schnitt: boolean): WandQuellen => {
    const k = schnitt && o.muster.schnitt !== undefined ? o.muster.schnitt : o.muster;
    return {
      quer: new Muster(`${o.id}.kappeQuer`, k.kappeQuer, KACHEL, BAND),
      laengs: new Muster(`${o.id}.kappeLaengs`, k.kappeLaengs, BAND, KACHEL),
      knoten: new Muster(`${o.id}.knoten`, k.knoten, BAND, BAND),
      front: new Muster(`${o.id}.front`, front, KACHEL, hoehe),
      pfosten: new Muster(`${o.id}.pfosten`, o.muster.pfosten, BAND, hoehe),
    };
  };
  const frames: PixelFrameInput[] = [];
  const clips: Record<string, number[]> = {};
  o.muster.front.forEach((front, i) => {
    const name = String.fromCharCode('a'.charCodeAt(0) + i);
    clips[name] = maskenTabelle(frames.length);
    const z = wandZeichner(quellen(front, false), hoehe, AUFRECHT);
    for (let m = 0; m < MASKEN; m++) frames.push(maskenFrame(AUFRECHT, o.stil, z, m));
  });
  if (o.schnitt === true) {
    const front = o.muster.front[0];
    if (front === undefined) throw new Error(`${o.id}: keine Front`);
    clips.schnitt = maskenTabelle(frames.length);
    const z = wandZeichner(quellen(front, true), SCHNITT_HOEHE, AUFRECHT);
    for (let m = 0; m < MASKEN; m++) frames.push(maskenFrame(AUFRECHT, o.stil, z, m));
  }
  return bauSprite({ id: o.id, size: AUFRECHT_ZELLE, anchor: AUFRECHT_ANKER, hoehe: 'flach', clips: tabellenClips(clips), occluder: { kind: 'sprite' }, schatten: 'silhouette' }, frames);
}

// ---------------------------------------------------------------------------------------------
// Dächer
// ---------------------------------------------------------------------------------------------

/** Quellmuster eines Dachs (16×16-Flächen kachelbar, Kanten entlang ihrer Richtung kachelbar). */
export interface DachMuster {
  /** Vorderseite (zur Kamera), 16×16. */
  readonly sued: string;
  /** Firstreihe, 16×16: oben Rückseite, Mitte First, unten Vorderseite; waagerecht kachelbar. */
  readonly first: string;
  /** Rückseite, 16×16. */
  readonly nord: string;
  /** Traufe unter der offenen Südkante: 2 Zeilen × 16 (Stirnbrett bzw. Halmenden). */
  readonly traufe: string;
  /** Ortgang an offenen Ost-/Westkanten: 16 Zeilen × 3 (außen → innen; die äußere Spalte wird Kontur). */
  readonly ortgang: string;
}

/** Letzte Zeile der Dachfläche an offener Südkante (1 px Überstand über das Wandband). */
const DACH_SUED_ENDE = BAND_BIS;
/** Zeilen der Traufe unter der offenen Südkante. */
const TRAUFE_ZEILEN = 2;
/** Tiefe des Schnitt-Rands an der Rückseite in px (ohne Kontur). */
const SCHNITT_RAND = 2;

/** Grenzen der Dachfläche (Tile-Koordinaten, inklusive) für Maske `m`. */
export function dachGrenzen(m: number): { x0: number; x1: number; y0: number; y1: number } {
  return {
    x0: (m & MASKE.w) !== 0 ? 0 : BAND_VON - DACH_UEBERSTAND,
    x1: (m & MASKE.o) !== 0 ? KACHEL - 1 : BAND_BIS - 1 + DACH_UEBERSTAND,
    y0: (m & MASKE.n) !== 0 ? 0 : BAND_VON - DACH_UEBERSTAND,
    y1: (m & MASKE.s) !== 0 ? KACHEL - 1 : DACH_SUED_ENDE,
  };
}

function dachZeichner(q: DachMuster, name: string, art: DachArt): Zeichner {
  const flaechen = {
    sued: new Muster(`${name}.sued`, q.sued, KACHEL, KACHEL),
    first: new Muster(`${name}.first`, q.first, KACHEL, KACHEL),
    nord: new Muster(`${name}.nord`, q.nord, KACHEL, KACHEL),
  };
  const traufe = new Muster(`${name}.traufe`, q.traufe, KACHEL, TRAUFE_ZEILEN);
  const ortgang = new Muster(`${name}.ortgang`, q.ortgang, 3, KACHEL);
  const [, oy] = AUFRECHT_URSPRUNG;
  return (m, stift) => {
    const g = dachGrenzen(m);
    const offen = (bit: number): boolean => (m & bit) === 0;
    // Im Schnitt trägt die Fläche den Charakter der Vorderseite (Traufrand).
    const flaeche = art === 'schnitt' ? flaechen.sued : flaechen[art];
    for (let gy = g.y0; gy <= g.y1; gy++) {
      for (let x = g.x0; x <= g.x1; x++) {
        if (art === 'schnitt') {
          // Traufrand nur an Rückseite und Giebeln: die offene Südseite gibt den Blick ins Haus frei.
          const amRand = (offen(MASKE.w) && x <= g.x0 + ortgang.w) || (offen(MASKE.o) && x >= g.x1 - ortgang.w) || (offen(MASKE.n) && gy <= g.y0 + SCHNITT_RAND);
          if (!amRand) continue;
        }
        let c = flaeche.at(x, gy);
        if (offen(MASKE.w) && x - g.x0 < ortgang.w) c = ortgang.at(x - g.x0, gy);
        else if (offen(MASKE.o) && g.x1 - x < ortgang.w) c = ortgang.at(g.x1 - x, gy);
        stift(x, oy + gy - WAND_HOEHE, c, 'kappe');
      }
    }
    if (offen(MASKE.s) && art !== 'schnitt') {
      for (let r = 0; r < TRAUFE_ZEILEN; r++) {
        for (let x = g.x0; x <= g.x1; x++) stift(x, oy + g.y1 + 1 + r - WAND_HOEHE, traufe.at(x, r), 'front');
      }
    }
  };
}

export interface DachOptionen {
  readonly id: string;
  readonly stil: Stil;
  readonly muster: DachMuster;
}

/** Dach-Sprite: Frames `art · 16 + maske` (Arten `DACH_ARTEN`), Clips je Art. */
export function dachSprite(o: DachOptionen): Sprite {
  const stil: Stil = { ...o.stil, materialAlle: 'dach' };
  const frames: PixelFrameInput[] = [];
  const clips: Record<string, number[]> = {};
  for (const art of DACH_ARTEN) {
    clips[art] = maskenTabelle(frames.length);
    const z = dachZeichner(o.muster, o.id, art);
    for (let m = 0; m < MASKEN; m++) frames.push(maskenFrame(AUFRECHT, stil, z, m, 'flaeche'));
  }
  return bauSprite({ id: o.id, size: AUFRECHT_ZELLE, anchor: AUFRECHT_ANKER, hoehe: 'flach', clips: tabellenClips(clips), occluder: { kind: 'none' }, schatten: 'silhouette' }, frames);
}

// ---------------------------------------------------------------------------------------------
// Böden und Steg
// ---------------------------------------------------------------------------------------------

export interface BodenOptionen {
  readonly id: string;
  readonly stil: Stil;
  /** Fassungen: je 16×16, in beide Richtungen kachelbar. */
  readonly fassungen: readonly string[];
}

/** Boden-Sprite: Frames `fassung · 16 + maske`, Kante (Kontur) an offenen Seiten. */
export function bodenSprite(o: BodenOptionen): Sprite {
  const frames: PixelFrameInput[] = [];
  const clips: Record<string, number[]> = {};
  o.fassungen.forEach((text, i) => {
    const muster = new Muster(`${o.id}.${i}`, text, KACHEL, KACHEL);
    clips[String.fromCharCode('a'.charCodeAt(0) + i)] = maskenTabelle(frames.length);
    const z: Zeichner = (_m, stift) => {
      for (let y = 0; y < KACHEL; y++) for (let x = 0; x < KACHEL; x++) stift(x, y, muster.at(x, y), 'kappe');
    };
    for (let m = 0; m < MASKEN; m++) frames.push(maskenFrame(BODEN, o.stil, z, m, 'flaeche'));
  });
  return bauSprite({ id: o.id, size: [KACHEL, KACHEL], anchor: [0, 0], hoehe: 'flach', clips: tabellenClips(clips) }, frames);
}

/** Zelle des Stegs: Deck plus Stirnbalken und Pfähle im Tile darunter. */
export const STEG_ZELLE: [number, number] = [KACHEL, KACHEL + 8];

export interface StegOptionen {
  readonly id: string;
  readonly stil: Stil;
  /** Deck, 16×16 kachelbar. */
  readonly deck: string;
  /** Stirnseite unter offener Südkante: 8 Zeilen × 16 (Balken, Pfähle; `.` = Wasser). */
  readonly stirn: string;
}

/** Steg-Sprite: Frames = Maske; Stirnbalken und Pfähle nur an offener Südseite. */
export function stegSprite(o: StegOptionen): Sprite {
  const deck = new Muster(`${o.id}.deck`, o.deck, KACHEL, KACHEL);
  const stirn = new Muster(`${o.id}.stirn`, o.stirn, KACHEL, STEG_ZELLE[1] - KACHEL);
  const geo: ZellGeometrie = { zelle: STEG_ZELLE, ursprung: [0, 0] };
  const z: Zeichner = (m, stift) => {
    for (let y = 0; y < KACHEL; y++) for (let x = 0; x < KACHEL; x++) stift(x, y, deck.at(x, y), 'kappe');
    if ((m & MASKE.s) === 0) for (let y = 0; y < stirn.h; y++) for (let x = 0; x < KACHEL; x++) stift(x, KACHEL + y, stirn.at(x, y), 'front');
  };
  const frames = Array.from({ length: MASKEN }, (_, m) => maskenFrame(geo, o.stil, z, m, 'flaeche'));
  return bauSprite({ id: o.id, size: STEG_ZELLE, anchor: [0, 0], hoehe: 'flach', clips: tabellenClips({ maske: maskenTabelle(0) }) }, frames);
}

// ---------------------------------------------------------------------------------------------
// Pfosten-Riegel-Zaun
// ---------------------------------------------------------------------------------------------

/** Höhe des oberen und des unteren Zaunriegels über Grund in px. */
export const RIEGEL_OBEN = 10;
export const RIEGEL_UNTEN = 5;
/** Standzeile des Zaunpfostens in der Standfläche (Mitte des Wandbands). */
const PFOSTEN_GY = BAND_BIS - 2;

export interface ZaunOptionen {
  readonly id: string;
  readonly stil: Stil;
  /** Pfosten von vorn: Zeilen vom Kopf bis zum Fuß × Breite. */
  readonly pfosten: string;
  /** Riegel eines Ost-West-Laufs von vorn: Zeilen ab Pfostenkopf × 16 (`.` = frei), waagerecht kachelbar. */
  readonly riegelQuer: string;
  /** Riegel eines Nord-Süd-Laufs von oben: 16 Zeilen × Breite, senkrecht kachelbar. */
  readonly riegelLaengs: string;
}

/**
 * Zaun aus einem Pfosten in der Tile-Mitte und Riegeln zu den verbundenen Seiten. Nord-Süd-Riegel
 * erscheinen von oben als Linie (oberer und unterer Riegel liegen 5 px versetzt übereinander) und
 * liegen hinter dem Pfosten; Ost-West-Riegel von vorn. Frames = Maske.
 */
export function zaunSprite(o: ZaunOptionen): Sprite {
  const pfosten = new Muster(`${o.id}.pfosten`, o.pfosten);
  const quer = new Muster(`${o.id}.riegelQuer`, o.riegelQuer, KACHEL);
  const laengs = new Muster(`${o.id}.riegelLaengs`, o.riegelLaengs, undefined, KACHEL);
  const [, oy] = AUFRECHT_URSPRUNG;
  const fussY = oy + PFOSTEN_GY;
  const kopfY = fussY - pfosten.h + 1;
  const px = (KACHEL - pfosten.w) / 2;
  const lx = (KACHEL - laengs.w) / 2;
  const z: Zeichner = (m, stift) => {
    const nordSued = (von: number, bis: number): void => {
      for (let y = von; y <= bis; y++) for (let x = 0; x < laengs.w; x++) stift(lx + x, y, laengs.at(x, y), 'kappe');
    };
    if ((m & MASKE.n) !== 0) nordSued(oy - RIEGEL_OBEN, oy + PFOSTEN_GY - RIEGEL_UNTEN);
    if ((m & MASKE.s) !== 0) nordSued(oy + PFOSTEN_GY - RIEGEL_OBEN, oy + KACHEL - 1 - RIEGEL_UNTEN);
    for (let x = 0; x < KACHEL; x++) {
      const links = x < px;
      const rechts = x >= px + pfosten.w;
      if ((links && (m & MASKE.w) === 0) || (rechts && (m & MASKE.o) === 0) || (!links && !rechts)) continue;
      for (let r = 0; r < quer.h; r++) stift(x, kopfY + r, quer.at(x, r), 'front');
    }
    for (let y = 0; y < pfosten.h; y++) for (let x = 0; x < pfosten.w; x++) stift(px + x, kopfY + y, pfosten.at(x, y), y === 0 ? 'kappe' : 'front');
  };
  const frames = Array.from({ length: MASKEN }, (_, m) => maskenFrame(AUFRECHT, o.stil, z, m));
  return bauSprite({ id: o.id, size: AUFRECHT_ZELLE, anchor: AUFRECHT_ANKER, hoehe: 'flach', clips: tabellenClips({ maske: maskenTabelle(0) }), occluder: { kind: 'sprite' }, schatten: 'silhouette' }, frames);
}

// ---------------------------------------------------------------------------------------------
// Schnitt aufrechter Wandelemente (Türen, Fenster)
// ---------------------------------------------------------------------------------------------

/** Erste Zeile der Kappe und der Front einer Wand in der aufrechten Zelle. */
const KAPPE_ZEILE = AUFRECHT_URSPRUNG[1] + BAND_VON - WAND_HOEHE;
const FRONT_ZEILE = AUFRECHT_URSPRUNG[1] + BAND_BIS - WAND_HOEHE;

/**
 * Schnittfassung eines Wandelements in einer Ost-West-Wand (Raster 16×32): unten bleiben die letzten
 * `SCHNITT_HOEHE` Zeilen der Front, darüber liegt die Kappe um die gekappte Höhe abgesenkt – nur über
 * Spalten, in denen die gekappte Front steht (eine offene Türöffnung bleibt frei).
 */
export function schnittRaster(raster: string): string {
  const zeilen = rasterRows(raster);
  const [zw, zh] = AUFRECHT_ZELLE;
  if (zeilen.length !== zh) throw new Error(`Schnitt: ${zeilen.length} Zeilen, erwartet ${zh}`);
  const senkung = WAND_HOEHE - SCHNITT_HOEHE;
  const frontOben = FRONT_ZEILE + senkung;
  const leer = '.'.repeat(zw);
  return zeilen
    .map((z, y) => {
      if (y >= frontOben && y < FRONT_ZEILE + WAND_HOEHE) return z;
      const quelle = y - senkung;
      if (quelle < KAPPE_ZEILE || quelle >= FRONT_ZEILE) return leer;
      const kappe = zeilen[quelle] ?? leer;
      const traeger = zeilen[frontOben] ?? leer;
      return [...kappe].map((c, x) => (traeger.charAt(x) === '.' ? '.' : c)).join('');
    })
    .join('\n');
}
