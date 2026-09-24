/**
 * Ergänzungsschrift „DH Satzzeichen“ (M1-27, ADR-0016): lateinische Satzzeichen mit Vorschub nach
 * lateinischem Satz für die Pixelschrift Fusion Pixel 10px Proportional SC.
 *
 * Die Hauptschrift ist eine Schrift für vereinfachtes Chinesisch: Anführungszeichen, Apostroph,
 * Mittelpunkt, Auslassungspunkte und Aufzählungspunkt haben dort volle Geviertbreite (10 px) und
 * stehen mittig bzw. als ⋯ auf halber Höhe. In „Funke’s“ oder „Tag 3 · 12:00“ klafften so Lücken von
 * bis zu 7 px. Diese Zeichen zeichnet DUSKHEARTH selbst im Maß der Hauptschrift: hohe
 * Anführungszeichen als 2 px breite Tropfen mit Haken („66“ links, „99“ rechts und als Apostroph),
 * Oberkante auf Versalhöhe; Mittelpunkt und Auslassungspunkte wie der 1-px-Satzpunkt der
 * Hauptschrift; Aufzählungspunkt als runder 4×4-Punkt. Links 1 px Luft wie bei ‚ und „, rechts so
 * viel, dass der nächste Buchstabe mit dem Abstand der Hauptschrift folgt.
 *
 * `tools/assets/truetype.ts` baut daraus eine TrueType-Datei, die `src/generated/ui-kit.css` als
 * `data:`-URL mit `unicode-range` vor die Hauptschrift setzt (DOM); der Glyphenatlas backt sie über dieselbe
 * CSS-Schriftliste (WebGL). Metrik und Raster gleichen der Hauptschrift: 1000 Einheiten je Geviert,
 * 1 Designpixel = 100 Einheiten, Zeilenbox 1200 über / 400 unter der Grundlinie.
 */

/** Eine Glyphe als Pixelraster. */
export interface PixelGlyphe {
  /** Vorschub [Designpixel]. */
  readonly vorschub: number;
  /** Designzeile der obersten Rasterzeile (Zeile 0 liegt direkt über der Grundlinie). */
  readonly oben: number;
  /**
   * `#` = Tinte, `.` = leer; oberste Zeile zuerst, Spalte 0 liegt am Stift. Einrückung und
   * Leerzeilen fallen weg.
   */
  readonly raster: string;
}

/** Schriftmetrik in Schrifteinheiten (gleich der Hauptschrift, damit Zeilenbox und Grundlinie übereinstimmen). */
export interface PixelSchriftMetrik {
  readonly einheitenJeGeviert: number;
  readonly einheitenJePixel: number;
  /** Oberlänge der Zeilenbox (hhea/OS/2), positiv. */
  readonly oberlaenge: number;
  /** Unterlänge der Zeilenbox, positiv. */
  readonly unterlaenge: number;
  /** Versal- und x-Höhe [Designpixel] (OS/2-Angaben). */
  readonly versalhoehe: number;
  readonly xHoehe: number;
}

export interface PixelSchrift {
  /** Familienname in der Schriftdatei und in CSS. */
  readonly name: string;
  /** PostScript-Name (ohne Leerzeichen). */
  readonly postscript: string;
  readonly version: string;
  readonly urheber: string;
  readonly lizenz: string;
  readonly metrik: PixelSchriftMetrik;
  /** Zeichen → Glyphe. */
  readonly glyphen: Readonly<Record<string, PixelGlyphe>>;
}

export const SATZZEICHEN: PixelSchrift = {
  name: 'DH Satzzeichen',
  postscript: 'DHSatzzeichen-Regular',
  version: '1.000',
  urheber: 'DUSKHEARTH',
  lizenz: 'Eigens für DUSKHEARTH gezeichnet (CREDITS.md).',
  metrik: { einheitenJeGeviert: 1000, einheitenJePixel: 100, oberlaenge: 1200, unterlaenge: 400, versalhoehe: 7, xHoehe: 5 },
  glyphen: {
    // Anführungszeichen: 2 px breite Tropfen mit Haken, oben bündig mit der Versalhöhe (Zeilen 6–4),
    // links und rechts 1 px Luft. Links „66“ (Haken oben rechts, Tropfen unten), rechts „99“ (die
    // Drehung um 180°, zugleich der Apostroph).
    '‘': {
      vorschub: 4,
      oben: 6,
      raster: `
        ..#
        .#.
        .##`,
    },
    '’': {
      vorschub: 4,
      oben: 6,
      raster: `
        .##
        ..#
        .#.`,
    },
    '“': {
      vorschub: 7,
      oben: 6,
      raster: `
        ..#..#
        .#..#.
        .##.##`,
    },
    '”': {
      vorschub: 7,
      oben: 6,
      raster: `
        .##.##
        ..#..#
        .#..#.`,
    },
    // Mittelpunkt als Trenner („Tag 3 · 12:00“): ein Punkt wie der Satzpunkt, mittig in der x-Höhe.
    '·': {
      vorschub: 3,
      oben: 2,
      raster: `
        .#`,
    },
    // Auslassungspunkte auf der Grundlinie, enger als drei Satzpunkte.
    '…': {
      vorschub: 7,
      oben: 0,
      raster: `
        .#.#.#`,
    },
    '•': {
      vorschub: 6,
      oben: 4,
      raster: `
        ..##.
        .####
        .####
        ..##.`,
    },
  },
};
