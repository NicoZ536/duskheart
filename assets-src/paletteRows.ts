/**
 * Palettenzeilen (MASTERPROMPT §4.3, docs/RENDER.md §1): Jede Zeile bildet jeden der 64
 * Palettenindizes auf einen Palettenindex ab. Der Shader schlägt die Farbe eines Pixels über
 * (Palettenindex, Zeile) in der Paletten-LUT nach – so entstehen Jahreszeiten-Laub, Verderbnis,
 * Elite-Umfärbungen und Materialstufen ohne neue Sprites.
 *
 * - `basis`: Identität (so, wie die Sprites gezeichnet sind).
 * - Jahreszeiten: Laub-Sprites zeichnen Blätter mit der Rampe `gras` (Sommerlaub); `laub` sind von
 *   Natur aus rote/goldene Pflanzenteile (Herbstarten, Falllaub, Streudeko). Frühling hellt `gras`
 *   auf, Herbst tauscht `gras` gegen `laub`, Winter macht beide stumpf und kalt.
 * - `verderbnis`: jede Rampe kippt dunkel-violett und entsättigt (verdorbenes Land, §6.2); die
 *   Stufenreihenfolge (dunkel → hell) bleibt erhalten, damit Schattierung lesbar bleibt.
 * - `elite`: feste Rampentausche für Elite-Gegner (lesbar in jedem Biom).
 * - Materialstufen T0–T7: Werkzeugköpfe werden mit der Rampe `stein` gezeichnet; jede Stufenzeile
 *   bildet `stein` auf die Farben ihres Materials ab (eine Form × 8 Material-Rampen).
 * - Biom-Tönung `biom_<id>` (docs/ART.md §5): gemeinsam genutzte Sprites (Grasböden, Felsen, Bäume,
 *   Streudeko) sind in Grünhain-Farben gezeichnet; die Biomzeile tönt ihre Rampen `gras`, `erde`,
 *   `stein`, `holz` und `laub` in die Farbidentität des Bioms, ohne neue Sprites.
 * - Art-Jahreszeiten `<jahreszeit>_<art>` (M2-20): Blüten und Früchte der Obstbäume, Schnee auf
 *   Nadelbäumen, immergrüne Arten; `jahreszeitZeile()` wählt die Zeile eines Baum-Sprites.
 */
import { MASTER_COLOR_COUNT, findRamp, paletteIndex, rampStart } from './palette';

/** Eine Palettenzeile: `map[i]` ist der Zielindex (1…64) für Palettenindex `i + 1`. */
export interface PaletteRow {
  readonly id: string;
  readonly beschreibung: string;
  readonly map: readonly number[];
}

/** Identitätsabbildung der 64 Palettenindizes. */
export function identityMap(): number[] {
  return Array.from({ length: MASTER_COLOR_COUNT }, (_, i) => i + 1);
}

function rampLength(name: string): number {
  const ramp = findRamp(name);
  if (ramp === undefined) throw new Error(`Palettenzeile: unbekannte Rampe ${name}`);
  return ramp.colors.length;
}

/**
 * Stufe für Stufe von Rampe `from` auf Rampe `to` (relative Position: erste → erste, letzte →
 * letzte, dazwischen gerundet). Liefert die Zielreferenzen `rampe.stufe`.
 */
export function rampTargets(from: string, to: string): string[] {
  const n = rampLength(from);
  const m = rampLength(to);
  return Array.from({ length: n }, (_, i) => `${to}.${n === 1 ? 0 : Math.round((i * (m - 1)) / (n - 1))}`);
}

/** Setzt in `map` jede Stufe der Rampe `from` auf die passende Referenz aus `targets`. */
export function remapRamp(map: number[], from: string, targets: readonly string[]): number[] {
  const n = rampLength(from);
  if (targets.length !== n) throw new Error(`Palettenzeile: Rampe ${from} hat ${n} Stufen, Abbildung nennt ${targets.length}`);
  const start = rampStart(from);
  targets.forEach((ref, step) => {
    map[start - 1 + step] = paletteIndex(ref);
  });
  return map;
}

/** Zeile aus Rampen-Abbildungen: `{ gras: ['laub.0', …] }` oder `{ erde: 'laub' }` (ganze Rampe). */
export function rowFromRamps(id: string, beschreibung: string, ramps: Readonly<Record<string, string | readonly string[]>>): PaletteRow {
  const map = identityMap();
  for (const [from, to] of Object.entries(ramps)) remapRamp(map, from, typeof to === 'string' ? rampTargets(from, to) : to);
  return { id, beschreibung, map };
}

