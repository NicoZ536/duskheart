/**
 * Aktionen der Spielfigur (M3-05 Bewegung, M3-06 Aktionen; MASTERPROMPT §4.5): je Aktion die Frames von
 * vorn, von hinten und im Profil, die Abspielfolge (Haltephasen als wiederholte Frames), Bildrate und
 * Frame-Events. Clip-Namen `<aktion>_<richtung>` (docs/ART.md §4).
 *
 * Ein Frame ist eine Pose (Teile + Versätze, `_spieler_rig.ts`) oder eine Sonderpose (`_spieler_sonder.ts`:
 * Schwimmen mit Wasserlinie, Rollball, Liegen). Antizipation: Werkzeug holt über zwei Frames aus, die
 * Rolle duckt sich vorher, der Tod knickt erst ein; Überschwingen: Werkzeug schlägt durch (Körper
 * nachgefedert), die Rolle federt in der Hocke nach, der Körper federt beim Aufprall 1 px nach;
 * Smear-Frames: Werkzeugschlag (gestreckter Arm mit Bewegungsspur) und Rollbeginn.
 */
import type { Bild, Richtung } from '../../lib/figure';
import type { Pose } from './_spieler_rig';
import { liegeBild, rollBild, schwimmBild, SCHWIMM_TIEFE } from './_spieler_sonder';

export interface AktionsEvent {
  /** Position im Clip (nicht der Sprite-Frame). */
  readonly frame: number;
  readonly name: string;
}

/** Sonderpose: baut das Bild je Richtung selbst. */
export interface Sonder {
  readonly sonder: (richtung: Richtung) => Bild;
}
export type FrameDef = Pose | Sonder;

export interface Aktion {
  /** Aktionsname im Clip `<aktion>_<richtung>`. */
  readonly name: string;
  readonly fps: number;
  readonly loop: boolean;
  /** Abspielfolge: Frame-Index je Clip-Position. */
  readonly folge: readonly number[];
  readonly events: readonly AktionsEvent[];
  /** Frames von vorn (down), von hinten (up; Standard: wie vorn) und im Profil (right; left gespiegelt). */
  readonly vorn: readonly FrameDef[];
  readonly hinten?: readonly FrameDef[];
  readonly profil: readonly FrameDef[];
}

export function istSonder(f: FrameDef): f is Sonder {
  return 'sonder' in f;
}

const STEHEN = { armR: ['haengen'], armL: ['haengen'], beinR: ['stand'], beinL: ['stand'] } as const satisfies Omit<Pose, 'kopf' | 'rumpf'>;
/** Hockende Beine (Rolle, Sprung). */
const HOCKE_BEINE = { beinR: ['hocke'], beinL: ['hocke'] } as const satisfies Pick<Pose, 'beinR' | 'beinL'>;

// ---------------------------------------------------------------------------------------------
// Idle – Atmung als Welle (M1-22): Kopf sinkt vor, Rumpf folgt, Kopf hebt sich, Ruhe.
// ---------------------------------------------------------------------------------------------

/** [Kopf-, Rumpf-Versatz] der Atemwelle. */
const WELLE: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
/** Ruhe- und Tiefpunkt je drei Bilder: 8 Bilder je Zyklus, bei 8 fps eine Sekunde. */
const WELLE_FOLGE = [0, 0, 0, 1, 2, 2, 2, 3];

const idle: Aktion = {
  name: 'idle',
  fps: 8,
  loop: true,
  folge: WELLE_FOLGE,
  events: [],
  vorn: WELLE.map(([k, r]) => ({ ...STEHEN, kopf: ['auf', 0, k], rumpf: ['normal', 0, r] })),
  profil: WELLE.map(([k, r]) => ({ ...STEHEN, kopf: ['auf', 0, k], rumpf: ['normal', 0, r] })),
};

// ---------------------------------------------------------------------------------------------
// Gehen – 6 Frames: Kontakt, Tiefpunkt, Passieren je Bein; der Kopf folgt dem Rumpf einen Frame später.
// ---------------------------------------------------------------------------------------------

type Arme = Pick<Pose, 'armR' | 'armL'>;
const SCHRITT_EVENTS = [
  { frame: 0, name: 'schritt' },
  { frame: 3, name: 'schritt' },
];

