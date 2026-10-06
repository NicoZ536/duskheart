/**
 * Der Borkenvater (MASTERPROMPT §20.2 Nr. 1 „verdorbener Uraltbaum … mehrteiliges Sprite 96–160 px“, §4.5; docs/SPIEL.md §22;
 * M7-33, Strang F): ein Uraltbaum, dessen Herz die Nacht vergiftet hat – gedrungener Stamm mit Gesicht (Brauenwulst, glühende
 * Augen, Maulspalte), zwei Astarme mit Wurzelfingern, eine weinrote Krone mit violett verdorbenen Schatten, Wurzeln, die weit in
 * die Arena greifen, und auf drei von ihnen die Knorren, die im Borkenpanzer (Phase 2) glühen.
 *
 * **Mehrteilig** (Render: src/render/game/bosses.ts):
 * - `boss_borkenvater` (128 × 142, Anker = Stammfuß `[64, 112]`): Körper mit allen Clips. Gebaut aus räumlichen Grundformen
 *   mit dem Kreatur-Renderer (`rendere`, assets-src/lib/creatureRender.ts) – Form-Schattierung nach Himmelsöffnung,
 *   Kontaktschatten zwischen Teilen, Kontur `nacht.1` –, so bleiben Proportion und Farbe in jedem Frame deckungsgleich.
 *   Die Knorren der Schwachstellen liegen genau auf den Versätzen des Contents (`schwachstellen` in
 *   src/content/bosses/borkenvater.ts: West (−26, 6), Ost (26, 4), Süd (2, 24) px vom Stammfuß).
 * - `boss_borkenvater_knoten` (16 × 16): die Glut eines Knorrens, pulsierend (Clip `glimmen`) – der Renderer legt sie in
 *   Phase 2 auf die drei Knorren, auch während der Angriffs-Clips (die Schwachstellen bleiben immer lesbar, §4.6).
 * - `boss_borkenvater_wurzel` (32 × 40): eine Wurzel, die aus dem Boden bricht (Clip `aus`) – längs der Rissspur eines
 *   Wurzelstoßes, im Ring des Stampfens und unter der Wurzelfaust.
 *
 * **Clips** des Körpers (≥ 8 eigene, Validator-Regel `boss`): `ruht` (schlafend: Augen dunkel, Krone hängt), `erwachen`,
 * `idle`, `wurzelstoss` (Arme hoch → in den Boden), `stampfen` (Stamm hebt sich und stampft), `beschwoeren` (Arme weit,
 * Maul glüht), `panzer` (Phase 2: Borkenplatten vor dem Gesicht, Arme verschränkt), `blaettersturm` (Krone peitscht, Laub
 * wirbelt), `raserei` (Phase 3: glühende Risse, Arme schlagen), `treffer`, `tod` (Krone welkt, der Baum sinkt; der letzte
 * Frame bleibt als toter Baum stehen).
 *
 * **Farben** (12 mit Kontur): Kontur `nacht.1`, Höhlen `nacht.0`; Borke `holz.0`–`holz.3`; Krone `laub.0` → `verderb.2` →
 * `laub.1` → `laub.2` (die Verderbnis sitzt in den Mitteltönen der Krone und als Adern im Stammfuß); Glut emissiv
 * `feuer.3*`/`feuer.4*` (Augen, Maul, Risse).
 */
import { Rng } from '../../../src/engine/rng';
import { rendere, normiere, kreuz, minus, plus, mal, type EllipsoidPrim, type KreaturMaterial, type Primitiv, type StempelPixel, type Szene, type TeilDef, type Trefferort, type V3 } from '../../lib/creatureRender';
import { sprite, spriteFromPixels, type PixelFrameInput, type Sprite } from '../../lib/sprite';

/** Kontaktbogen des Bosses (`tools/out/sheets/boss_borkenvater.png`). */
const GRUPPE = 'boss_borkenvater';
/** Zelle (eng um alle Frames, 1 px Luft) und Anker (Stammfuß) des Körpers. */
const ZELLE_B = 128;
const ZELLE_H = 142;
const ANKER: readonly [number, number] = [64, 112];
/** Kameraneigung der Szene (wie die Kreaturen von vorn). */
const NEIGUNG = 0.6;

/** Schwachstellen des Contents [Bildschirm-px vom Stammfuß] → Boden-Weltpunkte (y nach Norden: −dy / Neigung). */
const KNORREN: readonly (readonly [number, number])[] = [
  [-26, 6],
  [26, 4],
  [2, 24],
];
const knorrenWelt = (dx: number, dy: number): V3 => [dx, -dy / NEIGUNG, 3];