/** Materialstufen T0–T7 (§13.2): Werkzeugmaterial, Palettenzeile und Materialeigenschaften. */
export interface MaterialTier {
  /** Materialname = Suffix der Stufen-Sprites (`axt_bronze`). */
  readonly id: string;
  /** Stufe T0–T7. */
  readonly stufe: number;
  /** Id der Palettenzeile, die die Rampe `stein` auf das Material abbildet. */
  readonly zeile: string;
  /** `stein.0` … `stein.5` → Materialfarbe (dunkel → hell). */
  readonly farben: readonly string[];
  /** Metallglanz (Materialflag Bit 0) für die umgefärbten Pixel. */
  readonly metall: boolean;
  /** Eis-/Kristallglanz (Materialflag Bit 2). */
  readonly kristall: boolean;
  /** Ab dieser `stein`-Stufe leuchten die umgefärbten Pixel (emissiv); `null` = nie. */
  readonly leuchtetAb: number | null;
}

export const MATERIAL_TIERS: readonly MaterialTier[] = [
  // T0 Feuerstein/Stein: wie gezeichnet – Werkzeuge bekommen dafür eine eigene Form aus geschlagenem
  // Stein (`materialStufen(…, eigeneFormen)`, ADR-0017).
  { id: 'stein', stufe: 0, zeile: 'stufe_stein', farben: ['stein.0', 'stein.1', 'stein.2', 'stein.3', 'stein.4', 'stein.5'], metall: false, kristall: false, leuchtetAb: null },
  // T1 Bronze: braun im Schatten, rostiges Orange, matter Glanz in Messingtönen – dunkler und
  // brauner als Sonnenstahl, wärmer und heller als das dunkelrote Magmit (M1-30).
  { id: 'bronze', stufe: 1, zeile: 'stufe_bronze', farben: ['erde.0', 'erde.1', 'laub.2', 'holz.3', 'laub.3', 'sand.2'], metall: true, kristall: false, leuchtetAb: null },
  // T2 Eisen: dunkles, stumpfes Schmiedeeisen mit violettgrauen Schatten; die Schneide bleibt mittelgrau.
  { id: 'eisen', stufe: 2, zeile: 'stufe_eisen', farben: ['nacht.2', 'nacht.3', 'nacht.4', 'stein.2', 'stein.3', 'stein.4'], metall: true, kristall: false, leuchtetAb: null },
  // T3 Stahl: helles, neutrales Silbergrau mit eisweißer, polierter Schneide – deutlich heller als Eisen,
  // weniger blau als Lumenit.
  { id: 'stahl', stufe: 3, zeile: 'stufe_stahl', farben: ['stein.1', 'stein.2', 'stein.3', 'stein.4', 'eis.3', 'eis.4'], metall: true, kristall: false, leuchtetAb: null },
  // T4 Sonnenstahl: leuchtendes Goldgelb bis Weißgelb, nur der tiefste Schatten ist Holzbraun.
  { id: 'sonnenstahl', stufe: 4, zeile: 'stufe_sonnenstahl', farben: ['holz.1', 'sand.1', 'laub.4', 'feuer.4', 'sand.4', 'feuer.5'], metall: true, kristall: false, leuchtetAb: null },
  // T5 Magmit: schwarzes Vulkangestein, die hellen Stufen glühen.
  { id: 'magmit', stufe: 5, zeile: 'stufe_magmit', farben: ['erde.0', 'laub.0', 'feuer.0', 'feuer.1', 'feuer.2', 'feuer.3'], metall: true, kristall: false, leuchtetAb: 4 },
  // T6 Lumenit: türkiser Kristall mit mintfarben leuchtender Kante.
  { id: 'lumenit', stufe: 6, zeile: 'stufe_lumenit', farben: ['wasser.1', 'wasser.2', 'wasser.3', 'wasser.4', 'wasser.5', 'eis.4'], metall: false, kristall: true, leuchtetAb: 4 },
  // T7 Nachtstahl: violettschwarz mit violettem Schimmer und kalt-heller Schneide.
  { id: 'nachtstahl', stufe: 7, zeile: 'stufe_nachtstahl', farben: ['nacht.2', 'verderb.1', 'verderb.2', 'verderb.3', 'verderb.4', 'eis.2'], metall: true, kristall: false, leuchtetAb: null },
];

/** Rampe, mit der Werkzeugköpfe gezeichnet werden (Quelle der Materialstufen-Zeilen). */
export const MATERIAL_SOURCE_RAMP = 'stein';

