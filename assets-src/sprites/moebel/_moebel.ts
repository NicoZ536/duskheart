/**
 * Gemeinsamer Baustein der Möbel-, Deko-, Wandobjekt- und Licht-Sprites T0–T1 (M4-19; docs/SPIEL.md §8
 * „Möbel/Deko/Stationen `obj_<id>`“). Alle Sprites landen im Kontaktbogen `moebel_t0_t1.png`
 * (Gruppen-Ids sind snake_case wie bei `gruenhain_basis`).
 *
 * Konventionen (docs/ART.md §2–§3):
 * - **Stellfläche:** Ein Objekt steht auf `breite × tiefe` Tiles (Daten in src/content/items/moebel*.ts).
 *   Die Zelle ist `16 · breite` breit; 1 px Luft zum Zellrand für die Interaktions-Outline des Shaders.
 *   Der Anker ist die Mitte der Vorderkante der Stellfläche (Fußpunkt, y-Sortierung). Was höher ist als
 *   der Boden (Lehne, Kopfteil, Schrank), ragt über die Stellfläche nach oben.
 * - **Wandobjekte** liegen auf der Ebene Wandobjekt eines Wand-Tiles und hängen an dessen 16-px-Wandfront
 *   (assets-src/sprites/bau/_bau.ts): Anker unten Mitte (unterster Pixel), `MOEBEL_WANDHOEHE_PX` über der
 *   Fußlinie der Front (Daten), höchstens 15 px hoch, sortiert direkt vor der Wand.
 * - **Kontur** `nacht.1` wie die Werkbank (Items, Licht, Möbel trennen sich so auf jedem Boden);
 *   Holz in `holz` (Eiche, Möbel-Farbvarianten über `HOLZ_VARIANTEN`), Stoff in `laub` (Rot, Varianten
 *   über `STOFF_VARIANTEN`), Stroh in `sand`, Stein in `stein`, Bronze in den Farben der Stufenzeile
 *   `stufe_bronze` mit Metallflag, Glas in `eis` mit Glanzflag.
 * - **Schattierung** nach Himmelsöffnung: Oberseiten hell, Fronten mittel, Fugen, Unterkanten und
 *   Kontaktstellen dunkel; kein Richtungslicht (das rechnet der Renderer über die Normalen).
 * - **Lichter** leuchten nur in den Flammen- bzw. Glaspixeln ihres Clips `idle` (brennt) – `aus` ist
 *   dunkel. Sockel `licht` je Frame im hellen Kern.
 *
 * Eine Legende für alle Möbel, damit dieselbe Farbe überall dasselbe Zeichen hat (wie bei den Icons):
 * - `nacht`: `K` 0 · `k` 1 (Kontur) · `n` 2 · `N` 3 · `~` 4
 * - `stein`: Ziffern `1`–`6` (Stufe 0–5) · `holz`: `a`–`e` · `erde`: `p`–`t`
 * - `gras`: `G` `g` `h` `i` `j` `J` · `laub`: `L` `l` `m` `M` `o` · `wasser`: `w` `x` `y` `z` `Z` `Y`
 * - `sand`: `A`–`E` · `feuer` (nicht leuchtend): `f` `F` `u` `U` `v` `V` · `haut`: `H` `I` `O` `R` `S`
 * - `eis`: `7` `8` `9` `0` `#` · `verderb`: `(` `)` `[` `]` `%`
 * - leuchtend: `{` feuer.1 · `}` feuer.2 · `+` feuer.3 · `=` feuer.4 · `@` feuer.5 · `^` sand.3 · `$` sand.4
 * - Bronze (Metallflag über `METALL`): `Q` erde.1 · `W` laub.2 · `X` holz.3 · `T` laub.3 · `P` sand.2
 * - Glas (Glanzflag über `GLAS`): `:` eis.1 · `;` eis.3
 */
import { sprite, type HeightHint, type Sprite, type SpriteSource } from '../../lib/sprite';

