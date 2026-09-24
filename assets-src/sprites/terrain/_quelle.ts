/**
 * Hilfen der Terrain-Tilesets (M2-17/M2-18): Vollfeld-Varianten aus Index-Rastern, Färbung nach
 * Bändern je Seite (3/4-Sicht: Südkante = Front mit Lippe, Nordkante = Oberkante mit heller Kante)
 * und Überstände (Halme, Krümel, Wurzelspitzen), die über die Kante ins tiefere Terrain ragen.
 * Dateien mit `_` sind Hilfsmodule und keine Sprites (docs/RENDER.md §1).
 */
import { KACHEL, istInnen, male, seiteVon, tiefeVon, type BlobFeld, type Faerbung, type KantenGeometrie, type Seite, type StilPixel } from '../../lib/blob';
import type { PixelCanvas } from '../../lib/raster';
import { sprite, type SpriteFrame } from '../../lib/sprite';

/** Gruppe (Kontaktbogen) aller Terrain-Tilesets. */
export const GRUPPE_TERRAIN = 'terrain';

/** Vollfeld-Varianten aus handgezeichneten 16×16-Rastern (Legende wie im Sprite-Format). */
export function varianten(id: string, legende: Readonly<Record<string, string | null>>, frames: readonly string[]): readonly SpriteFrame[] {
  return sprite({ id: `quelle_${id}`, size: [KACHEL, KACHEL], anchor: [0, 0], hoehe: 'flach', legende, frames: [...frames] }).frames;
}

/**
 * Färbung nach Bändern: je Seite die Farben ab der Kante nach innen (Index = Tiefe). `breiter` hängt
 * an den markierten Positionen entlang der Kante (1) eine weitere Reihe der letzten Bandfarbe an; die
 * Fugen (Positionen 0–2 und 13–15) bleiben ohne, damit Kanten nahtlos aneinanderstoßen.
 */
export interface BandStil {
  readonly baender: Readonly<Record<Seite, readonly (string | undefined)[]>>;
  readonly breiter?: Readonly<Partial<Record<Seite, readonly number[]>>>;
  /**
   * Optional: Farben der Außenseite (Saum-Terrain) je Seite nach Tiefe; die letzte gilt weiter außen.
   * `BANK` greift auf die Bank-Textur (`bank`) zurück.
   */
  readonly aussen?: Readonly<Record<Seite, readonly string[]>>;
  /** Außenfarbe ohne Kante in Reichweite (reine Uferbank). */
  readonly bank?: (x: number, y: number) => string;
}

/** Marke in `aussen`: hier gilt die Bank-Textur. */
export const BANK = 'bank';

export function bandFaerbung(stil: BandStil, zusatz?: (p: StilPixel) => string | null | undefined): Faerbung {
  return (p) => {
    const extra = zusatz?.(p);
    if (extra !== undefined) return extra;
    if (!p.innen) {
      if (stil.aussen === undefined) return undefined;
      if (p.seite === null) return stil.bank?.(p.x, p.y);
      const liste = stil.aussen[p.seite];
      const f = liste[Math.min(liste.length - 1, p.tiefe)];
      return f === BANK ? stil.bank?.(p.x, p.y) : f;
    }
    if (p.seite === null) return undefined;
    const liste = stil.baender[p.seite];
    if (p.tiefe < liste.length) return liste[p.tiefe];
    if (p.tiefe === liste.length && (stil.breiter?.[p.seite]?.[p.entlang] ?? 0) === 1) return liste[liste.length - 1];
    return undefined;
  };
}

/** Oberste bzw. äußerste Innenreihe einer Spalte/Zeile an Seite `seite` (oder `null`). */
function randPixel(feld: BlobFeld, seite: Seite, i: number): [number, number] | null {
  for (let t = 0; t < KACHEL; t++) {
    const [x, y] = seite === 'n' ? [i, t] : seite === 's' ? [i, KACHEL - 1 - t] : seite === 'w' ? [t, i] : [KACHEL - 1 - t, i];
    if (!istInnen(feld, x, y)) continue;
    if (seiteVon(feld, x, y) !== seite || tiefeVon(feld.abstand[y * KACHEL + x] ?? 0) !== 0) return null;
    return [x, y];
  }
  return null;
}

