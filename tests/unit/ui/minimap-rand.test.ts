/**
 * Der ausgefranste Rand der Minimap (M7-84; MASTERPROMPT §25 „Nebel über Unerkundetem“; docs/SPIEL.md §18): die Aufdeckung
 * der Kartenzellen (4 × 4 Kacheln) wird je Kachel bilinear gelesen und gegen eine Schwelle mit Hash-Streuung verglichen –
 * der Rand ist nicht mehr stufig in 4 × 4-Zellen, sondern franst um höchstens eine Kachel, Ecken runden sich ab, eine
 * einzelne Zelle bleibt sichtbar; Nebel neben Land ist Randkachel, die das Raster im Schachbrett halb als Land zeichnet –
 * nahtlos über Chunkgrenzen.
 */
import { describe, expect, it } from 'vitest';
import { ChunkData } from '../../../src/world/model/chunk';
import { CHUNK_AREA, CHUNK_SIZE } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { createMapView, type MapView } from '../../../src/game/samples/orte';
import { KartenAufdeckung, RAND, kachelAufgedeckt, randMaskeInto, type AufdeckungsBits } from '../../../src/ui/hud/minimap/aufdeckung';
import { kartenFarbtabellen } from '../../../src/ui/hud/minimap/farben';
import { MASKE_AUF, MASKE_NEBEL, MASKE_RAND, neuesChunkRaster, rastereChunk } from '../../../src/ui/hud/minimap/raster';

const CT = 4;
const SIDE = 64;
const FELD = (CHUNK_SIZE + 2) * (CHUNK_SIZE + 2);

/** Eine Welt von `SIDE`² Zellen; `auf(zx, zy)` sagt, welche aufgedeckt sind. */
function welt(auf: (zx: number, zy: number) => boolean): AufdeckungsBits {
  const mask = new Uint8Array((SIDE * SIDE) / 8);
  for (let zy = 0; zy < SIDE; zy++) {
    for (let zx = 0; zx < SIDE; zx++) {
      if (!auf(zx, zy)) continue;
      const i = zy * SIDE + zx;
      mask[i >> 3] = (mask[i >> 3] as number) | (1 << (i & 7));
    }
  }
  return { mask, side: SIDE, cellTiles: CT };
}

/** Die Maske des Chunks (cx, cy), `null` wo er ganz Land ist. */
function maske(v: AufdeckungsBits, cx: number, cy: number): Uint8Array | null {
  const out = new Uint8Array(CHUNK_AREA);
  return randMaskeInto(v, cx, cy, out, new Uint8Array(FELD)) ? null : out;
}

/** Land an Weltkachel (gx, gy) laut Chunkmaske. */
function landIn(v: AufdeckungsBits, gx: number, gy: number): boolean {
  const m = maske(v, Math.floor(gx / CHUNK_SIZE), Math.floor(gy / CHUNK_SIZE));
  return m === null || m[(gy & (CHUNK_SIZE - 1)) * CHUNK_SIZE + (gx & (CHUNK_SIZE - 1))] === MASKE_AUF;
}

