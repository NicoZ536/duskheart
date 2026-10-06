/**
 * Item-Icons des Feldes (M7-19 … M7-22, Strang D; docs/SPIEL.md §29 „Feld & Fang“): die 18 Ernten, ihre Saattüten,
 * Gießkanne, Kompost, Knochenmehl, Kräuterbrühe und die Feld-Bauteile (Beete, Vogelscheuche, Kompostkiste).
 *
 * Jede Ernte mit eigener Silhouette, damit sie auch ohne Farbe unterscheidbar bleibt: Karotte als schräger Kegel mit
 * Kraut, Kartoffel als Knolle mit Augen, Rübe zweifarbig rund mit Blättern, Zwiebel mit Spitze und Streifen, Knoblauch
 * mit Zehen, Kohl als Kopf mit Blattadern, Salat gekraust, Erbse als offene Schote, Bohnen als Paar, Weizen/Gerste/Roggen
 * als Garbe (Gerste mit Grannen, Roggen schlank und dunkler), Mais als Kolben im Lieschblatt, Tomate rund mit Kelch, Kürbis
 * gerippt, Erdbeere als Kegel mit Nüsschen, Flachs als gebundene Stängel mit blauen Blüten, Kamille als Blütenkörbchen.
 * Die Saattüte ist für alle gleich (Papier `sand`, Schnur `holz`); ein Farbfleck der Frucht auf der Tüte unterscheidet sie.
 * Gezeichnet mit der Hilfe `../feld/_raster.ts`: Formen von Hand gesetzt, oben hell, unten dunkel (AO), Kontur `nacht.1`.
 */
import { Raster, stufe } from '../feld/_raster';
import { icon } from './_icon';

/** Ein Icon aus einem Zeichenvorgang (Kontur rundum). */
function zeichne(id: string, male: (r: Raster) => void, o: Parameters<typeof icon>[2] = {}): ReturnType<typeof icon> {
  const r = new Raster(16, 16);
  male(r);
  r.outline('k');
  return icon(id, r.toString(), o);
}

/** Rampe nach t (oben hell … unten dunkel). */
const sh = (rampe: string, hell = 0.3, dunkel = 0.75) => (_x: number, _y: number, t: number) => stufe(rampe, t, hell, dunkel);

/** Ein Blatt als gefülltes Vieleck von (x0, y0) nach (x1, y1) mit der Breite b. */
function blatt(r: Raster, x0: number, y0: number, x1: number, y1: number, b: number, rampe: string): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const n = Math.hypot(dx, dy) || 1;
  const px = (-dy / n) * b;
  const py = (dx / n) * b;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  r.poly(
    [
      [x0, y0],
      [mx + px, my + py],
      [x1, y1],
      [mx - px, my - py],
    ],
    sh(rampe),
  );
}