/** Kontaktbogen der Serie (`tools/out/sheets/moebel_t0_t1.png`). */
export const MOEBEL_GRUPPE = 'moebel_t0_t1';
/** Kantenlänge eines Tiles [px]. */
export const TILE = 16;
/** Präfix der Objekt-Sprites (docs/SPIEL.md §8). */
export const OBJ_PRAEFIX = 'obj_';

/** Zeichen der Bronzebeschläge (Metallflag). */
export const METALL = 'QWXTP';
/** Zeichen des Glases (Glanzflag „nass“). */
export const GLAS = ':;';

export const MOEBEL_LEGENDE: Readonly<Record<string, string | null>> = {
  '.': null,
  K: 'nacht.0',
  k: 'nacht.1',
  n: 'nacht.2',
  N: 'nacht.3',
  '~': 'nacht.4',
  '1': 'stein.0',
  '2': 'stein.1',
  '3': 'stein.2',
  '4': 'stein.3',
  '5': 'stein.4',
  '6': 'stein.5',
  a: 'holz.0',
  b: 'holz.1',
  c: 'holz.2',
  d: 'holz.3',
  e: 'holz.4',
  p: 'erde.0',
  q: 'erde.1',
  r: 'erde.2',
  s: 'erde.3',
  t: 'erde.4',
  G: 'gras.0',
  g: 'gras.1',
  h: 'gras.2',
  i: 'gras.3',
  j: 'gras.4',
  J: 'gras.5',
  L: 'laub.0',
  l: 'laub.1',
  m: 'laub.2',
  M: 'laub.3',
  o: 'laub.4',
  w: 'wasser.0',
  x: 'wasser.1',
  y: 'wasser.2',
  z: 'wasser.3',
  Z: 'wasser.4',
  Y: 'wasser.5',
  A: 'sand.0',
  B: 'sand.1',
  C: 'sand.2',
  D: 'sand.3',
  E: 'sand.4',
  f: 'feuer.0',
  F: 'feuer.1',
  u: 'feuer.2',
  U: 'feuer.3',
  v: 'feuer.4',
  V: 'feuer.5',
  H: 'haut.0',
  I: 'haut.1',
  O: 'haut.2',
  R: 'haut.3',
  S: 'haut.4',
  '7': 'eis.0',
  '8': 'eis.1',
  '9': 'eis.2',
  '0': 'eis.3',
  '#': 'eis.4',
  '(': 'verderb.0',
  ')': 'verderb.1',
  '[': 'verderb.2',
  ']': 'verderb.3',
  '%': 'verderb.4',
  '{': 'feuer.1*',
  '}': 'feuer.2*',
  '+': 'feuer.3*',
  '=': 'feuer.4*',
  '@': 'feuer.5*',
  '^': 'sand.3*',
  $: 'sand.4*',
  Q: 'erde.1',
  W: 'laub.2',
  X: 'holz.3',
  T: 'laub.3',
  P: 'sand.2',
  ':': 'eis.1',
  ';': 'eis.3',
};

/** Quelle eines Möbel-Sprites: wie `sprite()`, aber Id ohne Präfix, Legende und Gruppe fest. */
export type MoebelQuelle = Omit<SpriteSource, 'id' | 'group' | 'legende' | 'hoehe' | 'material'> & {
  /** Item-Id (das Sprite heißt `obj_<item>`). */
  readonly item: string;
  readonly hoehe: HeightHint;
  /** Hat Bronzebeschläge (Zeichen `METALL` bekommen das Metallflag). */
  readonly metall?: boolean;
  /** Hat Glas (Zeichen `GLAS` bekommen das Glanzflag). */
  readonly glas?: boolean;
  /** Weitere glänzend-nasse Zeichen (Wasser im Brunnen). */
  readonly nass?: string;
  /** Zeichen mit Wind-Biegung (Blätter). */
  readonly wind?: string;
};

/** Rand, den ein Raster braucht, damit überall 1 px Luft zum Zellrand bleibt [px je Seite]. */
interface Rand {
  readonly oben: number;
  readonly unten: number;
  readonly links: number;
  readonly rechts: number;
}