/**
 * Farbidentität eines Bioms (docs/ART.md §5): Grundton, Akzent und Nachtfarbe als Palettenreferenzen
 * und die Tönung (Rampen → Zielstufen, dunkel → hell) der Palettenzeile `zeile`. Die Grading-Absicht
 * steht in docs/ART.md; `tests/unit/assets/biom-farben.test.ts` hält Dokument und Daten gleich.
 *
 * Jede Tönung muss das Biom am Farbton erkennbar machen, nicht nur an der Helligkeit – eine bloß
 * dunklere Grünhain-Wiese liest sich als Grünhain in der Dämmerung (M1-31). Deshalb bekommt die
 * Grundfarbe des Grases (`gras.3`) in jedem Biom einen eigenen Farbton: Sand mit türkisem Dünengras
 * (Salzküste), Nebelgrau mit petrolgrünen Halmen (Nebelmoor), Schnee (Frostkamm), Wurzelbraun mit
 * Moos (Wurzelhöhlen), tiefblaue Flechten (Tiefgrund) … `tests/unit/assets/biom-abstand.test.ts`
 * misst das am Landschaftsbild (ADR-0017).
 */
export interface BiomeTint {
  /** Biom-Id (Content, MASTERPROMPT §9.3). */
  readonly biom: string;
  /** Ebene: 0 = Oberfläche, −1 … −3 = Untergrund. */
  readonly ebene: 0 | -1 | -2 | -3;
  /** Id der Palettenzeile. */
  readonly zeile: string;
  /** Flächenfarben, die das Biom tragen (Boden, Gestein, Vegetation). */
  readonly grundton: readonly string[];
  /** Seltene, lesbare Akzentfarben (Blüten, Glut, Kristalle, Wasserstellen). */
  readonly akzent: readonly string[];
  /** Farbe der Dunkelheit (Schatten- und Umgebungston bei Nacht bzw. in der Höhle). */
  readonly nacht: string;
  /** Tönung gemeinsamer Sprites: Rampe → Zielreferenzen je Stufe. */
  readonly toenung: Readonly<Record<string, readonly string[]>>;
}