/** Gang von vorn/hinten: Bein-, Rumpf- und Kopffolge; Arme austauschbar (Tragen), `tief` duckt den Körper (Schleichen). */
function gangVorn(arme: readonly [Arme, Arme, Arme, Arme, Arme, Arme], folge?: Pose['folge'], tief = 0): Pose[] {
  const beine: readonly Pick<Pose, 'beinR' | 'beinL'>[] = [
    { beinR: ['stand'], beinL: ['heben1'] },
    { beinR: ['stand'], beinL: ['heben2'] },
    { beinR: ['stand'], beinL: ['heben1'] },
    { beinR: ['heben1'], beinL: ['stand'] },
    { beinR: ['heben2'], beinL: ['stand'] },
    { beinR: ['heben1'], beinL: ['stand'] },
  ];
  const koerper: readonly (readonly [number, number])[] = [
    [0, 1],
    [1, 0],
    [0, 0],
    [0, 1],
    [1, 0],
    [0, 0],
  ];
  return beine.map((b, i) => {
    const [k, r] = koerper[i] ?? [0, 0];
    const a = arme[i] ?? arme[0];
    return { ...a, ...b, kopf: ['auf', 0, k + tief], rumpf: ['normal', 0, r + tief], ...(folge === undefined ? {} : { folge }) };
  });
}

/** Gang im Profil: Kontakt, Tiefpunkt, Passieren je Bein; `tief` duckt den Körper, `vor` neigt den Kopf nach vorn. */
function gangProfil(arme: readonly [Arme, Arme, Arme, Arme, Arme, Arme], folge?: Pose['folge'], tief = 0, vor = 0): Pose[] {
  const beine: readonly Pick<Pose, 'beinR' | 'beinL'>[] = [
    { beinR: ['vor'], beinL: ['zurueck'] },
    { beinR: ['stand'], beinL: ['zurueck'] },
    { beinR: ['stand'], beinL: ['mitte'] },
    { beinR: ['zurueck'], beinL: ['vor'] },
    { beinR: ['zurueck'], beinL: ['stand'] },
    { beinR: ['mitte'], beinL: ['stand'] },
  ];
  const koerper: readonly (readonly [number, number])[] = [
    [0, 0],
    [0, 1],
    [1, 0],
    [0, 0],
    [0, 1],
    [1, 0],
  ];
  return beine.map((b, i) => {
    const [k, r] = koerper[i] ?? [0, 0];
    const a = arme[i] ?? arme[0];
    return { ...a, ...b, kopf: ['auf', vor, k + tief], rumpf: ['normal', 0, r + tief], ...(folge === undefined ? {} : { folge }) };
  });
}

const PENDEL_R: Arme = { armR: ['zurueck'], armL: ['vor'] };
const PENDEL_L: Arme = { armR: ['vor'], armL: ['zurueck'] };
const HAENGEN: Arme = { armR: ['haengen'], armL: ['haengen'] };
const TRAGEN: Arme = { armR: ['tragen'], armL: ['tragen'] };

const walk: Aktion = {
  name: 'walk',
  fps: 10,
  loop: true,
  folge: [0, 1, 2, 3, 4, 5],
  events: SCHRITT_EVENTS,
  vorn: gangVorn([PENDEL_R, PENDEL_R, HAENGEN, PENDEL_L, PENDEL_L, HAENGEN]),
  profil: gangProfil([PENDEL_R, PENDEL_R, HAENGEN, PENDEL_L, PENDEL_L, HAENGEN]),
};

// ---------------------------------------------------------------------------------------------
// Schleichen – geduckter Gang (Kopf und Rumpf 2 px tiefer, Kopf im Profil vorgeneigt), Hände vorn.
// ---------------------------------------------------------------------------------------------

const TASTEN: Arme = { armR: ['pumpeVor'], armL: ['pumpeVor'] };

const sneak: Aktion = {
  name: 'sneak',
  fps: 8,
  loop: true,
  folge: [0, 1, 2, 3, 4, 5],
  events: SCHRITT_EVENTS,
  vorn: gangVorn([TASTEN, TASTEN, TASTEN, TASTEN, TASTEN, TASTEN], undefined, 2),
  profil: gangProfil([TASTEN, TASTEN, TASTEN, TASTEN, TASTEN, TASTEN], undefined, 2, 1),
};

