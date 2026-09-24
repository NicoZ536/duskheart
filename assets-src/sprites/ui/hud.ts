/**
 * Symbole des HUD (M3-27, MASTERPROMPT §26 „oben links Leben, Ausdauer, Sättigung, Durst, Thermometer mit
 * Trend, Furcht-Auge (ab 20)“, „automatische Tastensymbole (Xbox, PlayStation, generisch)“), Kontaktbogen
 * `hud`. Sie liegen im Spielatlas und werden im DOM-Overlay mit den Grundfarben der Palette aufgelöst
 * (`src/ui/screens/inventar/itemIcons.ts`); nie in der Welt: flach, ohne Schatten, ohne Verdecker.
 *
 * - Werte-Symbole 9×8, genau so hoch wie eine Leiste des UI-Kits (8 px), in der Farbe ihrer Füllung:
 *   Herz (Leben, Glutrot), Blitz (Ausdauer, Grün), Keule (Sättigung, Braten), Tropfen (Durst, Wasser).
 * - Thermometer 10×38 (so hoch wie die vier Leisten mit ihren Abständen): Glasrohr und Kugel mit Kontur
 *   und hellem Glasrand, innen durchsichtig – Rinne und Füllung legt das HUD darunter (`src/ui/hud/thermometer.ts`: 2 px je °C,
 *   28 °C am Rohrboden). Links die Marken der Stufengrenzen aus §11.2: kalt in Eisblau (33, 35, 36 °C),
 *   37 °C in Sand, warm in Glut (38, 39, 40,5 °C).
 * - Trendpfeil 7×8: steigt, steigt schnell, fällt, fällt schnell (warm Glut, kalt Eis).
 * - Furcht-Auge 15×9 je Stufe (§12.3): unruhig (Lid halb gesenkt), Flüstern (offen), Trugbilder (weit,
 *   Adern), bedrohlich (blutunterlaufen, rote Iris), Nachtmahr (schwarzes Auge, glühende Iris).
 * - Tastensymbole 11×11 für Gamepads: runder dunkler Knopf mit Licht oben; Xbox A/B/X/Y in ihren Farben,
 *   PlayStation Kreuz/Kreis/Quadrat/Dreieck, generisch vier Punkte als Raute mit dem gemeinten hell.
 *   Tasten der Tastatur zeichnet das HUD als Kappe mit Text (beliebige Belegung).
 * - Kleine Ziffern 5×7 für die Tasten 1–0 in der Ecke der Schnellleisten-Plätze: 3×5-Glyphe mit dunkler
 *   Kontur, damit sie das Icon kaum verdeckt (die 10-px-Schrift läge über einem Drittel des Icons);
 *   Frames 0–9 gedämpft (Sand), 10–19 hell für den gewählten Platz.
 *
 * Legende: gemeinsame Icon-Legende (`../icons/_icon.ts`), damit dieselbe Farbe überall dasselbe Zeichen hat.
 */
import { sprite, type Sprite } from '../../lib/sprite';
import { ICON_LEGENDE } from '../icons/_icon';

/** Kontaktbogen `hud.png`. */
export const HUD_GRUPPE = 'hud';

interface HudSymbol {
  readonly id: string;
  readonly size: [number, number];
  readonly frames: readonly string[];
  readonly einzelpixel?: string;
}

function hudSymbol(s: HudSymbol): Sprite {
  return sprite({
    id: s.id,
    group: HUD_GRUPPE,
    size: s.size,
    anchor: [0, 0],
    hoehe: 'flach',
    legende: ICON_LEGENDE,
    frames: [...s.frames],
    schatten: 'none',
    occluder: { kind: 'none' },
    ...(s.einzelpixel === undefined ? {} : { einzelpixel: s.einzelpixel }),
  });
}

/** Spiegelt ein Raster senkrecht (fallende Pfeile aus den steigenden). */
function senkrechtGespiegelt(raster: string, farbe: Readonly<Record<string, string>>): string {
  return raster
    .trim()
    .split('\n')
    .map((z) => z.trim())
    .reverse()
    .map((z) => [...z].map((c) => farbe[c] ?? c).join(''))
    .join('\n');
}

const PFEIL = `...k...
               ..kUk..
               .kUUUk.
               kUUUUUk
               kkkUkkk
               ..kUk..
               ..kUk..
               ..kkk..`;
/** Schnell: zwei Winkel übereinander. */
const PFEIL_SCHNELL = `...k...
                       ..kUk..
                       .kUkUk.
                       kUkkkUk
                       kkkUkkk
                       .kUkUk.
                       kUk.kUk
                       kk...kk`;
/** Glut der steigenden Pfeile → Eis der fallenden. */
const KALT = { U: '9' };

/** Runder Knopf 11×11 (Kontur, Licht oben, Schatten unten); `.` im Motiv lässt den Knopf durch. */
const KNOPF = `...kkkkk...
               .kkNNNNNkk.
               .kNnnnnnnk.
               kNnnnnnnnnk
               kNnnnnnnnnk
               kNnnnnnnnnk
               knnnnnnnnnk
               knnnnnnnnnk
               .knnnnnnnk.
               .kkKKKKKkk.
               ...kkkkk...`;

