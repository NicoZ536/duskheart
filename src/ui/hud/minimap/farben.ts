/**
 * Kartenfarben der Minimap (M3-28): welche Palettenfarbe eine Kachel auf der Karte bekommt. Die Karte ist
 * eine Lesehilfe, kein verkleinertes Weltbild – je Kachel genau eine Farbe, gewählt nach dem, was man
 * beim Laufen wissen muss: Wasser (tief/flach/zugefroren), Boden (getönt nach der Biom-Palettenzeile wie im
 * Weltbild, docs/ART.md §5), Wald als dunklere Fläche, Straßen, Brücken,
 * Höhleneingänge, Klippenkanten als Schattenzeile unter der höheren Stufe.
 *
 * `KARTEN_BODEN` nennt für jeden Terrain-Typ aus `src/content/terrain.ts` die Grundfarbe; der Unit-Test
 * `tests/unit/ui/minimap-raster.test.ts` verlangt einen Eintrag für jeden Typ, damit neue Terrains nicht
 * unbemerkt als Nebel erscheinen.
 */
import { CONTENT } from '../../../content/index';
import type { WorldObjectKind } from '../../../content/worldObjects';
import { contentWorldIdTables } from '../../../world/model/runtimeIds';
import { farbIndex, zeilenTabelle } from './palette';

/** Grundfarbe (`rampe.stufe`) je Terrain-Typ; `boden`-Typen werden danach mit der Biomzeile getönt. */
export const KARTEN_BODEN: Readonly<Record<string, string>> = {
  gras: 'gras.3',
  erde: 'erde.3',
  sand: 'sand.3',
  duenengras: 'sand.2',
  schnee: 'eis.4',
  asche: 'nacht.3',
  kristallboden: 'eis.2',
  moorschlamm: 'erde.1',
  torf: 'erde.2',
  meeresgrund: 'sand.1',
  strasse: 'stein.3',
  eis: 'eis.3',
  lava: 'feuer.3',
  hoehlenboden: 'stein.2',
  wurzelboden: 'erde.1',
  lehm: 'sand.1',
  obsidianboden: 'nacht.2',
  // Fester Fels im Untergrund: dunkle Masse, die offenen Gänge heben sich hell ab.
  fels: 'nacht.1',
  tiefenfels: 'nacht.1',
  glutfels: 'erde.0',
};
/** Farbe der Erzadern im Fels (alle Erze gleich: die Karte zeigt „hier ist Erz“, die Art zeigt die Welt). */
export const KARTEN_ERZADER = 'stein.1';

/**
 * Wald: Einzelne Objekte wären auf der Karte nur Streupunkte (docs/ART.md §2.2 „kein Streusel“). Bäume
 * zählen deshalb als Walddichte – eine Kachel wird Wald, wenn im 5×5-Fenster um sie mindestens
 * `WALD_SCHWELLE` Bäume stehen; so erscheinen Wälder als zusammenhängende dunkle Flächen, lichte Einzelbäume
 * und Felsen bleiben Boden (die Welt zeigt sie aus der Nähe).
 */
export const KARTEN_WALD = 'gras.1';
/** Objektarten, die als Wald zählen. */
export const WALD_ARTEN: ReadonlySet<WorldObjectKind> = new Set(['baum']);

/** Wasser: flach, tief (See/Fluss), tiefes Meer, zugefroren. */
export const KARTEN_WASSER = { flach: 'wasser.3', tief: 'wasser.2', meer: 'wasser.1', eis: 'eis.3' } as const;
/** Straße (Erbauer-Weg auf fremdem Boden), Brücke, Höhleneingang, Weg nach oben im Untergrund. */
export const KARTEN_WEG = { strasse: 'stein.3', bruecke: 'holz.3', eingang: 'nacht.0', aufgang: 'sand.4' } as const;
/** Nicht aufgedeckt oder noch nie geladen. */
export const KARTEN_NEBEL = 'nacht.1';

