/**
 * The map screen's model and the minimap's reveal (M7-49; MASTERPROMPT §25 "Pergament-Pixel-Look, Nebel über Unerkundetem …
 * Zoom"; docs/SPIEL.md §18 "Die Minimap zeigt ab M7 ebenfalls nur Aufgedecktes"): the picture's colours for revealed land,
 * water, coast and contour lines and the mist; the view's conversions and limits; the markers in view with their labels;
 * the minimap's chunk masks from the map's cells.
 */
import { describe, expect, it } from 'vitest';
import { createMapView, type MapMarkerRecord, type MapView } from '../../../src/game/samples/orte';
import { MAP_TERRAIN } from '../../../src/game/map/terrain';
import { createI18n } from '../../../src/i18n';
import { PLAN_BIOME_IDS } from '../../../src/world/gen/plan/biomes';
import { CHUNK_AREA, type Layer } from '../../../src/world/model/coords';
import { KartenAufdeckung } from '../../../src/ui/hud/minimap/aufdeckung';
import { erkundet, KARTE_ZOOMS, kartenFarben, markerImBild, naechsterZoom, punktDer, verschiebe, zeichneKarte, zelleAm, type Ausschnitt, type KartenBild, type KarteZoom } from '../../../src/ui/screens/karte/modell';

const SIDE = 16;
const GRUEN = MAP_TERRAIN.land + PLAN_BIOME_IDS.indexOf('gruenhain');

/** A 16² map: the west half land of the Grünhain (level 0, the rows 4–7 level 2), the east half sea; `offen` cells revealed. */
function bild(offen: (cx: number, cy: number) => boolean, layer: Layer = 0): KartenBild {
  const mask = new Uint8Array(Math.ceil((SIDE * SIDE) / 8));
  const kind = new Uint8Array(SIDE * SIDE);
  const level = new Uint8Array(SIDE * SIDE);
  for (let cy = 0; cy < SIDE; cy++) {
    for (let cx = 0; cx < SIDE; cx++) {
      const i = cy * SIDE + cx;
      if (offen(cx, cy)) mask[i >> 3] = (mask[i >> 3] as number) | (1 << (i & 7));
      kind[i] = cx < 8 ? GRUEN : MAP_TERRAIN.sea;
      level[i] = cx < 8 && cy >= 4 && cy < 8 ? 2 : 0;
    }
  }
  return { side: SIDE, mask, kind, level, layer };
}

/** A view of the whole 16² map at `zoom` (16·zoom design px square, centred). */
function ganz(zoom: KarteZoom): Ausschnitt {
  return { mitteX: SIDE / 2, mitteY: SIDE / 2, zoom, breite: SIDE * zoom, hoehe: SIDE * zoom };
}

function zeichne(v: KartenBild, a: Ausschnitt): (x: number, y: number) => number {
  const ziel = new Uint8Array(a.breite * a.hoehe);
  zeichneKarte(v, kartenFarben(), a, ziel);
  return (x, y) => ziel[y * a.breite + x] as number;
}

