/**
 * Legenden der Spielfigur (docs/ART.md §2.6 „Ein Material, eine Rampe“): Die Teile zeichnen mit
 * Material-Zeichen; hier bekommt jedes Zeichen seine Farbe – im Grundkörper, in den Kleidungs-Layern und
 * im angezogenen Vorschau-Körper (`spieler_koerper`).
 *
 * - Grundkörper `spieler_basis`: Haar `holz`, Haut `haut`, Unterkleid (Leinenkittel und -hose) `stein`,
 *   Stiefel `erde`, Kontur `nacht.1`, Gischtring beim Schwimmen `eis.3` – 12 Farben.
 * - Tunika-Layer: Tunika `wasser` (Kleidungsfarbe, §26), Gürtel `erde`.
 * - Hosen-Layer: Hose `wasser`.
 * Jede Rampe gehört genau einem Material, damit Palettenzeilen Haar, Haut, Kleidung und Leder
 * unabhängig umfärben können (Charakteranpassung).
 */

/** Material-Zeichen der Tunika (Layer `koerper`) und der Hose (Layer `beine`). */
export const TUNIKA_ZEICHEN: ReadonlySet<string> = new Set(['b', 't', 'T', 'g', 'G']);
export const HOSE_ZEICHEN: ReadonlySet<string> = new Set(['p', 'P']);
/** Konturzeichen (gehört an Kleidungsrändern mit zum Layer). */
export const KONTUR = 'k';

const GEMEINSAM = {
  '.': null,
  k: 'nacht.1',
  '1': 'holz.1',
  '2': 'holz.2',
  '3': 'holz.3',
  m: 'haut.2',
  S: 'haut.3',
  e: 'erde.1',
  E: 'erde.2',
  w: 'eis.3',
} as const;

/** Grundkörper: Unterkleid aus grauem Leinen. */
export const LEGENDE_BASIS = {
  ...GEMEINSAM,
  b: 'stein.2',
  t: 'stein.3',
  T: 'stein.4',
  g: 'stein.2',
  G: 'stein.3',
  p: 'stein.2',
  P: 'stein.3',
} as const;

/** Tunika in Kleidungsblau mit Ledergürtel. */
export const LEGENDE_TUNIKA = { '.': null, k: 'nacht.1', b: 'wasser.1', t: 'wasser.2', T: 'wasser.3', g: 'erde.1', G: 'erde.2' } as const;
/** Hose in dunklem Kleidungsblau. */
export const LEGENDE_HOSE = { '.': null, k: 'nacht.1', p: 'wasser.1', P: 'wasser.2' } as const;

/** Angezogen (Grundkörper + Tunika + Hose in einem Raster). */
export const LEGENDE_ANGEZOGEN = { ...GEMEINSAM, ...LEGENDE_TUNIKA, ...LEGENDE_HOSE } as const;