export const BIOME_TINTS: readonly BiomeTint[] = [
  // Grünhain ist die Referenz: gemeinsame Sprites sind in seinen Farben gezeichnet.
  { biom: 'gruenhain', ebene: 0, zeile: 'biom_gruenhain', grundton: ['gras.3', 'gras.2', 'erde.2', 'holz.2'], akzent: ['laub.4', 'sand.4', 'laub.2'], nacht: 'wasser.1', toenung: {} },
  {
    biom: 'salzkueste',
    ebene: 0,
    zeile: 'biom_salzkueste',
    grundton: ['sand.3', 'sand.2', 'wasser.3', 'stein.4'],
    akzent: ['eis.3', 'laub.3', 'wasser.5'],
    nacht: 'wasser.0',
    toenung: {
      // Der Boden der Salzküste ist Sand und Dünengras in Endfarben (M2-31); die Zeile tönt nur geteilte
      // Sprites und den Biomsaum der Nachbarkacheln: Grasflächen laufen in Sand aus, die dunklen Halme
      // bleiben grün (vorher Marineblau – blaue Linien auf dem Sand), Lichter werden Salz und Gischt.
      gras: ['wasser.1', 'gras.1', 'gras.2', 'sand.3', 'sand.4', 'eis.4'],
      erde: ['erde.1', 'erde.2', 'sand.0', 'sand.1', 'sand.2'],
      stein: ['stein.1', 'stein.2', 'stein.3', 'stein.4', 'stein.5', 'sand.4'],
    },
  },
  {
    biom: 'nebelmoor',
    ebene: 0,
    zeile: 'biom_nebelmoor',
    grundton: ['stein.3', 'gras.1', 'erde.1', 'stein.2'],
    akzent: ['gras.5', 'eis.2', 'laub.2'],
    nacht: 'gras.0',
    toenung: {
      gras: ['gras.0', 'gras.1', 'gras.1', 'stein.3', 'stein.4', 'gras.5'],
      erde: ['nacht.1', 'erde.0', 'erde.1', 'erde.2', 'holz.2'],
      stein: ['nacht.2', 'stein.0', 'stein.1', 'stein.2', 'stein.3', 'stein.4'],
      holz: ['nacht.1', 'holz.0', 'holz.1', 'erde.2', 'holz.2'],
    },
  },
  {
    biom: 'frostkamm',
    ebene: 0,
    zeile: 'biom_frostkamm',
    grundton: ['eis.2', 'eis.3', 'stein.2', 'eis.0'],
    akzent: ['laub.2', 'wasser.4', 'eis.4'],
    nacht: 'eis.0',
    toenung: {
      gras: ['nacht.2', 'stein.2', 'eis.0', 'eis.2', 'eis.3', 'eis.4'],
      erde: ['nacht.1', 'erde.0', 'erde.1', 'stein.2', 'stein.3'],
      stein: ['nacht.2', 'stein.1', 'stein.2', 'stein.3', 'eis.1', 'eis.3'],
    },
  },
  {
    biom: 'glutsand',
    ebene: 0,
    zeile: 'biom_glutsand',
    grundton: ['sand.2', 'sand.3', 'erde.3', 'laub.3'],
    akzent: ['wasser.4', 'gras.4', 'feuer.4'],
    nacht: 'verderb.1',
    toenung: {
      gras: ['erde.1', 'holz.1', 'gras.2', 'holz.3', 'sand.2', 'sand.3'],
      erde: ['erde.1', 'erde.2', 'erde.3', 'sand.1', 'sand.2'],
      stein: ['erde.0', 'erde.1', 'erde.2', 'erde.3', 'sand.2', 'sand.3'],
    },
  },
  {
    biom: 'aschenschlund',
    ebene: 0,
    zeile: 'biom_aschenschlund',
    grundton: ['nacht.2', 'stein.1', 'stein.2', 'nacht.3'],
    akzent: ['feuer.3', 'feuer.4', 'laub.2', 'sand.3'],
    nacht: 'feuer.0',
    toenung: {
      gras: ['nacht.0', 'nacht.1', 'nacht.2', 'stein.1', 'laub.1', 'laub.2'],
      erde: ['nacht.1', 'nacht.2', 'stein.0', 'stein.1', 'stein.2'],
      stein: ['nacht.0', 'nacht.1', 'nacht.2', 'nacht.3', 'stein.2', 'stein.3'],
      holz: ['nacht.0', 'nacht.1', 'erde.0', 'erde.1', 'erde.2'],
    },
  },
  {
    biom: 'scherbenhain',
    ebene: 0,
    zeile: 'biom_scherbenhain',
    grundton: ['wasser.3', 'eis.1', 'eis.2', 'nacht.3'],
    akzent: ['verderb.4', 'eis.4', 'wasser.5'],
    nacht: 'verderb.1',
    toenung: {
      gras: ['wasser.0', 'wasser.1', 'wasser.2', 'wasser.3', 'wasser.4', 'wasser.5'],
      erde: ['verderb.0', 'nacht.2', 'verderb.1', 'nacht.3', 'stein.2'],
      stein: ['nacht.2', 'nacht.3', 'stein.2', 'eis.0', 'eis.1', 'eis.3'],
      holz: ['stein.1', 'stein.2', 'stein.3', 'eis.1', 'eis.2'],
    },
  },
  {
    biom: 'nachtherz',
    ebene: 0,
    zeile: 'biom_nachtherz',
    grundton: ['nacht.2', 'verderb.1', 'nacht.3', 'verderb.2'],
    akzent: ['verderb.4', 'eis.4', 'verderb.3'],
    nacht: 'nacht.0',
    toenung: {
      gras: ['nacht.0', 'verderb.0', 'nacht.2', 'verderb.1', 'nacht.3', 'verderb.2'],
      erde: ['nacht.0', 'verderb.0', 'nacht.2', 'verderb.1', 'nacht.3'],
      stein: ['nacht.0', 'nacht.1', 'nacht.2', 'nacht.3', 'verderb.2', 'nacht.4'],
      holz: ['nacht.0', 'nacht.1', 'nacht.2', 'verderb.1', 'nacht.3'],
      laub: ['verderb.0', 'verderb.1', 'verderb.2', 'verderb.3', 'verderb.4'],
    },
  },
  {
    biom: 'wurzelhoehlen',
    ebene: -1,
    zeile: 'biom_wurzelhoehlen',
    grundton: ['holz.1', 'erde.0', 'erde.1', 'gras.2'],
    akzent: ['wasser.4', 'wasser.5', 'sand.3'],
    nacht: 'erde.0',
    toenung: {
      gras: ['nacht.1', 'erde.0', 'erde.1', 'holz.1', 'gras.2', 'holz.2'],
      erde: ['nacht.0', 'nacht.1', 'erde.0', 'erde.1', 'erde.2'],
      stein: ['erde.0', 'erde.1', 'stein.1', 'stein.2', 'stein.3', 'erde.4'],
    },
  },
  {
    biom: 'tiefgrund',
    ebene: -2,
    zeile: 'biom_tiefgrund',
    grundton: ['stein.1', 'stein.2', 'wasser.2', 'stein.0'],
    akzent: ['eis.2', 'wasser.5', 'sand.3'],
    nacht: 'wasser.0',
    toenung: {
      gras: ['nacht.1', 'nacht.2', 'stein.1', 'wasser.2', 'wasser.3', 'wasser.4'],
      erde: ['nacht.1', 'nacht.2', 'stein.0', 'stein.1', 'stein.2'],
      stein: ['nacht.1', 'nacht.2', 'stein.1', 'stein.2', 'stein.3', 'eis.1'],
    },
  },
  {
    biom: 'glutadern',
    ebene: -3,
    zeile: 'biom_glutadern',
    grundton: ['nacht.1', 'erde.0', 'laub.0', 'feuer.1'],
    akzent: ['feuer.3', 'feuer.4', 'wasser.4'],
    nacht: 'feuer.0',
    toenung: {
      gras: ['nacht.0', 'erde.0', 'laub.0', 'feuer.0', 'laub.1', 'feuer.1'],
      erde: ['nacht.0', 'erde.0', 'laub.0', 'erde.1', 'laub.1'],
      stein: ['nacht.0', 'nacht.1', 'erde.0', 'laub.0', 'erde.1', 'erde.2'],
    },
  },
];

