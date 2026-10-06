/**
 * Welt-Sprites des Feldes (M7-19 … M7-23, Strang D; Kontaktbogen `feld`):
 * - `obj_beet_holz`, `obj_beet_stein`: Hochbeete (Möbel der Kategorie `beet`, 1 × 1) – ein Rahmen aus Brettern bzw.
 *   Feldsteinen um gelockerte Erde mit Saatrillen; die Pflanze steht vor dem Rahmen in der Erde.
 * - `obj_vogelscheuche`: Pfahl mit Querholz, Hemd, Strohkopf und Hut; Strohbüschel an den Armen.
 * - `obj_kompostkiste`: Lattenkiste mit Clips `leer`, `belegt` (frischer Gartenabfall), `arbeitet` (die Masse setzt sich,
 *   zwei Frames) und `fertig` (dunkler, krümeliger Kompost bis zum Rand).
 * - `feld_nass`: feuchter Acker – dunkle Rillen über der Ackererde (flach, Bodenebene; der Renderer legt sie bei feuchtem
 *   Boden über die Kachel).
 * - `feld_kraehe`: eine Krähe am Beet (Clip `picken`, zwei Frames); `feld_mehltau`: weißer Belag über der Pflanze.
 * Anker = Mitte der Vorderkante mit 1 px Luft darunter (wie die Stationen). Gezeichnet mit `_raster.ts`.
 */
import { sprite, type Sprite } from '../../lib/sprite';
import { ICON_LEGENDE } from '../icons/_icon';
import { Raster, stufe } from './_raster';

const GRUPPE = 'feld';
const sh = (rampe: string, hell = 0.3, dunkel = 0.75) => (_x: number, _y: number, t: number) => stufe(rampe, t, hell, dunkel);

/** Ein Hochbeet: Rahmen in `rand` (hell, mittel, dunkel), Erde mit drei Rillen. */
function hochbeet(id: string, rand: string, fugen: (r: Raster) => void): Sprite {
  const r = new Raster(16, 16);
  // Rahmen oben (Draufsicht) und Vorderseite.
  r.poly(
    [
      [1, 5],
      [15, 5],
      [15, 12],
      [1, 12],
    ],
    rand[0] as string,
  );
  r.poly(
    [
      [1, 12],
      [15, 12],
      [15, 14],
      [1, 14],
    ],
    rand[1] as string,
  );
  r.line(1, 14, 14, 14, rand[2] as string);
  // Gelockerte, dunkle Erde mit Saatrillen (der Rahmen bleibt ein schmaler Rand).
  r.poly(
    [
      [2, 6],
      [14, 6],
      [14, 12],
      [2, 12],
    ],
    'r',
  );
  for (const y of [7, 9]) r.line(3, y, 12, y, 'q');
  r.line(2, 11, 13, 11, 'p');
  fugen(r);
  r.outline('k');
  return sprite({ id, group: GRUPPE, size: [16, 16], anchor: [8, 14], hoehe: 'block', legende: ICON_LEGENDE, frames: [r.toString()], occluder: { kind: 'rect', x: 1, y: 5, w: 14, h: 10 } });
}

const BEET_HOLZ = hochbeet('obj_beet_holz', 'dcb', (r) => {
  for (const x of [5, 10]) r.line(x, 12, x, 13, 'b');
});

const BEET_STEIN = hochbeet('obj_beet_stein', '543', (r) => {
  for (const x of [4, 8, 12]) r.line(x, 12, x, 13, '3');
});

/** Die Vogelscheuche. */
const VOGELSCHEUCHE = ((): Sprite => {
  const r = new Raster(16, 32);
  r.line(8, 30, 8, 9, 'c').line(9, 30, 9, 9, 'b');
  r.line(1, 14, 15, 14, 'c').line(1, 15, 15, 15, 'b');
  // Hemd.
  r.poly(
    [
      [4, 13],
      [13, 13],
      [14, 22],
      [3, 22],
    ],
    sh('xyz', 0.3, 0.85),
  );
  r.line(5, 18, 12, 18, 'x');
  // Strohbüschel an Ärmeln und Saum.
  for (const [x, y] of [
    [1, 16],
    [14, 16],
    [4, 23],
    [12, 23],
  ] as const)
    r.set(x, y, 'D').set(x + 1, y, 'E');
  // Kopf (Sack) und Hut.
  r.ellipse(8.5, 9.5, 2.6, 2.4, sh('CDE', 0.3, 0.8));
  r.set(7, 9, 'a').set(10, 9, 'a');
  r.poly(
    [
      [4.5, 7],
      [13.5, 7],
      [13.5, 8],
      [4.5, 8],
    ],
    'b',
  );
  r.poly(
    [
      [6, 3],
      [11, 3],
      [12, 7],
      [5, 7],
    ],
    sh('bc', 0.4, 0.9),
  );
  r.outline('k');
  return sprite({
    id: 'obj_vogelscheuche',
    group: GRUPPE,
    size: [16, 32],
    anchor: [8, 30],
    hoehe: 'zylinder',
    legende: ICON_LEGENDE,
    frames: [r.toString()],
    occluder: { kind: 'rect', x: 7, y: 9, w: 3, h: 22 },
    einzelpixel: 'Augen des Strohkopfs: je ein dunkles Pixel',
  });
})();

