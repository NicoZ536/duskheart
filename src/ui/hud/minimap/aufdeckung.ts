/**
 * Die Aufdeckung der Weltkarte für die Minimap (M7-49, M7-84; MASTERPROMPT §25 "Nebel über Unerkundetem"; docs/SPIEL.md §18
 * "Die Minimap zeigt ab M7 ebenfalls nur Aufgedecktes"): die Bitmaske der Kartenzellen (4 × 4 Kacheln) der Ebene des Spielers
 * aus `GameSession.sampleMap` (ohne Terrain: Budget 0), je Chunk als 32×32-Kachelmaske für das Raster der Minimap
 * (`AufdeckungQuelle`). Ein ganz aufgedeckter Chunk liefert `null` (kein Maskenvergleich je Kachel). `version` steigt, wenn sich
 * die Maske der gelesenen Ebene ändert oder die Ebene wechselt – die Minimap rastert dann neu.
 *
 * Der Rand ist ausgefranst wie auf der Karte statt in 4 × 4-Zellen gestuft (M7-84, `randMaskeInto`): jede Kachel liest die
 * Aufdeckung der vier nächsten Zellmitten bilinear (Ecken runden sich ab) und vergleicht sie mit einer Schwelle, die je Kachel
 * aus ihrem Hash um `RAND.zitter` um die Mitte streut (die Kante franst um eine Kachel hin und her); Nebelkacheln neben
 * aufgedecktem Land sind Randkacheln (`MASKE_RAND`), die das Raster im Schachbrett halb Land, halb Nebel zeichnet – wie der
 * Nebelsaum der Karte (src/ui/screens/karte/modell.ts). Alles ganzzahlig bis auf die Schwelle und eine reine Funktion der
 * Zellbits: dieselbe Kachel sieht in jedem Chunk, der sie liest, gleich aus (keine Naht an Chunkgrenzen).
 *
 * Ohne Allokation je Frame: die Sichten der vier Ebenen, die Chunkmaske und das Landfeld werden einmal angelegt.
 */
import { hash2, hashToUnit } from '../../../engine/rng';
import { createMapView, type MapView } from '../../../game/samples/orte';
import { CHUNK_AREA, CHUNK_SIZE, LAYER_COUNT, type Layer } from '../../../world/model/coords';
import { MASKE_AUF, MASKE_NEBEL, MASKE_RAND, type AufdeckungQuelle } from './raster';

/** Die Abtastung der Sitzung (`GameSession.sampleMap`). */
export type KartenAbtastung = (out: MapView, layer: Layer, budget: number) => MapView;

/**
 * Der ausgefranste Rand (M7-84): die Schwelle der bilinear gelesenen Aufdeckung (0 … 1) liegt je Kachel in
 * 0,5 ± `zitter` – bei 0,25 wird eine Kachel eine halbe Zelle vor der Zellkante (Anteil 5/8) zu drei Vierteln Land, die
 * erste dahinter (3/8) zu einem Viertel: die Kante springt um eine Kachel, nie um zwei (7/8 bleibt immer Land, 1/8 immer
 * Nebel) – ausgefranst, ohne Löcher im Aufgedeckten oder Inseln weit im Nebel. `salz` trennt den Hash von anderen Kachelhashes.
 */
export const RAND = { zitter: 0.25, salz: 0x6b61_7274 } as const;
const ZITTER = RAND.zitter;
const SALZ = RAND.salz;
/** Seite des Landfelds: der Chunk und ein Kachelring der Nachbarn (Randkacheln an der Chunkgrenze). */
const FELD_SEITE = CHUNK_SIZE + 2;

/** Was `randMaskeInto` von der Kartensicht liest. */
export type AufdeckungsBits = Pick<MapView, 'mask' | 'side' | 'cellTiles'>;

/** Ob Zelle (zx, zy) aufgedeckt ist (außerhalb der Welt: nein). */
function zelleAuf(v: AufdeckungsBits, zx: number, zy: number): number {
  if (zx < 0 || zy < 0 || zx >= v.side || zy >= v.side) return 0;
  const i = zy * v.side + zx;
  return ((v.mask[i >> 3] as number) >> (i & 7)) & 1;
}

/**
 * Ob die Kachel (gx, gy) [Weltkacheln] Land zeigt: die vier Zellmitten um ihre Mitte bilinear gewichtet (in Achteln der
 * doppelten Zellkante: ganzzahlig), gegen die Schwelle aus ihrem Hash (`RAND`).
 */