/** Die Ernten. */
const ERNTEN = [
  zeichne('karotte', (r) => {
    blatt(r, 10, 6, 12.5, 0.8, 1.2, 'hij');
    blatt(r, 10.5, 6.5, 15, 3, 1.2, 'hij');
    blatt(r, 9.5, 6, 8.5, 1, 1, 'hij');
    r.poly(
      [
        [7, 5.5],
        [12, 10.5],
        [2.5, 14.5],
      ],
      sh('FuU', 0.35, 0.8),
    );
    for (const [x, y] of [
      [6, 9],
      [7, 9],
      [5, 11],
      [6, 11],
    ] as const)
      r.set(x, y, 'F');
  }),
  zeichne('kartoffel', (r) => {
    r.ellipse(10.5, 6, 3.5, 2.5, sh('rst', 0.35, 0.7));
    r.ellipse(7, 10, 5.5, 3.8, sh('rst', 0.3, 0.7));
    r.set(5, 9, 'r').set(6, 9, 'r').set(9, 11, 'r').set(10, 11, 'r').set(11, 6, 'r').set(12, 6, 'r');
  }),
  zeichne('ruebe', (r) => {
    blatt(r, 7.5, 7, 4, 1.5, 1.4, 'hij');
    blatt(r, 8.5, 7, 12, 1.5, 1.4, 'hij');
    blatt(r, 8, 7, 8, 1, 1.2, 'ij');
    r.ellipse(8, 10.5, 4.6, 3.6, (_x, y) => (y <= 9 ? (y <= 8 ? ']' : '[') : y >= 13 ? '9' : '0'));
    r.set(8, 14.5, '9').set(8, 15, '9');
  }),
  zeichne('zwiebel', (r) => {
    r.poly(
      [
        [7.5, 2],
        [8.5, 2],
        [11, 6.5],
        [5, 6.5],
      ],
      sh('mMo', 0.4, 0.9),
    );
    r.ellipse(8, 9.8, 5.2, 4.2, sh('mMo', 0.3, 0.72));
    for (const x of [6, 10]) for (let y = 7; y <= 12; y++) r.set(x, y, 'M');
    r.set(6, 7, 'o').set(10, 7, 'o');
    r.set(7, 14.6, 'D').set(8, 14.6, 'D').set(9, 14.6, 'D');
  }),
  zeichne('knoblauch', (r) => {
    r.poly(
      [
        [7.5, 2],
        [8.5, 2],
        [10, 6],
        [6, 6],
      ],
      sh('9#', 0.6, 0.95),
    );
    r.ellipse(8, 10, 5.3, 4, sh('90#', 0.3, 0.75));
    for (const x of [5, 8, 11]) for (let y = 8; y <= 12; y++) if (r.get(x, y) !== '.') r.set(x, y, '9');
    r.set(7, 14.6, 'C').set(8, 14.6, 'C').set(9, 14.6, 'C');
  }),
  zeichne('kohl', (r) => {
    r.ellipse(8, 9, 6.4, 5.2, sh('ghij', 0.25, 0.8));
    r.ellipse(8, 7.8, 3.6, 3, sh('ijJ', 0.3, 0.85));
    r.line(8, 6, 8, 12, 'J');
    r.line(5, 9, 7, 11, 'J');
    r.line(11, 9, 9, 11, 'J');
  }),
  zeichne('salat', (r) => {
    r.ellipse(8, 10, 6.5, 4.4, sh('hij', 0.3, 0.8));
    r.ellipse(5.5, 8, 2.8, 2.4, sh('ijJ'));
    r.ellipse(10.5, 8, 2.8, 2.4, sh('ijJ'));
    r.ellipse(8, 6.5, 2.6, 2.2, sh('jJ', 0.5, 0.9));
    r.line(8, 9, 8, 13, 'J');
  }),
  zeichne('erbse', (r) => {
    // An open pod lying slantwise: the shell dark around, three peas bright inside.
    r.poly(
      [
        [1.5, 12.5],
        [4, 8],
        [9, 4],
        [14.5, 2.5],
        [12.5, 7.5],
        [8, 11.5],
        [3, 14],
      ],
      sh('Ggh', 0.3, 0.8),
    );
    for (const [x, y] of [
      [4, 10],
      [7.5, 7.5],
      [11, 5.5],
    ] as const) r.ellipse(x, y, 1.3, 1.3, (_x, yy) => (yy <= y ? 'J' : 'j'));
  }),
  zeichne('bohne', (r) => {
    for (const d of [0, 4]) {
      r.poly(
        [
          [2 + d, 3],
          [4 + d, 2],
          [7 + d, 6],
          [9 + d, 11],
          [8 + d, 14],
          [6.5 + d, 13],
          [5.5 + d, 8],
        ],
        sh('ghi', 0.3, 0.8),
      );
      r.line(4 + d, 4, 6 + d, 8, 'j');
    }
  }),
  zeichne('weizen', (r) => garbe(r, 'CDE', 'C', 2.5, false)),
  zeichne('gerste', (r) => garbe(r, 'BCD', 'D', 2.2, true)),
  zeichne('roggen', (r) => garbe(r, 'ABC', 'B', 1.6, false)),
  zeichne('mais', (r) => {
    r.ellipse(8, 7.5, 3, 6, (x, y) => ((x + y) % 2 === 0 ? (y < 5 ? 'V' : 'v') : y < 9 ? 'v' : 'U'));
    r.poly(
      [
        [4, 8],
        [6.5, 10],
        [7.5, 15],
        [4.5, 15],
        [2.5, 11],
      ],
      sh('hij'),
    );
    r.poly(
      [
        [12, 8],
        [9.5, 10],
        [8.5, 15],
        [11.5, 15],
        [13.5, 11],
      ],
      sh('ghi'),
    );
  }),
  zeichne('tomate', (r) => {
    r.ellipse(8, 9.5, 5.6, 4.8, sh('fFu', 0.3, 0.78));
    r.poly(
      [
        [5, 5],
        [8, 6.5],
        [11, 5],
        [9.5, 7.5],
        [6.5, 7.5],
      ],
      'h',
    );
    r.set(8, 4, 'h').set(8, 5, 'h').set(8, 3, 'h');
  }),
  zeichne('kuerbis', (r) => {
    r.ellipse(8, 10, 6.6, 4.6, (x, _y, t) => (x === 5 || x === 8 || x === 11 ? (t < 0.5 ? 'U' : 'u') : stufe('uUv', t, 0.35, 0.8)));
    r.poly(
      [
        [7, 3],
        [9, 2.5],
        [9, 5.8],
        [7.5, 5.8],
      ],
      'h',
    );
    blatt(r, 9.5, 5, 13.5, 3, 1.3, 'hi');
  }),
  zeichne(
    'erdbeere',
    (r) => {
      r.ellipse(8, 8.5, 5.3, 3.2, sh('Fu', 0.4, 0.9));
      r.poly(
        [
          [2.8, 8.5],
          [13.2, 8.5],
          [8.5, 15],
          [7.5, 15],
        ],
        sh('fFu', 0.0, 0.7),
      );
      for (const [x, y] of [
        [5, 9],
        [8, 8],
        [11, 9],
        [7, 11],
        [10, 11],
        [8, 13],
      ] as const)
        r.set(x, y, 'v');
      r.poly(
        [
          [4, 5],
          [8, 4],
          [12, 5],
          [10, 7],
          [6, 7],
        ],
        sh('hi'),
      );
      r.set(8, 2, 'h').set(8, 3, 'h');
    },
    { einzelpixel: 'Nüsschen auf der Erdbeere: helle Einzelpunkte auf rotem Grund' },
  ),
  zeichne('flachs', (r) => {
    for (const x of [5, 7, 9, 11]) r.line(x, 4, 8 + (x - 8) * 0.3, 15, x % 4 === 1 ? 'C' : 'D');
    r.line(5, 10, 10, 10, 'b').line(5, 11, 10, 11, 'c');
    for (const [x, y] of [
      [4, 2],
      [7, 1],
      [10, 2],
      [12, 4],
    ] as const) {
      r.set(x, y, 'Z').set(x + 1, y, 'Z').set(x, y + 1, 'z').set(x + 1, y + 1, 'z');
    }
  }),
  zeichne('kamille', (r) => {
    for (const [x0, y0, x1, y1] of [
      [5, 8, 6, 15],
      [10, 6, 8, 15],
      [12, 11, 9, 15],
    ] as const)
      r.line(x0, y0, x1, y1, 'i');
    for (const [cx, cy, rr] of [
      [5, 6, 2.6],
      [10.5, 4.5, 2.6],
      [12, 10, 2.2],
    ] as const) {
      r.ellipse(cx, cy, rr, rr * 0.85, (_x, _y, t) => (t < 0.55 ? '#' : '0'));
      r.ellipse(cx, cy - 0.3, 0.9, 0.7, 'v');
    }
  }),
];