/** Die Kompostkiste in ihren Zuständen. */
const KOMPOSTKISTE = ((): Sprite => {
  const frames: string[] = [];
  const inhalt: Array<(r: Raster) => void> = [
    // leer: der Boden der Kiste.
    (r) => r.line(3, 7, 12, 7, 'a'),
    // belegt: grüner Abfall, Laub.
    (r) => {
      r.ellipse(7.5, 6.5, 5, 2, sh('hi'));
      r.set(5, 6, 'M').set(6, 6, 'M').set(10, 7, 'M').set(11, 7, 'M');
    },
    // arbeitet: die Masse setzt sich (zwei Frames).
    (r) => {
      r.ellipse(7.5, 6.8, 5, 1.8, sh('qr'));
      r.set(5, 7, 'h').set(6, 7, 'h');
    },
    (r) => {
      r.ellipse(7.5, 7, 5, 1.6, sh('qr'));
      r.set(9, 7, 'h').set(10, 7, 'h');
    },
    // fertig: dunkler Kompost bis zum Rand.
    (r) => r.ellipse(7.5, 6, 5.5, 2.4, sh('pqr')),
  ];
  for (const male of inhalt) {
    const r = new Raster(16, 20);
    // Öffnung (dunkles Inneres) und Lattenwände.
    r.poly(
      [
        [2, 4],
        [14, 4],
        [14, 9],
        [2, 9],
      ],
      'a',
    );
    male(r);
    r.poly(
      [
        [1, 9],
        [15, 9],
        [15, 18],
        [1, 18],
      ],
      sh('bcd', 0.25, 0.85),
    );
    for (const y of [12, 15]) r.line(1, y, 14, y, 'b');
    r.line(1, 4, 1, 9, 'c').line(14, 4, 14, 9, 'c');
    r.outline('k');
    frames.push(r.toString());
  }
  return sprite({
    id: 'obj_kompostkiste',
    group: GRUPPE,
    size: [16, 20],
    anchor: [8, 18],
    hoehe: 'block',
    legende: ICON_LEGENDE,
    frames,
    clips: {
      leer: { frames: [0], fps: 1 },
      belegt: { frames: [1], fps: 1 },
      arbeitet: { frames: [2, 3], fps: 1.5 },
      fertig: { frames: [4], fps: 1 },
    },
    occluder: { kind: 'rect', x: 1, y: 4, w: 14, h: 15 },
  });
})();

/** Feuchter Acker: dunkle Rillen (flach, Bodenebene). */
const NASS = ((): Sprite => {
  const r = new Raster(16, 16);
  for (const y of [3, 7, 11]) {
    r.line(2, y, 13, y, 'q');
    r.line(3, y + 1, 12, y + 1, 'p');
  }
  return sprite({ id: 'feld_nass', group: GRUPPE, size: [16, 16], anchor: [0, 0], hoehe: 'flach', legende: ICON_LEGENDE, frames: [r.toString()], schatten: 'none', occluder: { kind: 'none' } });
})();

/** Eine Krähe, die am Beet pickt (zwei Frames). */
const KRAEHE = ((): Sprite => {
  const frames: string[] = [];
  for (const kopf of [0, 1]) {
    const r = new Raster(10, 8);
    r.ellipse(4.5, 4.5, 2.8, 1.8, sh('KnN', 0.3, 0.8));
    r.line(1, 4, 0, 5, 'n');
    r.ellipse(7, 3 + kopf, 1.4, 1.2, 'n');
    r.set(9, 3 + kopf * 2, 'B');
    r.line(4, 6, 4, 7, 'B').line(6, 6, 6, 7, 'B');
    frames.push(r.toString());
  }
  return sprite({
    id: 'feld_kraehe',
    group: GRUPPE,
    size: [10, 8],
    anchor: [5, 7],
    hoehe: 'kugel',
    legende: ICON_LEGENDE,
    frames,
    clips: { picken: { frames: [0, 1], fps: 3 } },
    occluder: { kind: 'none' },
    einzelpixel: 'Schnabel der Krähe: ein Pixel am Kopf',
  });
})();

/** Mehltau: weißer, pudriger Belag (über der Pflanze gezeichnet). */
const MEHLTAU = ((): Sprite => {
  const r = new Raster(12, 8);
  for (const [x, y] of [
    [1, 5],
    [4, 2],
    [7, 4],
    [9, 1],
    [10, 6],
    [3, 6],
  ] as const)
    r.set(x, y, '#').set(x + 1, y, '0').set(x, y + 1, '0');
  return sprite({ id: 'feld_mehltau', group: GRUPPE, size: [12, 8], anchor: [6, 7], hoehe: 'kugel', legende: ICON_LEGENDE, frames: [r.toString()], schatten: 'none', occluder: { kind: 'none' } });
})();

export default [BEET_HOLZ, BEET_STEIN, VOGELSCHEUCHE, KOMPOSTKISTE, NASS, KRAEHE, MEHLTAU];