const MATERIALIEN: Readonly<Record<string, KreaturMaterial>> = {
  rinde: { stufen: ['holz.0', 'holz.1', 'holz.2', 'holz.3'], schwellen: [0.34, 0.54, 0.76] },
  furche: { stufen: ['holz.0', 'holz.1'], schwellen: [0.62] },
  ader: { stufen: ['laub.0', 'verderb.2'], schwellen: [0.5] },
  laub: { stufen: ['laub.0', 'verderb.2', 'laub.1', 'laub.2'], schwellen: [0.4, 0.58, 0.8] },
  laubTief: { stufen: ['laub.0', 'verderb.2', 'laub.1'], schwellen: [0.52, 0.76] },
  welk: { stufen: ['laub.0', 'verderb.2', 'holz.1'], schwellen: [0.42, 0.62] },
  welkTief: { stufen: ['laub.0', 'verderb.2'], schwellen: [0.6] },
  hoehle: { stufen: ['nacht.0'] },
  glut: { stufen: ['feuer.3*', 'feuer.4*'], schwellen: [0.55] },
  knorren: { stufen: ['holz.0', 'holz.1', 'holz.2', 'holz.3'], schwellen: [0.3, 0.46, 0.66] },
  blatt: { stufen: ['laub.1', 'laub.2'] },
};

const TEILE: readonly TeilDef[] = [
  { name: 'wurzel', material: 'rinde', gruppe: 'wurzel' },
  { name: 'knorren', material: 'knorren', gruppe: 'knorren' },
  { name: 'stamm', material: 'rinde', gruppe: 'stamm' },
  { name: 'braue', material: 'rinde', gruppe: 'braue' },
  { name: 'hoehle', material: 'hoehle', gruppe: 'hoehle' },
  { name: 'glut', material: 'glut', gruppe: 'hoehle' },
  { name: 'arm', material: 'rinde', gruppe: 'arm' },
  { name: 'finger', material: 'rinde', gruppe: 'arm' },
  { name: 'panzer', material: 'rinde', gruppe: 'panzer' },
  { name: 'krone', material: 'laubTief', gruppe: 'krone' },
  { name: 'buendel', material: 'laub', gruppe: 'buendel' },
  { name: 'kroneWelk', material: 'welkTief', gruppe: 'krone' },
  { name: 'buendelWelk', material: 'welk', gruppe: 'buendel' },
  { name: 'zweig', material: 'rinde', gruppe: 'zweig' },
  { name: 'blatt', material: 'blatt', gruppe: 'blatt' },
];
const T = Object.fromEntries(TEILE.map((t, i) => [t.name, i])) as Record<string, number>;
const teil = (name: string): number => {
  const i = T[name];
  if (i === undefined) throw new Error(`Borkenvater: Teil ${name} fehlt`);
  return i;
};

/** Arm eines Frames: Ellbogen und Hand (rechter Arm; der linke gespiegelt, wenn nicht eigens angegeben). */
interface ArmPose {
  readonly e: V3;
  readonly h: V3;
}

/** Pose eines Frames. */
interface Pose {
  /** 0 schlafend (Augen dunkel) … 1 wach (Augen glühen). */
  readonly wach: number;
  /** Hub des Stammes [px] (die Wurzeln bleiben im Boden). */
  readonly hub: number;
  /** Neigung nach vorn [px Versatz der Stammspitze nach Süden]; negativ = zurück. */
  readonly lehne: number;
  /** Seitliches Schwanken der Stammspitze [px]. */
  readonly schwank: number;
  /** Versatz der Krone [px] (x, z) – Zittern, Peitschen, Sacken. */
  readonly kroneX: number;
  readonly kroneZ: number;
  /** Maul 0 zu … 1 weit; ab 0,5 glüht es innen (wach). */
  readonly mund: number;
  /** Borkenpanzer 0 … 1: Platten vor dem Gesicht. */
  readonly panzer: number;
  /** Glühende Risse 0 … 1 (Raserei). */
  readonly risse: number;
  /** Welken 0 … 1 (Tod): die Krone schrumpft und sackt, Farben ins Braune. */
  readonly welk: number;
  /** Blättersturm: Anzahl wirbelnder Blätter und ihre Phase (0 … 1). */
  readonly blaetter: number;
  readonly wirbel: number;
  readonly armR: ArmPose;
  readonly armL?: ArmPose;
}

const RUHE_ARM: ArmPose = { e: [31, -5, 42], h: [41, -13, 24] };
const POSE: Pose = { wach: 1, hub: 0, lehne: 0, schwank: 0, kroneX: 0, kroneZ: 0, mund: 0.25, panzer: 0, risse: 0, welk: 0, blaetter: 0, wirbel: 0, armR: RUHE_ARM };
const p = (o: Partial<Pose>): Pose => ({ ...POSE, ...o });

// ---------------------------------------------------------------------------------------------
// Grundformen
// ---------------------------------------------------------------------------------------------

/** Achsparalleles Ellipsoid. */
function ell(t: string, mitte: V3, r: V3, extra: Partial<EllipsoidPrim> = {}): EllipsoidPrim {
  return {
    art: 'ellipsoid',
    teil: teil(t),
    mitte,
    matrix: [
      [r[0], 0, 0],
      [0, r[1], 0],
      [0, 0, r[2]],
    ],
    ...extra,
  };
}