// ---------------------------------------------------------------------------------------------
// Sprung – 4 Frames: Hocke (Antizipation), Absprung (gestreckt, Arme hoch), Flug (Beine angezogen),
// Landung (gestaucht, federt nach). Spielt einmal über den Fortschritt des Sprungs (Klippen, M3-09).
// ---------------------------------------------------------------------------------------------

const jump: Aktion = {
  name: 'jump',
  fps: 10,
  loop: false,
  folge: [0, 1, 2, 2, 3],
  events: [
    { frame: 1, name: 'absprung' },
    { frame: 4, name: 'landung' },
  ],
  vorn: [
    { ...HOCKE_BEINE, kopf: ['auf', 0, 3], rumpf: ['normal', 0, 2], armR: ['zurueck'], armL: ['zurueck'] },
    { kopf: ['auf', 0, -2], rumpf: ['normal', 0, -2], armR: ['heben'], armL: ['heben'], beinR: ['heben1', 0, 0], beinL: ['heben1', 0, 0], folge: 'armeHinterKopf' },
    { kopf: ['auf', 0, -3], rumpf: ['normal', 0, -3], armR: ['vor'], armL: ['vor'], beinR: ['heben3', 0, -1], beinL: ['heben3', 0, -1] },
    { ...HOCKE_BEINE, kopf: ['auf', 0, 3], rumpf: ['normal', 0, 2], armR: ['vor'], armL: ['vor'] },
  ],
  profil: [
    { ...HOCKE_BEINE, kopf: ['auf', 1, 3], rumpf: ['normal', 0, 2], armR: ['zurueck'], armL: ['zurueck'] },
    { kopf: ['auf', 1, -2], rumpf: ['normal', 0, -2], armR: ['vor'], armL: ['vor'], beinR: ['zurueckWeit'], beinL: ['zurueckWeit', -1, 0] },
    { kopf: ['auf', 1, -3], rumpf: ['normal', 0, -3], armR: ['vor'], armL: ['vor'], beinR: ['knieHoch', 0, -1], beinL: ['knieHoch', -1, -1] },
    { ...HOCKE_BEINE, kopf: ['auf', 1, 3], rumpf: ['normal', 0, 2], armR: ['vor'], armL: ['vor'] },
  ],
};

// ---------------------------------------------------------------------------------------------
// Rennen – 6 Frames: Kontakt (gestaucht), Abdruck (Knie hoch), Flugphase (beide Füße in der Luft);
// im Profil nach vorn geneigt.
// ---------------------------------------------------------------------------------------------

const run: Aktion = {
  name: 'run',
  fps: 12,
  loop: true,
  folge: [0, 1, 2, 3, 4, 5],
  events: SCHRITT_EVENTS,
  vorn: [
    { kopf: ['auf', 0, 0], rumpf: ['normal', 0, 1], armR: ['pumpeZurueck'], armL: ['pumpeVor'], beinR: ['stand'], beinL: ['heben2'] },
    { kopf: ['auf', 0, 1], rumpf: ['normal', 0, 0], armR: ['pumpeZurueck'], armL: ['pumpeVor'], beinR: ['stand'], beinL: ['heben3'] },
    { kopf: ['auf', 0, -1], rumpf: ['normal', 0, -1], armR: ['haengen'], armL: ['haengen'], beinR: ['heben1'], beinL: ['heben2'] },
    { kopf: ['auf', 0, 0], rumpf: ['normal', 0, 1], armR: ['pumpeVor'], armL: ['pumpeZurueck'], beinR: ['heben2'], beinL: ['stand'] },
    { kopf: ['auf', 0, 1], rumpf: ['normal', 0, 0], armR: ['pumpeVor'], armL: ['pumpeZurueck'], beinR: ['heben3'], beinL: ['stand'] },
    { kopf: ['auf', 0, -1], rumpf: ['normal', 0, -1], armR: ['haengen'], armL: ['haengen'], beinR: ['heben2'], beinL: ['heben1'] },
  ],
  profil: [
    { kopf: ['auf', 1, 1], rumpf: ['normal', 0, 1], armR: ['pumpeZurueck'], armL: ['pumpeVor'], beinR: ['vor'], beinL: ['zurueckWeit'] },
    { kopf: ['auf', 1, 1], rumpf: ['normal', 0, 0], armR: ['pumpeZurueck'], armL: ['pumpeVor'], beinR: ['zurueck'], beinL: ['knieHoch'] },
    { kopf: ['auf', 1, -1], rumpf: ['normal', 0, -1], armR: ['haengen'], armL: ['haengen'], beinR: ['zurueckWeit'], beinL: ['vorWeit', 0, -1] },
    { kopf: ['auf', 1, 1], rumpf: ['normal', 0, 1], armR: ['pumpeVor'], armL: ['pumpeZurueck'], beinR: ['zurueckWeit'], beinL: ['vor'] },
    { kopf: ['auf', 1, 1], rumpf: ['normal', 0, 0], armR: ['pumpeVor'], armL: ['pumpeZurueck'], beinR: ['knieHoch'], beinL: ['zurueck'] },
    { kopf: ['auf', 1, -1], rumpf: ['normal', 0, -1], armR: ['haengen'], armL: ['haengen'], beinR: ['vorWeit', 0, -1], beinL: ['zurueckWeit'] },
  ],
};