describe('Minimap: ausgefranster Rand der Aufdeckung (M7-84)', () => {
  it('eine gerade Kante franst um eine Kachel: innen 1,5 Kacheln vor der Zellkante immer Land, 1,5 dahinter nie, dazwischen beides, Zeile für Zeile verschieden', () => {
    // Zellen 0–7 aufgedeckt (Kacheln 0–31), ab Zelle 8 (Kachel 32) Nebel.
    const v = welt((zx) => zx < 8);
    const vorKante: number[] = [];
    const hinterKante: number[] = [];
    const kanten = new Set<number>();
    // Die Zeilen fern vom oberen und unteren Weltrand (dort franst die Aufdeckung auch in y).
    for (let gy = 1; gy < 255; gy++) {
      expect(kachelAufgedeckt(v, 30, gy)).toBe(true);
      expect(kachelAufgedeckt(v, 33, gy)).toBe(false);
      vorKante.push(kachelAufgedeckt(v, 31, gy) ? 1 : 0);
      hinterKante.push(kachelAufgedeckt(v, 32, gy) ? 1 : 0);
      let letzte = 0;
      for (let gx = 0; gx < 40; gx++) if (kachelAufgedeckt(v, gx, gy)) letzte = gx;
      kanten.add(letzte);
    }
    const anteil = (a: number[]): number => a.reduce((s, x) => s + x, 0) / a.length;
    // Vor der Kante (Anteil 5/8) zu drei Vierteln Land, dahinter (3/8) zu einem Viertel – bei Zittern 0,25 (`RAND`).
    expect(RAND.zitter).toBe(0.25);
    expect(anteil(vorKante)).toBeGreaterThan(0.6);
    expect(anteil(vorKante)).toBeLessThan(0.9);
    expect(anteil(hinterKante)).toBeGreaterThan(0.1);
    expect(anteil(hinterKante)).toBeLessThan(0.4);
    // Die Kante springt zwischen Kachel 30 und 32 – keine Treppe in 4er-Schritten, kein gerader Strich.
    expect([...kanten].sort()).toEqual([30, 31, 32]);
  });

  it('Ecken runden sich ab: die äußere Eckkachel eines aufgedeckten Blocks ist meist Nebel, die Kachel diagonal davor nie Land', () => {
    // Blöcke aus 3 × 3 Zellen alle 6 Zellen: 100 Blöcke mit je vier äußeren Ecken.
    const v = welt((zx, zy) => zx % 6 < 3 && zy % 6 < 3);
    let ecken = 0;
    let eckenLand = 0;
    let kantenLand = 0;
    for (let by = 0; by < 10; by++) {
      for (let bx = 0; bx < 10; bx++) {
        const x0 = bx * 6 * CT;
        const y0 = by * 6 * CT;
        const x1 = x0 + 3 * CT - 1;
        const y1 = y0 + 3 * CT - 1;
        for (const [gx, gy, dx, dy] of [
          [x0, y0, -1, -1],
          [x1, y0, 1, -1],
          [x0, y1, -1, 1],
          [x1, y1, 1, 1],
        ] as const) {
          if (gx + dx < 0 || gy + dy < 0) continue;
          ecken++;
          if (kachelAufgedeckt(v, gx, gy)) eckenLand++;
          expect(kachelAufgedeckt(v, gx + dx, gy + dy), `diagonal vor (${gx}, ${gy})`).toBe(false);
        }
        // Die Mitte der rechten Kante (gleich weit von der Zellkante wie die Eckkachel, aber ohne Ecke).
        if (kachelAufgedeckt(v, x1, y0 + 6)) kantenLand++;
      }
    }
    expect(ecken).toBeGreaterThan(300);
    // Eckkachel: Anteil 25/64 → etwa 28 % Land; Kantenkachel: 40/64 → etwa 75 %.
    expect(eckenLand / ecken).toBeLessThan(0.45);
    expect(kantenLand / 100).toBeGreaterThan(0.55);
  });

  it('eine einzelne aufgedeckte Zelle bleibt sichtbar: ihre vier Mittelkacheln sind Land, nichts weiter als eine Kachel um sie', () => {
    const v = welt((zx, zy) => zx === 9 && zy === 9);
    let land = 0;
    for (let gy = 24; gy < 56; gy++) {
      for (let gx = 24; gx < 56; gx++) {
        if (!kachelAufgedeckt(v, gx, gy)) continue;
        land++;
        expect(gx >= 35 && gx <= 40 && gy >= 35 && gy <= 40, `(${gx}, ${gy})`).toBe(true);
      }
    }
    for (const [gx, gy] of [
      [37, 37],
      [38, 37],
      [37, 38],
      [38, 38],
    ] as const) {
      expect(kachelAufgedeckt(v, gx, gy)).toBe(true);
    }
    // Höchstens die 16 Kacheln der Zelle und die 8 mittleren ihres Kachelrings (Anteil 21/64; die äußeren 15/64 nie).
    expect(land).toBeGreaterThanOrEqual(4);
    expect(land).toBeLessThanOrEqual(24);
  });

  it('Randkacheln: genau die Nebelkacheln neben Land – auch über die Chunkgrenze, nahtlos in beiden Chunks', () => {
    // Ein Kreis aus Zellen über die Ecke der Chunks (0,0), (1,0), (0,1), (1,1).
    const v = welt((zx, zy) => (zx - 8) * (zx - 8) + (zy - 8) * (zy - 8) <= 20);
    const land = (gx: number, gy: number): boolean => kachelAufgedeckt(v, gx, gy);
    let rand = 0;
    for (let cy = 0; cy < 2; cy++) {
      for (let cx = 0; cx < 2; cx++) {
        const m = maske(v, cx, cy);
        expect(m, `Chunk (${cx}, ${cy})`).not.toBeNull();
        for (let y = 0; y < CHUNK_SIZE; y++) {
          for (let x = 0; x < CHUNK_SIZE; x++) {
            const gx = cx * CHUNK_SIZE + x;
            const gy = cy * CHUNK_SIZE + y;
            const neben = land(gx - 1, gy) || land(gx + 1, gy) || land(gx, gy - 1) || land(gx, gy + 1);
            const soll = land(gx, gy) ? MASKE_AUF : neben ? MASKE_RAND : MASKE_NEBEL;
            expect((m as Uint8Array)[y * CHUNK_SIZE + x], `(${gx}, ${gy})`).toBe(soll);
            if (soll === MASKE_RAND && (x === 0 || x === CHUNK_SIZE - 1 || y === 0 || y === CHUNK_SIZE - 1)) rand++;
          }
        }
      }
    }
    // Der Kreis kreuzt die Chunkgrenzen: dort liegen Randkacheln, deren Land im Nachbarchunk ist.
    expect(rand).toBeGreaterThan(0);
  });

  it('ganz Land nur, wo auch die Nachbarzellen aufgedeckt sind; außerhalb der Welt ist Nebel', () => {
    expect(maske(welt(() => true), 1, 1)).toBeNull();
    // Chunk (1, 0) ganz aufgedeckt, ringsum Nebel: sein Rand franst – er braucht eine Maske.
    const insel = welt((zx, zy) => zx >= 8 && zx < 16 && zy < 8);
    const m = maske(insel, 1, 0);
    expect(m).not.toBeNull();
    expect((m as Uint8Array)[16 * CHUNK_SIZE + 16]).toBe(MASKE_AUF);
    // Jenseits des Weltrands liegt Nebel: die zweite Kachel davor ist nie Land, die zweite dahinter immer.
    expect(kachelAufgedeckt(welt(() => true), -2, 5)).toBe(false);
    expect(kachelAufgedeckt(welt(() => true), 1, 5)).toBe(true);
  });

  it('KartenAufdeckung liefert die ausgefranste Maske je Chunk; ein Chunk mitten im Aufgedeckten braucht keine', () => {
    const bits = welt((zx, zy) => zx < 24 && zy < 24);
    const view: MapView = { ...createMapView(), available: true, side: SIDE, cellTiles: CT, worldTiles: SIDE * CT, mask: bits.mask, maskVersion: 1 };
    const a = new KartenAufdeckung((out) => Object.assign(out, view));
    a.aktualisiere(0);
    expect(a.maske(0, 1, 1)).toBeNull();
    // Am Weltrand franst die Aufdeckung (jenseits liegt Nebel): Chunk (0, 0) braucht eine Maske.
    expect(a.maske(0, 0, 0)).not.toBeNull();
    const rand = a.maske(0, 2, 1);
    expect(rand).not.toBeNull();
    // Die Zellkante liegt bei Kachel 96 = Chunk 3, Spalte 0: in Chunk 2 ist bis Spalte 30 alles Land.
    for (let y = 0; y < CHUNK_SIZE; y++) expect((rand as Uint8Array)[y * CHUNK_SIZE + 30]).toBe(MASKE_AUF);
    for (let y = 32; y < 64; y++) expect(landIn(bits, 95, y)).toBe(kachelAufgedeckt(bits, 95, y));
  });
});

