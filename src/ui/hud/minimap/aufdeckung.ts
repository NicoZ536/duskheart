/**
 * Die Aufdeckung der Weltkarte für die Minimap (M7-49; MASTERPROMPT §25 "Nebel über Unerkundetem"; docs/SPIEL.md §18 "Die
 * Minimap zeigt ab M7 ebenfalls nur Aufgedecktes"): die Bitmaske der Kartenzellen (4 × 4 Kacheln) der Ebene des Spielers aus
 * `GameSession.sampleMap` (ohne Terrain: Budget 0), je Chunk als 32×32-Kachelmaske für das Raster der Minimap
 * (`AufdeckungQuelle`). Ein ganz aufgedeckter Chunk liefert `null` (kein Maskenvergleich je Kachel). `version` steigt, wenn sich
 * die Maske der gelesenen Ebene ändert oder die Ebene wechselt – die Minimap rastert dann neu.
 *
 * Ohne Allokation je Frame: die Sichten der vier Ebenen und die Chunkmaske werden einmal angelegt.
 */
import { createMapView, type MapView } from '../../../game/samples/orte';
import { CHUNK_AREA, CHUNK_SIZE, LAYER_COUNT, type Layer } from '../../../world/model/coords';
import type { AufdeckungQuelle } from './raster';

/** Die Abtastung der Sitzung (`GameSession.sampleMap`). */
export type KartenAbtastung = (out: MapView, layer: Layer, budget: number) => MapView;

export class KartenAufdeckung implements AufdeckungQuelle {
  version = 0;
  private readonly sichten: MapView[] = Array.from({ length: LAYER_COUNT }, () => createMapView());
  private readonly chunkMaske = new Uint8Array(CHUNK_AREA);
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
    const ct = v.cellTiles;
    const je = CHUNK_SIZE / ct;
    const out = this.chunkMaske;
    let alle = true;
    for (let zy = 0; zy < je; zy++) {
      const gy = cy * je + zy;
      for (let zx = 0; zx < je; zx++) {
        const gx = cx * je + zx;
        let auf = 0;
        if (gx >= 0 && gy >= 0 && gx < v.side && gy < v.side) {
          const i = gy * v.side + gx;
          auf = ((v.mask[i >> 3] as number) >> (i & 7)) & 1;
        }
        if (auf === 0) alle = false;
        for (let y = 0; y < ct; y++) out.fill(auf, (zy * ct + y) * CHUNK_SIZE + zx * ct, (zy * ct + y) * CHUNK_SIZE + zx * ct + ct);
      }
    }
    return alle ? null : out;
  }
}