/** Gestrecktes Ellipsoid von `a` nach `b` mit Radius `r` quer dazu (Ast, Wurzel, Arm). */
function stab(t: string, a: V3, b: V3, r: number, extra: Partial<EllipsoidPrim> = {}): EllipsoidPrim {
  const u = mal(minus(b, a), 0.5);
  const lang = Math.hypot(u[0], u[1], u[2]);
  const achse: V3 = lang < 1e-6 ? [1, 0, 0] : u;
  const hilf: V3 = Math.abs(achse[2]) / Math.max(lang, 1e-6) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const v = mal(normiere(kreuz(achse, hilf)), r);
  const w = mal(normiere(kreuz(achse, v)), r);
  // Die Hauptachse um den Radius verlängert: die Enden runden über die Gelenkpunkte hinaus (keine Lücke am Gelenk).
  const voll = mal(normiere(achse), lang + r * 0.6);
  return { art: 'ellipsoid', teil: teil(t), mitte: mal(plus(a, b), 0.5), matrix: [voll, v, w], ...extra };
}

/** Fester Stempel aus einem Material (Augen, Blätter). */
function stempel(material: string, pixel: readonly (readonly [number, number, number])[]): StempelPixel[] {
  return pixel.map(([dx, dy, stufe]) => ({ dx, dy, material, stufe }));
}

/** Glutauge, schräg (innen tiefer: der Blick ist böse); `nachAussen` spiegelt es für das linke Auge. */
const AUGE = stempel('glut', [
  [0, 0, 1],
  [1, 0, 0],
  [-1, 1, 0],
  [0, 1, 1],
]);
const AUGE_SCHLITZ = stempel('glut', [
  [-1, 0, 0],
  [0, 0, 1],
  [1, 0, 0],
]);
const BLATT = stempel('blatt', [
  [0, 0, 1],
  [1, 0, 1],
  [-1, 1, 0],
  [0, 1, 0],
]);

// ---------------------------------------------------------------------------------------------
// Szene je Pose
// ---------------------------------------------------------------------------------------------

/** Wurzeln: Weg vom Stamm hinaus (Weltpunkte am Boden); die drei ersten tragen die Knorren. */
const WURZELN: readonly (readonly V3[])[] = [
  [[-12, -3, 5], knorrenWelt(...(KNORREN[0] as [number, number])), [-44, -12, 1]],
  [[12, -2, 5], knorrenWelt(...(KNORREN[1] as [number, number])), [45, -9, 1]],
  [[1, -12, 5], knorrenWelt(...(KNORREN[2] as [number, number]))],
  [[-10, -9, 5], [-24, -26, 2], [-33, -38, 1]],
  [[10, -9, 5], [24, -24, 2], [34, -33, 1]],
  [[-13, 6, 5], [-30, 14, 2], [-44, 20, 1]],
  [[13, 6, 5], [31, 15, 2], [44, 19, 1]],
];

/**
 * Stamm (Mitte, Radien): ein hoher Leib vom Wurzelanlauf bis unter die Krone, darunter der breite Anlauf, oben der Hals in
 * die Krone – wenige große Formen, damit die Schattierung senkrecht weich durchläuft (keine gestapelten Scheiben).
 */
const STAMM: readonly (readonly [V3, V3])[] = [
  [
    [0, 2, 8],
    [23, 19, 9],
  ],
  [
    [0, 3, 30],
    [16.5, 13.5, 28],
  ],
  [
    [0, 4, 54],
    [12.5, 10.5, 10],
  ],
];

/** Blattmassen der Krone (Mitte relativ zur Kronenbasis, Radien). */
const KRONE: readonly (readonly [V3, V3])[] = [
  [
    [0, 8, 14],
    [25, 16, 15],
  ],
  [
    [-25, 6, 8],
    [17, 13, 13],
  ],
  [
    [25, 6, 8],
    [17, 13, 13],
  ],
  [
    [-11, 13, 22],
    [16, 11, 11],
  ],
  [
    [12, 13, 22],
    [16, 11, 11],
  ],
  [
    [-41, 2, -2],
    [11, 9, 9],
  ],
  [
    [41, 2, -2],
    [11, 9, 9],
  ],
];
/** Kronenbasis über dem Fuß [px]. */
const KRONE_BASIS = 55;

