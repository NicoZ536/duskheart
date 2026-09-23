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
  // T0 Feuerstein/Stein: die gezeichnete Form selbst.
  { id: 'stein', stufe: 0, zeile: 'stufe_stein', farben: ['stein.0', 'stein.1', 'stein.2', 'stein.3', 'stein.4', 'stein.5'], metall: false, kristall: false, leuchtetAb: null },
  // T1 Bronze: rotbraun → honiggold.
  { id: 'bronze', stufe: 1, zeile: 'stufe_bronze', farben: ['erde.1', 'holz.2', 'holz.3', 'laub.3', 'sand.3', 'sand.4'], metall: true, kristall: false, leuchtetAb: null },
  // T2 Eisen: dunkles, kühles Grau.
  { id: 'eisen', stufe: 2, zeile: 'stufe_eisen', farben: ['nacht.2', 'nacht.3', 'stein.1', 'stein.2', 'stein.3', 'stein.4'], metall: true, kristall: false, leuchtetAb: null },
  // T3 Stahl: helles Blaugrau mit eisweißer Schneide.
  { id: 'stahl', stufe: 3, zeile: 'stufe_stahl', farben: ['nacht.2', 'stein.1', 'stein.2', 'stein.4', 'eis.3', 'eis.4'], metall: true, kristall: false, leuchtetAb: null },
  // T4 Sonnenstahl: Gold mit weißgelbem Glanz.
  { id: 'sonnenstahl', stufe: 4, zeile: 'stufe_sonnenstahl', farben: ['holz.1', 'laub.2', 'laub.3', 'laub.4', 'sand.4', 'feuer.5'], metall: true, kristall: false, leuchtetAb: null },
  // T5 Magmit: schwarzes Vulkangestein, die hellen Stufen glühen.
  { id: 'magmit', stufe: 5, zeile: 'stufe_magmit', farben: ['erde.0', 'laub.0', 'feuer.0', 'feuer.1', 'feuer.2', 'feuer.3'], metall: true, kristall: false, leuchtetAb: 4 },
  // T6 Lumenit: türkiser Kristall mit leuchtender Kante.
  { id: 'lumenit', stufe: 6, zeile: 'stufe_lumenit', farben: ['wasser.1', 'wasser.2', 'wasser.3', 'wasser.4', 'eis.3', 'eis.4'], metall: false, kristall: true, leuchtetAb: 4 },
  // T7 Nachtstahl: violettschwarz mit violettem Schimmer und kalt-heller Schneide.
  { id: 'nachtstahl', stufe: 7, zeile: 'stufe_nachtstahl', farben: ['nacht.2', 'verderb.1', 'verderb.2', 'verderb.3', 'verderb.4', 'eis.2'], metall: true, kristall: false, leuchtetAb: null },
];

/** Rampe, mit der Werkzeugköpfe gezeichnet werden (Quelle der Materialstufen-Zeilen). */
export const MATERIAL_SOURCE_RAMP = 'stein';

/**
 * Farbidentität eines Bioms (docs/ART.md §5): Grundton, Akzent und Nachtfarbe als Palettenreferenzen
 * und die Tönung (Rampen → Zielstufen, dunkel → hell) der Palettenzeile `zeile`. Die Grading-Absicht
 * steht in docs/ART.md; `tests/unit/assets/biom-farben.test.ts` hält Dokument und Daten gleich.
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
      gras: ['gras.1', 'gras.2', 'gras.2', 'gras.3', 'stein.4', 'sand.4'],
      erde: ['erde.1', 'erde.2', 'sand.0', 'sand.1', 'sand.2'],
      stein: ['stein.1', 'stein.2', 'stein.3', 'stein.4', 'stein.5', 'sand.4'],
    },
  },
  {
    biom: 'nebelmoor',
    ebene: 0,
    zeile: 'biom_nebelmoor',
    grundton: ['gras.1', 'gras.2', 'erde.1', 'stein.2'],
    akzent: ['gras.5', 'eis.2', 'laub.2'],
    nacht: 'gras.0',
    toenung: {
      gras: ['nacht.1', 'gras.0', 'gras.1', 'gras.2', 'gras.3', 'stein.3'],
      erde: ['nacht.1', 'erde.0', 'erde.1', 'erde.2', 'holz.2'],
      stein: ['nacht.2', 'stein.0', 'stein.1', 'stein.2', 'stein.3', 'stein.4'],
      holz: ['nacht.1', 'holz.0', 'holz.1', 'erde.2', 'holz.2'],
    },
  },
  {
    biom: 'frostkamm',
    ebene: 0,
    zeile: 'biom_frostkamm',
    grundton: ['eis.3', 'eis.2', 'stein.2', 'gras.1'],
    akzent: ['laub.2', 'wasser.4', 'eis.4'],
    nacht: 'eis.0',
    toenung: {
      gras: ['gras.0', 'gras.1', 'gras.2', 'stein.3', 'eis.1', 'eis.2'],
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
    akzent: ['feuer.3', 'feuer.4', 'sand.3'],
    nacht: 'feuer.0',
    toenung: {
      gras: ['nacht.0', 'nacht.1', 'nacht.2', 'stein.1', 'stein.2', 'stein.3'],
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
    grundton: ['erde.1', 'erde.2', 'holz.1', 'gras.1'],
    akzent: ['wasser.4', 'wasser.5', 'sand.3'],
    nacht: 'erde.0',
    toenung: {
      gras: ['nacht.1', 'gras.0', 'gras.0', 'gras.1', 'gras.2', 'gras.3'],
      erde: ['nacht.1', 'erde.0', 'erde.1', 'erde.2', 'erde.3'],
      stein: ['erde.0', 'erde.1', 'stein.1', 'stein.2', 'stein.3', 'erde.4'],
    },
  },
  {
    biom: 'tiefgrund',
    ebene: -2,
    zeile: 'biom_tiefgrund',
    grundton: ['stein.1', 'stein.2', 'nacht.3', 'stein.0'],
    akzent: ['eis.2', 'wasser.5', 'sand.3'],
    nacht: 'wasser.0',
    toenung: {
      gras: ['nacht.1', 'nacht.2', 'stein.1', 'stein.2', 'wasser.3', 'wasser.4'],
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
