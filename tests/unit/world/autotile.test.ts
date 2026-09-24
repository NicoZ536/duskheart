/**
 * M2-16 Autotiling (src/world/autotile.ts): 47er-Blob-Regel für alle 256 Nachbarschaften und alle 47
 * Masken, Übergangsprioritäten (höheres Terrain zeichnet den Rand, Saum-Terrain unten), Klippen in
 * Höhenstufen (16 px Wand je Stufe) mit Rampen und Treppen – und die Tilesets aus M2-17/M2-18:
 * vollständig, palettenrein, ohne Einzelpixel und nahtlos an jeder möglichen Nachbarschaft.
 */
import { describe, expect, it } from 'vitest';
import {
  BLOB_ANZAHL,
  BLOB_INSEL,
  BLOB_MASKS,
  BLOB_VOLL,
  KANTEN_BRUCH,
  KLIPPE_FRAME,
  KLIPPEN_GRUPPEN,
  KLIPPEN_GRUPPE_JE_BIOM,
  MASKE_VOLL,
  MAX_HOEHENSTUFE,
  NB,
  RICHTUNGEN,
  SAUM_TERRAIN,
  TERRAIN_REIHENFOLGE,
  TILESET_VARIANTEN_START,
  UEBERGANG,
  Uebergaenge,
  VERSATZ,
  WAND_PX_JE_STUFE,
  WAND_SPALTE,
  WAND_VARIANTE_ANTEIL,
  WAND_ZEILE,
  blobIndex,
  kachelEbenen,
  klippenFrames,
  klippenTilesetId,
  nachbarMaske,
  reduziereMaske,
  terrainRang,
  tilesetId,
  wandAn,
  wandFrame,
  wandSpalte,
  wandZeile,
  type KachelEbene,
  type KlippenUmgebung,
} from '../../../src/world/autotile';
import { TRANSPARENT, spriteColorCount, type Sprite } from '../../../assets-src/lib/sprite';
import { TERRAIN } from '../../../src/content/terrain';
import { checkSprite } from '../../../tools/assets/spriteChecks';
import { loadSprites } from '../../../tools/assets/sources';

/** Die 47 reduzierten Masken der Blob-Regel (N = 1, im Uhrzeigersinn), aufsteigend. */
const KANONISCH = [
  0, 1, 4, 5, 7, 16, 17, 20, 21, 23, 28, 29, 31, 64, 65, 68, 69, 71, 80, 81, 84, 85, 87, 92, 93, 95, 112, 113, 116, 117, 119, 124, 125, 127, 193, 197, 199, 209, 213, 215, 221, 223, 241, 245, 247, 253, 255,
];
const TILE = 16;
/** Terrain-Typen aus docs/WORLD.md §7 (Oberfläche und Untergrund). */
const WELT_TERRAIN = ['gras', 'erde', 'sand', 'duenengras', 'schnee', 'asche', 'kristallboden', 'moorschlamm', 'torf', 'meeresgrund', 'strasse', 'eis', 'lava', 'hoehlenboden', 'wurzelboden', 'obsidianboden', 'lehm'];
const BIOME = ['gruenhain', 'salzkueste', 'nebelmoor', 'frostkamm', 'glutsand', 'aschenschlund', 'scherbenhain', 'nachtherz', 'wurzelhoehlen', 'tiefgrund', 'glutadern'];

/** Nachbarn in `RICHTUNGEN`-Reihenfolge: gesetztes Bit → `ja`, sonst `nein`. */
function nachbarnAus(maske: number, ja: string, nein: string): string[] {
  return RICHTUNGEN.map((r) => ((maske & NB[r]) !== 0 ? ja : nein));
}