describe('Minimap: Randkacheln im Raster (M7-84)', () => {
  const IDS = contentWorldIdTables();
  const T = kartenFarbtabellen();

  it('eine Randkachel zeigt ihr Land, wo Spalte + Zeile gerade ist, sonst Nebel; Nebel bleibt Nebel, Land bleibt Land', () => {
    const c = new ChunkData(0, 0, 0);
    c.ground.fill(IDS.terrain.runtimeId('sand'));
    c.biome.fill(IDS.biomes.runtimeId('salzkueste'));
    const m = new Uint8Array(CHUNK_AREA);
    m.fill(MASKE_RAND, 0, CHUNK_SIZE * 2);
    m.fill(MASKE_AUF, CHUNK_SIZE * 2, CHUNK_SIZE * 3);
    const r = neuesChunkRaster();
    rastereChunk(c, 0, undefined, m, T, r);
    const landFarbe = r[0][CHUNK_SIZE * 2] as number;
    expect(landFarbe).not.toBe(T.nebel);
    for (let y = 0; y < 2; y++) for (let x = 0; x < CHUNK_SIZE; x++) expect(r[0][y * CHUNK_SIZE + x], `(${x}, ${y})`).toBe(((x + y) & 1) === 0 ? landFarbe : T.nebel);
    expect(r[0][CHUNK_SIZE * 3]).toBe(T.nebel);
  });
});
