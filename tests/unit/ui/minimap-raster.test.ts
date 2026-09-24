/**
 * M3-28 Kartenraster und Kartenbild der Minimap (src/ui/hud/minimap/farben.ts, raster.ts, karte.ts,
 * zeichnung.ts): jede Terrainart hat eine Kartenfarbe, Wasser/Wege/Höhleneingänge/Klippenschatten/Wald
 * werden richtig eingefärbt, die Biomzeile tönt den Boden, nicht Aufgedecktes ist Nebel, verkleinerte
 * Stufen nehmen die Mehrheit, der Kartenspeicher rastert neu geladene Chunks inkrementell (mit Budget) und
 * vergisst Entladenes nicht, und das fertige Bild setzt Rahmen, Himmel, Marker und Pfeil an die richtige Stelle.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import {
  ChunkData,
  TILE_FLAG_BRIDGE,
  TILE_FLAG_RAMP,
  TILE_FLAG_ROAD,
  TILE_FLAG_STAIRS,
  WATER_DEPTH_DEEP,
  WATER_DEPTH_SHALLOW,
  WATER_FROZEN,
  WATER_LAKE,
  WATER_SEA,
} from '../../../src/world/model/chunk';
import { CHUNK_AREA, CHUNK_SIZE, type Layer } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { KARTEN_BODEN, kartenFarbtabellen } from '../../../src/ui/hud/minimap/farben';
import { MinimapKarte, type KartenLeser } from '../../../src/ui/hud/minimap/karte';
import { neueMinimapLage, type KartenMarker } from '../../../src/ui/hud/minimap/lage';
import { farbIndex, rampenStufe, zeilenTabelle } from '../../../src/ui/hud/minimap/palette';
import { ALLES_AUFGEDECKT, mehrheit, neuesChunkRaster, rastereChunk, verkleinere, WALD_SCHWELLE, type AufdeckungQuelle } from '../../../src/ui/hud/minimap/raster';
import type { SymbolMass, SymbolQuelle } from '../../../src/ui/hud/minimap/spriteBild';
import {
  HORIZONT_Y,
  KARTE_MITTE_X,
  KARTE_MITTE_Y,
  KARTE_RADIUS,
  MARKER_RAND,
  MINIMAP_BREITE,
  MINIMAP_HOEHE,
  minimapRahmen,
  SCHEIBE_RADIUS,
  zeichneMinimap,
} from '../../../src/ui/hud/minimap/zeichnung';

const IDS = contentWorldIdTables();
const T = kartenFarbtabellen();
const tid = (id: string): number => IDS.terrain.runtimeId(id);
const bid = (id: string): number => IDS.biomes.runtimeId(id);

/** Ein Chunk ganz aus `boden` im Biom `biom` auf Höhe 0. */
function chunk(boden = 'gras', biom = 'gruenhain', layer: Layer = 0, cx = 0, cy = 0): ChunkData {
  const c = new ChunkData(layer, cx, cy);
  c.ground.fill(tid(boden));
  c.biome.fill(bid(biom));
  return c;
}

function raster(c: ChunkData, layer: Layer = 0, nord?: ChunkData, maske: Uint8Array | null = null): Uint8Array {
  const r = neuesChunkRaster();
  rastereChunk(c, layer, nord, maske, T, r);
  return r[0];
}

/** Grundfarbe getönt durch die Biomzeile. */
function getoent(ref: string, biom: string): number {
  const zeile = zeilenTabelle(`biom_${biom}`);
  const i = farbIndex(ref);
  return zeile?.[i] ?? i;
}