describe('47er-Blob-Regel', () => {
  it('ergibt genau die 47 kanonischen Masken', () => {
    expect(BLOB_ANZAHL).toBe(47);
    expect([...BLOB_MASKS]).toEqual(KANONISCH);
    expect(BLOB_VOLL).toBe(46);
    expect(BLOB_INSEL).toBe(0);
    expect(TILESET_VARIANTEN_START).toBe(47);
  });

  it('bildet alle 256 Nachbarschaften auf eine der 47 Masken ab (Eckbits nur mit beiden Seiten)', () => {
    const treffer = new Array<number>(BLOB_ANZAHL).fill(0);
    for (let m = 0; m <= MASKE_VOLL; m++) {
      const r = reduziereMaske(m);
      expect(BLOB_MASKS).toContain(r);
      expect(reduziereMaske(r)).toBe(r);
      expect(r & ~m).toBe(0);
      for (const [ecke, a, b] of [
        [NB.NE, NB.N, NB.E],
        [NB.SE, NB.S, NB.E],
        [NB.SW, NB.S, NB.W],
        [NB.NW, NB.N, NB.W],
      ] as const) {
        if ((r & ecke) !== 0) expect((r & a) !== 0 && (r & b) !== 0).toBe(true);
        else if ((m & ecke) !== 0 && (m & a) !== 0 && (m & b) !== 0) expect.unreachable(`Maske ${m}: Ecke ${ecke} ging verloren`);
      }
      const i = blobIndex(m);
      treffer[i] = (treffer[i] ?? 0) + 1;
    }
    expect(treffer.reduce((a, b) => a + b, 0)).toBe(256);
    expect(treffer.every((n) => n > 0)).toBe(true);
    // Die Seitenbits bestimmen, wie viele Ecken frei sind: Vollfeld nur mit allen acht, Insel aus 16 Masken.
    expect(treffer[BLOB_VOLL]).toBe(1);
    expect(treffer[BLOB_INSEL]).toBe(16);
  });

  it('liest die Nachbarschaft in Bitreihenfolge N, NE, E, SE, S, SW, W, NW', () => {
    expect(RICHTUNGEN.map((r) => VERSATZ[r])).toEqual([
      [0, -1],
      [1, -1],
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
    ]);
    expect(nachbarMaske((_dx, dy) => dy < 0)).toBe(NB.N | NB.NE | NB.NW);
    expect(nachbarMaske((dx) => dx > 0)).toBe(NB.NE | NB.E | NB.SE);
    expect(nachbarMaske(() => true)).toBe(MASKE_VOLL);
  });

  it.each(KANONISCH.map((m, i) => [i, m] as const))('Blob %i (Maske %i): Gras über Erde zeichnet genau diesen Frame', (i, m) => {
    expect(blobIndex(m)).toBe(i);
    const ebenen = kachelEbenen('gras', nachbarnAus(m, 'gras', 'erde'));
    const oben = ebenen[ebenen.length - 1];
    expect(oben).toEqual({ terrain: 'gras', blob: i });
    // Liegt irgendwo Erde daneben, trägt sie als Vollfeld darunter.
    if (m === MASKE_VOLL) expect(ebenen).toHaveLength(1);
    else expect(ebenen[0]).toEqual({ terrain: 'erde', blob: BLOB_VOLL });
  });
});

