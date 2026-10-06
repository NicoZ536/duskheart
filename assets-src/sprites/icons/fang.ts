/**
 * Item-Icons des Fangs (M7-24, Strang D; docs/SPIEL.md §29 „Feld & Fang“): die acht rohen Fische, die Stockangel, der
 * Knochenhaken, die Reuse und der Regenwurm.
 *
 * Die Fische liegen alle gleich (Kopf rechts, Schwanz links), damit sie sich nur in dem unterscheiden, was sie ausmacht:
 * Forelle olivgrün mit rosa Seite und roten Punkten, Barsch grüngelb mit dunklen Querbinden und roten Flossen, Karpfen
 * hochrückig golden mit Schuppenreihen, Hecht lang und schlank mit Entenschnabel und hellen Flecken, Aal als dunkle
 * Schlange, Quappe braun gefleckt mit breitem Kopf, Hering schlank silberblau, Makrele blaugrün mit dunklen Wellenstreifen.
 * Das Auge ist ein einzelnes dunkles Pixel (begründet). Gezeichnet mit `../feld/_raster.ts`, Kontur `nacht.1`.
 */
import { Raster, stufe } from '../feld/_raster';
import { icon } from './_icon';

const AUGE = 'Auge des Fischs: ein dunkles Einzelpixel im Kopf';

interface FischForm {
  /** Körpermitte, Halbachsen. */
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  /** Rücken (oben), Seite, Bauch (unten). */
  readonly ruecken: string;
  readonly seite: string;
  readonly bauch: string;
  /** Flossen. */
  readonly flosse: string;
  /** Muster auf dem Körper (nach dem Grundton). */
  readonly muster?: (r: Raster, inBody: (x: number, y: number) => boolean) => void;
  /** Kopf spitz (Hecht) – die Schnauze reicht weiter. */
  readonly schnauze?: number;
}

function fisch(id: string, f: FischForm): ReturnType<typeof icon> {
  const r = new Raster(16, 16);
  const left = f.cx - f.rx;
  // Schwanz: ein Fächer links.
  r.poly(
    [
      [left + 1.5, f.cy],
      [left - 2.5, f.cy - f.ry - 1],
      [left - 1.5, f.cy],
      [left - 2.5, f.cy + f.ry + 1],
    ],
    f.flosse,
  );
  // Rückenflosse und Bauchflosse.
  r.poly(
    [
      [f.cx - 2, f.cy - f.ry + 0.5],
      [f.cx - 1, f.cy - f.ry - 1.8],
      [f.cx + 2, f.cy - f.ry + 0.5],
    ],
    f.flosse,
  );
  r.poly(
    [
      [f.cx - 1, f.cy + f.ry - 0.5],
      [f.cx, f.cy + f.ry + 1.3],
      [f.cx + 1.5, f.cy + f.ry - 0.5],
    ],
    f.flosse,
  );
  r.ellipse(f.cx, f.cy, f.rx, f.ry, (_x, _y, t) => (t < 0.38 ? f.ruecken : t < 0.72 ? f.seite : f.bauch));
  if (f.schnauze !== undefined) {
    r.poly(
      [
        [f.cx + f.rx - 1, f.cy - 1],
        [f.cx + f.rx + f.schnauze, f.cy - 0.3],
        [f.cx + f.rx + f.schnauze, f.cy + 0.6],
        [f.cx + f.rx - 1, f.cy + 1.2],
      ],
      f.seite,
    );
  }
  const inBody = (x: number, y: number): boolean => {
    const dx = (x - f.cx) / (f.rx + 0.35);
    const dy = (y - f.cy) / (f.ry + 0.35);
    return dx * dx + dy * dy <= 1;
  };
  f.muster?.(r, inBody);
  // Kiemenbogen und Auge.
  const kx = Math.round(f.cx + f.rx * 0.45);
  for (let y = Math.round(f.cy - f.ry * 0.5); y <= Math.round(f.cy + f.ry * 0.5); y++) if (inBody(kx, y)) r.set(kx, y, f.flosse);
  r.set(Math.round(f.cx + f.rx * 0.7), Math.round(f.cy - f.ry * 0.25), 'K');
  r.outline('k');
  return icon(id, r.toString(), { einzelpixel: AUGE });
}