// ---------------------------------------------------------------------------------------------
// Rolle – 5 Frames: Hocke (Antizipation), drei Ballphasen (die erste gestreckt als Smear), Hocke
// (Nachfedern). 0,42 s bei 12 fps; die Unverwundbarkeit (0,25 s, §11.4) liegt in den Ballphasen.
// ---------------------------------------------------------------------------------------------

const HOCKE = HOCKE_BEINE;
const ball = (phase: number): Sonder => ({ sonder: (r) => rollBild(r, phase) });

const roll: Aktion = {
  name: 'roll',
  fps: 12,
  loop: false,
  folge: [0, 1, 2, 3, 4],
  events: [
    { frame: 1, name: 'abrollen' },
    { frame: 4, name: 'schritt' },
  ],
  vorn: [
    { ...HOCKE, kopf: ['auf', 0, 4], rumpf: ['normal', 0, 3], armR: ['vor'], armL: ['vor'] },
    ball(0),
    ball(1),
    ball(2),
    { ...HOCKE, kopf: ['auf', 0, 2], rumpf: ['normal', 0, 2], armR: ['zurueck'], armL: ['zurueck'] },
  ],
  profil: [
    { ...HOCKE, kopf: ['auf', 2, 4], rumpf: ['normal', 1, 3], armR: ['vor'], armL: ['vor'] },
    ball(0),
    ball(1),
    ball(2),
    { ...HOCKE, kopf: ['auf', 1, 2], rumpf: ['normal', 0, 2], armR: ['zurueck'], armL: ['zurueck'] },
  ],
};

// ---------------------------------------------------------------------------------------------
// Schwimmen – 4 Frames Brustzug: Arme vor, Arme auseinander (Kopf hebt sich), Arme zurück, gleiten.
// ---------------------------------------------------------------------------------------------

/** Schwimm-Frame: Pose eingesunken um `SCHWIMM_TIEFE`, Kopf-Hub `k`, Wellenring `ring`. */
function zug(arme: Arme, k: number, ring: number, folge?: Pose['folge']): Sonder {
  const pose: Pose = {
    ...arme,
    kopf: ['auf', 0, SCHWIMM_TIEFE + k],
    rumpf: ['normal', 0, SCHWIMM_TIEFE],
    beinR: ['stand'],
    beinL: ['stand'],
    ...(folge === undefined ? {} : { folge }),
  };
  return { sonder: (r) => schwimmBild(r, pose, ring) };
}