describe('Karte: Bild', () => {
  const f = kartenFarben();

  it('aufgedecktes Land in der Biomfarbe, Meer in Blau, Unerkundetes als Pergament mit Nebel', () => {
    const px = zeichne(
      bild((cx) => cx < 12),
      ganz(2),
    );
    expect(px(3, 3)).toBe(f.biom[PLAN_BIOME_IDS.indexOf('gruenhain')]);
    expect([f.meer, f.meerWelle]).toContain(px(2 * 10 + 1, 2 * 1 + 1));
    // Unrevealed (cx ≥ 12): parchment, its mist, and the frayed edge next to the revealed cells.
    const nebel = new Set([f.pergament, f.pergamentDunkel, f.nebelRand]);
    for (let y = 0; y < 32; y++) for (let x = 2 * 13; x < 32; x++) expect(nebel.has(px(x, y))).toBe(true);
    let rand = 0;
    for (let y = 0; y < 32; y++) if (px(2 * 12, y) === f.nebelRand) rand++;
    expect(rand).toBeGreaterThan(0);
  });

  it('Tinte an der Küste, Höhenlinie an der Stufe, höheres Land eine Stufe dunkler', () => {
    const px = zeichne(
      bild(() => true),
      ganz(2),
    );
    // The coast between cell 7 (land) and 8 (sea): ink in the sea cell's left column and the land cell's right column.
    expect(px(2 * 8, 2 * 1 + 1)).toBe(f.tinte);
    expect(px(2 * 7 + 1, 2 * 1 + 1)).toBe(f.tinte);
    // The step from level 0 (row 3) to level 2 (row 4): a contour line in row 4's top pixel row.
    expect(px(2 * 3 + 1, 2 * 4)).toBe(f.hoehenlinie);
    expect(px(2 * 3 + 1, 2 * 4 + 1)).not.toBe(f.biom[PLAN_BIOME_IDS.indexOf('gruenhain')]);
    expect(px(2 * 3 + 1, 2 * 2 + 1)).toBe(f.biom[PLAN_BIOME_IDS.indexOf('gruenhain')]);
  });

  it('Zoom: ein Block von zoom × zoom Designpixeln je Zelle', () => {
    for (const z of KARTE_ZOOMS) {
      const px = zeichne(
        bild(() => true),
        ganz(z),
      );
      // Cell (2, 1) is plain land: every pixel of its block away from the edges has the biome colour.
      expect(px(2 * z + z - 1, 1 * z + z - 1)).toBe(f.biom[PLAN_BIOME_IDS.indexOf('gruenhain')]);
    }
  });

  it('unter Tage: Höhlen hell auf dunklem Fels, Tinte an der Höhlenwand', () => {
    const v = bild(() => true, -1);
    for (let i = 0; i < v.kind.length; i++) v.kind[i] = i % SIDE < 8 ? MAP_TERRAIN.cave : MAP_TERRAIN.rock;
    const px = zeichne(v, ganz(2));
    expect(px(3, 3)).toBe(f.hoehle);
    expect([f.fels, f.felsSchraffur]).toContain(px(2 * 10 + 1, 3));
    expect(px(2 * 8, 3)).toBe(f.tinte);
  });

  it('erkundet: Anteil der aufgedeckten Zellen', () => {
    expect(erkundet({ side: SIDE, mask: bild((cx) => cx < 4).mask })).toBe(0.25);
  });
});

