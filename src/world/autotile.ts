/**
 * Autotiling (M2-16, MASTERPROMPT §4.4/§4.5, docs/WORLD.md §7, docs/ART.md §3): 47er-Blob-Regel,
 * Übergangsprioritäten zwischen Terrain-Typen und Klippen in Höhenstufen mit Rampen und Treppen.
 * Reine Funktionen ohne Zufall; die Präsentation (Kachelkarte, M2-28) übersetzt ihre Ergebnisse in
 * Frames der Tileset-Sprites.
 *
 * **Blob-Regel.** Die 8er-Nachbarschaft einer Kachel wird als Bitmaske geschrieben (Norden = Bit 0, im
 * Uhrzeigersinn, `NB`). Ein Eckbit zählt nur, wenn beide angrenzenden Seiten verbunden sind – eine
 * Ecke ohne ihre Seiten ändert das Bild nicht. So bleiben von 256 Masken 47 (`BLOB_MASKS`, aufsteigend
 * sortiert); ihr Index ist der Blob-Index und zugleich der Frame im Tileset `tileset_<terrain>`
 * (Frames 0–46; ab Frame 47 folgen die Varianten des Vollfeldes, docs/WORLD.md §7).
 *
 * **Übergänge.** Das höher liegende Terrain zeichnet den Rand (docs/ART.md §3): Eine Kachel wird als
 * Stapel gezeichnet – unten das niedrigste Terrain ihrer 3×3-Umgebung als Vollfeld, darüber jedes
 * höhere Terrain bis zu ihrem eigenen mit der Maske „Nachbar liegt gleich hoch oder höher“. Die
 * Tileset-Frames 0–45 dieser Terrains sind deshalb Überlagerungen (außen transparent). Meeresgrund und
 * Lava liegen ganz unten und haben einen **Saum**: Ihre Frames decken die Kachel ganz und zeigen zu
 * fremden Nachbarn hin eine Uferbank (Flachwasser) bzw. erkaltete Kruste; unter einer fremden Kachel
 * liegen sie als reine Uferbank (Blob 0), damit die Bank unter dem Rand des Landes weiterläuft.
 *
 * **Klippen.** Höhenstufen 0–4; eine Kante zeigt 16 px Wand je Stufe (§4.4). Die Wand liegt in den
 * Kacheln unmittelbar südlich der Plateaukante auf der tieferen Ebene: Fällt eine Kante um `d` Stufen,
 * sind die `d` Kacheln darunter Wand (Zeile 1…d) – die Weltgenerierung hält sie frei. Nord-, Ost- und
 * Westkanten zeigen nur den Rand auf der Plateaukachel (die Wand zeigt vom Betrachter weg bzw. steht
 * seitlich). Rampen und Treppen markiert das Flag an der oberen Kantenkachel: an einer Südkante wird
 * die Wandspalte darunter zu Rampe bzw. Treppe, an Nord-, Ost- und Westkanten bricht der Rand auf.
 * Im Untergrund lässt sich festes Gestein als Höhe über dem Boden darstellen (Gruppe `hoehle`).
 */