const swim: Aktion = {
  name: 'swim',
  fps: 8,
  loop: true,
  folge: [0, 1, 2, 3],
  events: [{ frame: 1, name: 'zug' }],
  vorn: [
    zug({ armR: ['paddelVor'], armL: ['paddelVor'] }, 0, 0),
    zug({ armR: ['paddelSeite'], armL: ['paddelSeite'] }, -1, 1),
    zug({ armR: ['paddelZurueck'], armL: ['paddelZurueck'] }, -1, 2),
    zug({ armR: ['paddelVor', 0, 1], armL: ['paddelVor', 0, 1] }, 0, 1),
  ],
  hinten: [
    zug({ armR: ['paddelVor'], armL: ['paddelVor'] }, 0, 0, 'armeHinten'),
    zug({ armR: ['paddelSeite'], armL: ['paddelSeite'] }, -1, 1),
    zug({ armR: ['paddelZurueck'], armL: ['paddelZurueck'] }, -1, 2),
    zug({ armR: ['paddelVor', 0, 1], armL: ['paddelVor', 0, 1] }, 0, 1, 'armeHinten'),
  ],
  profil: [
    zug({ armR: ['paddelVor'], armL: ['paddelZurueck'] }, 0, 0),
    zug({ armR: ['paddelSeite'], armL: ['paddelSeite'] }, -1, 1),
    zug({ armR: ['paddelZurueck'], armL: ['paddelVor'] }, -1, 2),
    zug({ armR: ['paddelVor', 0, 1], armL: ['paddelZurueck', 0, 1] }, 0, 1),
  ],
};

// ---------------------------------------------------------------------------------------------
// Werkzeug – 4 Frames: Anheben, Ausholen (gehalten), Schlag (Smear), Durchschlag (Körper federt nach).
// Event `treffer` auf dem Durchschlag (Sammeln, Schaden, Sound).
// ---------------------------------------------------------------------------------------------

const tool: Aktion = {
  name: 'tool',
  fps: 12,
  loop: false,
  folge: [0, 1, 1, 2, 3, 3],
  events: [{ frame: 4, name: 'treffer' }],
  vorn: [
    { ...STEHEN, kopf: ['auf', 0, 0], rumpf: ['normal', 0, 0], armR: ['heben'], folge: 'armeHinterKopf' },
    { ...STEHEN, kopf: ['auf', 0, -1], rumpf: ['normal', 0, 0], armR: ['hoch'], folge: 'armeHinterKopf' },
    { ...STEHEN, kopf: ['auf', 0, 1], rumpf: ['normal', 0, 1], armR: ['schlag'], beinR: ['hocke'] },
    { ...STEHEN, kopf: ['auf', 0, 2], rumpf: ['normal', 0, 1], armR: ['treffer'], beinR: ['hocke'] },
  ],
  hinten: [
    { ...STEHEN, kopf: ['auf', 0, 0], rumpf: ['normal', 0, 0], armR: ['heben'], folge: 'armeHinterKopf' },
    { ...STEHEN, kopf: ['auf', 0, -1], rumpf: ['normal', 0, 0], armR: ['hoch'], folge: 'armeHinterKopf' },
    { ...STEHEN, kopf: ['auf', 0, 1], rumpf: ['normal', 0, 1], armR: ['heben', 0, 1], beinR: ['hocke'], folge: 'armeHinten' },
    { ...STEHEN, kopf: ['auf', 0, 2], rumpf: ['normal', 0, 1], armR: ['treffer'], beinR: ['hocke'], folge: 'armeHinten' },
  ],
  profil: [
    { ...STEHEN, kopf: ['auf', -1, 0], rumpf: ['normal', 0, 0], armR: ['heben'], folge: 'armeHinterKopf' },
    { ...STEHEN, kopf: ['auf', -1, -1], rumpf: ['normal', -1, 0], armR: ['hoch'], folge: 'armeHinterKopf' },
    { ...STEHEN, kopf: ['auf', 1, 1], rumpf: ['normal', 1, 1], armR: ['schlag'], beinR: ['vor'], beinL: ['zurueck'] },
    { ...STEHEN, kopf: ['auf', 1, 2], rumpf: ['normal', 1, 1], armR: ['treffer'], beinR: ['vor'], beinL: ['zurueck'] },
  ],
};

// ---------------------------------------------------------------------------------------------
// Treffer – 2 Frames: zurückgeworfen (Arme weg, Schmerz), eingesackt.
// ---------------------------------------------------------------------------------------------