describe('Übergangsprioritäten', () => {
  it('jeder Terrain-Typ aus docs/WORLD.md §7 hat Rang und Tileset-Id', () => {
    expect([...TERRAIN_REIHENFOLGE].sort()).toEqual([...WELT_TERRAIN].sort());
    for (const t of WELT_TERRAIN) {
      expect(Number.isInteger(terrainRang(t))).toBe(true);
      expect(tilesetId(t)).toBe(`tileset_${t}`);
    }
    expect(() => terrainRang('fels')).toThrow(/Übergangsrang/);
  });

  it('Wasser liegt immer unten, Schnee immer oben, Gras über Erde über Sand (docs/ART.md §3)', () => {
    const rang = (t: string): number => terrainRang(t);
    for (const t of WELT_TERRAIN) {
      if (t !== 'meeresgrund') expect(rang('meeresgrund')).toBeLessThan(rang(t));
      if (t !== 'schnee') expect(rang('schnee')).toBeGreaterThan(rang(t));
    }
    expect(rang('gras')).toBeGreaterThan(rang('erde'));
    expect(rang('erde')).toBeGreaterThan(rang('sand'));
    expect(rang('gras')).toBeGreaterThan(rang('strasse'));
    expect(rang('torf')).toBeGreaterThan(rang('moorschlamm'));
    expect(rang('obsidianboden')).toBeGreaterThan(rang('lava'));
    // Lehmnester liegen als Mulden im Boden der Wurzelhöhlen (ADR-0024).
    expect(rang('lehm')).toBeLessThan(rang('hoehlenboden'));
    expect(rang('lehm')).toBeLessThan(rang('wurzelboden'));
  });

  it('das tiefere Terrain bleibt ein Vollfeld; nur das höhere zeichnet den Rand', () => {
    const erdeNeben = kachelEbenen('erde', nachbarnAus(NB.E | NB.SE | NB.S, 'gras', 'erde'));
    expect(erdeNeben).toEqual([{ terrain: 'erde', blob: BLOB_VOLL }]);
    const grasNeben = kachelEbenen('gras', nachbarnAus(NB.E | NB.SE | NB.S, 'gras', 'erde'));
    expect(grasNeben).toEqual([
      { terrain: 'erde', blob: BLOB_VOLL },
      { terrain: 'gras', blob: blobIndex(NB.E | NB.SE | NB.S) },
    ]);
  });

  it('stapelt drei Terrains nach Rang; höhere Nachbarn gelten als verbunden', () => {
    // Gras in der Mitte, Sand im Süden, Erde im Osten, Schnee im Norden.
    const n = ['schnee', 'gras', 'erde', 'erde', 'sand', 'sand', 'gras', 'gras'];
    const ebenen = kachelEbenen('gras', n);
    expect(ebenen.map((e) => e.terrain)).toEqual(['sand', 'erde', 'gras']);
    // Sand unten voll; Erde fehlt nur zum Sand hin; Gras fehlt zu Erde und Sand, der Schnee im Norden zählt als verbunden.
    expect(ebenen[0]?.blob).toBe(BLOB_VOLL);
    expect(ebenen[1]?.blob).toBe(blobIndex(NB.N | NB.NE | NB.E | NB.SE | NB.W | NB.NW));
    expect(ebenen[2]?.blob).toBe(blobIndex(NB.N | NB.NE | NB.W | NB.NW));
  });

  it('Saum-Terrain: eigene Kachel mit Uferbank zu fremden Nachbarn, unter Land die reine Bank', () => {
    expect([...SAUM_TERRAIN].sort()).toEqual(['lava', 'meeresgrund']);
    const see = kachelEbenen('meeresgrund', nachbarnAus(NB.N | NB.NE | NB.E, 'meeresgrund', 'sand'));
    expect(see).toEqual([{ terrain: 'meeresgrund', blob: blobIndex(NB.N | NB.NE | NB.E) }]);
    const ufer = kachelEbenen('sand', nachbarnAus(NB.W | NB.SW | NB.S | NB.N | NB.NW, 'sand', 'meeresgrund'));
    expect(ufer[0]).toEqual({ terrain: 'meeresgrund', blob: BLOB_INSEL });
    expect(ufer[1]?.terrain).toBe('sand');
    // Offenes Meer: volles Tiefwasser.
    expect(kachelEbenen('meeresgrund', nachbarnAus(MASKE_VOLL, 'meeresgrund', 'sand'))).toEqual([{ terrain: 'meeresgrund', blob: BLOB_VOLL }]);
  });

  it('arbeitet mit Laufzeit-Ids in beliebiger Reihenfolge und verwendet den Ausgabepuffer wieder', () => {
    const ids = ['schnee', 'erde', 'gras', 'meeresgrund'];
    const tabelle = new Uebergaenge(ids);
    const out: KachelEbene[] = [];
    const n = tabelle.ebenen(2, [0, 2, 2, 1, 1, 3, 2, 2], out);
    expect(n).toBe(3);
    expect(out.slice(0, n).map((e) => ids[e.terrain])).toEqual(['meeresgrund', 'erde', 'gras']);
    const erstes = out[0];
    expect(tabelle.ebenen(2, [2, 2, 2, 2, 2, 2, 2, 2], out)).toBe(1);
    expect(out[0]).toBe(erstes);
    expect(out[0]).toEqual({ terrain: 2, blob: BLOB_VOLL });
    expect(() => tabelle.ebenen(2, [2, 2], out)).toThrow(RangeError);
  });

  it('festes Gestein aus der Terrain-Registry (ohne Tileset) zeichnet keinen Übergang', () => {
    const ids = ['erde', 'fels', 'gras'];
    const tabelle = new Uebergaenge(ids);
    expect([0, 1, 2].map((i) => tabelle.hatTileset(i))).toEqual([true, false, true]);
    const out: KachelEbene[] = [];
    // Fels im Norden und Osten gilt als verbunden, Erde im Süden schneidet den Rand.
    const n = tabelle.ebenen(2, [1, 1, 1, 2, 0, 2, 2, 2], out);
    expect(out.slice(0, n)).toEqual([
      { terrain: 0, blob: BLOB_VOLL },
      { terrain: 2, blob: blobIndex(MASKE_VOLL & ~NB.S) },
    ]);
    expect(() => tabelle.ebenen(1, [0, 0, 0, 0, 0, 0, 0, 0], out)).toThrow(/kein Tileset/);
  });
});