const SCHRITT: Readonly<Record<Seite, readonly [number, number]>> = { n: [0, -1], s: [0, 1], w: [-1, 0], o: [1, 0] };

/**
 * Überstände: an Kante `seite` ragen an ausgewählten Positionen (`wahl(maske, i)`) kurze Formen über die
 * Kante hinaus – `farben[k]` ist der k-te Pixel ab der Kante nach außen, `fuss` färbt den Randpixel
 * selbst. Positionen nahe den Fugen bleiben frei (Überstände stoßen nie an den Kachelrand).
 */
export function ueberstand(k: PixelCanvas, feld: BlobFeld, maske: number, seite: Seite, farben: readonly string[], wahl: (maske: number, i: number) => boolean, fuss?: string): void {
  const [dx, dy] = SCHRITT[seite];
  const rand = farben.length + 1;
  for (let i = rand; i < KACHEL - rand; i++) {
    if (!wahl(maske, i)) continue;
    const p = randPixel(feld, seite, i);
    if (p === null) continue;
    const [x, y] = p;
    let frei = true;
    for (let s = 1; s <= farben.length; s++) if (istInnen(feld, x + dx * s, y + dy * s) || !k.inside(x + dx * s, y + dy * s)) frei = false;
    if (!frei) continue;
    farben.forEach((f, s) => male(k, x + dx * (s + 1), y + dy * (s + 1), f));
    if (fuss !== undefined) male(k, x, y, fuss);
  }
}

/** Deterministische Streuwahl für Überstände: etwa jede `abstand`-te Position, je Maske versetzt. */
export function streuung(abstand: number, versatz = 0): (maske: number, i: number) => boolean {
  return (maske, i) => (maske * 7 + i * 5 + versatz) % abstand === 0;
}

// ---------------------------------------------------------------------------------------------
// Kantenstücke: handgezeichnete Profile (Einzug in px je Position; kleiner = Terrain reicht weiter)
// ---------------------------------------------------------------------------------------------

/**
 * Grasnarbe: Zungen und Buchten an Nord- und Südkante, Seiten in Läufen von 3 px (docs/ART.md §2.5),
 * mittelrunde Außenecken.
 */
export const GEOMETRIE_NARBE: KantenGeometrie = {
  profile: {
    n: [
      [4, 4, 3, 2, 2, 1, 1, 2, 3, 4, 5, 5, 4, 3, 4, 4],
      [4, 4, 3, 4, 5, 6, 6, 5, 4, 3, 2, 2, 2, 3, 4, 4],
      [4, 4, 3, 3, 4, 4, 3, 2, 1, 1, 2, 3, 4, 3, 4, 4],
    ],
    s: [
      [4, 4, 4, 3, 2, 2, 2, 3, 4, 5, 5, 5, 4, 4, 4, 4],
      [4, 4, 4, 5, 6, 6, 5, 4, 3, 3, 3, 4, 5, 4, 4, 4],
      [4, 4, 4, 4, 3, 3, 4, 5, 5, 4, 3, 2, 3, 4, 4, 4],
    ],
    w: [
      [4, 4, 4, 3, 3, 3, 2, 2, 2, 3, 3, 4, 4, 4, 4, 4],
      [4, 4, 4, 5, 5, 5, 6, 6, 5, 5, 5, 4, 4, 4, 4, 4],
    ],
    o: [
      [4, 4, 4, 5, 5, 5, 4, 4, 3, 3, 3, 3, 4, 4, 4, 4],
      [4, 4, 4, 3, 3, 2, 2, 2, 3, 3, 4, 4, 4, 4, 4, 4],
    ],
  },
  eckenRadien: [3, 4, 5],
  innenFormen: [2, 1.6, 2.6],
};

