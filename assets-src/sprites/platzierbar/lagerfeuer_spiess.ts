/**
 * Der Bratspieß über dem Lagerfeuer (M7-102; MASTERPROMPT §18 „Zubereitung … Spieß am Feuer“, docs/SPIEL.md §21; die
 * Darstellung in src/render/game/lights.ts): solange am Lagerfeuer ein Gericht vom Spieß gart, steht über dem Feuer ein
 * Spieß auf zwei Astgabeln, und an ihm steckt, was brät – je Gericht ein Sprite `spiess_<gericht>` (die Darstellung sucht
 * es zum Erzeugnis des laufenden Rezepts, wie das Icon `icon_<item>`; ein Rezept ohne Spießbild zeigt keinen Spieß).
 *
 * Aufbau: 40 × 32 px, Anker wie das Lagerfeuer am Fußpunkt (die Darstellung setzt beide auf denselben Punkt), vier px
 * breiter als das Feuer je Seite – die Gabeln stehen links und rechts neben dem Steinring, der Spieß liegt in ihren Kerben
 * auf der Höhe des Sockels `kochen` des Lagerfeuers (assets-src/sprites/platzierbar/lagerfeuer.ts) quer über der Flamme,
 * rechts mit einer Kurbel. Das Gargut sitzt mittig über der Flamme, kleiner als sie: oben züngeln die Spitzen darüber, unten
 * brennt der Kern. Zwei Bilder mit 3 fps: der Spieß dreht sich, die hellen Stellen wandern (Fett glänzt, Röstflecken).
 * Holz in `holz`, Kontur `nacht.1` (ART §2.4); Fleisch in `erde`, Fisch und Mais goldbraun in `sand`, Pilzhüte in `erde`
 * und `laub` (Pfifferling), Stiele hell. Je Sprite höchstens zwölf Farben.
 */
import { sprite, type Sprite } from '../../lib/sprite';
import lagerfeuer from './lagerfeuer';

/** Zellgröße und Anker (Fußpunkt, wie beim Lagerfeuer). */
const B = 40;
const H = 32;
const ANKER: [number, number] = [B / 2, lagerfeuer.anchor[1]];
const KOCHEN = lagerfeuer.sockets['kochen']?.[0];
if (KOCHEN === undefined) throw new Error('lagerfeuer_spiess: das Lagerfeuer hat keinen Sockel kochen');
/** Zeile des Spießes: die Höhe des Sockels `kochen` über dem Fußpunkt des Feuers. */
const SPIESS_Y = ANKER[1] - (lagerfeuer.anchor[1] - KOCHEN[1]);
/** Mitte des Garguts: über dem Sockel `kochen`. */
const MITTE_X = ANKER[0] + (KOCHEN[0] - lagerfeuer.anchor[0]);
/** Spalten der Astgabeln (Mitte des Stiels) und wo sie im Boden stecken (auf der Tiefe der Feuermitte). */
const GABEL_X = [3, B - 4] as const;
const GABEL_FUSS_Y = 24;
/** Wo der Spieß endet: links knapp vor der Gabel, rechts die Kurbel. */
const SPIESS_VON = 1;
const SPIESS_BIS = B - 2;

/**
 * Die Astgabel (4 Spalten um den Stiel, ab zwei Zeilen über dem Spieß): zwei Zinken, in deren Kerbe der Spieß liegt (Zeile
 * 2 ist die des Spießes), darunter der Stiel, links hell, rechts dunkel – dünnes Holz ohne eigene Kontur wie der Spieß.
 */
const GABEL = [
  'c..b', //
  'c..b',
  '....', // der Spieß
];
const STIEL = '.cb.';
const FUSS = '.kk.';

/** Legende des Spießes; die Gerichte bringen ihre Farben dazu. */
const HOLZ: Record<string, string | null> = { '.': null, k: 'nacht.1', b: 'holz.1', c: 'holz.2', d: 'holz.3' };

/** Leeres Raster. */
function leer(): string[][] {
  return Array.from({ length: H }, () => Array.from({ length: B }, () => '.'));
}

/** Setzt `muster` (Zeilen, `.` lässt stehen) mit der linken oberen Ecke bei (x, y) ins Raster. */
function stempel(r: string[][], muster: readonly string[], x: number, y: number): void {
  muster.forEach((zeile, dy) => {
    [...zeile].forEach((c, dx) => {
      if (c === '.') return;
      const z = r[y + dy];
      if (z === undefined || x + dx < 0 || x + dx >= B) throw new Error(`lagerfeuer_spiess: Pixel (${x + dx}, ${y + dy}) außerhalb`);
      z[x + dx] = c;
    });
  });
}

/** Gabeln, Spieß und Kurbel. */
function spiess(): string[][] {
  const r = leer();
  for (const gx of GABEL_X) {
    const oben = SPIESS_Y - 2;
    stempel(r, GABEL, gx - 2, oben);
    for (let y = oben + GABEL.length; y < GABEL_FUSS_Y; y++) stempel(r, [STIEL], gx - 2, y);
    stempel(r, [FUSS], gx - 2, GABEL_FUSS_Y);
  }
  const zeile = r[SPIESS_Y] as string[];
  for (let x = SPIESS_VON; x <= SPIESS_BIS; x++) zeile[x] = 'b';
  // Die Kurbel: am rechten Ende zwei Pixel hinab und ein Griff.
  stempel(r, ['.b', '.b', 'bb'], SPIESS_BIS, SPIESS_Y);
  return r;
}

/**
 * Ein Spießbild: das Gargut `bild` (ungerade Zeilenzahl, die mittlere Zeile liegt auf dem Spieß; `.` lässt den Spieß
 * sehen) mittig über dem Sockel `kochen`.
 */