/** Rindenzeichnung: Furchen um den Stamm, verdorbene Adern unten, glühende Risse in der Raserei. */
function zeichnung(pose: Pose): (ort: Trefferort) => string | null {
  return (ort) => {
    if (ort.teil !== 'stamm' && ort.teil !== 'arm' && ort.teil !== 'wurzel') return null;
    const [q0, q1, q2] = ort.lokal;
    if (ort.teil === 'wurzel') return ort.hoehe < 2.2 && Math.abs(q1) < 0.4 ? 'ader' : null;
    if (ort.teil === 'arm') return Math.abs(q1 + 0.25 * Math.sin(q0 * 5)) < 0.12 ? 'furche' : null;
    // Winkel um die Stammachse (0 = vorn) und eine gewundene Furchenlage.
    const winkel = Math.atan2(q1, -q0 === 0 ? 1e-6 : q0);
    const lage = (winkel / (2 * Math.PI)) * 11 + 0.18 * Math.sin(q2 * 4.2 + winkel * 2) + ort.hoehe * 0.01;
    const band = lage - Math.floor(lage);
    const furche = band < 0.2;
    // Risse der Raserei: jede dritte Furche reißt auf und glüht, zuerst unten am Stamm.
    if (furche && pose.risse > 0 && Math.floor(lage) % 3 === 0 && ort.hoehe < 18 + 44 * pose.risse) return 'glut';
    // Die Verderbnis kriecht aus den Wurzeln in den Stammfuß.
    if (furche && ort.hoehe < 16) return 'ader';
    return furche ? 'furche' : null;
  };
}