/** Weiche Decken (Sand, Schnee, Asche, Schlamm): lange, flache Wellen, große runde Ecken. */
export const GEOMETRIE_WEICH: KantenGeometrie = {
  profile: {
    n: [
      [4, 4, 4, 3, 3, 3, 2, 2, 2, 3, 3, 4, 5, 4, 4, 4],
      [4, 4, 4, 5, 5, 5, 4, 3, 3, 3, 3, 3, 4, 4, 4, 4],
      [4, 4, 4, 4, 3, 2, 2, 3, 4, 5, 5, 5, 5, 4, 4, 4],
    ],
    s: [
      [4, 4, 4, 5, 5, 4, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4],
      [4, 4, 4, 3, 3, 3, 3, 4, 5, 5, 5, 4, 3, 4, 4, 4],
    ],
    w: [
      [4, 4, 4, 3, 3, 3, 3, 4, 4, 4, 5, 5, 5, 4, 4, 4],
      [4, 4, 4, 5, 5, 5, 4, 4, 4, 3, 3, 3, 4, 4, 4, 4],
    ],
    o: [
      [4, 4, 4, 4, 5, 5, 5, 4, 4, 3, 3, 3, 3, 4, 4, 4],
      [4, 4, 4, 3, 3, 3, 4, 4, 5, 5, 5, 5, 4, 4, 4, 4],
    ],
  },
  eckenRadien: [4, 5, 6],
  innenFormen: [2, 2.4],
};

/** Schollen (Erde, Torf, Wurzeln, Höhlenboden): kurze Stufen, ausgebrochene Brocken, mittlere Ecken. */
export const GEOMETRIE_SCHOLLE: KantenGeometrie = {
  profile: {
    n: [
      [4, 4, 3, 3, 2, 2, 3, 3, 3, 4, 5, 5, 4, 3, 4, 4],
      [4, 4, 3, 4, 4, 5, 5, 4, 2, 2, 2, 3, 3, 3, 4, 4],
      [4, 4, 3, 2, 2, 3, 4, 4, 5, 4, 3, 3, 4, 3, 4, 4],
    ],
    s: [
      [4, 4, 4, 3, 3, 4, 5, 5, 4, 3, 3, 3, 4, 4, 4, 4],
      [4, 4, 4, 5, 4, 3, 3, 3, 4, 5, 5, 4, 4, 4, 4, 4],
      [4, 4, 4, 4, 4, 5, 5, 3, 3, 4, 4, 5, 4, 4, 4, 4],
    ],
    w: [
      [4, 4, 4, 3, 3, 3, 4, 4, 4, 5, 5, 5, 4, 4, 4, 4],
      [4, 4, 4, 5, 5, 5, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4],
    ],
    o: [
      [4, 4, 4, 5, 5, 5, 5, 4, 4, 4, 3, 3, 3, 4, 4, 4],
      [4, 4, 4, 3, 3, 3, 4, 4, 5, 5, 5, 4, 4, 4, 4, 4],
    ],
  },
  eckenRadien: [2, 3, 4],
  innenFormen: [2, 1.8, 3],
};

/** Kantig (Pflaster, Kristall, Obsidian): ausgebrochene Platten, harte Sprünge, spitze Ecken. */
export const GEOMETRIE_KANTIG: KantenGeometrie = {
  profile: {
    n: [
      [4, 4, 4, 4, 2, 2, 2, 2, 5, 5, 5, 3, 3, 4, 4, 4],
      [4, 4, 4, 6, 6, 6, 3, 3, 3, 3, 2, 2, 2, 4, 4, 4],
      [4, 4, 4, 3, 3, 3, 5, 5, 5, 5, 3, 3, 3, 4, 4, 4],
    ],
    s: [
      [4, 4, 4, 2, 2, 2, 5, 5, 5, 3, 3, 3, 3, 4, 4, 4],
      [4, 4, 4, 4, 5, 5, 5, 5, 2, 2, 2, 4, 4, 4, 4, 4],
    ],
    w: [
      [4, 4, 4, 2, 2, 2, 2, 5, 5, 5, 3, 3, 3, 4, 4, 4],
      [4, 4, 4, 5, 5, 5, 3, 3, 3, 3, 3, 6, 6, 4, 4, 4],
    ],
    o: [
      [4, 4, 4, 5, 5, 5, 5, 2, 2, 2, 4, 4, 4, 4, 4, 4],
      [4, 4, 4, 3, 3, 3, 6, 6, 6, 4, 4, 4, 4, 4, 4, 4],
    ],
  },
  eckenRadien: [1, 1, 2],
  innenFormen: [3, 4],
};
