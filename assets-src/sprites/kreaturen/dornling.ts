/**
 * Dornling (Grünhain, Gegner, getarnt; MASTERPROMPT §20.1, docs/ART.md §15): 32×32, getarnt ein runder
 * Beerenbusch in Grünhain-Laubfarben mit Kontur `gras.0` (wie `busch_beeren`); enthüllt eine dunkle Höhle
 * mit glühenden Augen (`feuer.4*`), Wurzelbeine und aufgestellte Dornen. Clips zusätzlich `tarnung`
 * (Busch im Wind) und `erwachen` (Enthüllen). Angriffe: `peitsche` (Dornenranke schnellt vor) und
 * `ueberfall` (aus der Tarnung: Busch bebt, die Dornen sträuben sich, die Augen öffnen sich – von hinten lugen sie über
 * die Krone –, springt vor, reißt das Maul auf).
 */
import { kreatur, type Bauplan } from '../../lib/creature';
import { angriffClip, idleClip, klip, pose, todClip, trefferClip, zyklusClip, type Werte } from '../../lib/creatureAnim';
import { type Bau, KOERPER } from '../../lib/creatureBau';
import { busch } from '../../lib/creatureBusch';
import type { V3 } from '../../lib/creatureRender';
import { zeige } from '../../lib/creatureVierbeiner';

const MASSEN = [
  { f: 0, s: 0, u: 9, r: [5.6, 5.6, 4.6] },
  { f: -2.2, s: -3.6, u: 6.6, r: [4, 4, 3.6] },
  { f: -2.2, s: 3.6, u: 6.6, r: [4, 4, 3.6] },
  { f: 2.4, s: 0, u: 6.4, r: [4.2, 5, 3.8] },
] as const;

/**
 * Dornen (M6-Gate, `kreaturen-gruenhain-lauer`): die zufällig gesäten Dornen des Busch-Bauplans liefen gesträubt teils
 * parallel nebeneinander und verschmolzen rechts zu einem dunkelroten 4 × 3-Block. Jetzt stehen 14 Dornen an festen,
 * gleichmäßig verteilten Orten (Masse, Azimut in Grad – 0 vorn, 90 rechts –, Höhe auf der Masse −1…1), gesträubt mindestens
 * 60° auseinander, keiner vor dem Augenspalt der Krone, und laufen spitz zu: innen dunkel (`laub.0`), die äußere Hälfte rot (`laub.2`, wie die Beeren – die
 * 12 Farben des Sprites sind ausgeschöpft). Die Bauplan-Dornen behalten ihre Zufallsfolge (Länge 0, im Laub verborgen),
 * damit Blattbündel und Beeren an ihrem Ort bleiben.
 */
const DORNEN: readonly (readonly [number, number, number])[] = [
  [0, 30, 0.5],
  [0, 90, 0.5],
  [0, 150, 0.5],
  [0, 210, 0.5],
  [0, 270, 0.5],
  [0, 330, 0.5],
  [0, 135, 0.85],
  [0, 225, 0.85],
  [1, 220, 0.15],
  [1, 290, 0.25],
  [2, 70, 0.25],
  [2, 140, 0.15],
  [3, 320, 0.2],
  [3, 40, 0.2],
];
/** Länge (px Kreaturraum) wie beim Bauplan: getarnt 45 %, enthüllt voll, gesträubt (`dornen` 1) doppelt; Anteil der roten Spitze. */
const DORN = { laenge: 1.8, getarnt: 0.45, spitze: 0.45 } as const;

const w0 = (w: Werte, k: string): number => w[k] ?? 0;

function dornen(bau: Bau, w: Werte, nur: ReadonlySet<string> | null): void {
  if (!zeige(nur, 'laub')) return;
  bau.teil('dornSpitze', 'dornSpitze', 'dorn');
  const offen = w0(w, 'offen');
  const lang = DORN.laenge * (DORN.getarnt + (1 - DORN.getarnt) * offen) * (1 + w0(w, 'dornen'));
  for (const [mi, grad, h] of DORNEN) {
    const m = MASSEN[mi];
    if (m === undefined) continue;
    const a = (grad * Math.PI) / 180;
    const q = Math.sqrt(1 - h * h);
    const d: V3 = [Math.cos(a) * q, Math.sin(a) * q, h];
    const fuss: V3 = [m.f + d[0] * m.r[0] * 0.95, m.s + d[1] * m.r[1] * 0.95, m.u + d[2] * m.r[2] * 0.95];
    const knick = lang * (1 - DORN.spitze);
    const mitte: V3 = [fuss[0] + d[0] * knick, fuss[1] + d[1] * knick, fuss[2] + d[2] * knick];
    const spitze: V3 = [fuss[0] + d[0] * lang, fuss[1] + d[1] * lang, fuss[2] + d[2] * lang];
    bau.linie('dorn', KOERPER, fuss, mitte, 1, 0);
    // Getarnt nur der dunkle Stummel am Rand (die verräterische Spitze), erst enthüllt die rote.
    if (offen > 0.2) bau.linie('dornSpitze', KOERPER, mitte, spitze, 1, 0);
  }
}