function szene(pose: Pose): Szene {
  const prim: Primitiv[] = [];
  // Versatz eines Stammpunkts nach Höhe: Hub, Lehnen, Schwanken (Wurzeln bleiben).
  const fall = (z: number): V3 => {
    const f = Math.max(0, Math.min(1.4, z / 60));
    return [pose.schwank * f, -pose.lehne * f, pose.hub * Math.min(1, z / 12)];
  };
  const amStamm = (q: V3): V3 => plus(q, fall(q[2]));

  // Wurzeln und Knorren.
  for (const w of WURZELN) {
    for (let i = 0; i + 1 < w.length; i++) {
      const a = w[i] as V3;
      const b = w[i + 1] as V3;
      prim.push(stab('wurzel', i === 0 ? amStamm(a) : a, b, i === 0 ? 5.5 : 3.2));
    }
  }
  for (const [dx, dy] of KNORREN) {
    const k = knorrenWelt(dx, dy);
    prim.push(ell('knorren', [k[0], k[1], 3.5], [6.5, 5.5, 5]));
    // Die Mulde des Knorrens: hier sitzt in Phase 2 die Glut (`boss_borkenvater_knoten`).
    prim.push(ell('hoehle', [k[0], k[1] - 2.5, 5.8], [2.6, 1.2, 1.8], { tiefenVersatz: -0.6 }));
  }

  // Stamm.
  for (const [m, r] of STAMM) prim.push(ell('stamm', amStamm(m), r));

  // Gesicht: Augenhöhlen, Brauenwulst, Augen, Maul.
  const gesicht = (q: V3): V3 => amStamm(q);
  const panzer = pose.panzer;
  for (const s of [-1, 1]) {
    prim.push(ell('hoehle', gesicht([6.5 * s, -7.6, 41]), [3.6, 1.6, 2.6 - panzer * 1.2], { tiefenVersatz: -0.6 }));
    prim.push(stab('braue', gesicht([12 * s, -6.6, 47.5]), gesicht([2.5 * s, -9.6, 44.2 + panzer]), 2.4));
    if (pose.wach > 0.5) {
      prim.push({ art: 'punkt', teil: teil('glut'), ort: gesicht([6.5 * s, -9.4, 41]), normale: null, stempel: panzer > 0.5 ? AUGE_SCHLITZ : AUGE, nachAussen: true, obenauf: true });
    }
  }
  const mund = pose.mund;
  prim.push(ell('hoehle', gesicht([0, -11.6, 27]), [6.5 + mund * 1.5, 1.6, 1.3 + mund * 2.2], { tiefenVersatz: -0.6 }));
  if (mund >= 0.5 && pose.wach > 0.5) prim.push(ell('glut', gesicht([0, -12.4, 27 - mund * 0.5]), [3.6 + mund, 0.8, 0.6 + mund * 1.1], { tiefenVersatz: -1.2 }));

  // Borkenpanzer: Platten legen sich schuppig über Brust und Stirn.
  if (panzer > 0) {
    const vor = -2 + panzer * 3;
    prim.push(ell('panzer', gesicht([-8, -11 - vor, 33]), [8, 3, 9 * panzer]));
    prim.push(ell('panzer', gesicht([8, -11 - vor, 33]), [8, 3, 9 * panzer]));
    prim.push(ell('panzer', gesicht([0, -10 - vor, 50]), [11, 3, 5 * panzer]));
  }

  // Arme mit Wurzelfingern.
  for (const s of [-1, 1]) {
    const arm = s > 0 ? pose.armR : (pose.armL ?? { e: [-pose.armR.e[0], pose.armR.e[1], pose.armR.e[2]], h: [-pose.armR.h[0], pose.armR.h[1], pose.armR.h[2]] });
    const schulter = amStamm([14 * s, 0, 47]);
    const e = plus(arm.e, [0, 0, pose.hub * 0.7]);
    const h = plus(arm.h, [0, 0, pose.hub * 0.5]);
    prim.push(stab('arm', schulter, e, 5.2));
    prim.push(stab('arm', e, h, 4.1));
    prim.push(ell('arm', h, [4.6, 4.2, 4.2]));
    // Drei Finger in Verlängerung des Unterarms, gefächert.
    const richtung = normiere(minus(h, e));
    const quer = normiere(kreuz(richtung, [0, 0, 1]));
    for (const f of [-1, 0, 1]) {
      const spitze = plus(plus(h, mal(richtung, 9 - Math.abs(f) * 2)), mal(quer, f * 4.5));
      prim.push({ art: 'linie', teil: teil('finger'), von: plus(h, mal(quer, f * 1.5)), bis: spitze, breite: 2, stufe: 1 });
    }
  }

  // Krone.
  const welk = pose.welk;
  // Welk (Tod) wechseln Massen und Bündel in die braunen Rampen.
  const massenTeil = welk > 0.5 ? 'kroneWelk' : 'krone';
  const buendelTeil = welk > 0.5 ? 'buendelWelk' : 'buendel';
  const basis = amStamm([pose.kroneX, 0, KRONE_BASIS + pose.kroneZ - welk * 10]);
  KRONE.forEach(([m, r], i) => {
    // Welkend schrumpfen erst die äußeren Massen.
    const schrumpf = 1 - welk * (i >= 5 ? 0.9 : i >= 3 ? 0.55 : 0.3);
    if (schrumpf < 0.2) return;
    const zitter = i % 2 === 0 ? pose.kroneX * 0.4 : -pose.kroneX * 0.3;
    prim.push(ell(massenTeil, plus(basis, [m[0] * (1 - welk * 0.15) + zitter, m[1], m[2] * (1 - welk * 0.4)]), [r[0] * schrumpf, r[1] * schrumpf, r[2] * schrumpf]));
  });

  // Blattbündel auf den Oberseiten der Massen (die Kontaktschatten zwischen ihnen geben dem Laub Struktur) und tote
  // Zweigspitzen, die aus der Krone stechen.
  const bRng = new Rng(9137);
  KRONE.forEach(([m, r], i) => {
    const schrumpf = 1 - welk * (i >= 5 ? 0.9 : i >= 3 ? 0.55 : 0.3);
    if (schrumpf < 0.35) return;
    const zitter = i % 2 === 0 ? pose.kroneX * 0.4 : -pose.kroneX * 0.3;
    const mitte = plus(basis, [m[0] * (1 - welk * 0.15) + zitter, m[1], m[2] * (1 - welk * 0.4)]);
    const anzahl = Math.round((r[0] * r[1]) / 18);
    for (let k = 0; k < anzahl; k++) {
      const a = bRng.float(0, 2 * Math.PI);
      const hoch = bRng.float(-0.15, 0.85);
      const quer = Math.sqrt(1 - hoch * hoch);
      const dir: V3 = [Math.cos(a) * quer, Math.sin(a) * quer, hoch];
      const rb = bRng.float(5.4, 7.8) * schrumpf;
      prim.push(ell(buendelTeil, plus(mitte, [dir[0] * r[0] * schrumpf * 0.86, dir[1] * r[1] * schrumpf * 0.86, dir[2] * r[2] * schrumpf * 0.86]), [rb, rb * 0.9, rb * 0.8]));
    }
  });
  const ZWEIGE: readonly (readonly [V3, V3])[] = [
    [[-30, 6, 14], [-48, 4, 28]],
    [[31, 6, 13], [49, 6, 25]],
    [[-6, 12, 26], [-11, 14, 37]],
    [[44, 2, 0], [57, 0, 6]],
  ];
  if (welk < 0.9)
    for (const [a, b] of ZWEIGE) {
      const von = plus(basis, a);
      const bis = plus(basis, mal(b, 1 - welk * 0.3));
      const knick = plus(mal(plus(von, bis), 0.5), [0, 0, 2]);
      prim.push({ art: 'linie', teil: teil('zweig'), von, bis: knick, breite: 3, stufe: 1 });
      prim.push({ art: 'linie', teil: teil('zweig'), von: knick, bis, breite: 2, stufe: 1 });
    }

  // Blättersturm: Blätter auf einer Spirale um die Krone, gedreht mit `wirbel`.
  const rng = new Rng(4711);
  for (let i = 0; i < Math.round(pose.blaetter * 22); i++) {
    const a = rng.float(0, 2 * Math.PI) + pose.wirbel * 2 * Math.PI * (i % 2 === 0 ? 1 : 0.7);
    const rad = rng.float(36, 62);
    const z = rng.float(30, 92) + Math.sin(a * 2) * 4;
    prim.push({ art: 'punkt', teil: teil('blatt'), ort: [Math.cos(a) * rad, Math.sin(a) * rad * 0.5 - 6, z], normale: null, stempel: BLATT, obenauf: true });
  }

  return { teile: TEILE, materialien: MATERIALIEN, primitive: prim, zeichnung: zeichnung(pose), hoeheBezug: 70, neigung: NEIGUNG };
}