/** Eine Getreidegarbe: drei Ähren auf kurzen Halmen, unten gebunden; Gerste mit Grannen. */
function garbe(r: Raster, rampe: string, halm: string, breite: number, grannen: boolean): void {
  for (const x of [5, 8, 11]) r.line(x, 9, 8 + (x - 8) * 0.35, 15, halm);
  for (const [x, top] of [
    [4.5, 3],
    [8, 1.5],
    [11.5, 3],
  ] as const) {
    r.ellipse(x, top + 3.5, breite / 2 + 0.2, 3.5, (_xx, y) => ((y + Math.round(x)) % 2 === 0 ? (rampe[2] as string) : (rampe[1] as string)));
    if (grannen) r.line(x, top, x + (x - 8) * 0.3, top - 2.5, 'E');
  }
  r.line(6, 12, 10, 12, 'b');
}

/** Die Saattüte mit dem Farbfleck der Frucht (`fleck`: zwei Stufen ihrer Rampe, hell und dunkel). */
function saat(pflanze: string, fleck: string): ReturnType<typeof icon> {
  return zeichne(`saat_${pflanze}`, (r) => {
    r.poly(
      [
        [4, 5],
        [12, 5],
        [13, 14.5],
        [3, 14.5],
      ],
      sh('CDE', 0.3, 0.85),
    );
    r.poly(
      [
        [5, 2],
        [11, 2],
        [12, 5],
        [4, 5],
      ],
      sh('DE', 0.5, 0.9),
    );
    r.line(4, 5, 12, 5, 'b');
    r.ellipse(8, 10, 2.4, 2.2, (_x, _y, t) => (t < 0.5 ? (fleck[0] as string) : (fleck[1] as string)));
  });
}

/** Saattüten: Farbfleck je Frucht (hell, dunkel). */
const SAAT = [
  saat('karotte', 'Uu'),
  saat('kartoffel', 'tr'),
  saat('ruebe', ']['),
  saat('zwiebel', 'oM'),
  saat('knoblauch', '#9'),
  saat('kohl', 'ji'),
  saat('salat', 'Jj'),
  saat('erbse', 'jh'),
  saat('bohne', 'ih'),
  saat('weizen', 'ED'),
  saat('gerste', 'DC'),
  saat('roggen', 'CB'),
  saat('mais', 'vU'),
  saat('tomate', 'uF'),
  saat('kuerbis', 'vU'),
  saat('erdbeere', 'uF'),
  saat('flachs', 'Zz'),
  saat('kamille', '#v'),
];