const basis = busch({
  massen: MASSEN,
  buendel: { anzahl: 22, radius: 1.6 },
  dornen: { anzahl: 14, laenge: 0 },
  beeren: 5,
  hoehle: { f: 5.2, u: 7.4, r: [1.6, 3, 2.2] },
  // Von hinten (Blick nach oben) lugen die Augen durch einen Spalt oben in der Krone: so zeigt sich der enthüllte Dornling
  // und sein Überfall auch im Rücken – und nachts als zwei Glutpunkte über dem Busch.
  spalt: { f: 1.6, u: 13, r: [1.4, 2.8, 1] },
  augen: {
    s: 1.4,
    u: 0.5,
    seite: [
      [0, 0, 'auge', 0],
      [1, 0, 'auge', 0],
    ],
    vorn: [
      [0, 0, 'auge', 0],
      [1, 0, 'auge', 0],
    ],
  },
  beine: { f: [2.4, -2.4], spur: 4, laenge: 4 },
  ranke: { laenge: 8, u: 7 },
  seed: 3301,
  hoeheBezug: 14,
  materialien: {
    laub: { stufen: ['gras.1', 'gras.2', 'gras.3', 'gras.4', 'gras.5'], schwellen: [0.33, 0.48, 0.66, 0.86] },
    welk: { stufen: ['laub.0', 'holz.1', 'laub.1', 'laub.2'], schwellen: [0.36, 0.55, 0.78] },
    dorn: { stufen: ['laub.0'] },
    dornSpitze: { stufen: ['laub.2'] },
    beere: { stufen: ['laub.2'] },
    hoehle: { stufen: ['nacht.1'] },
    auge: { stufen: ['feuer.4*'] },
    maul: { stufen: ['laub.0'] },
    rinde: { stufen: ['holz.1'] },
    ranke: { stufen: ['holz.1', 'gras.1'] },
  },
});

const plan: Bauplan = {
  ...basis,
  baue(bau, w, nur) {
    basis.baue(bau, w, nur);
    dornen(bau, w, nur);
  },
};

const OFFEN = { offen: 1, hub: 2 };

export const dornling = kreatur({
  id: 'dornling',
  zelle: 32,
  anker: [16, 26],
  hoehe: 'kugel',
  plan,
  // Von hinten liegt die Höhle mit den Augen vorn verdeckt: dort lugen die Augen über die Krone (nur enthüllt, `offen`).
  jeRichtung: { up: { lugen: 1 } },
  clips: [
    idleClip(OFFEN, { ...OFFEN, wackeln: 3 }, { ...OFFEN, hub: 1.5, wackeln: 3 }, { ...OFFEN, hub: 1.5, wackeln: -2 }),
    zyklusClip('move', 6, 10, (ph) => ({ ...OFFEN, gang: ph, schritt: 1.6, hub: 2 + 0.6 * Math.cos(4 * Math.PI * ph), wackeln: 4 * Math.sin(2 * Math.PI * ph) }), [0, 3]),
    angriffClip({
      name: 'peitsche',
      fps: 10,
      aushol: [
        { ...OFFEN, ranke: 0.3, rankeHub: 3, nick: -6, vor: -0.5 },
        { ...OFFEN, ranke: 0.45, rankeHub: 6, nick: -10, vor: -1, maul: 0.4 },
      ],
      halten: 3,
      schlag: { ...OFFEN, ranke: 0.92, rankeHub: 1, nick: 6, vor: 0.3, maul: 0.8 },
      schmierTeile: ['ranke'],
      treffer: { ...OFFEN, ranke: 0.92, rankeHub: -1, nick: 8, vor: 0.4, maul: 0.6 },
      nach: [{ ...OFFEN, ranke: 0.5, rankeHub: 1, nick: 2 }, { ...OFFEN, ranke: 0.1 }],
    }),
    angriffClip({
      name: 'ueberfall',
      fps: 10,
      // Der Busch bebt und öffnet sich: in der gehaltenen Pose stehen Dornen und Wurzelbeine, die Augen glühen auch im Profil.
      aushol: [{ offen: 0.2, wackeln: 6 }, { offen: 0.5, wackeln: -7, hub: 0.8, dornen: 0.5 }, { offen: 0.85, wackeln: 5, hub: 1.6, dornen: 1 }],
      halten: 2,
      schlag: { offen: 1, hub: 4, vor: 2, nick: 10, maul: 1 },
      schmierTeile: ['laub'],
      treffer: { offen: 1, hub: 1, vor: 3, nick: 12, maul: 1 },
      nach: [{ offen: 1, hub: 1.5, vor: 1.5, maul: 0.4 }, { ...OFFEN }],
    }),
    trefferClip({ ...OFFEN, vor: -1.5, hub: 2.5, wackeln: -8, nick: -8 }, { ...OFFEN, hub: 1, wackeln: 4 }),
    todClip(
      [
        { ...OFFEN, vor: -1.5, hub: 2.5, wackeln: -8 },
        { offen: 0.8, hub: 0.5, wackeln: 10, nick: -6 },
        { offen: 0.5, welk: 1, liegen: 0.3, wackeln: 16 },
        { offen: 0.3, welk: 1, liegen: 0.55, wackeln: 22 },
        { offen: 0.2, welk: 1, liegen: 0.65, wackeln: 24 },
      ],
      3,
    ),
    klip('tarnung', 8, true, [pose({}), pose({ wackeln: 2 }), pose({ wackeln: 0.5 }), pose({ wackeln: -1.5 })], [0, 0, 1, 1, 2, 3, 3, 2]),
    klip(
      'erwachen',
      10,
      false,
      [pose({ offen: 0, wackeln: 4 }), pose({ offen: 0.3, wackeln: -5, hub: 0.5 }), pose({ offen: 0.6, hub: 1.5, wackeln: 3 }), pose({ offen: 1, hub: 3, nick: 6 }), pose(OFFEN)],
      [0, 1, 2, 3, 4],
      [{ frame: 3, name: 'erwacht' }],
    ),
  ],
});

export default dornling.sprite;