/** Höhenkarte (Ziffern) und Flags (`r` Rampe, `t` Treppe) als Klippen-Umgebung um (tx, ty); außen geklemmt. */
function umgebung(hoehen: readonly string[], flags: readonly string[], tx: number, ty: number): KlippenUmgebung {
  const h = hoehen.length;
  const w = hoehen[0]?.length ?? 0;
  const cx = (x: number): number => Math.max(0, Math.min(w - 1, x));
  const cy = (y: number): number => Math.max(0, Math.min(h - 1, y));
  return {
    hoehe: (dx, dy) => Number(hoehen[cy(ty + dy)]?.[cx(tx + dx)] ?? '0'),
    uebergang: (dx, dy) => {
      const c = flags[cy(ty + dy)]?.[cx(tx + dx)] ?? '.';
      return c === 'r' ? UEBERGANG.rampe : c === 't' ? UEBERGANG.treppe : UEBERGANG.keiner;
    },
  };
}

function frames(hoehen: readonly string[], flags: readonly string[], tx: number, ty: number, zufall = 0.99): number[] {
  const out: number[] = [];
  klippenFrames(umgebung(hoehen, flags, tx, ty), zufall, out);
  return out;
}

const LEER = Array.from({ length: 12 }, () => '............');

describe('Klippen in Höhenstufen', () => {
  // Plateau Höhe 3 (Zeilen 1–3), darunter Ebene 0: Wand in den Zeilen 4–6 (drei Stufen = drei Kacheln).
  const TURM = ['000000000000', '000333330000', '000333330000', '000333330000', '000000000000', '000000000000', '000000000000', '000000000000', '000000000000', '000000000000', '000000000000', '000000000000'];

  it('eine Kante zeigt 16 px Wand je Stufe – die Kacheln unter der Kante sind Wand', () => {
    expect(WAND_PX_JE_STUFE).toBe(TILE);
    expect(MAX_HOEHENSTUFE).toBe(4);
    const zeilen = [4, 5, 6, 7].map((y) => wandAn(umgebung(TURM, LEER, 5, y)));
    expect(zeilen.slice(0, 3).map((w) => w?.stufe)).toEqual([1, 2, 3]);
    expect(zeilen.slice(0, 3).every((w) => w?.stufen === 3 && w.fuss === 0 && w.art === UEBERGANG.keiner)).toBe(true);
    expect(zeilen[3]).toBeNull();
    expect(zeilen.slice(0, 3).reduce((px, w) => px + (w === null ? 0 : WAND_PX_JE_STUFE), 0)).toBe(3 * WAND_PX_JE_STUFE);
    expect(zeilen.slice(0, 3).map((w) => (w === null ? -1 : wandZeile(w)))).toEqual([WAND_ZEILE.oben, WAND_ZEILE.mitte, WAND_ZEILE.unten]);
    // Plateau und Boden daneben sind keine Wand.
    expect(wandAn(umgebung(TURM, LEER, 5, 3))).toBeNull();
    expect(wandAn(umgebung(TURM, LEER, 1, 5))).toBeNull();
  });

  it('jede Höhe 1–4 ergibt genau so viele Wandkacheln', () => {
    for (let d = 1; d <= MAX_HOEHENSTUFE; d++) {
      const karte = ['0000', `0${d}${d}0`, '0000', '0000', '0000', '0000', '0000'];
      const wand = [2, 3, 4, 5, 6].map((y) => wandAn(umgebung(karte, LEER, 1, y)));
      expect(wand.filter((w) => w !== null)).toHaveLength(d);
      const erste = wand[0];
      if (d === 1) expect(erste === null || erste === undefined ? -1 : wandZeile(erste)).toBe(WAND_ZEILE.einzeln);
    }
  });

  it('Wandenden links/rechts, Einzelstück und Innenecke am höheren Nachbarn', () => {
    const karte = ['00000000', '01111100', '01111110', '00000010', '00000000'];
    const spalte = (x: number, y: number): number => {
      const u = umgebung(karte, LEER, x, y);
      const w = wandAn(u);
      if (w === null) throw new Error(`keine Wand bei ${x},${y}`);
      return wandSpalte(u, w);
    };
    expect(spalte(1, 3)).toBe(WAND_SPALTE.links);
    expect(spalte(3, 3)).toBe(WAND_SPALTE.mitte);
    // Rechts stößt die Wand an das höhere Land (6, 3): Innenecke, die Wand läuft dahinter weiter.
    expect(spalte(5, 3)).toBe(WAND_SPALTE.mitte);
    expect(spalte(6, 4)).toBe(WAND_SPALTE.einzeln);
    const zweiter = ['0000000', '0011000', '0000000'];
    const u = umgebung(zweiter, LEER, 2, 2);
    const w = wandAn(u);
    expect(w === null ? -1 : wandSpalte(u, w)).toBe(WAND_SPALTE.links);
  });

  it('Rand der Plateaukachel: Blob-Maske aus gleich hohen oder höheren Nachbarn, Vollfeld ohne Rand', () => {
    expect(frames(TURM, LEER, 5, 2)).toEqual([]);
    // Südkante: Süden (und die Südecken) liegen tiefer.
    expect(frames(TURM, LEER, 5, 3)).toEqual([KLIPPE_FRAME.kante + blobIndex(MASKE_VOLL & ~(NB.S | NB.SE | NB.SW))]);
    // Nordwestecke.
    expect(frames(TURM, LEER, 3, 1)).toEqual([KLIPPE_FRAME.kante + blobIndex(NB.E | NB.SE | NB.S)]);
    // Boden neben der Wand bekommt keinen Rand.
    expect(frames(TURM, LEER, 2, 5)).toEqual([]);
  });

  it('Wandkacheln wählen Zeile, Spalte und – nur mittig – die zweite Fassung', () => {
    expect(frames(TURM, LEER, 3, 4)).toEqual([wandFrame(UEBERGANG.keiner, WAND_ZEILE.oben, WAND_SPALTE.links)]);
    expect(frames(TURM, LEER, 5, 5)).toEqual([wandFrame(UEBERGANG.keiner, WAND_ZEILE.mitte, WAND_SPALTE.mitte)]);
    expect(frames(TURM, LEER, 5, 5, WAND_VARIANTE_ANTEIL / 2)).toEqual([KLIPPE_FRAME.wandVariante + WAND_ZEILE.mitte]);
    expect(frames(TURM, LEER, 7, 6, 0)).toEqual([wandFrame(UEBERGANG.keiner, WAND_ZEILE.unten, WAND_SPALTE.rechts)]);
  });

  it('Rampe und Treppe an Südkanten: die Wandspalte unter der markierten Kante wird begehbar', () => {
    const flags = ['............', '............', '............', '.....rrt....', ...LEER.slice(4)];
    // Zwei Rampenspalten nebeneinander: links und rechts Wangen zur Wand.
    expect(frames(TURM, flags, 5, 4)).toEqual([wandFrame(UEBERGANG.rampe, WAND_ZEILE.oben, WAND_SPALTE.links)]);
    expect(frames(TURM, flags, 6, 6)).toEqual([wandFrame(UEBERGANG.rampe, WAND_ZEILE.unten, WAND_SPALTE.rechts)]);
    expect(frames(TURM, flags, 7, 5)).toEqual([wandFrame(UEBERGANG.treppe, WAND_ZEILE.mitte, WAND_SPALTE.einzeln)]);
    // Die Wand neben der Rampe endet (Wandende zur Rampe hin).
    expect(frames(TURM, flags, 4, 4)).toEqual([wandFrame(UEBERGANG.keiner, WAND_ZEILE.oben, WAND_SPALTE.rechts)]);
    // Die markierte Kantenkachel verliert ihre Südlippe.
    expect(frames(TURM, flags, 5, 3)).toEqual([KLIPPE_FRAME.kante + blobIndex(MASKE_VOLL & ~(NB.SE | NB.SW))]);
  });

  it('Rampe und Treppe an Nord-, West- und Ostkanten brechen den Rand auf', () => {
    const flags = ['............', '.....t......', '...r...t....', ...LEER.slice(3)];
    // Nordkante: Treppe; der Rand bleibt nur an den Ecken offen.
    expect(frames(TURM, flags, 5, 1)).toEqual([KLIPPE_FRAME.kante + blobIndex(MASKE_VOLL & ~(NB.NE | NB.NW)), KLIPPE_FRAME.treppeBruch + KANTEN_BRUCH.n]);
    // Westkante: Rampe.
    expect(frames(TURM, flags, 3, 2)).toEqual([KLIPPE_FRAME.kante + blobIndex(MASKE_VOLL & ~(NB.NW | NB.SW)), KLIPPE_FRAME.rampeBruch + KANTEN_BRUCH.w]);
    // Ostkante: Treppe.
    expect(frames(TURM, flags, 7, 2)).toEqual([KLIPPE_FRAME.kante + blobIndex(MASKE_VOLL & ~(NB.NE | NB.SE)), KLIPPE_FRAME.treppeBruch + KANTEN_BRUCH.o]);
    // Ohne tieferen Nachbarn bleibt das Flag wirkungslos.
    expect(frames(TURM, ['............', '............', '.....r......', ...LEER.slice(3)], 5, 2)).toEqual([]);
  });

  it('Frame-Belegung, Gruppen je Biom und Tileset-Ids', () => {
    expect(KLIPPE_FRAME).toEqual({ kante: 0, wand: 47, wandVariante: 63, rampe: 67, treppe: 83, rampeBruch: 99, treppeBruch: 102, anzahl: 105 });
    const alle = new Set<number>();
    for (const art of [UEBERGANG.keiner, UEBERGANG.rampe, UEBERGANG.treppe]) for (const z of Object.values(WAND_ZEILE)) for (const s of Object.values(WAND_SPALTE)) alle.add(wandFrame(art, z, s));
    expect(alle.size).toBe(48);
    expect(Math.min(...alle)).toBe(KLIPPE_FRAME.wand);
    expect([...BIOME].sort()).toEqual(Object.keys(KLIPPEN_GRUPPE_JE_BIOM).sort());
    expect(new Set(Object.values(KLIPPEN_GRUPPE_JE_BIOM))).toEqual(new Set(KLIPPEN_GRUPPEN));
    expect(KLIPPEN_GRUPPEN.map(klippenTilesetId)).toEqual(['tileset_klippe_gruen', 'tileset_klippe_stein', 'tileset_klippe_sand', 'tileset_klippe_asche', 'tileset_klippe_kristall', 'tileset_klippe_hoehle']);
  });
});

