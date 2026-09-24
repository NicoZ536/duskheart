/**
 * Gemeinsamer Baustein der Item-Icons (docs/SPIEL.md §2 „Icon-Konvention“, docs/ART.md §3): jedes Item hat
 * ein Sprite `icon_<itemId>` (16×16, Motiv ≤ 14×14 mit 1 px Luft zum Rand); der Welt-Drop zeigt dasselbe
 * Icon über dem Drop-Schatten (`drop_schatten`). Kontur `nacht.1` rundum (Items, ART §2.4), Material in
 * seiner eigenen Rampe, Oberseiten hell und Unterseiten dunkel (AO statt Richtungslicht). Die Rarität
 * trägt der UI-Rahmen, nie das Icon (ART §6).
 *
 * Eine Legende für alle Icons, damit dieselbe Farbe überall dasselbe Zeichen hat:
 * - `nacht`: `K` 0 · `k` 1 (Kontur) · `n` 2 · `N` 3 · `~` 4
 * - `stein`: Ziffern `1`–`6` (Stufe 0–5)
 * - `holz`: `a`–`e` · `erde`: `p`–`t` · `gras`: `G` `g` `h` `i` `j` `J`
 * - `laub`: `L` `l` `m` `M` `o` · `wasser`: `w` `x` `y` `z` `Z` `Y` · `sand`: `A`–`E`
 * - `feuer`: `f` `F` `u` `U` `v` `V` · `haut`: `H` `I` `O` `R` `S`
 * - `eis`: `7` `8` `9` `0` `#` · `verderb`: `(` `)` `[` `]` `%`
 */
import { sprite, type HeightHint, type MaterialFlag, type Sprite } from '../../lib/sprite';

/** Kontaktbogen `icons.png`. */
export const ICON_GRUPPE = 'icons';
/** Zellgröße (docs/ART.md §3). */
export const ICON_GROESSE = 16;
/** Fußpunkt des Welt-Drops: unten Mitte über der Luftzeile. */
export const ICON_ANKER: [number, number] = [8, 14];

export const ICON_LEGENDE: Readonly<Record<string, string | null>> = {
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
};

export interface IconOptionen {
  /** Zusätzliche oder ersetzte Legendenzeichen (z. B. emissive Farben). */
  readonly legende?: Readonly<Record<string, string | null>>;
  /** Höhen-Hinweis des liegenden Drops (Standard `block`: Plateau mit Fase). */
  readonly hoehe?: HeightHint;
  /** Begründung für gewollte Einzelpixel (Glanzpunkte, Funken). */
  readonly einzelpixel?: string;
  /** Materialflags je Legendenzeichen. */
  readonly material?: Partial<Record<MaterialFlag, string>>;
}

/** Item-Icon `icon_<itemId>` aus einem 16×16-Raster. */
export function icon(itemId: string, raster: string, o: IconOptionen = {}): Sprite {
  return sprite({
    id: `icon_${itemId}`,
    group: ICON_GRUPPE,
    size: [ICON_GROESSE, ICON_GROESSE],
    anchor: ICON_ANKER,
    hoehe: o.hoehe ?? 'block',
    legende: { ...ICON_LEGENDE, ...o.legende },
    frames: [raster],
    // Der Drop steht nicht aufrecht: Bodenkontakt gibt `drop_schatten`, nicht der Sonnenschatten.
    schatten: 'none',
    occluder: { kind: 'none' },
    ...(o.einzelpixel === undefined ? {} : { einzelpixel: o.einzelpixel }),
    ...(o.material === undefined ? {} : { material: o.material }),
  });
}