const TREFFER_VORN: readonly Pose[] = [
  { kopf: ['schmerz', 0, -1], rumpf: ['normal', 0, 0], armR: ['weg'], armL: ['weg'], beinR: ['stand'], beinL: ['stand'], folge: 'armeHinterKopf' },
  { kopf: ['schmerz', 0, 2], rumpf: ['normal', 0, 1], armR: ['vor'], armL: ['vor'], beinR: ['hocke'], beinL: ['hocke'] },
];
const TREFFER_PROFIL: readonly Pose[] = [
  { kopf: ['schmerz', -2, 0], rumpf: ['normal', -1, 0], armR: ['weg'], armL: ['weg'], beinR: ['stand'], beinL: ['zurueck'] },
  { kopf: ['schmerz', -1, 2], rumpf: ['normal', 0, 1], armR: ['vor'], armL: ['vor'], beinR: ['hocke'], beinL: ['stand'] },
];

const hit: Aktion = {
  name: 'hit',
  fps: 8,
  loop: false,
  folge: [0, 1],
  events: [{ frame: 0, name: 'getroffen' }],
  vorn: TREFFER_VORN,
  profil: TREFFER_PROFIL,
};

// ---------------------------------------------------------------------------------------------
// Tod – 6 Frames: Treffer, Einknicken, Knien, Umkippen, Aufprall (federt 1 px), Liegen.
// ---------------------------------------------------------------------------------------------

/** Liegende Grundpose (Augen zu). */
const LIEGEN: Pose = { ...STEHEN, kopf: ['zu', 0, 0], rumpf: ['normal', 0, 0] };
const liegen = (pose: Pose, hub: number): Sonder => ({ sonder: (r) => liegeBild(r, pose, hub) });

const death: Aktion = {
  name: 'death',
  fps: 8,
  loop: false,
  folge: [0, 1, 2, 3, 4, 5],
  events: [{ frame: 4, name: 'aufprall' }],
  vorn: [
    TREFFER_VORN[0] ?? LIEGEN,
    { ...STEHEN, kopf: ['zu', 0, 3], rumpf: ['normal', 0, 2], beinR: ['hocke'], beinL: ['hocke'] },
    { ...STEHEN, kopf: ['zu', 0, 5], rumpf: ['normal', 0, 3], beinR: ['knie'], beinL: ['knie'] },
    { ...STEHEN, kopf: ['zu', -3, 7], rumpf: ['normal', -1, 4], armR: ['weg'], beinR: ['knie'], beinL: ['knie'] },
    liegen(LIEGEN, 1),
    liegen(LIEGEN, 0),
  ],
  hinten: [
    TREFFER_VORN[0] ?? LIEGEN,
    { ...STEHEN, kopf: ['zu', 0, 3], rumpf: ['normal', 0, 2], beinR: ['hocke'], beinL: ['hocke'] },
    { ...STEHEN, kopf: ['zu', 0, 5], rumpf: ['normal', 0, 3], beinR: ['knie'], beinL: ['knie'] },
    { ...STEHEN, kopf: ['zu', 3, 7], rumpf: ['normal', 1, 4], armR: ['weg'], beinR: ['knie'], beinL: ['knie'] },
    liegen(LIEGEN, 1),
    liegen(LIEGEN, 0),
  ],
  profil: [
    TREFFER_PROFIL[0] ?? LIEGEN,
    { ...STEHEN, kopf: ['zu', 1, 3], rumpf: ['normal', 0, 2], beinR: ['hocke'], beinL: ['hocke'] },
    { ...STEHEN, kopf: ['zu', 1, 5], rumpf: ['normal', 0, 3], beinR: ['knie'], beinL: ['knie'] },
    { ...STEHEN, kopf: ['zu', 3, 7], rumpf: ['normal', 1, 4], armR: ['vor'], armL: ['vor'], beinR: ['knie'], beinL: ['knie'] },
    liegen(LIEGEN, 1),
    liegen(LIEGEN, 0),
  ],
};

// ---------------------------------------------------------------------------------------------
// Sitzen – 2 Frames Atmung (Hände auf den Knien); Schlafen – 2 Frames Atmung im Liegen.
// ---------------------------------------------------------------------------------------------