function mitGargut(bild: readonly string[]): string {
  const r = spiess();
  const breite = (bild[0] ?? '').length;
  if (bild.length % 2 !== 1 || bild.some((z) => z.length !== breite)) throw new Error('lagerfeuer_spiess: Gargut braucht ungerade Zeilenzahl und gleich lange Zeilen');
  stempel(r, bild, MITTE_X - Math.floor(breite / 2), SPIESS_Y - (bild.length - 1) / 2);
  return r.map((z) => z.join('')).join('\n');
}

/** Ein Gericht am Spieß: zwei Bilder (der Spieß dreht sich), seine Farben zur Legende des Holzes. */
function amSpiess(gericht: string, bilder: readonly [readonly string[], readonly string[]], farben: Record<string, string>, einzelpixel?: string): Sprite {
  return sprite({
    id: `spiess_${gericht}`,
    group: 'platzierbar',
    size: [B, H],
    anchor: ANKER,
    hoehe: 'block',
    legende: { ...HOLZ, ...farben },
    frames: bilder.map(mitGargut),
    clips: { dreht: { frames: [0, 1], fps: 3, loop: true } },
    occluder: { kind: 'none' },
    schatten: 'none',
    ...(einzelpixel === undefined ? {} : { einzelpixel }),
  });
}

/** Gebratenes Fleisch: ein Bratenstück, die Kruste rotbraun, glasiert, Fett glänzt oben. */
const FLEISCH: [string[], string[]] = [
  [
    '..kkkkkkk..', //
    '.kmMMEMmmk.',
    'kmMMMmmmmqk',
    '.mmmmmmqqq.',
    'kqmmmmqqqpk',
    '.kqqmqqqpk.',
    '..kkkkkkk..',
  ],
  [
    '..kkkkkkk..', //
    '.kmmMMEMmk.',
    'kmmMMMmmmqk',
    '.mmmmmmqqq.',
    'kqmmmmqqqpk',
    '.kpqqmqqqk.',
    '..kkkkkkk..',
  ],
];

/** Gebratener Fisch: ganz, der Kopf rechts mit Auge, die Schwanzflosse links, goldbraune Haut mit Grillstreifen. */
const FISCH: [string[], string[]] = [
  [
    '....kkkkkkk....', //
    'kk.kAAqAAqAkk..',
    'kAkAMMqMMqMMAk.',
    '.AAMMqMMqMMMkM.',
    'kAkDDqDDqDDDDk.',
    'kk.kDDDDDDDkk..',
    '....kkkkkkk....',
  ],
  [
    '....kkkkkkk....', //
    'kk.kAqAAqAAkk..',
    'kAkAMqMMqMMMAk.',
    '.AAMqMMqMMMMkM.',
    'kAkDqDDqDDDDDk.',
    'kk.kDDDDDDDkk..',
    '....kkkkkkk....',
  ],
];

/**
 * Pilzspieß: zwei Steinpilze und ein Pfifferling, durch den Hut aufgespießt, die Stiele hängen in die Hitze (9 Zeilen, der
 * Spieß in der mittleren). Der Pfifferling rechts außen: sein Orange stünde vor der Flamme nicht ab, vor dem Boden schon.
 */
const PILZE: [string[], string[]] = [
  [
    '...................', //
    '...................',
    '.kkkk..kkkk...kkkk.',
    'krttsk.krtsk.kMooMk',
    'krsssr.krssr.kMMMMk',
    '.kDDDk.kDDDk.kmMMmk',
    '..kEEk..kEEk..kMMk.',
    '..kDDk..kDDk..kmmk.',
    '...kk....kk....kk..',
  ],
  [
    '...................', //
    '...................',
    '.kkkk..kkkk...kkkk.',
    'krsttk.krstk.kooMMk',
    'krrssr.krrsr.kMMMMk',
    '.kDDDk.kDDDk.kmMMmk',
    '..kEEk..kEEk..kMMk.',
    '..kDDk..kDDk..kmmk.',
    '...kk....kk....kk..',
  ],
];

/** Gerösteter Mais: der Kolben längs am Spieß, goldgelbe Körner mit Röstflecken, links die Hüllblätter. */
const MAIS: [string[], string[]] = [
  [
    'kk.............', //
    'kihk.kkkkkkkkk.',
    '.khikoEoEoEoEMk',
    '..hikoMqoMoqMo.',
    '.khikMmMqMmMMmk',
    'kihk.kkkkkkkkk.',
    'kk.............',
  ],
  [
    'kk.............', //
    'kihk.kkkkkkkkk.',
    '.khikEoEoEoEoMk',
    '..hikMoMqoMoqM.',
    '.khikmMqMmMMmMk',
    'kihk.kkkkkkkkk.',
    'kk.............',
  ],
];

export default [
  amSpiess('gebratenes_fleisch', FLEISCH, { p: 'erde.0', q: 'erde.1', m: 'laub.2', M: 'laub.3', E: 'sand.4' }, 'der Fettglanz auf der Kruste ist ein Einzelpixel'),
  amSpiess('gebratener_fisch', FISCH, { A: 'sand.1', M: 'laub.3', D: 'sand.3', q: 'erde.1' }, 'das Auge des Fischs ist ein Einzelpixel'),
  amSpiess('pilzspiess', PILZE, { r: 'erde.2', s: 'erde.3', t: 'erde.4', D: 'sand.3', E: 'sand.4', m: 'laub.2', M: 'laub.3', o: 'laub.4' }),
  amSpiess('geroesteter_mais', MAIS, { h: 'gras.2', i: 'gras.3', q: 'erde.1', o: 'laub.4', M: 'laub.3', m: 'laub.2', E: 'sand.4' }, 'Röstflecken auf dem Kolben sind einzelne Pixel'),
];