/** Werkzeug, Dünger, Bauteile des Feldes. */
const WERKZEUG = [
  zeichne('giesskanne', (r) => {
    r.poly(
      [
        [4, 6],
        [10, 6],
        [10.5, 13.5],
        [3.5, 13.5],
      ],
      sh('3456', 0.3, 0.8),
    );
    r.poly(
      [
        [10, 9],
        [14.5, 4],
        [15, 5],
        [10.5, 11],
      ],
      sh('345'),
    );
    r.ellipse(14.2, 3.8, 1, 1, '4');
    r.line(4, 5, 6, 3, '3').line(6, 3, 9, 3, '3').line(9, 3, 10, 5, '3');
    r.line(4, 9, 10, 9, '3');
  }),
  zeichne('kompost', (r) => {
    r.ellipse(8, 11, 6.5, 3.6, sh('pqr', 0.35, 0.8));
    r.ellipse(8, 8.5, 4, 2.5, sh('qrs', 0.4, 0.85));
    r.set(5, 10, 'i').set(6, 10, 'i').set(10, 8, 'i').set(11, 8, 'i').set(9, 12, 'M').set(10, 12, 'M');
  }),
  zeichne('knochenmehl', (r) => {
    r.poly(
      [
        [4, 6],
        [12, 6],
        [13, 14.5],
        [3, 14.5],
      ],
      sh('rst', 0.3, 0.85),
    );
    r.ellipse(8, 5.5, 4.2, 1.8, sh('0#', 0.5, 0.95));
    r.ellipse(8, 3.8, 2, 1.2, '#');
    r.line(4, 7, 12, 7, 'q');
  }),
  zeichne('kraeuterbruehe', (r) => {
    r.poly(
      [
        [3, 7],
        [13, 7],
        [11.5, 14.5],
        [4.5, 14.5],
      ],
      sh('qrs', 0.3, 0.85),
    );
    r.ellipse(8, 7, 5, 1.5, (_x, _y, t) => (t < 0.5 ? 'j' : 'i'));
    blatt(r, 7, 6.5, 4.5, 2, 1.4, 'hi');
    blatt(r, 9, 6.5, 11.5, 2, 1.4, 'hi');
  }),
  zeichne('beet_holz', (r) => {
    r.poly(
      [
        [1.5, 6],
        [14.5, 6],
        [14.5, 13.5],
        [1.5, 13.5],
      ],
      sh('bcd', 0.3, 0.8),
    );
    r.poly(
      [
        [3, 7],
        [13, 7],
        [13, 11],
        [3, 11],
      ],
      sh('qr', 0.4, 0.9),
    );
    for (const x of [5, 8, 11]) r.set(x, 8, 'i').set(x, 9, 'h');
    r.line(1, 12, 15, 12, 'b');
  }),
  zeichne('beet_stein', (r) => {
    r.poly(
      [
        [1.5, 6],
        [14.5, 6],
        [14.5, 13.5],
        [1.5, 13.5],
      ],
      sh('345', 0.3, 0.8),
    );
    r.poly(
      [
        [3, 7],
        [13, 7],
        [13, 11],
        [3, 11],
      ],
      sh('qr', 0.4, 0.9),
    );
    for (const x of [5, 8, 11]) r.set(x, 8, 'i').set(x, 9, 'h');
    for (const x of [4, 8, 12]) r.set(x, 12, '3').set(x, 13, '3');
  }),
  zeichne('vogelscheuche', (r) => {
    r.line(8, 4, 8, 15, 'c');
    r.line(2, 7, 14, 7, 'c');
    r.poly(
      [
        [5, 6],
        [11, 6],
        [12, 11],
        [4, 11],
      ],
      sh('xyz', 0.3, 0.85),
    );
    r.ellipse(8, 4, 2.2, 2, sh('DE'));
    r.poly(
      [
        [4.5, 2.5],
        [11.5, 2.5],
        [9.5, 0.5],
        [6.5, 0.5],
      ],
      'b',
    );
    for (const [x, y] of [
      [2, 8],
      [14, 8],
      [5, 12],
      [11, 12],
    ] as const)
      r.set(x, y, 'D');
  }),
  zeichne('kompostkiste', (r) => {
    r.poly(
      [
        [2, 4],
        [14, 4],
        [14, 14.5],
        [2, 14.5],
      ],
      sh('bcd', 0.3, 0.8),
    );
    r.poly(
      [
        [3.5, 5],
        [12.5, 5],
        [12.5, 7.5],
        [3.5, 7.5],
      ],
      sh('pq'),
    );
    for (const y of [9, 12]) r.line(2, y, 14, y, 'b');
    r.set(5, 6, 'i').set(6, 6, 'i').set(10, 6, 'M').set(11, 6, 'M');
  }),
];

export default [...ERNTEN, ...SAAT, ...WERKZEUG];