const sit: Aktion = {
  name: 'sit',
  fps: 8,
  loop: true,
  folge: [0, 0, 0, 0, 1, 1, 1, 1],
  events: [],
  vorn: [
    { kopf: ['auf', 0, 2], rumpf: ['normal', 0, 2], armR: ['vor'], armL: ['vor'], beinR: ['sitz'], beinL: ['sitz'], folge: 'beineVorn' },
    { kopf: ['auf', 0, 3], rumpf: ['normal', 0, 2], armR: ['vor'], armL: ['vor'], beinR: ['sitz'], beinL: ['sitz'], folge: 'beineVorn' },
  ],
  hinten: [
    { ...STEHEN, kopf: ['auf', 0, 1], rumpf: ['normal', 0, 1] },
    { ...STEHEN, kopf: ['auf', 0, 2], rumpf: ['normal', 0, 1] },
  ],
  profil: [
    { kopf: ['auf', 0, 1], rumpf: ['normal', 0, 1], armR: ['vor'], armL: ['vor'], beinR: ['sitz'], beinL: ['sitz'] },
    { kopf: ['auf', 0, 2], rumpf: ['normal', 0, 1], armR: ['vor'], armL: ['vor'], beinR: ['sitz'], beinL: ['sitz'] },
  ],
};

const SCHLAF: Pose = { ...STEHEN, kopf: ['zu', 0, 0], rumpf: ['normal', 0, 0], armR: ['brust'] };
const SCHLAF_ATEM: Pose = { ...SCHLAF, rumpf: ['normal', 0, 1] };

const sleep: Aktion = {
  name: 'sleep',
  fps: 8,
  loop: true,
  folge: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1],
  events: [],
  vorn: [liegen(SCHLAF, 0), liegen(SCHLAF_ATEM, 0)],
  profil: [liegen(SCHLAF, 0), liegen(SCHLAF_ATEM, 0)],
};

// ---------------------------------------------------------------------------------------------
// Essen und Trinken – 4 Frames: Hand hebt an, Biss/Schluck (Kopf), Kauen bzw. Kopf in den Nacken.
// ---------------------------------------------------------------------------------------------

const eat: Aktion = {
  name: 'eat',
  fps: 8,
  loop: true,
  folge: [0, 1, 2, 3, 2, 3],
  events: [{ frame: 1, name: 'biss' }],
  vorn: [
    { ...STEHEN, armR: ['brust'] },
    { ...STEHEN, kopf: ['auf', 0, 1], armR: ['mund'] },
    { ...STEHEN, kopf: ['auf', 0, 0], armR: ['mund', 0, 1] },
    { ...STEHEN, kopf: ['auf', 0, 1], armR: ['mund', 0, 1] },
  ],
  hinten: [
    { ...STEHEN, armR: ['brust'], folge: 'armeHinten' },
    { ...STEHEN, kopf: ['auf', 0, 1], armR: ['mund'], folge: 'armeHinten' },
    { ...STEHEN, kopf: ['auf', 0, 0], armR: ['mund', 0, 1], folge: 'armeHinten' },
    { ...STEHEN, kopf: ['auf', 0, 1], armR: ['mund', 0, 1], folge: 'armeHinten' },
  ],
  profil: [
    { ...STEHEN, armR: ['brust'] },
    { ...STEHEN, kopf: ['auf', 0, 1], armR: ['mund'] },
    { ...STEHEN, kopf: ['auf', 0, 0], armR: ['mund', 0, 1] },
    { ...STEHEN, kopf: ['auf', 0, 1], armR: ['mund', 0, 1] },
  ],
};

