/**
 * Kartenspeicher der Minimap (M3-28, „aus den Chunkdaten in niedriger Auflösung, inkrementell beim Laden“):
 * je gesehenem Chunk die drei Raster-Stufen (`raster.ts`). `aktualisiere` rastert Chunks, die neu geladen
 * wurden (andere `ChunkData`-Instanz), höchstens `budget` je Frame, und frischt reihum einen sichtbaren
 * Chunk auf (Änderungen an Ort und Stelle: gefällte Bäume, gegrabene Kacheln). Entladene Chunks bleiben als
 * Raster erhalten – die Karte vergisst in einer Sitzung nicht, was sie schon gezeigt hat –, ihre Chunkdaten
 * hält sie aber nicht fest.
 *
 * `komponiere` setzt das runde Kartenbild um die Spielerposition aus den Rastern zusammen (Palettenindizes
 * in einen Zielpuffer, Nebel wo nichts bekannt ist).
 */
import { CHUNK_SHIFT, CHUNK_SIZE, packChunkId, type Layer } from '../../../world/model/coords';
import type { KartenFarbtabellen } from './farben';
import { felderJePunkt, imKreis, kartenZentrum, type ZoomStufe } from './projektion';
import { neuesChunkRaster, rastereChunk, type AufdeckungQuelle, type ChunkRaster, type KartenChunk } from './raster';

/** Lesezugriff der Karte auf die Welt. */
export interface KartenLeser {
  /** Der geladene Chunk an der Adresse, oder `undefined`. Eine neue Instanz bedeutet „neu geladen“. */
  chunk(ebene: Layer, cx: number, cy: number): KartenChunk | undefined;
  readonly aufdeckung: AufdeckungQuelle;
}

interface Eintrag {
  readonly ebene: Layer;
  readonly cx: number;
  readonly cy: number;
  readonly raster: ChunkRaster;
  /** Die gerasterten Chunkdaten, solange sie geladen sind (Vergleich auf Neuladen). */
  quelle: KartenChunk | null;
  /** Aufdeckungsstand beim Rastern. */
  aufdeckung: number;
}

/** Neue Chunks, die je Frame höchstens gerastert werden (≈ 25 µs je Chunk). */
export const RASTER_BUDGET_JE_FRAME = 6;
/** Gespeicherte Chunk-Raster, ab denen ferne verworfen werden (je Chunk ≈ 1,3 KiB). */
const SPEICHER_GRENZE = 3000;
/** Chunk-Abstand zum Zentrum, jenseits dessen beim Aufräumen verworfen wird. */
const AUFRAEUM_ABSTAND = 12;

export class MinimapKarte {
  private readonly eintraege = new Map<number, Eintrag>();
  private readonly sichtbar: Eintrag[] = [];
  private runde = 0;
  /** Steigt bei jeder Änderung eines Rasters (die Minimap zeichnet dann neu). */
  version = 0;

  constructor(private readonly farben: KartenFarbtabellen) {}

  /** Nebelfarbe (Palettenindex) für Unbekanntes. */
  get nebel(): number {
    return this.farben.nebel;
  }

  /** Gespeicherte Chunk-Raster (Diagnose, Tests). */
  get groesse(): number {
    return this.eintraege.size;
  }