const FISCHE = [
  fisch('forelle', {
    cx: 8.5,
    cy: 8,
    rx: 5.5,
    ry: 2.6,
    ruecken: 'h',
    seite: 'S',
    bauch: '#',
    flosse: 'g',
    muster: (r, inBody) => {
      for (const [x, y] of [
        [6, 7],
        [8, 6],
        [10, 7],
        [5, 8],
      ] as const)
        if (inBody(x, y)) r.set(x, y, 'F');
    },
  }),
  fisch('barsch', {
    cx: 8.5,
    cy: 8,
    rx: 5,
    ry: 3.2,
    ruecken: 'i',
    seite: 'j',
    bauch: 'J',
    flosse: 'u',
    muster: (r, inBody) => {
      for (const x of [5, 7, 9]) for (let y = 5; y <= 9; y++) if (inBody(x, y)) r.set(x, y, 'g');
    },
  }),
  fisch('karpfen', {
    cx: 8.5,
    cy: 8,
    rx: 5.2,
    ry: 3.6,
    ruecken: 'M',
    seite: 'o',
    bauch: 'E',
    flosse: 'm',
    muster: (r, inBody) => {
      for (const [y, x0] of [
        [6, 5],
        [8, 4],
      ] as const)
        for (let x = x0; x <= 10; x += 2) if (inBody(x, y) && inBody(x + 1, y)) r.set(x, y, 'm');
      r.set(14, 10, 'm').set(14, 11, 'm');
    },
  }),
  fisch('hecht', {
    cx: 7.5,
    cy: 8,
    rx: 5.5,
    ry: 2,
    ruecken: 'h',
    seite: 'i',
    bauch: 'J',
    flosse: 'g',
    schnauze: 2,
    muster: (r, inBody) => {
      for (const [x, y] of [
        [4, 7],
        [5, 7],
        [8, 8],
        [9, 8],
      ] as const)
        if (inBody(x, y)) r.set(x, y, 'J');
    },
  }),
  ((): ReturnType<typeof icon> => {
    // The eel: a dark snake in two bends, the belly lighter.
    const r = new Raster(16, 16);
    const pts: [number, number][] = [];
    for (let x = 1; x <= 14; x++) pts.push([x, 8 + Math.sin((x / 14) * Math.PI * 2) * 2.5]);
    for (const [x, y] of pts) {
      r.set(x, y - 1, 'B');
      r.set(x, y, 'B');
      r.set(x, y + 1, 'C');
    }
    r.set(14, 7.4 + Math.sin(Math.PI * 2) * 2.5, 'K');
    r.outline('k');
    return icon('aal', r.toString(), { einzelpixel: AUGE });
  })(),
  fisch('quappe', {
    cx: 8.5,
    cy: 8,
    rx: 5.5,
    ry: 3,
    ruecken: 'r',
    seite: 's',
    bauch: 't',
    flosse: 'q',
    muster: (r, inBody) => {
      for (const [x, y] of [
        [5, 7],
        [6, 7],
        [9, 6],
        [10, 6],
        [7, 9],
        [8, 9],
      ] as const)
        if (inBody(x, y)) r.set(x, y, 'q');
      r.set(14, 10, 'q').set(14, 11, 'q');
    },
  }),
  fisch('hering', {
    cx: 8.5,
    cy: 8,
    rx: 5.5,
    ry: 2.2,
    ruecken: 'z',
    seite: '0',
    bauch: '#',
    flosse: 'y',
  }),
  fisch('makrele', {
    cx: 8.5,
    cy: 8,
    rx: 5.6,
    ry: 2.6,
    ruecken: 'Z',
    seite: '0',
    bauch: '#',
    flosse: 'y',
    muster: (r, inBody) => {
      for (const x of [5, 7, 9]) {
        if (inBody(x, 6)) r.set(x, 6, 'x');
        if (inBody(x + 1, 7)) r.set(x + 1, 7, 'x');
      }
    },
  }),
];

/** Rampe nach t (oben hell … unten dunkel). */
const sh = (rampe: string, hell = 0.3, dunkel = 0.75) => (_x: number, _y: number, t: number) => stufe(rampe, t, hell, dunkel);

const GERAET = [
  ((): ReturnType<typeof icon> => {
    // The stick rod: a twig slantwise, the line hanging from its tip, a float and the bone hook.
    const r = new Raster(16, 16);
    r.line(1, 15, 13, 2, 'c');
    r.line(2, 15, 14, 2, 'd');
    r.line(14, 2, 14, 9, '#');
    r.set(13, 10, 'F').set(14, 10, 'F').set(13, 11, '#').set(14, 11, '#');
    r.line(14, 12, 14, 13, 'E').set(13, 13, 'E');
    r.outline('k');
    return icon('angel_holz', r.toString());
  })(),
  ((): ReturnType<typeof icon> => {
    // The bone hook: a J of bone with a barb and an eye for the line.
    const r = new Raster(16, 16);
    r.line(9, 3, 9, 11, 'E');
    r.line(10, 3, 10, 11, 'D');
    r.line(5, 9, 5, 12, 'E');
    r.line(6, 12, 9, 12, 'D');
    r.line(6, 13, 9, 13, 'C');
    r.set(4, 9, 'D').set(4, 8, 'E');
    r.ellipse(9.5, 2.5, 1.2, 1, 'D');
    r.outline('k');
    return icon('knochenhaken', r.toString());
  })(),
  ((): ReturnType<typeof icon> => {
    // The fish trap: a woven basket lying, the funnel mouth to the right.
    const r = new Raster(16, 16);
    r.ellipse(7, 8.5, 6, 4.5, sh('bcd', 0.3, 0.8));
    for (const x of [4, 7, 10]) for (let y = 4; y <= 13; y++) if (r.get(x, y) !== '.') r.set(x, y, 'b');
    r.ellipse(13, 8.5, 1.6, 3.2, sh('cd'));
    r.ellipse(13, 8.5, 0.6, 1.4, 'a');
    r.outline('k');
    return icon('reuse', r.toString());
  })(),
  ((): ReturnType<typeof icon> => {
    // The earthworm: a pink S, ringed.
    const r = new Raster(16, 16);
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      const x = 2 + t * 12;
      const y = 8 + Math.sin(t * Math.PI * 2) * 3;
      r.set(x, y, 'S');
      r.set(x, y + 1, 'R');
    }
    for (const x of [5, 9]) for (let y = 0; y < 16; y++) if (r.get(x, y) === 'S') r.set(x, y, 'O');
    r.outline('k');
    return icon('regenwurm', r.toString());
  })(),
];

export default [...FISCHE, ...GERAET];