const drink: Aktion = {
  name: 'drink',
  fps: 8,
  loop: true,
  folge: [0, 1, 2, 1, 2, 3],
  events: [{ frame: 2, name: 'schluck' }],
  vorn: [
    { ...STEHEN, armR: ['brust'] },
    { ...STEHEN, kopf: ['hoch', 0, 0], armR: ['mund', 0, -1] },
    { ...STEHEN, kopf: ['hoch', 0, -1], armR: ['mund', 0, -2] },
    { ...STEHEN, kopf: ['auf', 0, 1], armR: ['brust'] },
  ],
  hinten: [
    { ...STEHEN, armR: ['brust'], folge: 'armeHinten' },
    { ...STEHEN, kopf: ['hoch', 0, 0], armR: ['mund', 0, -1], folge: 'armeHinten' },
    { ...STEHEN, kopf: ['hoch', 0, -1], armR: ['mund', 0, -2], folge: 'armeHinten' },
    { ...STEHEN, kopf: ['auf', 0, 1], armR: ['brust'], folge: 'armeHinten' },
  ],
  profil: [
    { ...STEHEN, armR: ['brust'] },
    { ...STEHEN, kopf: ['hoch', 0, 0], armR: ['mund', 0, -1] },
    { ...STEHEN, kopf: ['hoch', 0, -1], armR: ['mund', 0, -2] },
    { ...STEHEN, kopf: ['auf', 0, 1], armR: ['brust'] },
  ],
};

// ---------------------------------------------------------------------------------------------
// Tragen – Last über dem Kopf (Sockel `last`): Stehen mit Atemwelle und Gehen.
// ---------------------------------------------------------------------------------------------

const carryIdle: Aktion = {
  name: 'carry_idle',
  fps: 8,
  loop: true,
  folge: WELLE_FOLGE,
  events: [],
  vorn: WELLE.map(([k, r]) => ({ ...STEHEN, ...TRAGEN, kopf: ['auf', 0, k], rumpf: ['normal', 0, r] })),
  profil: WELLE.map(([k, r]) => ({ ...STEHEN, ...TRAGEN, kopf: ['auf', 0, k], rumpf: ['normal', 0, r], folge: 'armeHinterKopf' })),
};

const carry: Aktion = {
  name: 'carry',
  fps: 10,
  loop: true,
  folge: [0, 1, 2, 3, 4, 5],
  events: SCHRITT_EVENTS,
  vorn: gangVorn([TRAGEN, TRAGEN, TRAGEN, TRAGEN, TRAGEN, TRAGEN]),
  profil: gangProfil([TRAGEN, TRAGEN, TRAGEN, TRAGEN, TRAGEN, TRAGEN], 'armeHinterKopf'),
};

// ---------------------------------------------------------------------------------------------
// Licht in der Nebenhand (§12.2): Varianten `<aktion>_licht`, in denen die linke Hand das Licht ruhig
// hält (die Fackel pendelt nicht mit dem Gang) – von vorn und hinten leicht vom Körper weg, damit die
// Flamme neben dem Kopf steht, im Profil mit nach vorn gestrecktem Unterarm, damit sie vor dem Gesicht
// und nicht hinter dem Kopf steht.
// ---------------------------------------------------------------------------------------------

/** Suffix der Licht-Varianten im Aktionsnamen. */
export const LICHT_SUFFIX = '_licht';

function mitLicht(a: Aktion): Aktion {
  const haltenVorn = (f: FrameDef): FrameDef => (istSonder(f) ? f : { ...f, armL: ['fackel'] });
  const haltenProfil = (f: FrameDef): FrameDef => (istSonder(f) ? f : { ...f, armL: ['fackel'] });
  return {
    ...a,
    name: `${a.name}${LICHT_SUFFIX}`,
    vorn: a.vorn.map(haltenVorn),
    ...(a.hinten === undefined ? {} : { hinten: a.hinten.map(haltenVorn) }),
    profil: a.profil.map(haltenProfil),
  };
}

/** Bewegung (M3-05; dazu Schleichen und Sprung für die Bewegungsarten aus §11.4 und M3-09). */
export const BEWEGUNG: readonly Aktion[] = [idle, walk, run, roll, swim, sneak, jump];
/** Aktionen (M3-06). */
export const AKTIONEN_M3_06: readonly Aktion[] = [tool, hit, death, sit, sleep, eat, drink, carry, carryIdle];
/** Licht-Varianten (M3-07): Aktionen, bei denen die Nebenhand ein Licht halten kann. */
export const MIT_LICHT: readonly Aktion[] = [idle, walk, run, sneak, tool, sit, eat, drink].map(mitLicht);
/** Alle Aktionen in Frame-Reihenfolge des Sprites. */
export const AKTIONEN: readonly Aktion[] = [...BEWEGUNG, ...AKTIONEN_M3_06, ...MIT_LICHT];