// ---------------------------------------------------------------------------------------------
// Tilesets (M2-17/M2-18)
// ---------------------------------------------------------------------------------------------

const SPRITES = await loadSprites(new URL('../../../assets-src/sprites/terrain', import.meta.url).pathname);
const nachId = new Map(SPRITES.sprites.map((l) => [l.sprite.id, l.sprite]));

function tileset(id: string): Sprite {
  const s = nachId.get(id);
  if (s === undefined) throw new Error(`${id} fehlt`);
  return s;
}

function deckend(s: Sprite, frame: number, x: number, y: number): boolean {
  return (s.frames[frame]?.index[y * TILE + x] ?? TRANSPARENT) !== TRANSPARENT;
}

/** Bit gesetzt, wenn Zelle (dx, dy) Terrain ist; `zellen` = Menge der Terrainzellen relativ zu A (0, 0). */
function maskeUm(zellen: ReadonlySet<string>, ox: number, oy: number): number {
  return nachbarMaske((dx, dy) => zellen.has(`${ox + dx},${oy + dy}`));
}

describe('Terrain-Tilesets (M2-17/M2-18)', () => {
  it('lädt fehlerfrei: 15 Terrain-Tilesets und 6 Klippen-Tilesets', () => {
    expect(SPRITES.errors).toEqual([]);
    for (const t of WELT_TERRAIN) expect(nachId.has(tilesetId(t))).toBe(true);
    for (const g of KLIPPEN_GRUPPEN) expect(tileset(klippenTilesetId(g)).frames).toHaveLength(KLIPPE_FRAME.anzahl);
  });

  it.each(WELT_TERRAIN)('tileset_%s: 47 Blob-Frames + 3–4 Varianten, 16×16, ≤ 12 Farben, ohne Einzelpixel', (t) => {
    const s = tileset(tilesetId(t));
    expect([s.w, s.h, s.hoehe, s.anchor]).toEqual([TILE, TILE, 'flach', [0, 0]]);
    const varianten = s.frames.length - TILESET_VARIANTEN_START;
    expect(varianten).toBeGreaterThanOrEqual(3);
    expect(varianten).toBeLessThanOrEqual(4);
    expect(spriteColorCount(s)).toBeLessThanOrEqual(12);
    expect(checkSprite(s)).toEqual({ errors: [], warnings: [] });
    // Vollfeld und Varianten decken die Kachel; Saum-Terrain deckt jeden Frame.
    for (let f = BLOB_VOLL; f < s.frames.length; f++) for (let p = 0; p < TILE * TILE; p++) expect(deckend(s, f, p % TILE, Math.floor(p / TILE))).toBe(true);
    if (SAUM_TERRAIN.has(t)) for (let f = 0; f < BLOB_ANZAHL; f++) expect(s.frames[f]?.index.every((v) => v !== TRANSPARENT)).toBe(true);
    else {
      // Überlagerung: die Insel lässt die Ecken frei, das Vollfeld nicht.
      expect(deckend(s, BLOB_INSEL, 0, 0)).toBe(false);
      expect(deckend(s, BLOB_INSEL, 8, 8)).toBe(true);
    }
  });

  it('Streugewichte der Vollfeld-Varianten stehen als Daten am Terrain (src/content/terrain.ts), eines je Variante', () => {
    for (const t of WELT_TERRAIN) {
      const daten = TERRAIN.find((x) => x.id === t)?.tileset;
      expect(daten, t).toBeDefined();
      expect(daten?.variantWeights, t).toHaveLength(tileset(tilesetId(t)).frames.length - TILESET_VARIANTEN_START);
      // Pflaster hat feste Fugen und wird nicht gespiegelt.
      expect(daten?.mirror, t).toBe(t !== 'strasse');
    }
  });

  it.each(KLIPPEN_GRUPPEN)('tileset_klippe_%s: ≤ 12 Farben, ohne Einzelpixel, Wände deckend bis auf den Fuß', (g) => {
    const s = tileset(klippenTilesetId(g));
    expect(spriteColorCount(s)).toBeLessThanOrEqual(12);
    expect(checkSprite(s)).toEqual({ errors: [], warnings: [] });
    const mitte = wandFrame(UEBERGANG.keiner, WAND_ZEILE.mitte, WAND_SPALTE.mitte);
    expect(s.frames[mitte]?.index.every((v) => v !== TRANSPARENT)).toBe(true);
    // Das Vollfeld des Rands ist leer (die Plateaufläche zeigt ihren Boden).
    expect(s.frames[KLIPPE_FRAME.kante + BLOB_VOLL]?.index.every((v) => v === TRANSPARENT)).toBe(true);
  });

  /**
   * Nahtlosigkeit: Für jede Belegung der zehn Zellen um ein waagerechtes Kachelpaar A|B (beide Terrain)
   * müssen die Deckung von Spalte 15 in A und Spalte 0 in B übereinstimmen (höchstens eine Zeile
   * Abweichung); ebenso senkrecht für A über B mit Zeile 15/0. So stoßen Kanten, Ecken und Innenecken an
   * jeder möglichen Nachbarschaft ohne Stufe aneinander.
   */
  it.each(WELT_TERRAIN.filter((t) => !SAUM_TERRAIN.has(t)))('tileset_%s: Kanten laufen an jeder Nachbarschaft nahtlos über die Kachelgrenze', (t) => {
    const s = tileset(tilesetId(t));
    const rand = (paar: 'waagerecht' | 'senkrecht'): number => {
      // Zellen um A (0, 0) und B (1, 0) bzw. B (0, 1), ohne A und B selbst.
      const umfeld =
        paar === 'waagerecht'
          ? [-1, 0, 1, 2].flatMap((x) => [`${x},-1`, `${x},1`]).concat(['-1,0', '2,0'])
          : [-1, 0, 1, 2].flatMap((y) => [`-1,${y}`, `1,${y}`]).concat(['0,-1', '0,2']);
      let schlimmste = 0;
      for (let belegung = 0; belegung < 1 << umfeld.length; belegung++) {
        const zellen = new Set(['0,0', paar === 'waagerecht' ? '1,0' : '0,1']);
        umfeld.forEach((z, i) => {
          if ((belegung & (1 << i)) !== 0) zellen.add(z);
        });
        const a = blobIndex(maskeUm(zellen, 0, 0));
        const b = paar === 'waagerecht' ? blobIndex(maskeUm(zellen, 1, 0)) : blobIndex(maskeUm(zellen, 0, 1));
        let abweichung = 0;
        for (let i = 0; i < TILE; i++) {
          const da = paar === 'waagerecht' ? deckend(s, a, TILE - 1, i) : deckend(s, a, i, TILE - 1);
          const db = paar === 'waagerecht' ? deckend(s, b, 0, i) : deckend(s, b, i, 0);
          if (da !== db) abweichung++;
        }
        schlimmste = Math.max(schlimmste, abweichung);
      }
      return schlimmste;
    };
    expect(rand('waagerecht')).toBeLessThanOrEqual(1);
    expect(rand('senkrecht')).toBeLessThanOrEqual(1);
  });
});