/** Jahreszeiten in Kalenderreihenfolge (Ids der allgemeinen Laubzeilen). */
export const JAHRESZEITEN = ['fruehling', 'sommer', 'herbst', 'winter'] as const;
export type Jahreszeit = (typeof JAHRESZEITEN)[number];

/**
 * Jahreszeitliche Sonderzeile einer Baumart (M2-20, docs/ART.md §5 „Jahreszeiten“): Zeile
 * `<jahreszeit>_<art>` ersetzt für alle Sprites `baum_<art>…` (Baum, Stumpf, Setzling) die allgemeine
 * Zeile der Jahreszeit. Wo keine Sonderzeile steht, gilt die allgemeine (`jahreszeitZeile`).
 *
 * Zeichenkonvention der Obstbäume: Blätter in `gras` (Stufen 0–4), Früchte in `laub` (Apfel und
 * Kirsche `laub.2`/`laub.3`, Birne und Walnuss `laub.3`/`laub.4`). Die Frühlingszeile färbt die
 * Lichtseiten der Krone und die Fruchtpixel in Blütenfarben, die Sommerzeile zeigt unreife oder reife
 * Früchte, die Herbstzeile reife Früchte vor einem Laub, von dem sie sich abheben. Im Winter stehen
 * Laubbäume kahl (Frame `winter`), die allgemeine Winterzeile gilt. Nadelbäume tragen im Winter Schnee
 * auf den Lichtkappen und bleiben im Herbst grün; Palme und Mangrove bleiben immergrün.
 */
export interface ArtZeile {
  readonly art: string;
  readonly jahreszeit: Jahreszeit;
  readonly beschreibung: string;
  readonly toenung: Readonly<Record<string, readonly string[]>>;
}

/** Nadelbaum im Winter: Lichtkappen der Nadelbüschel werden Schnee, das Grün dunkelt nach. */
const NADEL_SCHNEE = { gras: ['gras.0', 'gras.1', 'gras.1', 'gras.2', 'eis.3', 'eis.4'] } as const;