/** Bits der 8er-Nachbarschaft, im Uhrzeigersinn ab Norden. */
export const NB = { N: 1, NE: 2, E: 4, SE: 8, S: 16, SW: 32, W: 64, NW: 128 } as const;
export type Richtung = keyof typeof NB;
/** Richtungen in Bitreihenfolge. */
export const RICHTUNGEN: readonly Richtung[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** Versatz (dx, dy) je Richtung; y wächst nach Süden. */
export const VERSATZ: Readonly<Record<Richtung, readonly [number, number]>> = {
  N: [0, -1],
  NE: [1, -1],
  E: [1, 0],
  SE: [1, 1],
  S: [0, 1],
  SW: [-1, 1],
  W: [-1, 0],
  NW: [-1, -1],
};

/** Alle acht Nachbarn verbunden. */
export const MASKE_VOLL = 0xff;
/** Anzahl der möglichen 8-Bit-Masken. */
const MASKEN_ANZAHL = MASKE_VOLL + 1;
/** Ecke → ihre beiden Seiten. */
const ECKEN: ReadonlyArray<readonly [number, number, number]> = [
  [NB.NE, NB.N, NB.E],
  [NB.SE, NB.S, NB.E],
  [NB.SW, NB.S, NB.W],
  [NB.NW, NB.N, NB.W],
];

/** Streicht Eckbits, deren beide Seiten nicht verbunden sind (Blob-Regel). */
export function reduziereMaske(maske: number): number {
  let m = maske & MASKE_VOLL;
  for (const [ecke, a, b] of ECKEN) if ((m & a) === 0 || (m & b) === 0) m &= ~ecke;
  return m;
}

function baueBlobMasken(): number[] {
  const set = new Set<number>();
  for (let m = 0; m < MASKEN_ANZAHL; m++) set.add(reduziereMaske(m));
  return [...set].sort((a, b) => a - b);
}

/** Die 47 reduzierten Masken, aufsteigend; der Index ist Blob-Index und Tileset-Frame. */
export const BLOB_MASKS: readonly number[] = Object.freeze(baueBlobMasken());
/** Anzahl der Blob-Frames (47). */
export const BLOB_ANZAHL = BLOB_MASKS.length;

const BLOB_LUT: Uint8Array = (() => {
  const lut = new Uint8Array(MASKEN_ANZAHL);
  for (let m = 0; m < MASKEN_ANZAHL; m++) lut[m] = BLOB_MASKS.indexOf(reduziereMaske(m));
  return lut;
})();

/** Blob-Index (0…46) einer beliebigen 8-Bit-Nachbarschaftsmaske. */
export function blobIndex(maske: number): number {
  return BLOB_LUT[maske & MASKE_VOLL] ?? 0;
}

/** Blob-Index des Vollfeldes (alle Nachbarn verbunden). */
export const BLOB_VOLL = blobIndex(MASKE_VOLL);
/** Blob-Index der Insel (kein Nachbar verbunden); bei Saum-Terrain die reine Uferbank. */
export const BLOB_INSEL = blobIndex(0);
/** Erster Frame der Vollfeld-Varianten in `tileset_<terrain>`. */
export const TILESET_VARIANTEN_START = BLOB_ANZAHL;

/** Maske aus einem Prädikat „Nachbar (dx, dy) ist verbunden“ (unreduziert). */
export function nachbarMaske(verbunden: (dx: number, dy: number) => boolean): number {
  let m = 0;
  for (const r of RICHTUNGEN) {
    const [dx, dy] = VERSATZ[r];
    if (verbunden(dx, dy)) m |= NB[r];
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
// Übergangsprioritäten
// ---------------------------------------------------------------------------------------------

/**
 * Übergangsreihenfolge, tief → hoch (docs/ART.md §3 „Das höher liegende Terrain zeichnet den Rand“):
 * Wasser (Meeresgrund) liegt immer unten, darüber Lava; nasse, tief liegende Böden (Moorschlamm, Eis,
 * Pflaster, Torf) unter den festen; Sand unter Dünengras (die Halme der Salzküsten-Dünen stehen im
 * Sand), Dünengras unter Erde, Erde unter Gras; Asche und Kristall legen sich
 * über die Wiese, Schnee liegt immer oben. Untergrund: Lehmnester liegen als Mulden unter Höhlen- und
 * Wurzelboden, Höhlenboden unter Obsidian, Wurzeln über Erde.
 */
export const TERRAIN_REIHENFOLGE = [
  'meeresgrund',
  'lava',
  'moorschlamm',
  'eis',
  'strasse',
  'torf',
  'lehm',
  'hoehlenboden',
  'obsidianboden',
  'sand',
  'duenengras',
  'erde',
  'wurzelboden',
  'gras',
  'asche',
  'kristallboden',
  'schnee',
] as const;
export type TerrainArt = (typeof TERRAIN_REIHENFOLGE)[number];

/** Terrain mit Saum: deckende Frames mit Uferbank bzw. Kruste zu fremden Nachbarn. */
export const SAUM_TERRAIN: ReadonlySet<string> = new Set<TerrainArt>(['meeresgrund', 'lava']);

const RANG = new Map<string, number>(TERRAIN_REIHENFOLGE.map((id, i) => [id, i]));

/** Übergangsrang eines Terrains (höher zeichnet den Rand); wirft bei unbekanntem Terrain. */
export function terrainRang(id: string): number {
  const r = RANG.get(id);
  if (r === undefined) throw new Error(`Terrain ${id} hat keinen Übergangsrang (TERRAIN_REIHENFOLGE in src/world/autotile.ts)`);
  return r;
}

/** Sprite-Id des Tilesets eines Terrains (docs/WORLD.md §7). */
export function tilesetId(terrain: string): string {
  return `tileset_${terrain}`;
}

/** Eine Ebene des Kachelstapels: Terrain (Laufzeit-Id) und Blob-Index. */
export interface KachelEbene {
  terrain: number;
  blob: number;
}

/** Höchstens so viele Ebenen hat ein Stapel (Mitte + acht verschiedene Nachbarn). */
export const MAX_EBENEN = RICHTUNGEN.length + 1;

/** Rang eines Terrains ohne Tileset (festes Gestein `fels`, `tiefenfels`, `glutfels`). */
const OHNE_RANG = -1;

/**
 * Übergangstabelle für Laufzeit-Ids (Index in `terrainIds`, docs/WORLD.md §4), z. B. die ganze
 * Terrain-Registry. Terrain ohne Rang in `TERRAIN_REIHENFOLGE` (festes Gestein, das als Höhe bzw.
 * Wand dargestellt wird) zeichnet keinen Boden: Als Nachbar gilt es als verbunden (kein Übergang),
 * als Mitte ist es ein Fehler.
 */
export class Uebergaenge {
  private readonly rang: Int16Array;
  private readonly saum: Uint8Array;
  private readonly kandidaten = new Int32Array(MAX_EBENEN);

  constructor(readonly terrainIds: readonly string[]) {
    this.rang = Int16Array.from(terrainIds, (id) => RANG.get(id) ?? OHNE_RANG);
    this.saum = Uint8Array.from(terrainIds, (id) => (SAUM_TERRAIN.has(id) ? 1 : 0));
  }

  /** Ob das Laufzeit-Terrain `id` ein Tileset (und damit Übergänge) hat. */
  hatTileset(id: number): boolean {
    return (this.rang[id] ?? OHNE_RANG) !== OHNE_RANG;
  }

  private rangVon(id: number): number {
    const r = this.rang[id];
    if (r === undefined) throw new RangeError(`Laufzeit-Terrain ${id} fehlt in der Übergangstabelle`);
    return r;
  }

  /**
   * Kachelstapel für die Mitte `mitte` mit den Nachbarn `nachbarn` (acht Laufzeit-Ids in
   * `RICHTUNGEN`-Reihenfolge). Schreibt die Ebenen von unten nach oben nach `out` und liefert ihre
   * Anzahl. Die unterste Ebene ist ein Vollfeld (`BLOB_VOLL`, Variante per Positions-Hash wählt der
   * Aufrufer) bzw. bei Saum-Terrain die Uferbank oder der Saum der eigenen Kachel.
   */
  ebenen(mitte: number, nachbarn: ArrayLike<number>, out: KachelEbene[]): number {
    if (nachbarn.length !== RICHTUNGEN.length) throw new RangeError(`ebenen: ${RICHTUNGEN.length} Nachbarn erwartet, ${nachbarn.length} erhalten`);
    const rm = this.rangVon(mitte);
    if (rm === OHNE_RANG) throw new RangeError(`Terrain ${this.terrainIds[mitte] ?? mitte} hat kein Tileset (TERRAIN_REIHENFOLGE)`);
    const k = this.kandidaten;
    let n = 0;
    for (let i = 0; i < nachbarn.length; i++) {
      const t = nachbarn[i] ?? mitte;
      const rt = this.rangVon(t);
      if (rt === OHNE_RANG || rt >= rm) continue;
      let neu = true;
      for (let j = 0; j < n; j++) if (k[j] === t) neu = false;
      if (neu) k[n++] = t;
    }
    k[n++] = mitte;
    // Einfügesortierung nach Rang (höchstens neun Einträge).
    for (let i = 1; i < n; i++) {
      const t = k[i] ?? mitte;
      const r = this.rangVon(t);
      let j = i - 1;
      while (j >= 0 && this.rangVon(k[j] ?? mitte) > r) {
        k[j + 1] = k[j] ?? mitte;
        j--;
      }
      k[j + 1] = t;
    }
    for (let e = 0; e < n; e++) {
      const t = k[e] ?? mitte;
      let maske = 0;
      if (this.saum[t] === 1) {
        if (t === mitte) for (let i = 0; i < nachbarn.length; i++) if (nachbarn[i] === t) maske |= 1 << i;
      } else {
        const rt = this.rangVon(t);
        for (let i = 0; i < nachbarn.length; i++) {
          const rn = this.rangVon(nachbarn[i] ?? mitte);
          if (rn === OHNE_RANG || rn >= rt) maske |= 1 << i;
        }
      }
      const ebene = out[e];
      if (ebene === undefined) out[e] = { terrain: t, blob: blobIndex(maske) };
      else {
        ebene.terrain = t;
        ebene.blob = blobIndex(maske);
      }
    }
    return n;
  }
}

/** Bequemlichkeit für String-Ids (Werkzeuge, Tests): Ebenen als `{ terrain, blob }` von unten nach oben. */
export function kachelEbenen(mitte: string, nachbarn: readonly string[]): Array<{ terrain: string; blob: number }> {
  const ids = [...new Set([mitte, ...nachbarn])];
  const tabelle = new Uebergaenge(ids);
  const out: KachelEbene[] = [];
  const n = tabelle.ebenen(
    ids.indexOf(mitte),
    nachbarn.map((t) => ids.indexOf(t)),
    out,
  );
  return out.slice(0, n).map((e) => ({ terrain: ids[e.terrain] ?? mitte, blob: e.blob }));
}

// ---------------------------------------------------------------------------------------------
// Klippen, Rampen, Treppen
// ---------------------------------------------------------------------------------------------

/** Höchste Höhenstufe der Oberfläche (docs/WORLD.md §3). */
export const MAX_HOEHENSTUFE = 4;
/** Sichtbare Wandhöhe je Höhenstufe in px (§4.4) = eine Kachelzeile. */
export const WAND_PX_JE_STUFE = 16;
/** Übergang an einer Kantenkachel (Flag der oberen Kachel). */
export const UEBERGANG = { keiner: 0, rampe: 1, treppe: 2 } as const;
export type Uebergang = (typeof UEBERGANG)[keyof typeof UEBERGANG];

/** Zeile eines Wandstücks: oben (unter der Kante), mitte, unten (Fuß), einzeln (Wand einer Stufe). */
export const WAND_ZEILE = { oben: 0, mitte: 1, unten: 2, einzeln: 3 } as const;
/** Spalte eines Wandstücks: links/rechts = Wandende (Außenecke), einzeln = beide Enden. */
export const WAND_SPALTE = { links: 0, mitte: 1, rechts: 2, einzeln: 3 } as const;
/** Richtung eines Kantenbruchs (Rampe/Treppe an Nord-, Ost- oder Westkante). */
export const KANTEN_BRUCH = { n: 0, o: 1, w: 2 } as const;

const ZEILEN = Object.keys(WAND_ZEILE).length;
const SPALTEN = Object.keys(WAND_SPALTE).length;
const BRUECHE = Object.keys(KANTEN_BRUCH).length;

/**
 * Frame-Belegung von `tileset_klippe_<gruppe>` (docs/WORLD.md §7):
 * - `kante` + Blob-Index (0–46): Rand der Plateaukachel, Maske = Nachbarn gleich hoch oder höher.
 * - `wand`, `rampe`, `treppe` + Zeile × 4 + Spalte: Wandstücke bzw. Rampe/Treppe an einer Südkante.
 * - `wandVariante` + Zeile: zweite Fassung des mittleren Wandstücks je Zeile (gegen Wiederholung).
 * - `rampeBruch`, `treppeBruch` + `KANTEN_BRUCH`: Rampe/Treppe an Nord-, Ost- bzw. Westkante.
 */
export const KLIPPE_FRAME = (() => {
  let i = 0;
  const kante = i;
  i += BLOB_ANZAHL;
  const wand = i;
  i += ZEILEN * SPALTEN;
  const wandVariante = i;
  i += ZEILEN;
  const rampe = i;
  i += ZEILEN * SPALTEN;
  const treppe = i;
  i += ZEILEN * SPALTEN;
  const rampeBruch = i;
  i += BRUECHE;
  const treppeBruch = i;
  i += BRUECHE;
  return { kante, wand, wandVariante, rampe, treppe, rampeBruch, treppeBruch, anzahl: i } as const;
})();

/** Frame eines Wand-, Rampen- oder Treppenstücks. */
export function wandFrame(art: Uebergang, zeile: number, spalte: number): number {
  const basis = art === UEBERGANG.rampe ? KLIPPE_FRAME.rampe : art === UEBERGANG.treppe ? KLIPPE_FRAME.treppe : KLIPPE_FRAME.wand;
  return basis + zeile * SPALTEN + spalte;
}

/** Klippen-Gruppen (Material der Wände): `tileset_klippe_<gruppe>`. */
export const KLIPPEN_GRUPPEN = ['gruen', 'stein', 'sand', 'asche', 'kristall', 'hoehle'] as const;
export type KlippenGruppe = (typeof KLIPPEN_GRUPPEN)[number];

/** Klippen-Gruppe je Biom (docs/WORLD.md §7); die Biom-Palettenzeile tönt `gruen` und `hoehle` nach. */
export const KLIPPEN_GRUPPE_JE_BIOM: Readonly<Record<string, KlippenGruppe>> = {
  gruenhain: 'gruen',
  salzkueste: 'sand',
  nebelmoor: 'gruen',
  frostkamm: 'stein',
  glutsand: 'sand',
  aschenschlund: 'asche',
  scherbenhain: 'kristall',
  nachtherz: 'asche',
  wurzelhoehlen: 'hoehle',
  tiefgrund: 'hoehle',
  glutadern: 'asche',
};

/** Sprite-Id des Klippen-Tilesets einer Gruppe. */
export function klippenTilesetId(gruppe: KlippenGruppe): string {
  return `tileset_klippe_${gruppe}`;
}

/** Sicht auf die Umgebung einer Kachel (Versatz relativ zur betrachteten Kachel). */
export interface KlippenUmgebung {
  /** Höhenstufe 0…4 der Kachel (dx, dy). */
  hoehe(dx: number, dy: number): number;
  /** Übergangs-Flag (`UEBERGANG`) der Kachel (dx, dy). */
  uebergang(dx: number, dy: number): number;
}

/** Eine Kachel, die von einer Klippenwand bedeckt ist. */
export interface WandStueck {
  /** Zeile der Wand, 1 = direkt unter der Kante. */
  readonly stufe: number;
  /** Höhe der Wand in Stufen (= Kacheln). */
  readonly stufen: number;
  /** dy der Plateaukachel an der Kante (relativ zur betrachteten Kachel). */
  readonly kanteDy: number;
  /** Höhenstufe am Wandfuß (Ebene unter der Kante). */
  readonly fuss: number;
  /** Wand, Rampe oder Treppe (Flag der Kantenkachel). */
  readonly art: Uebergang;
}

function alsUebergang(v: number): Uebergang {
  return v === UEBERGANG.rampe ? UEBERGANG.rampe : v === UEBERGANG.treppe ? UEBERGANG.treppe : UEBERGANG.keiner;
}

/**
 * Wandstück an (dx, dy) oder `null`: Die Kachel liegt `k` Zeilen unter einer Kante, die um
 * mindestens `k` Stufen fällt (16 px Wand je Stufe), und nicht höher als die Kante selbst.
 */
export function wandAn(u: KlippenUmgebung, dx = 0, dy = 0): WandStueck | null {
  const hier = u.hoehe(dx, dy);
  for (let k = 1; k <= MAX_HOEHENSTUFE; k++) {
    const oben = u.hoehe(dx, dy - k);
    const fuss = u.hoehe(dx, dy - k + 1);
    const stufen = oben - fuss;
    if (stufen >= k && hier < oben) return { stufe: k, stufen, kanteDy: dy - k, fuss, art: alsUebergang(u.uebergang(dx, dy - k)) };
  }
  return null;
}

/** Zeile eines Wandstücks. */
export function wandZeile(w: WandStueck): number {
  if (w.stufen === 1) return WAND_ZEILE.einzeln;
  if (w.stufe === 1) return WAND_ZEILE.oben;
  return w.stufe >= w.stufen ? WAND_ZEILE.unten : WAND_ZEILE.mitte;
}

/**
 * Ob die Wand an (dx, dy) seitlich nach (dx + seite, dy) weiterläuft: dort steht ein Stück derselben
 * Art (Wand an Wand, Rampe an Rampe), oder – nur bei Wänden – höheres Land, hinter dem die Wand
 * verschwindet (Innenecke).
 */
function wandVerbunden(u: KlippenUmgebung, w: WandStueck, dx: number, dy: number, seite: number): boolean {
  const n = wandAn(u, dx + seite, dy);
  if (n !== null) return n.art === w.art;
  return w.art === UEBERGANG.keiner && u.hoehe(dx + seite, dy) > w.fuss;
}

/** Spalte eines Wandstücks (Wandenden links/rechts). */
export function wandSpalte(u: KlippenUmgebung, w: WandStueck, dx = 0, dy = 0): number {
  const links = wandVerbunden(u, w, dx, dy, -1);
  const rechts = wandVerbunden(u, w, dx, dy, 1);
  if (links && rechts) return WAND_SPALTE.mitte;
  if (links) return WAND_SPALTE.rechts;
  if (rechts) return WAND_SPALTE.links;
  return WAND_SPALTE.einzeln;
}

/** Richtungen, in die eine markierte Kantenkachel aufbricht (Süd zuerst, dann Nord, West, Ost). */
const BRUCH_REIHENFOLGE: ReadonlyArray<readonly [Richtung, number | null]> = [
  ['S', null],
  ['N', KANTEN_BRUCH.n],
  ['W', KANTEN_BRUCH.w],
  ['E', KANTEN_BRUCH.o],
];

/** Anteil der mittleren Wandstücke, die die zweite Fassung zeigen. */
export const WAND_VARIANTE_ANTEIL = 0.35;

/**
 * Klippen-Frames der Kachel (0, 0) von unten nach oben nach `out` (Frames von
 * `tileset_klippe_<gruppe>`, `KLIPPE_FRAME`); liefert ihre Anzahl. `zufall` ∈ [0, 1) ist ein
 * Positions-Hash der Kachel (Wahl der Wandvariante).
 * - Wandkachel: ein deckendes Wand-, Rampen- oder Treppenstück (Zeile nach Stufe, Spalte nach Enden).
 * - Plateaukachel mit tieferem Nachbarn: Rand (`kante` + Blob-Index); mit Übergangs-Flag bricht der
 *   Rand zur tieferen Seite auf (an Nord-, Ost- und Westkanten zusätzlich ein Bruchstück).
 */
export function klippenFrames(u: KlippenUmgebung, zufall: number, out: number[]): number {
  out.length = 0;
  const wand = wandAn(u);
  if (wand !== null) {
    const zeile = wandZeile(wand);
    const spalte = wandSpalte(u, wand);
    if (wand.art === UEBERGANG.keiner && spalte === WAND_SPALTE.mitte && zufall < WAND_VARIANTE_ANTEIL) out.push(KLIPPE_FRAME.wandVariante + zeile);
    else out.push(wandFrame(wand.art, zeile, spalte));
    return out.length;
  }
  const h = u.hoehe(0, 0);
  let maske = nachbarMaske((dx, dy) => u.hoehe(dx, dy) >= h);
  let bruch: number | null = null;
  const art = alsUebergang(u.uebergang(0, 0));
  if (art !== UEBERGANG.keiner) {
    for (const [r, b] of BRUCH_REIHENFOLGE) {
      if ((maske & NB[r]) !== 0) continue;
      maske |= NB[r];
      bruch = b;
      break;
    }
  }
  const blob = blobIndex(maske);
  if (blob !== BLOB_VOLL) out.push(KLIPPE_FRAME.kante + blob);
  if (bruch !== null) out.push((art === UEBERGANG.rampe ? KLIPPE_FRAME.rampeBruch : KLIPPE_FRAME.treppeBruch) + bruch);
  return out.length;
}