describe('Karte: Ausschnitt und Marker', () => {
  it('Zelle am Punkt und Punkt der Kachel passen zueinander; Verschieben bleibt in der Welt; Zoom hält an den Enden', () => {
    const a: Ausschnitt = { mitteX: 100, mitteY: 50, zoom: 4, breite: 384, hoehe: 256 };
    expect(zelleAm(a, 192, 128)).toEqual({ cx: 100, cy: 50 });
    const p = punktDer(a, 100 * 4 + 1, 50 * 4 + 1, 4);
    expect(zelleAm(a, p.x, p.y)).toEqual({ cx: 100, cy: 50 });
    verschiebe(a, -1e6, 1e6, 384);
    expect([a.mitteX, a.mitteY]).toEqual([0, 384]);
    expect(naechsterZoom(8, 1)).toBe(8);
    expect(naechsterZoom(1, -1)).toBe(1);
    expect(naechsterZoom(2, 1)).toBe(4);
  });

  it('nur Marker im Bild, mit ihrem Namen: eigene, Orte nach Ortstyp, andere nach Art', () => {
    const i18n = createI18n('de');
    const a: Ausschnitt = { mitteX: 10, mitteY: 10, zoom: 2, breite: 64, hoehe: 64 };
    const r = (kind: MapMarkerRecord['kind'], ref: string, tx: number, ty: number, id = -1): MapMarkerRecord => ({ kind, sprite: `karte_${kind}`, ref, id, tx, ty });
    const liste = [r('eigen', 'Erzhöhle', 40, 40, 3), r('ort', 'schrein', 44, 36), r('grab', '', 30, 30), r('basis', '', 400, 400)];
    const m = markerImBild(i18n, liste, liste.length, a, 4);
    expect(m.map((x) => x.name)).toEqual(['Erzhöhle', 'Schrein der Erbauer', 'Grab']);
    expect(m[0]).toMatchObject({ art: 'eigen', id: 3, x: 32, y: 32 });
  });

  it('Beschriftungen ohne Überdeckung: eigene zuerst, sonst darüber, sonst keine; Gräber ohne Namen', () => {
    const i18n = createI18n('de');
    const a: Ausschnitt = { mitteX: 32, mitteY: 32, zoom: 4, breite: 256, hoehe: 256 };
    const r = (kind: MapMarkerRecord['kind'], ref: string, tx: number, ty: number, id = -1): MapMarkerRecord => ({ kind, sprite: `karte_${kind}`, ref, id, tx, ty });
    // A place, an own marker 12 px to its right (zoom 4 with 4-tile cells: a tile per design px), a far place, a grave.
    const liste = [r('ort', 'schrein', 100, 100), r('eigen', 'Lager am Bach', 112, 100, 1), r('ort', 'friedhof', 200, 40), r('grab', '', 60, 60)];
    const m = markerImBild(i18n, liste, liste.length, a, 4);
    const lage = (name: string): unknown => m.find((x) => x.name === name)?.beschriftung;
    // The own marker claims the place below first; the shrine's long label would cover it – above.
    expect(lage('Lager am Bach')).toBe('unten');
    expect(lage('Schrein der Erbauer')).toBe('oben');
    expect(lage('Friedhof der Erbauer')).toBe('unten');
    expect(lage('Grab')).toBeNull();
    // A place between two own markers 12 px above and below: the upper one's label goes above (the place's symbol is under
    // it), the lower one's below; the place keeps no free spot – no label.
    const eng = [r('eigen', 'Oben', 100, 88, 1), r('eigen', 'Unten', 100, 112, 2), r('ort', 'schrein', 100, 100)];
    const n = markerImBild(i18n, eng, eng.length, a, 4);
    expect(n.map((x) => x.beschriftung)).toEqual(['oben', 'unten', null]);
    // At the view's edges the label moves inside (its whole name on the sheet), in the middle it stays centred.
    const rand = [r('ort', 'naturwunder', 2, 60), r('ort', 'gehoeft', 250, 140), r('ort', 'friedhof', 128, 200)];
    const o = markerImBild(i18n, rand, rand.length, a, 4);
    for (const x of o) {
      const halb = (x.name.length * 5.2) / 2;
      expect(x.x + x.nameDx - halb, x.name).toBeGreaterThanOrEqual(-0.5);
      expect(x.x + x.nameDx + halb, x.name).toBeLessThanOrEqual(a.breite + 0.5);
    }
    expect(o.map((x) => Math.sign(x.nameDx))).toEqual([1, -1, 0]);
  });
});

describe('Minimap: nur Aufgedecktes', () => {
  it('je Chunk die Kachelmaske der Kartenzellen; ein ganz aufgedeckter Chunk ohne Maske; Version bei Änderung', () => {
    const view: MapView = { ...createMapView(), available: true, side: 64, cellTiles: 4, worldTiles: 256, mask: new Uint8Array(512), maskVersion: 1 };
    const setze = (cx: number, cy: number): void => {
      const i = cy * 64 + cx;
      view.mask[i >> 3] = (view.mask[i >> 3] as number) | (1 << (i & 7));
    };
    // Chunk (0, 0) = cells 0–7: only cell (1, 2); chunk (1, 0) = cells 8–15 × 0–7 completely.
    setze(1, 2);
    for (let y = 0; y < 8; y++) for (let x = 8; x < 16; x++) setze(x, y);
    const a = new KartenAufdeckung((out) => Object.assign(out, view));
    a.aktualisiere(0);
    const v0 = a.version;
    const m = a.maske(0, 0, 0);
    expect(m).not.toBeNull();
    let auf = 0;
    for (let i = 0; i < CHUNK_AREA; i++) auf += (m as Uint8Array)[i] as number;
    expect(auf).toBe(16);
    expect((m as Uint8Array)[(2 * 4 + 1) * 32 + 1 * 4 + 2]).toBe(1);
    expect(a.maske(0, 1, 0)).toBeNull();
    a.aktualisiere(0);
    expect(a.version).toBe(v0);
    view.maskVersion = 2;
    a.aktualisiere(0);
    expect(a.version).toBe(v0 + 1);
  });
});