/** Die Farbtabellen einer Welt-ID-Belegung (Laufzeit-IDs → Palettenindex), einmal gebaut. */
export interface KartenFarbtabellen {
  /** Terrain-Laufzeit-ID → Palettenindex (Grundfarbe, vor der Biomzeile); 0 = unbekannt (Nebel). */
  readonly boden: Uint8Array;
  /** Terrain-Laufzeit-ID → 1, wenn der Typ ein `boden` ist (Biomzeile anwenden). */
  readonly bodenGetoent: Uint8Array;
  /** Terrain-Laufzeit-ID → 1 für Erzadern. */
  readonly erzader: Uint8Array;
  /** Biom-Laufzeit-ID → Palettenzeile (Index → Index) oder `null`. */
  readonly biomZeile: readonly (Uint8Array | null)[];
  /** Objekt-Laufzeit-ID → 1 für Bäume (Walddichte). */
  readonly baum: Uint8Array;
  /** Waldfarbe (vor der Biomzeile). */
  readonly wald: number;
  readonly wasserFlach: number;
  readonly wasserTief: number;
  readonly wasserMeer: number;
  readonly wasserEis: number;
  readonly strasse: number;
  readonly bruecke: number;
  readonly eingang: number;
  readonly aufgang: number;
  readonly erzFarbe: number;
  readonly nebel: number;
}

let tabellen: KartenFarbtabellen | null = null;

/** Die Farbtabellen der Content-IDs (`contentWorldIdTables`), beim ersten Aufruf gebaut. */
export function kartenFarbtabellen(): KartenFarbtabellen {
  if (tabellen !== null) return tabellen;
  const ids = contentWorldIdTables();
  const terrainDefs = new Map(CONTENT.collection('terrain').values().map((t) => [t.id, t] as const));
  const terrainIds = ids.terrain.ids();
  const boden = new Uint8Array(terrainIds.length + 1);
  const bodenGetoent = new Uint8Array(terrainIds.length + 1);
  const erzader = new Uint8Array(terrainIds.length + 1);
  terrainIds.forEach((id, i) => {
    const def = terrainDefs.get(id);
    if (id.startsWith('ader_')) {
      erzader[i + 1] = 1;
      boden[i + 1] = farbIndex(KARTEN_ERZADER);
      return;
    }
    const ref = KARTEN_BODEN[id];
    if (ref === undefined) return;
    boden[i + 1] = farbIndex(ref);
    bodenGetoent[i + 1] = def?.kind === 'boden' ? 1 : 0;
  });
  const biomZeile = [null, ...ids.biomes.ids().map((id) => zeilenTabelle(`biom_${id}`))];
  const objektDefs = new Map(CONTENT.collection('worldObjects').values().map((o) => [o.id, o] as const));
  const objektIds = ids.objects.ids();
  const baum = new Uint8Array(objektIds.length + 1);
  objektIds.forEach((id, i) => {
    const def = objektDefs.get(id);
    if (def !== undefined && WALD_ARTEN.has(def.kind)) baum[i + 1] = 1;
  });
  tabellen = {
    boden,
    bodenGetoent,
    erzader,
    biomZeile,
    baum,
    wald: farbIndex(KARTEN_WALD),
    wasserFlach: farbIndex(KARTEN_WASSER.flach),
    wasserTief: farbIndex(KARTEN_WASSER.tief),
    wasserMeer: farbIndex(KARTEN_WASSER.meer),
    wasserEis: farbIndex(KARTEN_WASSER.eis),
    strasse: farbIndex(KARTEN_WEG.strasse),
    bruecke: farbIndex(KARTEN_WEG.bruecke),
    eingang: farbIndex(KARTEN_WEG.eingang),
    aufgang: farbIndex(KARTEN_WEG.aufgang),
    erzFarbe: farbIndex(KARTEN_ERZADER),
    nebel: farbIndex(KARTEN_NEBEL),
  };
  return tabellen;
}