describe('Kartenfarben', () => {
  it('jede Terrainart des Contents hat eine Kartenfarbe (Erzadern gemeinsam)', () => {
    for (const t of CONTENT.collection('terrain').values()) {
      if (t.id.startsWith('ader_')) {
        expect(T.erzader[tid(t.id)], t.id).toBe(1);
        continue;
      }
      expect(KARTEN_BODEN[t.id], `Kartenfarbe für ${t.id}`).toBeDefined();
      expect(T.boden[tid(t.id)], t.id).toBeGreaterThan(0);
    }
  });

  it('Boden trägt die Biomzeile: Gras im Grünhain und an der Salzküste unterscheidet sich', () => {
    const gruen = raster(chunk('gras', 'gruenhain'))[0];
    const kueste = raster(chunk('gras', 'salzkueste'))[0];
    expect(gruen).toBe(getoent('gras.3', 'gruenhain'));
    expect(kueste).toBe(getoent('gras.3', 'salzkueste'));
    expect(gruen).not.toBe(kueste);
  });

  it('Wasser: flach, tief (See), Meer, zugefroren; Brücke darüber', () => {
    const c = chunk('meeresgrund', 'salzkueste');
    c.water[0] = WATER_DEPTH_SHALLOW | WATER_SEA;
    c.water[1] = WATER_DEPTH_DEEP | WATER_LAKE;
    c.water[2] = WATER_DEPTH_DEEP | WATER_SEA;
    c.water[3] = WATER_DEPTH_DEEP | WATER_LAKE | WATER_FROZEN;
    c.water[4] = WATER_DEPTH_DEEP | WATER_LAKE;
    c.flags[4] = TILE_FLAG_BRIDGE;
    const r = raster(c);
    expect([r[0], r[1], r[2], r[3], r[4]]).toEqual([T.wasserFlach, T.wasserTief, T.wasserMeer, T.wasserEis, T.bruecke]);
  });

  it('Wege und Eingänge: Straße auf fremdem Boden, Höhleneingang oben, Aufgang unten', () => {
    const c = chunk('gras');
    c.flags[0] = TILE_FLAG_ROAD;
    c.flags[1] = TILE_FLAG_STAIRS;
    expect([raster(c)[0], raster(c)[1]]).toEqual([T.strasse, T.eingang]);
    const h = chunk('hoehlenboden', 'wurzelhoehlen', -1);
    h.flags[0] = TILE_FLAG_RAMP;
    h.solid[1] = tid('fels');
    h.solid[2] = tid('ader_kupfer');
    const r = raster(h, -1);
    expect([r[0], r[1], r[2]]).toEqual([T.aufgang, farbIndex(KARTEN_BODEN['fels'] ?? ''), T.erzFarbe]);
    // Höhlenboden trägt die Biomzeile der Ebene.
    expect(r[3]).toBe(getoent(KARTEN_BODEN['hoehlenboden'] ?? '', 'wurzelhoehlen'));
  });

  it('Klippenschatten: eine Stufe dunkler unter einer höheren Kachel, auch über die Chunkgrenze', () => {
    const c = chunk('gras');
    c.height.fill(0);
    for (let x = 0; x < CHUNK_SIZE; x++) c.height[5 * CHUNK_SIZE + x] = 2;
    const r = raster(c);
    const grund = getoent('gras.3', 'gruenhain');
    expect(r[6 * CHUNK_SIZE]).toBe(rampenStufe(grund, -1));
    expect(r[5 * CHUNK_SIZE]).toBe(grund);
    expect(r[7 * CHUNK_SIZE]).toBe(grund);
    const nord = chunk('gras', 'gruenhain', 0, 0, -1);
    nord.height.fill(3);
    expect(raster(chunk('gras'), 0, nord)[0]).toBe(rampenStufe(grund, -1));
  });

  it('Wald: ab drei Bäumen im 5×5-Fenster dunkle Fläche (getönt), ein Einzelbaum bleibt Boden', () => {
    const baum = IDS.objects.runtimeId('baum_eiche');
    const einzeln = chunk('gras');
    einzeln.object[10 * CHUNK_SIZE + 10] = baum;
    expect(raster(einzeln)[10 * CHUNK_SIZE + 10]).toBe(getoent('gras.3', 'gruenhain'));
    const wald = chunk('gras');
    for (let k = 0; k < WALD_SCHWELLE; k++) wald.object[10 * CHUNK_SIZE + 10 + k * 2] = baum;
    const r = raster(wald);
    expect(r[10 * CHUNK_SIZE + 12]).toBe(getoent('gras.1', 'gruenhain'));
    expect(r[20 * CHUNK_SIZE + 20]).toBe(getoent('gras.3', 'gruenhain'));
  });

  it('Aufdeckung (Hook M7): nicht aufgedeckte Kacheln sind Nebel', () => {
    const maske = new Uint8Array(CHUNK_AREA);
    maske.fill(1, 0, CHUNK_SIZE);
    const r = raster(chunk('gras'), 0, undefined, maske);
    expect(r[0]).toBe(getoent('gras.3', 'gruenhain'));
    expect(r[CHUNK_SIZE]).toBe(T.nebel);
  });

  it('Verkleinern nach Mehrheit, bei Gleichstand der erste', () => {
    expect(mehrheit(1, 2, 2, 3)).toBe(2);
    expect(mehrheit(4, 1, 2, 4)).toBe(4);
    expect(mehrheit(1, 2, 3, 3)).toBe(3);
    expect(mehrheit(5, 6, 7, 8)).toBe(5);
    const q = Uint8Array.from([1, 1, 2, 3, 1, 9, 3, 3, 4, 4, 5, 5, 6, 4, 5, 6]);
    const z = new Uint8Array(4);
    verkleinere(q, 4, z);
    expect([...z]).toEqual([1, 3, 4, 5]);
  });
});