// ---------------------------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------------------------

/** Arm-Posen. */
const ARM = {
  haengend: { e: [27, -3, 37], h: [35, -8, 14] },
  ruhe: RUHE_ARM,
  atmen: { e: [31, -5, 43], h: [41, -12, 26] },
  hoch: { e: [36, -8, 56], h: [51, -14, 66] },
  hochZurueck: { e: [37, -6, 59], h: [54, -10, 73] },
  boden: { e: [26, -15, 38], h: [30, -30, 3] },
  ziehen: { e: [29, -10, 40], h: [37, -20, 12] },
  weit: { e: [37, -3, 50], h: [53, -6, 54] },
  weitHoch: { e: [36, -2, 56], h: [52, -4, 68] },
  verschraenkt: { e: [19, -19, 40], h: [-5, -22, 33] },
  schlagHoch: { e: [32, -4, 60], h: [44, -10, 72] },
  schlagTief: { e: [33, -10, 36], h: [45, -22, 14] },
} as const satisfies Record<string, ArmPose>;
const links = (a: ArmPose): ArmPose => ({ e: [-a.e[0], a.e[1], a.e[2]], h: [-a.h[0], a.h[1], a.h[2]] });

interface ClipPlan {
  readonly name: string;
  readonly posen: readonly Pose[];
  /** Abspielfolge (Pose-Indizes); Standard 0 … n − 1. */
  readonly folge?: readonly number[];
  readonly fps: number;
  readonly loop: boolean;
  readonly events?: readonly { readonly frame: number; readonly name: string }[];
}

const SCHLAF = p({ wach: 0, mund: 0, lehne: 2, kroneZ: -3, armR: ARM.haengend });

const CLIPS: readonly ClipPlan[] = [
  { name: 'ruht', posen: [SCHLAF, p({ ...SCHLAF, kroneX: 1, kroneZ: -2 })], fps: 1.5, loop: true },
  {
    name: 'erwachen',
    posen: [
      SCHLAF,
      p({ wach: 1, mund: 0, lehne: 1, kroneZ: -2, armR: ARM.haengend }),
      p({ wach: 1, mund: 0.4, lehne: 0, kroneZ: 0, armR: ARM.ruhe }),
      p({ wach: 1, mund: 1, lehne: -3, kroneZ: 3, armR: ARM.weitHoch }),
      p({ wach: 1, mund: 1, lehne: -3, kroneZ: 3, kroneX: 1, armR: ARM.weitHoch }),
      p({ wach: 1, mund: 0.5, lehne: -1, kroneZ: 1, armR: ARM.weit }),
    ],
    folge: [0, 1, 2, 3, 4, 3, 5],
    fps: 5,
    loop: false,
    events: [{ frame: 3, name: 'brueller' }],
  },
  {
    name: 'idle',
    posen: [p({}), p({ hub: 1, kroneZ: 1, armR: ARM.atmen }), p({ hub: 1, kroneZ: 2, kroneX: 1, armR: ARM.atmen })],
    folge: [0, 1, 2, 1],
    fps: 3,
    loop: true,
  },
  {
    name: 'wurzelstoss',
    posen: [
      p({ lehne: -2, kroneZ: 1, armR: ARM.hoch, mund: 0.5 }),
      p({ lehne: -3, kroneZ: 2, kroneX: -1, armR: ARM.hochZurueck, mund: 0.8 }),
      p({ lehne: 6, hub: -2, kroneZ: -2, armR: ARM.boden, mund: 1 }),
      p({ lehne: 5, hub: -1, kroneZ: -1, kroneX: 1, armR: ARM.boden, mund: 0.6 }),
      p({ lehne: 2, armR: ARM.ziehen, mund: 0.3 }),
    ],
    fps: 6,
    loop: false,
    events: [{ frame: 2, name: 'schlag' }],
  },
  {
    name: 'stampfen',
    posen: [
      p({ hub: 3, kroneZ: 1, armR: ARM.weit }),
      p({ hub: 6, kroneZ: 2, armR: ARM.weitHoch, mund: 0.6 }),
      p({ hub: -2, kroneZ: -3, armR: ARM.schlagTief, mund: 1 }),
      p({ hub: 0, kroneZ: 1, kroneX: -1, armR: ARM.ruhe }),
    ],
    fps: 7,
    loop: false,
    events: [{ frame: 2, name: 'schlag' }],
  },
  {
    name: 'beschwoeren',
    posen: [
      p({ armR: ARM.weit, mund: 0.6, kroneZ: 1 }),
      p({ armR: ARM.weitHoch, mund: 1, kroneZ: 2, lehne: -2 }),
      p({ armR: ARM.weitHoch, mund: 1, kroneZ: 2, kroneX: 1, lehne: -2 }),
      p({ armR: ARM.weitHoch, mund: 1, kroneZ: 2, kroneX: -1, lehne: -2 }),
      p({ armR: ARM.weit, mund: 0.5 }),
    ],
    fps: 6,
    loop: false,
    events: [{ frame: 2, name: 'ruf' }],
  },
  {
    name: 'panzer',
    posen: [p({ panzer: 1, mund: 0, armR: ARM.verschraenkt, armL: links(ARM.verschraenkt), lehne: 1 }), p({ panzer: 1, mund: 0, hub: 1, kroneZ: 1, armR: ARM.verschraenkt, armL: links(ARM.verschraenkt), lehne: 1 })],
    fps: 2.5,
    loop: true,
  },
  {
    name: 'blaettersturm',
    posen: [
      p({ armR: ARM.weitHoch, kroneX: -3, mund: 0.8, blaetter: 0.5, wirbel: 0 }),
      p({ armR: ARM.weitHoch, kroneX: 3, mund: 1, blaetter: 1, wirbel: 0.25 }),
      p({ armR: ARM.weitHoch, kroneX: -3, mund: 1, blaetter: 1, wirbel: 0.5 }),
      p({ armR: ARM.weit, kroneX: 2, mund: 0.6, blaetter: 0.7, wirbel: 0.75 }),
    ],
    // Die Krone peitscht hin und her (gehaltene Phase), dann sinken die Arme.
    folge: [0, 1, 2, 1, 2, 3],
    fps: 8,
    loop: false,
    events: [{ frame: 2, name: 'sturm' }],
  },
  {
    name: 'raserei',
    posen: [
      p({ risse: 1, mund: 1, hub: 1, armR: ARM.schlagHoch, armL: links(ARM.schlagTief), schwank: 2 }),
      p({ risse: 1, mund: 1, hub: 0, armR: ARM.ruhe, armL: links(ARM.ruhe), kroneX: 1 }),
      p({ risse: 1, mund: 1, hub: 1, armR: ARM.schlagTief, armL: links(ARM.schlagHoch), schwank: -2 }),
      p({ risse: 1, mund: 1, hub: 0, armR: ARM.ruhe, armL: links(ARM.ruhe), kroneX: -1 }),
    ],
    fps: 7,
    loop: true,
  },
  {
    name: 'treffer',
    posen: [p({ lehne: -4, kroneX: 2, mund: 0.7 }), p({ lehne: -1, kroneX: -1, mund: 0.4 })],
    fps: 10,
    loop: false,
  },
  {
    name: 'tod',
    posen: [
      p({ lehne: -4, mund: 1, kroneZ: 2, armR: ARM.weitHoch }),
      p({ lehne: -3, mund: 1, risse: 1, kroneZ: 1, armR: ARM.weit }),
      p({ lehne: 3, mund: 0.6, risse: 0.6, welk: 0.35, hub: -1, armR: ARM.ziehen }),
      p({ wach: 0, lehne: 6, mund: 0.3, welk: 0.7, hub: -2, armR: ARM.haengend }),
      p({ wach: 0, lehne: 8, mund: 0, welk: 1, hub: -3, armR: { e: [27, -8, 30], h: [36, -16, 4] } }),
    ],
    fps: 4,
    loop: false,
    events: [{ frame: 4, name: 'fall' }],
  },
];