/**
 * Luft für die Interaktions-Outline (docs/ART.md §8 „Sprites lassen dafür 1 px Luft zum Zellrand“): Berührt
 * ein Frame den Zellrand, wächst die Zelle auf dieser Seite um 1 px. So darf ein Möbel seine Stellfläche
 * ganz füllen (ein Vorhang über die volle Tile-Breite), und Anker, Sockel, Hitbox und Occluder rücken mit.
 */
function randFuer(frames: readonly string[]): Rand {
  let oben = 0;
  let unten = 0;
  let links = 0;
  let rechts = 0;
  for (const f of frames) {
    const z = zeilen(f);
    if ((z[0] ?? '').replace(/\./g, '') !== '') oben = 1;
    if ((z[z.length - 1] ?? '').replace(/\./g, '') !== '') unten = 1;
    if (z.some((r) => r[0] !== '.')) links = 1;
    if (z.some((r) => r[r.length - 1] !== '.')) rechts = 1;
  }
  return { oben, unten, links, rechts };
}

function polstere(frame: string, r: Rand): string {
  const z = zeilen(frame).map((l) => `${'.'.repeat(r.links)}${l}${'.'.repeat(r.rechts)}`);
  const leer = '.'.repeat(z[0]?.length ?? 0);
  return [...Array.from({ length: r.oben }, () => leer), ...z, ...Array.from({ length: r.unten }, () => leer)].join('\n');
}

/** Objekt-Sprite `obj_<item>` der Serie. */
export function moebel(q: MoebelQuelle): Sprite {
  const { item, metall, glas, nass, wind, ...rest } = q;
  const material: NonNullable<SpriteSource['material']> = {};
  if (metall === true) material.metall = METALL;
  const glaenzend = `${glas === true ? GLAS : ''}${nass ?? ''}`;
  if (glaenzend.length > 0) material.nass = glaenzend;
  if (wind !== undefined) material.wind = wind;
  const r = randFuer(rest.frames);
  const dx = r.links;
  const dy = r.oben;
  const verschoben = (p: readonly [number, number]): [number, number] => [p[0] + dx, p[1] + dy];
  const occ = rest.occluder;
  return sprite({
    ...rest,
    id: `${OBJ_PRAEFIX}${item}`,
    group: MOEBEL_GRUPPE,
    legende: MOEBEL_LEGENDE,
    size: [rest.size[0] + r.links + r.rechts, rest.size[1] + r.oben + r.unten],
    anchor: verschoben(rest.anchor),
    frames: rest.frames.map((f) => polstere(f, r)),
    ...(rest.sockets === undefined ? {} : { sockets: Object.fromEntries(Object.entries(rest.sockets).map(([k, pts]) => [k, pts.map(verschoben)])) }),
    ...(rest.hitbox === undefined ? {} : { hitbox: [rest.hitbox[0] + dx, rest.hitbox[1] + dy, rest.hitbox[2], rest.hitbox[3]] }),
    ...(occ === undefined ? {} : { occluder: occ.kind === 'rect' || occ.kind === 'ellipse' ? { ...occ, x: occ.x + dx, y: occ.y + dy } : occ }),
    ...(Object.keys(material).length > 0 ? { material } : {}),
  });
}

/** Zeilen eines Rasters ohne Einrückung. */
function zeilen(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Legt `oben` über `unten` (gleich große Raster); `.` in `oben` lässt `unten` stehen. */
export function ueberlagere(unten: string, oben: string): string {
  const u = zeilen(unten);
  const o = zeilen(oben);
  if (u.length !== o.length) throw new Error(`Überlagerung: ${o.length} Zeilen über ${u.length} Zeilen`);
  return u
    .map((zeile, y) => {
      const oz = o[y] ?? '';
      if (oz.length !== zeile.length) throw new Error(`Überlagerung Zeile ${y}: ${oz.length} statt ${zeile.length} Zeichen`);
      return [...zeile].map((c, x) => (oz[x] === '.' ? c : (oz[x] ?? c))).join('');
    })
    .join('\n');
}