/** Welt aus einzelnen Chunks. */
class Welt implements KartenLeser {
  readonly chunks = new Map<string, ChunkData>();
  aufdeckung: AufdeckungQuelle = ALLES_AUFGEDECKT;
  setze(c: ChunkData): void {
    this.chunks.set(`${c.layer}:${c.cx}:${c.cy}`, c);
  }
  chunk(ebene: Layer, cx: number, cy: number): ChunkData | undefined {
    return this.chunks.get(`${ebene}:${cx}:${cy}`);
  }
}

describe('Kartenspeicher', () => {
  it('rastert neu geladene Chunks mit Budget, erkennt Neuladen und behält Entladenes', () => {
    const welt = new Welt();
    for (let cy = 0; cy < 3; cy++) for (let cx = 0; cx < 3; cx++) welt.setze(chunk('sand', 'salzkueste', 0, cx, cy));
    const karte = new MinimapKarte(T);
    expect(karte.aktualisiere(welt, 0, 48, 48, 1, 26, 4)).toBe(true);
    expect(karte.groesse).toBe(9);
    const v1 = karte.version;
    karte.aktualisiere(welt, 0, 48, 48, 1, 26, 10);
    const v2 = karte.version;
    expect(v2).toBeGreaterThan(v1);
    // Alles gerastert: nichts ändert sich mehr.
    expect(karte.aktualisiere(welt, 0, 48, 48, 1, 26, 10)).toBe(false);
    // Neu geladen (andere Instanz, anderer Inhalt) → neu gerastert.
    welt.setze(chunk('gras', 'gruenhain', 0, 1, 1));
    expect(karte.aktualisiere(welt, 0, 48, 48, 1, 26, 10)).toBe(true);
    // Änderung an Ort und Stelle: reihum aufgefrischt.
    const mitte = welt.chunk(0, 1, 1) as ChunkData;
    mitte.ground.fill(tid('schnee'));
    let gemerkt = false;
    for (let i = 0; i < 9 && !gemerkt; i++) gemerkt = karte.aktualisiere(welt, 0, 48, 48, 1, 26, 10);
    expect(gemerkt).toBe(true);
    // Entladen: das Raster bleibt, das Bild zeigt weiter die Welt.
    welt.chunks.clear();
    karte.aktualisiere(welt, 0, 48, 48, 1, 26, 10);
    const bild = new Uint8Array(MINIMAP_BREITE * MINIMAP_HOEHE);
    karte.komponiere(0, 48.5, 48.5, 1, KARTE_RADIUS, bild, MINIMAP_BREITE, KARTE_MITTE_X, KARTE_MITTE_Y);
    expect(bild[KARTE_MITTE_Y * MINIMAP_BREITE + KARTE_MITTE_X]).toBe(farbIndex('eis.4'));
  });

  it('komponiert nur im Kreis; Unbekanntes ist Nebel; weite Zoomstufen nutzen die verkleinerten Raster', () => {
    const welt = new Welt();
    welt.setze(chunk('sand', 'salzkueste', 0, 0, 0));
    const karte = new MinimapKarte(T);
    karte.aktualisiere(welt, 0, 16, 16, 3, 26, 10);
    const bild = new Uint8Array(MINIMAP_BREITE * MINIMAP_HOEHE);
    karte.komponiere(0, 16, 16, 1, KARTE_RADIUS, bild, MINIMAP_BREITE, KARTE_MITTE_X, KARTE_MITTE_Y);
    const at = (dx: number, dy: number): number => bild[(KARTE_MITTE_Y + dy) * MINIMAP_BREITE + KARTE_MITTE_X + dx] ?? -1;
    expect(at(0, 0)).toBe(farbIndex('sand.3'));
    expect(at(-16, 0)).toBe(farbIndex('sand.3'));
    expect(at(-17, 0)).toBe(T.nebel);
    expect(at(26, 0)).toBe(T.nebel);
    expect(at(27, 0)).toBe(0);
    expect(at(-19, -19)).toBe(0);
    // 4 Kacheln je Punkt: der Chunk ist 8 Punkte breit (Kacheln 0–31 → Punkte −4 … 3).
    bild.fill(0);
    karte.komponiere(0, 16, 16, 3, KARTE_RADIUS, bild, MINIMAP_BREITE, KARTE_MITTE_X, KARTE_MITTE_Y);
    expect(at(-4, 0)).toBe(farbIndex('sand.3'));
    expect(at(3, 0)).toBe(farbIndex('sand.3'));
    expect(at(4, 0)).toBe(T.nebel);
    expect(at(-5, 0)).toBe(T.nebel);
  });
});