export const ART_ZEILEN: readonly ArtZeile[] = [
  { art: 'tanne', jahreszeit: 'herbst', beschreibung: 'Tanne im Herbst: immergrün wie gezeichnet', toenung: {} },
  { art: 'tanne', jahreszeit: 'winter', beschreibung: 'Tanne im Winter: Schnee auf den Nadelkappen', toenung: NADEL_SCHNEE },
  { art: 'kiefer', jahreszeit: 'herbst', beschreibung: 'Kiefer im Herbst: immergrün wie gezeichnet', toenung: {} },
  { art: 'kiefer', jahreszeit: 'winter', beschreibung: 'Kiefer im Winter: Schnee auf den Nadelkappen', toenung: NADEL_SCHNEE },
  { art: 'dattelpalme', jahreszeit: 'herbst', beschreibung: 'Dattelpalme im Herbst: immergrün wie gezeichnet', toenung: {} },
  { art: 'dattelpalme', jahreszeit: 'winter', beschreibung: 'Dattelpalme im Winter: immergrün wie gezeichnet', toenung: {} },
  { art: 'mangrove', jahreszeit: 'herbst', beschreibung: 'Mangrove im Herbst: immergrün wie gezeichnet', toenung: {} },
  { art: 'mangrove', jahreszeit: 'winter', beschreibung: 'Mangrove im Winter: immergrün wie gezeichnet', toenung: {} },
  {
    art: 'birke',
    jahreszeit: 'herbst',
    beschreibung: 'Birke im Herbst: goldgelbes Laub',
    toenung: { gras: ['laub.0', 'laub.1', 'laub.3', 'laub.4', 'sand.3', 'sand.4'] },
  },
  {
    art: 'weide',
    jahreszeit: 'herbst',
    beschreibung: 'Weide im Herbst: gelbes Laub, grüne Schatten',
    toenung: { gras: ['gras.0', 'gras.1', 'holz.3', 'laub.4', 'sand.3', 'sand.4'] },
  },
  {
    art: 'apfelbaum',
    jahreszeit: 'fruehling',
    beschreibung: 'Apfelbaum im Frühling: rosa-weiße Blüten auf den Lichtseiten',
    toenung: { gras: ['gras.0', 'gras.1', 'gras.2', 'gras.3', 'haut.4', 'eis.4'], laub: ['laub.0', 'laub.1', 'haut.3', 'eis.4', 'eis.4'] },
  },
  {
    art: 'apfelbaum',
    jahreszeit: 'sommer',
    beschreibung: 'Apfelbaum im Sommer: gelbgrüne Äpfel mit roter Backe',
    toenung: { laub: ['laub.0', 'laub.1', 'laub.2', 'gras.5', 'gras.5'] },
  },
  {
    art: 'apfelbaum',
    jahreszeit: 'herbst',
    beschreibung: 'Apfelbaum im Herbst: rote Äpfel vor olivgoldenem Laub',
    toenung: { gras: ['gras.0', 'gras.1', 'gras.2', 'holz.3', 'sand.2', 'sand.3'], laub: ['laub.0', 'laub.1', 'feuer.1', 'feuer.2', 'feuer.2'] },
  },
  {
    art: 'kirschbaum',
    jahreszeit: 'fruehling',
    beschreibung: 'Kirschbaum im Frühling: rosa Blütenwolke, grüne Schatten',
    toenung: { gras: ['gras.0', 'gras.1', 'gras.2', 'haut.3', 'haut.4', 'eis.4'], laub: ['laub.0', 'laub.1', 'haut.3', 'haut.4', 'eis.4'] },
  },
  {
    art: 'kirschbaum',
    jahreszeit: 'sommer',
    beschreibung: 'Kirschbaum im Sommer: dunkelrote reife Kirschen',
    toenung: { laub: ['laub.0', 'laub.0', 'feuer.0', 'feuer.1', 'feuer.2'] },
  },
  {
    art: 'kirschbaum',
    jahreszeit: 'herbst',
    beschreibung: 'Kirschbaum im Herbst: abgeerntet, orangerotes Laub',
    toenung: { gras: ['laub.0', 'laub.1', 'laub.2', 'laub.3', 'laub.4', 'sand.3'] },
  },
  {
    art: 'birnbaum',
    jahreszeit: 'fruehling',
    beschreibung: 'Birnbaum im Frühling: cremeweiße Blüten auf den Lichtseiten',
    toenung: { gras: ['gras.0', 'gras.1', 'gras.2', 'gras.3', 'sand.4', 'eis.4'], laub: ['laub.0', 'laub.1', 'sand.3', 'eis.4', 'eis.4'] },
  },
  {
    art: 'birnbaum',
    jahreszeit: 'sommer',
    beschreibung: 'Birnbaum im Sommer: grüne Birnen',
    toenung: { laub: ['laub.0', 'laub.1', 'gras.3', 'gras.4', 'gras.5'] },
  },
  {
    art: 'birnbaum',
    jahreszeit: 'herbst',
    beschreibung: 'Birnbaum im Herbst: gelbe Birnen vor rotem Laub',
    toenung: { gras: ['laub.0', 'laub.0', 'laub.1', 'laub.2', 'laub.3', 'laub.4'], laub: ['laub.0', 'laub.1', 'laub.2', 'sand.3', 'sand.4'] },
  },
  {
    art: 'walnussbaum',
    jahreszeit: 'fruehling',
    beschreibung: 'Walnussbaum im Frühling: frisches Laub, blassgelbe Kätzchen',
    toenung: { gras: ['gras.0', 'gras.2', 'gras.3', 'gras.4', 'gras.5', 'sand.4'], laub: ['laub.0', 'laub.1', 'laub.2', 'sand.2', 'sand.3'] },
  },
  {
    art: 'walnussbaum',
    jahreszeit: 'sommer',
    beschreibung: 'Walnussbaum im Sommer: grüne Fruchthüllen',
    toenung: { laub: ['laub.0', 'laub.1', 'gras.3', 'gras.4', 'gras.5'] },
  },
  {
    art: 'walnussbaum',
    jahreszeit: 'herbst',
    beschreibung: 'Walnussbaum im Herbst: braune Nüsse vor goldgelbem Laub',
    toenung: { gras: ['gras.0', 'gras.1', 'holz.2', 'laub.3', 'laub.4', 'sand.4'], laub: ['laub.0', 'holz.1', 'holz.1', 'holz.2', 'holz.3'] },
  },
];