/** Legt ein 5×5-Motiv (`#` = Farbe `farbe`) in die Mitte des Knopfs (Spalten 3–7, Zeilen 3–7). */
function knopfMit(motiv: string, farbe: string): string {
  const knopf = KNOPF.split('\n').map((z) => [...z.trim()]);
  motiv
    .trim()
    .split('\n')
    .map((z) => z.trim())
    .forEach((zeile, y) => {
      [...zeile].forEach((c, x) => {
        const reihe = knopf[y + 3];
        if (c === '#' && reihe !== undefined) reihe[x + 3] = farbe;
      });
    });
  return knopf.map((z) => z.join('')).join('\n');
}

/** Generischer Knopf: vier Punkte als Raute (Zeile/Spalte 2–3 bzw. 7–8 um die Mitte 5), `hell` ist der gemeinte. */
function knopfGenerisch(hell: 'unten' | 'rechts' | 'links' | 'oben'): string {
  const knopf = KNOPF.split('\n').map((z) => [...z.trim()]);
  const punkte = {
    oben: [
      [5, 2],
      [5, 3],
    ],
    unten: [
      [5, 7],
      [5, 8],
    ],
    links: [
      [2, 5],
      [3, 5],
    ],
    rechts: [
      [7, 5],
      [8, 5],
    ],
  } as const;
  for (const [name, feld] of Object.entries(punkte)) {
    for (const [x, y] of feld) {
      const reihe = knopf[y];
      if (reihe !== undefined) reihe[x] = name === hell ? 'E' : '~';
    }
  }
  return knopf.map((z) => z.join('')).join('\n');
}

/** Ziffern 0–9 als 3×5-Glyphen (`#` = Strich). */
const ZIFFERN: readonly string[] = [
  '###\n#.#\n#.#\n#.#\n###',
  '.#.\n##.\n.#.\n.#.\n###',
  '##.\n..#\n.#.\n#..\n###',
  '##.\n..#\n.#.\n..#\n##.',
  '#.#\n#.#\n###\n..#\n..#',
  '###\n#..\n##.\n..#\n##.',
  '.##\n#..\n###\n#.#\n###',
  '###\n..#\n.#.\n.#.\n.#.',
  '###\n#.#\n###\n#.#\n###',
  '###\n#.#\n###\n..#\n##.',
];

/** Glyphe `motiv` (3×5) in `farbe` mit 1 px Kontur `K` ringsum (auch diagonal) im 5×7-Feld. */
function zifferMit(motiv: string, farbe: string): string {
  const b = 5;
  const h = 7;
  const feld: string[][] = Array.from({ length: h }, () => Array.from({ length: b }, () => '.'));
  const striche = motiv.split('\n').map((z) => [...z]);
  striche.forEach((zeile, y) =>
    zeile.forEach((c, x) => {
      if (c !== '#') return;
      for (let dy = 0; dy <= 2; dy++) {
        for (let dx = 0; dx <= 2; dx++) {
          const reihe = feld[y + dy];
          if (reihe !== undefined && reihe[x + dx] === '.') reihe[x + dx] = 'K';
        }
      }
    }),
  );
  striche.forEach((zeile, y) =>
    zeile.forEach((c, x) => {
      const reihe = feld[y + 1];
      if (c === '#' && reihe !== undefined) reihe[x + 1] = farbe;
    }),
  );
  return feld.map((z) => z.join('')).join('\n');
}