// ---------------------------------------------------------------------------------------------
// Aufbau
// ---------------------------------------------------------------------------------------------

function schluessel(r: { index: Uint8Array; emissiv: Uint8Array }): string {
  return `${Buffer.from(r.index).toString('base64')}|${Buffer.from(r.emissiv).toString('base64')}`;
}

function koerper(): Sprite {
  const frames: PixelFrameInput[] = [];
  const nach = new Map<string, number>();
  const clips: Record<string, { frames: number[]; fps: number; loop: boolean; events: { frame: number; name: string }[] }> = {};
  for (const c of CLIPS) {
    const bilder = c.posen.map((pose) => {
      const r = rendere(szene(pose), { w: ZELLE_B, h: ZELLE_H, anker: ANKER, kontur: 'nacht.1' });
      const k = schluessel(r);
      const da = nach.get(k);
      if (da !== undefined) return da;
      frames.push({ index: r.index, emissive: r.emissiv });
      nach.set(k, frames.length - 1);
      return frames.length - 1;
    });
    const folge = (c.folge ?? c.posen.map((_, i) => i)).map((i) => {
      const f = bilder[i];
      if (f === undefined) throw new Error(`Borkenvater: Clip ${c.name} nennt Pose ${i}`);
      return f;
    });
    clips[c.name] = { frames: folge, fps: c.fps, loop: c.loop, events: (c.events ?? []).map((e) => ({ ...e })) };
  }
  return spriteFromPixels(
    {
      id: 'boss_borkenvater',
      group: GRUPPE,
      size: [ZELLE_B, ZELLE_H],
      anchor: [ANKER[0], ANKER[1]],
      hoehe: 'kugel',
      clips,
      // Trefferfläche = Stamm (die Arme und die Krone schlagen, sie werden nicht getroffen).
      hitbox: [ANKER[0] - 20, ANKER[1] - 56, 40, 60],
      sockets: { knoten_west: [[ANKER[0] - 26, ANKER[1] + 6]], knoten_ost: [[ANKER[0] + 26, ANKER[1] + 4]], knoten_sued: [[ANKER[0] + 2, ANKER[1] + 24]] },
      occluder: { kind: 'ellipse', x: ANKER[0], y: ANKER[1] - 4, rx: 22, ry: 10 },
      schatten: 'silhouette',
      // Links und rechts sind nicht gleich: die Raserei schlägt mit verschiedenen Armen, die Knorren liegen ungleich.
      spiegelbar: false,
      einzelpixel: 'Glutaugen und wirbelnde Blätter sind gewollte kleine Stempel',
    },
    frames,
  );
}