/** Id der Sonderzeile einer Art in einer Jahreszeit. */
export function artZeileId(art: string, jahreszeit: Jahreszeit): string {
  return `${jahreszeit}_${art}`;
}

/**
 * Palettenzeile eines Laub-Sprites je Jahreszeit: `<jahreszeit>_<art>`, wenn die Art eine Sonderzeile
 * hat, sonst die allgemeine Jahreszeitzeile. `spriteId` ist `baum_<art>`, `baum_<art>_stumpf` oder
 * `baum_<art>_setzling`; andere Sprites (Büsche, Gräser) nutzen die allgemeine Zeile.
 */
export function jahreszeitZeile(spriteId: string, jahreszeit: Jahreszeit): string {
  const m = /^baum_([a-z]+)/.exec(spriteId);
  const art = m?.[1];
  if (art !== undefined && ART_ZEILEN.some((z) => z.art === art && z.jahreszeit === jahreszeit)) return artZeileId(art, jahreszeit);
  return jahreszeit;
}

/**
 * Welt-Objekte, die über mehrere Biome geteilt und deshalb in Grünhain-Farben gezeichnet sind: sie
 * nehmen die Biomzeile des Tiles (docs/ART.md §5). Streudeko, Erzknoten und Kristalle (Wirtsgestein und
 * Sockel in `stein`, Erz und Kristall in Rampen, die keine Biomzeile ändert) sowie die Pflanzen, die in
 * mehreren Biomen wachsen.
 */
export const BIOM_GETOENT_PRAEFIXE: readonly string[] = ['deko_', 'erz_', 'kristall_'];
export const BIOM_GETOENT_IDS: readonly string[] = ['pflanze_fasergras', 'pflanze_steinpilz'];

/**
 * Palettenzeile eines Welt-Objekt-Sprites (M2-19/20/21, Vertrag für die Welt-Darstellung M2-28):
 * - `baum_*` (Baum, Stumpf, Setzling): Jahreszeitzeile der Art (`jahreszeitZeile`), keine Biomtönung –
 *   jede Art ist in ihren eigenen Farben gezeichnet.
 * - `busch_*`: allgemeine Jahreszeitzeile (Laub in `gras`/`laub`, Beeren und Blüten in eigenen Rampen).
 * - geteilte Sprites (`BIOM_GETOENT_*`): Biomzeile `biom_<biom>` des Tiles.
 * - alles Übrige (`fels_*_<biom>`, Einzelbiom-Pflanzen): `basis` – in Endfarben gezeichnet.
 */
export function objektZeile(spriteId: string, biom: string, jahreszeit: Jahreszeit): string {
  if (spriteId.startsWith('baum_')) return jahreszeitZeile(spriteId, jahreszeit);
  if (spriteId.startsWith('busch_')) return jahreszeit;
  if (BIOM_GETOENT_PRAEFIXE.some((p) => spriteId.startsWith(p)) || BIOM_GETOENT_IDS.includes(spriteId)) {
    const zeile = BIOME_TINTS.find((b) => b.biom === biom)?.zeile;
    if (zeile === undefined) throw new Error(`objektZeile: unbekanntes Biom ${biom}`);
    return zeile;
  }
  return 'basis';
}