export default [
  hudSymbol({
    id: 'ui_hud_leben',
    size: [9, 8],
    frames: [
      `.kkk.kkk.
       kUUukuuuk
       kUuuuuuuk
       kuuuuuuFk
       .kuuuuFk.
       ..kuuFk..
       ...kFk...
       ....k....`,
    ],
  }),
  hudSymbol({
    id: 'ui_hud_ausdauer',
    size: [9, 8],
    frames: [
      `....kkkk.
       ...kJjjk.
       ..kJjjk..
       .kJjjjjk.
       .kkkjjjk.
       ...kjik..
       ..kjik...
       ..kkk....`,
    ],
  }),
  hudSymbol({
    id: 'ui_hud_saettigung',
    size: [9, 8],
    frames: [
      `.kkkk....
       kMMmmk...
       kMmmmmk..
       kmmmmlk..
       .kmmllk..
       ..kllk6k.
       ...kk666k
       ......kk.`,
    ],
  }),
  hudSymbol({
    id: 'ui_hud_durst',
    size: [9, 8],
    frames: [
      `....k....
       ...kZk...
       ..kZZzk..
       .kZYzzzk.
       .kZYzzyk.
       .kzzzzyk.
       ..kzyyk..
       ...kkk...`,
    ],
  }),
  hudSymbol({
    id: 'ui_hud_thermometer',
    size: [10, 38],
    frames: [
      `...kkkkk..
       ..kN...Nk.
       ..kN...Nk.
       ..kN...Nk.
       ..kN...Nk.
       ..kN...Nk.
       uukN...Nk.
       ..kN...Nk.
       ..kN...Nk.
       uukN...Nk.
       ..kN...Nk.
       uukN...Nk.
       ..kN...Nk.
       DDkN...Nk.
       ..kN...Nk.
       88kN...Nk.
       ..kN...Nk.
       88kN...Nk.
       ..kN...Nk.
       ..kN...Nk.
       ..kN...Nk.
       88kN...Nk.
       ..kN...Nk.
       ..kN...Nk.
       ..kN...Nk.
       ..kN...Nk.
       ..kN...Nk.
       ..kN...Nk.
       ..kN...Nk.
       ..kN...Nk.
       ..kN...Nk.
       ..kN...Nk.
       .kN.....Nk
       .kN.#...Nk
       .kN.#...Nk
       .kN.....Nk
       ..kN...Nk.
       ...kkkkk..`,
    ],
  }),
  hudSymbol({
    id: 'ui_hud_trend',
    size: [7, 8],
    frames: [PFEIL, PFEIL_SCHNELL, senkrechtGespiegelt(PFEIL, KALT), senkrechtGespiegelt(PFEIL_SCHNELL, KALT)],
  }),
  hudSymbol({
    id: 'ui_hud_furcht',
    size: [15, 9],
    frames: [
      // 0 unruhig: das Lid hängt halb über der Iris.
      `...............
       ...............
       ..kkkkkkkkkkk..
       .knnnnnnnnnnnk.
       k0###[]K][###0k
       .k0##[]K][##0k.
       ..kk00[[[00kk..
       ....kkkkkkk....
       ...............`,
      // 1 Flüstern: weit offen.
      `.....kkkkk.....
       ...kk00000kk...
       ..k00#[[[#00k..
       .k0##[]K][##0k.
       k0###[]K][###0k
       .k0##[]]][##0k.
       ..k00#[[[#00k..
       ...kk00000kk...
       .....kkkkk.....`,
      // 2 Trugbilder: aufgerissen, rote Äderchen.
      `.....kkkkk.....
       ...kk00000kk...
       ..k0F#[[[#F0k..
       .kF##[]K][##Fk.
       k0###[]K][###0k
       .kF##[]]][##Fk.
       ..k0F#[[[#F0k..
       ...kk00000kk...
       .....kkkkk.....`,
      // 3 bedrohlich: blutunterlaufen, rote Iris.
      `.....kkkkk.....
       ...kkF000Fkk...
       ..k0F#FuF#F0k..
       .kF##FuKuF##Fk.
       kF###FuKuF###Fk
       .kF##FuuuF##Fk.
       ..k0F#FFF#F0k..
       ...kkF000Fkk...
       .....kkkkk.....`,
      // 4 Nachtmahr: schwarzes Auge, glühende Iris mit Schlitz.
      `.....kkkkk.....
       ...kknnnnnkk...
       ..knnnuuunnnk..
       .knnnuVKVunnnk.
       knnnnuVKVunnnnk
       .knnnuVVVunnnk.
       ..knnnuuunnnk..
       ...kknnnnnkk...
       .....kkkkk.....`,
    ],
  }),
  hudSymbol({
    id: 'ui_taste_xbox',
    size: [11, 11],
    frames: [
      knopfMit(`.###.\n#...#\n#####\n#...#\n#...#`, 'j'),
      knopfMit(`####.\n#...#\n####.\n#...#\n####.`, 'u'),
      knopfMit(`#...#\n.#.#.\n..#..\n.#.#.\n#...#`, 'Z'),
      knopfMit(`#...#\n.#.#.\n..#..\n..#..\n..#..`, 'v'),
    ],
  }),
  hudSymbol({
    id: 'ui_taste_ps',
    size: [11, 11],
    frames: [
      knopfMit(`#...#\n.#.#.\n..#..\n.#.#.\n#...#`, '8'),
      knopfMit(`.###.\n#...#\n#...#\n#...#\n.###.`, 'u'),
      knopfMit(`#####\n#...#\n#...#\n#...#\n#####`, '%'),
      knopfMit(`..#..\n.#.#.\n.#.#.\n#...#\n#####`, 'Z'),
    ],
  }),
  hudSymbol({
    id: 'ui_hud_ziffer',
    size: [5, 7],
    // Gedämpft wie die Beschriftung des Pergaments, hell wie der Text über dem gewählten Platz.
    frames: [...ZIFFERN.map((z) => zifferMit(z, 'C')), ...ZIFFERN.map((z) => zifferMit(z, 'E'))],
  }),
  hudSymbol({
    id: 'ui_taste_generisch',
    size: [11, 11],
    frames: [knopfGenerisch('unten'), knopfGenerisch('rechts'), knopfGenerisch('links'), knopfGenerisch('oben')],
  }),
];