/** Glut eines Knorrens (Phase 2): pulsierend, 16 × 16, Anker in der Mulde. */
const KNOTEN = sprite({
  id: 'boss_borkenvater_knoten',
  group: GRUPPE,
  size: [16, 16],
  anchor: [8, 9],
  hoehe: 'flach',
  legende: { '.': null, r: 'feuer.1*', f: 'feuer.2*', F: 'feuer.3*', y: 'feuer.4*', W: 'feuer.5*' },
  frames: [
    `................
     ................
     ................
     ................
     ................
     ......ffff......
     .....fFFFFf.....
     ....fFyyyyFf....
     ....fFyWWyFf....
     ....fFyyyyFf....
     .....fFFFFf.....
     ......ffff......
     ................
     ................
     ................
     ................`,
    `................
     ................
     ................
     ................
     ......rrrr......
     .....rffffr.....
     ....rfFFFFfr....
     ...rfFyyyyFfr...
     ...rfFyWWyFfr...
     ...rfFyyyyFfr...
     ....rfFFFFfr....
     .....rffffr.....
     ......rrrr......
     ................
     ................
     ................`,
    `................
     ................
     ................
     ......rrrr......
     ....rrffffrr....
     ...rfFFFFFFfr...
     ...rFFyyyyFFr...
     ..rfFyyWWyyFfr..
     ..rfFyWWWWyFfr..
     ..rfFyyWWyyFfr..
     ...rFFyyyyFFr...
     ...rfFFFFFFfr...
     ....rrffffrr....
     ......rrrr......
     ................
     ................`,
  ],
  clips: { glimmen: { frames: [0, 1, 2, 2, 1, 0], fps: 6, loop: true } },
  schatten: 'none',
  occluder: { kind: 'none' },
  spiegelbar: true,
});

/** Eine Wurzel bricht aus dem Boden: Erdscholle, Spitze, ganz heraus, sinkt zurück. */
const WURZEL_SZENE = (hoehe: number, krumm: number, scholle: number): Szene => {
  const prim: Primitiv[] = [];
  if (scholle > 0) {
    prim.push(ell('knorren', [-7, -2, 0.5], [5 * scholle, 3, 2 * scholle]));
    prim.push(ell('knorren', [7, -1, 0.5], [5 * scholle, 3, 2 * scholle]));
  }
  if (hoehe > 0) {
    const mitte: V3 = [krumm * 0.6, -1, hoehe * 0.55];
    const spitze: V3 = [krumm, -2, hoehe];
    prim.push(stab('wurzel', [0, 0, -2], mitte, 4.4));
    prim.push(stab('wurzel', mitte, spitze, 2.8));
  }
  return { teile: TEILE, materialien: MATERIALIEN, primitive: prim, zeichnung: (ort) => (ort.teil === 'wurzel' && Math.abs(ort.lokal[1]) < 0.3 ? 'furche' : null), hoeheBezug: 24, neigung: NEIGUNG };
};

function wurzelAusbruch(): Sprite {
  const w = 32;
  const h = 40;
  const anker: readonly [number, number] = [16, 36];
  const phasen = [
    [0, 0, 1],
    [10, 2, 1.2],
    [24, 4, 1.2],
    [30, 3, 1.1],
    [18, 2, 1],
    [6, 1, 0.8],
  ] as const;
  const frames = phasen.map(([hoehe, krumm, scholle]) => {
    const r = rendere(WURZEL_SZENE(hoehe, krumm, scholle), { w, h, anker, kontur: 'nacht.1' });
    return { index: r.index, emissive: r.emissiv };
  });
  return spriteFromPixels(
    {
      id: 'boss_borkenvater_wurzel',
      group: GRUPPE,
      size: [w, h],
      anchor: [anker[0], anker[1]],
      hoehe: 'zylinder',
      clips: { aus: { frames: [0, 1, 2, 3, 3, 4, 5], fps: 12, loop: false, events: [{ frame: 2, name: 'treffer' }] } },
      schatten: 'silhouette',
      occluder: { kind: 'none' },
      spiegelbar: true,
    },
    frames,
  );
}

export default [koerper(), KNOTEN, wurzelAusbruch()];