/** Symbolattrappe: jedes Symbol ein 3×3-Quadrat in einer eigenen Farbe (Mondphase: Farbe je Frame). */
class Symbole implements SymbolQuelle {
  static readonly FARBE: Readonly<Record<string, number>> = { ui_karte_spieler: 50, ui_karte_grab: 51, ui_karte_startstrand: 52, ui_himmel_sonne: 53, ui_himmel_mond: 40 };
  mass(id: string): SymbolMass | null {
    return id in Symbole.FARBE ? { breite: 3, hoehe: 3, ankerX: 1, ankerY: 1, frames: 8 } : null;
  }
  indizes(id: string, frame = 0): Uint8Array | null {
    const f = Symbole.FARBE[id];
    return f === undefined ? null : new Uint8Array(9).fill(id === 'ui_himmel_mond' ? f + frame : f);
  }
}

describe('Kartenbild', () => {
  const welt = new Welt();
  welt.setze(chunk('gras', 'gruenhain', 0, 3, 3));
  const karte = new MinimapKarte(T);
  const lage = neueMinimapLage();
  Object.assign(lage, { vorhanden: true, x: 100.5, y: 100.5, ebene: 0, richtung: 0, minute: 12 * 60, mondphase: 3, wetter: 'klar' });
  karte.aktualisiere(welt, 0, lage.x, lage.y, 1, KARTE_RADIUS, 10);
  const bild = new Uint8Array(MINIMAP_BREITE * MINIMAP_HOEHE);
  const at = (x: number, y: number): number => bild[y * MINIMAP_BREITE + x] ?? -1;

  it('Rahmen: geschlossener Ring mit Kontur, Innenschatten und Eisen; Scheibe darauf, Sockel deckt die Ringmitte', () => {
    const r = minimapRahmen();
    const kontur = farbIndex('nacht.1');
    // Ringkontur links, rechts, unten; oben liegt der Sockel der Scheibe.
    expect(r[KARTE_MITTE_Y * MINIMAP_BREITE + 0]).toBe(kontur);
    expect(r[KARTE_MITTE_Y * MINIMAP_BREITE + MINIMAP_BREITE - 1]).toBe(kontur);
    expect(r[(MINIMAP_HOEHE - 1) * MINIMAP_BREITE + KARTE_MITTE_X]).toBe(kontur);
    // Scheibenrand oben: die oberste Zeile der Leinwand ist Kontur, das Fenster darunter frei.
    expect(r[KARTE_MITTE_X]).toBe(kontur);
    expect(r[(HORIZONT_Y - SCHEIBE_RADIUS) * MINIMAP_BREITE + KARTE_MITTE_X]).toBe(0);
    // Die Karte selbst ist frei.
    expect(r[KARTE_MITTE_Y * MINIMAP_BREITE + KARTE_MITTE_X]).toBe(0);
    // Ecken der Leinwand bleiben durchsichtig (runde Form).
    expect(r[(MINIMAP_HOEHE - 1) * MINIMAP_BREITE]).toBe(0);
  });

  it('Mittag: Sonne oben im Fenster, kein Mond, Spielerpfeil in der Mitte, Marker an ihrer Stelle', () => {
    const marker: KartenMarker[] = [
      { art: 'grab', x: 110.5, y: 94.5, ebene: 0 },
      { art: 'startstrand', x: 400, y: 100.5, ebene: 0 },
      { art: 'grab', x: 101, y: 101, ebene: -1 },
    ];
    zeichneMinimap(bild, karte, lage, 1, marker, new Symbole());
    expect(at(KARTE_MITTE_X, KARTE_MITTE_Y)).toBe(50);
    expect(at(KARTE_MITTE_X + 10, KARTE_MITTE_Y - 6)).toBe(51);
    // Fern im Osten: am Rand der Karte.
    expect(at(KARTE_MITTE_X + MARKER_RAND, KARTE_MITTE_Y)).toBe(52);
    // Sonne im Scheitel des Bogens, Mond nicht zu sehen.
    expect(at(KARTE_MITTE_X, HORIZONT_Y - 6)).toBe(53);
    expect(bild.some((v) => v >= 40 && v < 48)).toBe(false);
  });

  it('Nacht: Mond in seiner Phase, Sterne, Nachthimmel; ohne Figur nur Nebel und Uhr', () => {
    const nacht = { ...lage, minute: 0 };
    zeichneMinimap(bild, karte, nacht, 1, [], new Symbole());
    expect(at(KARTE_MITTE_X, HORIZONT_Y - 6)).toBe(43);
    expect(bild.some((v) => v === farbIndex('eis.3'))).toBe(true);
    expect(at(KARTE_MITTE_X + 5, HORIZONT_Y - 5)).toBe(farbIndex('wasser.0'));
    zeichneMinimap(bild, karte, { ...lage, vorhanden: false }, 1, [], new Symbole());
    expect(at(KARTE_MITTE_X, KARTE_MITTE_Y)).toBe(T.nebel);
    expect(at(KARTE_MITTE_X + 5, KARTE_MITTE_Y + 5)).toBe(T.nebel);
  });
});
