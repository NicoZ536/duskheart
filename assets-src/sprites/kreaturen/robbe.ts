/**
 * Robbe (Salzküste, friedlich; MASTERPROMPT §20.1, docs/ART.md §15): 32×32, grau gefleckter Seehund
 * (`stein`), heller Bauch, runder Kopf mit großen dunklen Augen, Vorderflossen und Schwanzflossen.
 * `move` robbt (Körper wölbt sich, Flossen schieben). Verteidigt sich mit `biss`.
 */
import { kreatur } from '../../lib/creature';
import { angriffClip, idleClip, zyklusClip } from '../../lib/creatureAnim';
import { koerperTeil, vierbeiner, vierbeinerTod, vierbeinerTreffer } from '../../lib/creatureVierbeiner';

const plan = vierbeiner({
  rumpf: { f: -1.4, u: 4.2, r: [7.4, 3.8, 3.4] },
  brust: { f: 3.2, u: 5, r: [3.8, 3.7, 3.8] },
  huefte: { f: -7.6, u: 3, r: [3.4, 2.6, 2.2] },
  hals: { f: 5.4, u: 7.2, r: [2.8, 3, 3.2], nick: -35 },
  kopf: { f: 7.6, u: 9.2, r: [3, 2.9, 2.7], gelenk: [5.6, 7.4] },
  schnauze: { f: 2.5, u: -0.6, r: [1.6, 1.9, 1.5] },
  kiefer: { f: 2.2, u: -1.4, r: [1.5, 1.6, 0.8], gelenk: [0.6, -1], oeffnen: 35 },
  augen: {
    f: 1.8,
    s: 1.35,
    u: 0.7,
    seite: [
      [0, 0, 'auge', 0],
      [0, 1, 'auge', 0],
    ],
    vorn: [
      [0, 0, 'auge', 0],
      [0, 1, 'auge', 0],
    ],
    zu: [[0, 1, 'auge', 0]],
  },
  nase: { f: 4.1, u: -0.3, seite: [[0, 0, 'auge', 0]], vorn: [[0, 0, 'auge', 0]] },
  beine: { vornF: 3.4, hintenF: -4, spur: 3.2, gelenkU: 3.2, dicke: [2, 2], pfote: 1.6, nurVorn: true },
  hoeheBezug: 9,
  materialien: {
    fell: { stufen: ['stein.2', 'stein.3', 'stein.4', 'stein.5'], schwellen: [0.36, 0.52, 0.82] },
    flecken: { stufen: ['stein.1', 'stein.2'], schwellen: [0.6] },
    bauch: { stufen: ['stein.4', 'stein.5'], schwellen: [0.5] },
    bein: { stufen: ['stein.1', 'stein.2'] },
    pfote: { stufen: ['stein.1'] },
    flosse: { stufen: ['stein.1', 'stein.2'], schwellen: [0.6] },
    auge: { stufen: ['nacht.1'] },
    rachen: { stufen: ['laub.0', 'laub.1'] },
  },
  zeichnung: (o) => {
    const [f, s, u] = o.lokal;
    if (koerperTeil(o.teil) && o.normale[2] < -0.4) return 'bauch';
    if (koerperTeil(o.teil) && Math.sin(f * 7.1 + s * 2) * Math.sin(u * 6.3 - f * 3) > 0.55) return 'flecken';
    return null;
  },
  extra: (bau, { koerper, w, nur }) => {
    if (nur !== null && !nur.has('rumpf')) return;
    bau.teil('flosse', 'flosse', 'flosse');
    const schlag = w['flosse'] ?? 0;
    for (const seite of [-1, 1]) {
      bau.flaeche('flosse', koerper, [
        [-9.4, 0.4 * seite, -1],
        [-9.4, 1.6 * seite, -1.4],
        [-12.2, 2.6 * seite, -2.4 + schlag],
        [-12.6, 0.6 * seite, -1.8 + schlag],
      ]);
    }
  },
});

export const robbe = kreatur({
  id: 'robbe',
  zelle: 32,
  anker: [16, 22],
  hoehe: 'kugel',
  massstab: 0.86,
  plan,
  clips: [
    idleClip({}, { kopfNick: 8, kopfGier: 8 }, { kopfNick: 8, kopfGier: 8, hub: -0.4 }, { kopfNick: -4, hub: -0.4, flosse: 0.8 }),
    zyklusClip(
      'move',
      6,
      10,
      (ph) => {
        const a = 2 * Math.PI * ph;
        return { nick: 7 * Math.sin(a), hub: 0.8 * Math.max(0, Math.sin(a)), vor: 0.8 * Math.cos(a), vlF: -1.6 * Math.cos(a), vrF: -1.6 * Math.cos(a), vlU: Math.max(0, Math.sin(a)) * 1.2, vrU: Math.max(0, Math.sin(a)) * 1.2, kopfNick: -5 * Math.sin(a), flosse: 1.2 * Math.max(0, -Math.sin(a)) };
      },
      [0, 3],
      'robben',
    ),
    angriffClip({
      name: 'biss',
      fps: 10,
      aushol: [
        { kopfNick: 14, kopfVor: -0.8, hub: 0.4, maul: 0.3 },
        { kopfNick: 24, kopfVor: -1.4, hub: 0.8, maul: 0.7, nick: 6 },
      ],
      halten: 2,
      schlag: { kopfNick: -10, kopfVor: 2, maul: 1, nick: -4, vor: 1 },
      schmierTeile: ['kopf'],
      treffer: { kopfNick: -14, kopfVor: 2.4, maul: 0.2, nick: -6, vor: 1.2 },
      nach: [{ kopfNick: -4, kopfVor: 0.8, vor: 0.4 }, {}],
    }),
    vierbeinerTreffer(),
    vierbeinerTod(),
  ],
});

export default robbe.sprite;