  /**
   * Hält die Raster der Chunks im Sichtfeld aktuell: Mitte (zx, zy) [Kacheln], Radius `radius` [Punkte] bei
   * Zoomstufe `zoom`. Gibt zurück, ob sich ein Raster geändert hat.
   */
  aktualisiere(leser: KartenLeser, ebene: Layer, zx: number, zy: number, zoom: ZoomStufe, radius: number, budget = RASTER_BUDGET_JE_FRAME): boolean {
    const weite = radius * felderJePunkt(zoom) + 1;
    const cx0 = Math.floor(zx - weite) >> CHUNK_SHIFT;
    const cx1 = Math.floor(zx + weite) >> CHUNK_SHIFT;
    const cy0 = Math.floor(zy - weite) >> CHUNK_SHIFT;
    const cy1 = Math.floor(zy + weite) >> CHUNK_SHIFT;
    const version = leser.aufdeckung.version;
    let geaendert = false;
    let rest = budget;
    this.sichtbar.length = 0;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const id = packChunkId(ebene, cx, cy);
        const geladen = leser.chunk(ebene, cx, cy);
        let e = this.eintraege.get(id);
        if (geladen === undefined) {
          if (e !== undefined) e.quelle = null;
          continue;
        }
        if (e === undefined) {
          e = { ebene, cx, cy, raster: neuesChunkRaster(), quelle: null, aufdeckung: -1 };
          this.eintraege.set(id, e);
        }
        this.sichtbar.push(e);
        if ((e.quelle !== geladen || e.aufdeckung !== version) && rest > 0) {
          rest--;
          this.rastere(leser, e, geladen, version);
          geaendert = true;
        }
      }
    }
    // Reihum einen geladenen, sichtbaren Chunk neu rastern: Änderungen an Ort und Stelle (Fällen, Graben).
    if (this.sichtbar.length > 0) {
      const e = this.sichtbar[this.runde++ % this.sichtbar.length];
      if (e?.quelle) geaendert = this.rastere(leser, e, e.quelle, version, true) || geaendert;
    }
    if (this.eintraege.size > SPEICHER_GRENZE) this.raeumeAuf(Math.floor(zx) >> CHUNK_SHIFT, Math.floor(zy) >> CHUNK_SHIFT);
    if (geaendert) this.version++;
    return geaendert;
  }

  /** Rastert `e` aus `c`; mit `vergleiche` nur dann als Änderung gemeldet, wenn sich ein Punkt unterscheidet. */
  private rastere(leser: KartenLeser, e: Eintrag, c: KartenChunk, version: number, vergleiche = false): boolean {
    const vorher = vergleiche ? e.raster[0].slice() : null;
    const nord = leser.chunk(e.ebene, e.cx, e.cy - 1);
    rastereChunk(c, e.ebene, nord, leser.aufdeckung.maske(e.ebene, e.cx, e.cy), this.farben, e.raster);
    e.quelle = c;
    e.aufdeckung = version;
    if (vorher === null) return true;
    const jetzt = e.raster[0];
    for (let i = 0; i < jetzt.length; i++) if (jetzt[i] !== vorher[i]) return true;
    return false;
  }

  private raeumeAuf(ccx: number, ccy: number): void {
    for (const [id, e] of this.eintraege) {
      if (Math.max(Math.abs(e.cx - ccx), Math.abs(e.cy - ccy)) > AUFRAEUM_ABSTAND) this.eintraege.delete(id);
    }
  }

  /**
   * Schreibt das runde Kartenbild in `ziel` (Palettenindizes, Zeilenbreite `zielBreite`): Mittelpunkt bei
   * (`mitteX`, `mitteY`), Radius `radius` Punkte, Spielerposition (zx, zy) [Kacheln]. Unbekanntes wird
   * `farben.nebel`; Punkte außerhalb des Kreises bleiben unberührt.
   */
  komponiere(ebene: Layer, zx: number, zy: number, zoom: ZoomStufe, radius: number, ziel: Uint8Array, zielBreite: number, mitteX: number, mitteY: number): void {
    const fjp = felderJePunkt(zoom);
    // Stufe 0 für ½ und 1 Kachel je Punkt, sonst die verkleinerte Stufe mit genau fjp Kacheln je Zelle.
    const stufe = fjp <= 1 ? 0 : fjp === 2 ? 1 : 2;
    const zelle = fjp <= 1 ? 1 : fjp;
    const seite = CHUNK_SIZE / zelle;
    const zqx = kartenZentrum(zx, fjp);
    const zqy = kartenZentrum(zy, fjp);
    const nebel = this.farben.nebel;
    let letzteId = Number.NaN;
    let letztes: Uint8Array | null = null;
    for (let dy = -radius; dy <= radius; dy++) {
      const zy0 = Math.floor((zqy + dy * fjp) / zelle);
      const cy = Math.floor(zy0 / seite);
      const ly = zy0 - cy * seite;
      const zeile = (mitteY + dy) * zielBreite + mitteX;
      for (let dx = -radius; dx <= radius; dx++) {
        if (!imKreis(dx, dy, radius)) continue;
        const zx0 = Math.floor((zqx + dx * fjp) / zelle);
        const cx = Math.floor(zx0 / seite);
        const lx = zx0 - cx * seite;
        const id = packChunkId(ebene, cx, cy);
        if (id !== letzteId) {
          letzteId = id;
          letztes = this.eintraege.get(id)?.raster[stufe] ?? null;
        }
        ziel[zeile + dx] = letztes === null ? nebel : (letztes[ly * seite + lx] ?? nebel) || nebel;
      }
    }
  }
}