/** Alle Palettenzeilen in fester Reihenfolge; Zeile 0 ist immer `basis`. */
export const PALETTE_ROWS: readonly PaletteRow[] = [
  { id: 'basis', beschreibung: 'Grundfarben (Identität)', map: identityMap() },
  rowFromRamps('fruehling', 'Frühling: frisches, helles Laub mit cremefarbenen Spitzen', {
    gras: ['gras.0', 'gras.2', 'gras.3', 'gras.4', 'gras.5', 'sand.4'],
  }),
  { id: 'sommer', beschreibung: 'Sommer: Laub wie gezeichnet', map: identityMap() },
  rowFromRamps('herbst', 'Herbst: Laub wird rot-golden, Rotlaub dunkelt nach', {
    gras: ['laub.0', 'laub.1', 'laub.2', 'laub.3', 'laub.4', 'sand.3'],
    laub: ['erde.0', 'laub.0', 'laub.1', 'laub.2', 'laub.3'],
  }),
  rowFromRamps('winter', 'Winter: stumpfes, kaltes Laub; Rotlaub verwelkt braun', {
    gras: ['nacht.1', 'gras.0', 'gras.1', 'stein.2', 'stein.3', 'stein.4'],
    laub: ['nacht.1', 'erde.0', 'erde.1', 'erde.2', 'erde.3'],
  }),
  rowFromRamps('verderbnis', 'Verderbnis: Land und Dinge kippen dunkel-violett und fahl (§6.2)', {
    stein: ['nacht.1', 'nacht.2', 'nacht.3', 'verderb.2', 'nacht.4', 'stein.3'],
    erde: ['verderb.0', 'nacht.2', 'verderb.1', 'nacht.3', 'nacht.4'],
    holz: ['verderb.0', 'verderb.1', 'nacht.3', 'verderb.2', 'nacht.4'],
    gras: ['verderb.0', 'nacht.2', 'verderb.1', 'nacht.3', 'verderb.2', 'nacht.4'],
    laub: 'verderb',
    wasser: ['nacht.0', 'verderb.0', 'nacht.2', 'verderb.1', 'nacht.3', 'nacht.4'],
    sand: ['nacht.3', 'nacht.4', 'stein.2', 'stein.3', 'stein.4'],
    feuer: ['verderb.0', 'verderb.1', 'verderb.2', 'verderb.3', 'verderb.4', 'eis.2'],
    haut: ['verderb.1', 'nacht.3', 'nacht.4', 'stein.3', 'stein.4'],
    eis: ['nacht.4', 'stein.2', 'stein.3', 'verderb.4', 'stein.5'],
  }),
  rowFromRamps('elite', 'Elite: rostrotes Fell, dunkle Panzer, Brut in Glut, Feuer violett', {
    erde: 'laub',
    stein: ['nacht.0', 'nacht.1', 'nacht.2', 'nacht.3', 'nacht.4', 'stein.3'],
    verderb: 'feuer',
    feuer: ['verderb.0', 'verderb.1', 'verderb.2', 'verderb.3', 'verderb.4', 'eis.2'],
  }),
  ...MATERIAL_TIERS.map((t) => rowFromRamps(t.zeile, `Materialstufe T${t.stufe} ${t.id}`, { [MATERIAL_SOURCE_RAMP]: t.farben })),
  ...BIOME_TINTS.map((b) => rowFromRamps(b.zeile, `Biom-Tönung ${b.biom} (Ebene ${b.ebene})`, b.toenung)),
  ...ART_ZEILEN.map((z) => rowFromRamps(artZeileId(z.art, z.jahreszeit), z.beschreibung, z.toenung)),
];

/** Index der Zeile `id` in `PALETTE_ROWS`; wirft bei unbekannter Zeile. */
export function paletteRowIndex(id: string): number {
  const i = PALETTE_ROWS.findIndex((r) => r.id === id);
  if (i < 0) throw new Error(`Palettenzeile ${id} fehlt`);
  return i;
}

/** Prüft alle Zeilen: eindeutige Ids, `basis` zuerst, je 64 Einträge im Bereich 1…64. */
export function validatePaletteRows(rows: readonly PaletteRow[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  if (rows[0]?.id !== 'basis') errors.push('Palettenzeile 0 muss "basis" sein');
  for (const row of rows) {
    if (seen.has(row.id)) errors.push(`Palettenzeile ${row.id} doppelt`);
    seen.add(row.id);
    if (row.map.length !== MASTER_COLOR_COUNT) errors.push(`Palettenzeile ${row.id}: ${row.map.length} Einträge statt ${MASTER_COLOR_COUNT}`);
    row.map.forEach((v, i) => {
      if (!Number.isInteger(v) || v < 1 || v > MASTER_COLOR_COUNT) errors.push(`Palettenzeile ${row.id}: Index ${i + 1} → ${v} liegt außerhalb der Palette`);
    });
  }
  return errors;
}
