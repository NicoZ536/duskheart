/**
 * Reh (Grünhain, friedlich; MASTERPROMPT §20.1, docs/ART.md §15): 32×32, rotbraunes Sommerfell (`holz`),
 * weißer Spiegel, große Lauscher, kleines Gehörn (Bock), schlanke Läufe mit dunklen Schalen. Verteidigt
 * sich mit `tritt` (steigt vorn leicht auf, Vorderläufe schlagen vor).
 */
import { kreatur } from '../../lib/creature';
import { angriffClip, idleClip, zyklusClip } from '../../lib/creatureAnim';
import { KOERPER, punktIn, rahmen } from '../../lib/creatureBau';
import { gangPose, koerperTeil, vierbeiner, vierbeinerTod, vierbeinerTreffer } from '../../lib/creatureVierbeiner';

const plan = vierbeiner({
  rumpf: { f: -0.6, u: 12.4, r: [5.4, 3, 3] },
  brust: { f: 3, u: 12.8, r: [3.1, 3, 3.4] },
  huefte: { f: -4, u: 12.9, r: [3, 3, 3] },
  hals: { f: 4.8, u: 16, r: [1.8, 1.9, 3.8], nick: -52 },
  kopf: { f: 6.6, u: 20, r: [2.5, 2.1, 2.1], gelenk: [5, 16], nick: -18 },
  schnauze: { f: 2, u: -1, r: [1.7, 1.2, 1.2], nick: -22 },
  ohren: { form: 'lang', f: -1, s: 1.3, u: 1.2, laenge: 3.2, breite: 2.2, neigung: 25, spreizung: 42 },
  augen: {
    f: 1,
    s: 1.25,
    u: 0.4,
    seite: [
      [0, 0, 'auge', 0],
      [0, 1, 'auge', 0],
    ],
    vorn: [
      [0, 0, 'auge', 0],
      [0, 1, 'auge', 0],
    ],
    zu: [[0, 0, 'auge', 0]],
  },
  nase: { f: 3.5, u: -1.7, seite: [[0, 0, 'auge', 0]], vorn: [[0, 0, 'auge', 0]] },
  beine: { vornF: 3.4, hintenF: -4.2, spur: 1.8, gelenkU: 10.4, dicke: [2, 1], pfote: 0.6, hintenKnick: -1 },
  schwanz: { form: 'stummel', f: -6.4, u: 13, laenge: 1.6, dicke: 1.3, winkel: 20, material: 'spiegel' },
  hoeheBezug: 16,
  materialien: {
    fell: { stufen: ['holz.1', 'holz.2', 'holz.3', 'holz.4'], schwellen: [0.36, 0.52, 0.82] },
    bauch: { stufen: ['sand.2', 'sand.3'], schwellen: [0.5] },
    spiegel: { stufen: ['sand.4', 'eis.4'], schwellen: [0.5] },
    geweih: { stufen: ['sand.1', 'sand.2'] },
    bein: { stufen: ['holz.1', 'holz.2'] },
    pfote: { stufen: ['nacht.1'] },
    auge: { stufen: ['nacht.1'] },
  },
  zeichnung: (o) => {
    if (o.teil === 'huefte' && o.lokal[0] < -0.35 && o.normale[2] > -0.3) return 'spiegel';
    if ((koerperTeil(o.teil) || o.teil === 'kopf') && o.normale[2] < -0.55) return 'bauch';
    if (o.teil === 'schnauze' && o.normale[2] < -0.1) return 'bauch';
    return null;
  },
  extra: (bau, { kopf, nur }) => {
    if (nur !== null && !nur.has('kopf')) return;
    bau.teil('geweih', 'geweih', 'geweih');
    for (const seite of [-1, 1]) {
      const fuss = punktIn(kopf, [-0.2, 0.8 * seite, 1.8]);
      const r = rahmen(KOERPER, fuss);
      bau.zug('geweih', r, [
        [0, 0, 0],
        [-0.3, 0.3 * seite, 2.4],
        [-0.6, 0.4 * seite, 4],
      ], 1, 1);
      bau.linie('geweih', r, [-0.3, 0.3 * seite, 2.4], [0.9, 0.5 * seite, 3.4], 1, 0);
    }
  },
});

const RUHE = { vlF: 0.8, hlF: -0.8 };

export const reh = kreatur({
  id: 'reh',
  zelle: 32,
  anker: [16, 26],
  hoehe: 'kugel',
  massstab: 0.8,
  jeRichtung: { up: { kopfHub: -1.2 }, down: { kopfHub: -0.6 } },
  plan,
  clips: [
    idleClip(RUHE, { ...RUHE, kopfNick: -8, ohren: 10 }, { ...RUHE, hub: -0.6, kopfNick: -8, ohren: 10 }, { ...RUHE, hub: -0.6, ohren: -8 }),
    zyklusClip('move', 6, 12, (ph) => gangPose({ art: 'galopp', schritt: 3, anheben: 2.4, koerperHub: 1.6, koerperNick: 6, kopfNick: 5, schwanz: 15 }, ph), [0, 3]),
    angriffClip({
      name: 'tritt',
      fps: 10,
      aushol: [
        { nick: 8, hub: 0.8, vlU: 2, vrU: 2, kopfNick: 10, ohren: 25 },
        { nick: 16, hub: 1.8, vlU: 4, vrU: 4, vlF: -0.5, vrF: -0.5, kopfNick: 16, ohren: 35, hlF: 1, hrF: 1 },
      ],
      halten: 2,
      schlag: { nick: -4, hub: 0.5, vlU: 1.5, vrU: 1.5, vlF: 3, vrF: 3, kopfNick: -6, ohren: 30 },
      schmierTeile: ['bein'],
      treffer: { nick: -6, hub: 0, vlU: 0, vrU: 0, vlF: 3.5, vrF: 3.5, kopfNick: -8, ohren: 25 },
      nach: [{ nick: -2, vlF: 1.5, vrF: 1.5 }, { ...RUHE }],
    }),
    vierbeinerTreffer(),
    vierbeinerTod({ beineAn: 0.5 }),
  ],
});

export default reh.sprite;