export function kachelAufgedeckt(v: AufdeckungsBits, gx: number, gy: number): boolean {
  const ct = v.cellTiles;
  const d = 2 * ct;
  // Die Kachelmitte relativ zur Mitte der Zelle links oben von ihr, in 1/d Zellen: ungerade 1 … d − 1.
  const qx = 2 * gx + 1 - ct;
  const qy = 2 * gy + 1 - ct;
  const zx = Math.floor(qx / d);
  const zy = Math.floor(qy / d);
  const fx = qx - zx * d;
  const fy = qy - zy * d;
  const a = zelleAuf(v, zx, zy);
  const b = zelleAuf(v, zx + 1, zy);
  const c = zelleAuf(v, zx, zy + 1);
  const e = zelleAuf(v, zx + 1, zy + 1);
  const summe = a + b + c + e;
  if (summe === 4) return true;
  if (summe === 0) return false;
  const anteil = (d - fx) * (d - fy) * a + fx * (d - fy) * b + (d - fx) * fy * c + fx * fy * e;
  const schwelle = (0.5 + (hashToUnit(hash2(gx, gy, SALZ)) * 2 - 1) * ZITTER) * d * d;
  return anteil > schwelle;
}

/**
 * Die Kachelmaske des Chunks (cx, cy) nach `out` (`CHUNK_AREA`): `MASKE_AUF` für Land, `MASKE_RAND` für Nebel neben Land
 * (eine der vier Nachbarkacheln, auch über die Chunkgrenze), sonst `MASKE_NEBEL`. `feld` (`(CHUNK_SIZE + 2)²`) nimmt das
 * Land des Chunks und seines Kachelrings auf. Gibt zurück, ob der ganze Chunk Land ist (dann braucht das Raster keine Maske).
 */
export function randMaskeInto(v: AufdeckungsBits, cx: number, cy: number, out: Uint8Array, feld: Uint8Array): boolean {
  const gx0 = cx * CHUNK_SIZE - 1;
  const gy0 = cy * CHUNK_SIZE - 1;
  for (let y = 0; y < FELD_SEITE; y++) {
    for (let x = 0; x < FELD_SEITE; x++) feld[y * FELD_SEITE + x] = kachelAufgedeckt(v, gx0 + x, gy0 + y) ? 1 : 0;
  }
  let alle = true;
  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const f = (y + 1) * FELD_SEITE + x + 1;
      let m = MASKE_NEBEL;
      if (feld[f] === 1) m = MASKE_AUF;
      else if (feld[f - 1] === 1 || feld[f + 1] === 1 || feld[f - FELD_SEITE] === 1 || feld[f + FELD_SEITE] === 1) m = MASKE_RAND;
      if (m !== MASKE_AUF) alle = false;
      out[y * CHUNK_SIZE + x] = m;
    }
  }
  return alle;
}

export class KartenAufdeckung implements AufdeckungQuelle {
  version = 0;
  private readonly sichten: MapView[] = Array.from({ length: LAYER_COUNT }, () => createMapView());
  private readonly chunkMaske = new Uint8Array(CHUNK_AREA);
  private readonly landFeld = new Uint8Array(FELD_SEITE * FELD_SEITE);
  private ebene: Layer = 0;
  private gelesen = -1;

  constructor(private readonly abtasten: KartenAbtastung) {}

  /** Die gelesene Sicht der Ebene (Marker, Version der Karte). */
  sicht(ebene: Layer): MapView {
    return this.sichten[-ebene] as MapView;
  }

  /** Liest die Maske der Ebene `ebene` (je Frame); `version` steigt bei einer Änderung. */
  aktualisiere(ebene: Layer): void {
    const v = this.abtasten(this.sichten[-ebene] as MapView, ebene, 0);
    const stand = v.available ? v.maskVersion : -1;
    if (ebene !== this.ebene || stand !== this.gelesen) {
      this.ebene = ebene;
      this.gelesen = stand;
      this.version++;
    }
  }

  maske(ebene: Layer, cx: number, cy: number): Uint8Array | null {
    const v = this.sichten[-ebene] as MapView;
    // Vor der Welt (keine Karte): die Minimap hat ohnehin keine Chunks – alles Geladene gilt.
    if (!v.available || v.cellTiles === 0) return null;
    return randMaskeInto(v, cx, cy, this.chunkMaske, this.landFeld) ? null : this.chunkMaske;
  }
}
