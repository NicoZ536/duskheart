/**
 * Dachs (Grünhain, Gegner; MASTERPROMPT §20.1, docs/ART.md §15): 32×32, flach und breit, graues Fell
 * (`stein`), schwarze Läufe, weißes Gesicht mit zwei schwarzen Streifen über die Augen; nachtaktiv – Augen
 * `feuer.4*` im schwarzen Streifen. Angriffe: `biss` und `kratzer` (Grabkralle hebt sich, schlägt nieder).
 */
import { kreatur } from '../../lib/creature';
import { angriffClip, idleClip, zyklusClip } from '../../lib/creatureAnim';
import { gangPose, koerperTeil, vierbeiner, vierbeinerTod, vierbeinerTreffer } from '../../lib/creatureVierbeiner';

const plan = vierbeiner({
  rumpf: { f: -0.6, u: 5.6, r: [6, 4.1, 3.2] },
  brust: { f: 3, u: 5.8, r: [3.2, 3.9, 3] },
  huefte: { f: -4, u: 5.8, r: [3, 3.9, 3] },
  kopf: { f: 6.4, u: 6.2, r: [2.9, 2.6, 2.3], gelenk: [4.4, 6.2] },
  schnauze: { f: 2.5, u: -0.6, r: [2.1, 1.3, 1.2], nick: -10 },
  kiefer: { f: 2.1, u: -1.4, r: [1.8, 1.1, 0.6], gelenk: [0.4, -1.1], oeffnen: 35 },
  ohren: { form: 'rund', f: -1.4, s: 1.9, u: 1.2, laenge: 1.6, breite: 1.8, neigung: 10, spreizung: 30 },
  augen: {
    f: 1.9,
    s: 1.25,
    u: 0.5,
    seite: [
      [0, 0, 'auge', 0],
      [1, 0, 'auge', 0],
    ],
    vorn: [[0, 0, 'auge', 0], [0, -1, 'auge', 0]],
    zu: [
      [0, 0, 'schwarz', 0],
      [1, 0, 'schwarz', 0],
    ],
  },
  nase: { f: 4.6, u: -0.7, seite: [[0, 0, 'schwarz', 0]], vorn: [[0, 0, 'schwarz', 0]] },
  beine: { vornF: 3, hintenF: -4, spur: 2.8, gelenkU: 3.4, dicke: [2, 2], pfote: 1.2, hintenKnick: -1 },
  schwanz: { form: 'stummel', f: -6.4, u: 6, laenge: 2, dicke: 1.4, winkel: 10 },
  hoeheBezug: 9,
  materialien: {
    fell: { stufen: ['stein.1', 'stein.2', 'stein.3', 'stein.4'], schwellen: [0.36, 0.52, 0.82] },
    weiss: { stufen: ['eis.2', 'eis.3', 'eis.4'], schwellen: [0.4, 0.66] },
    schwarz: { stufen: ['nacht.1', 'nacht.2'], schwellen: [0.6] },
    bein: { stufen: ['nacht.1', 'nacht.2'] },
    pfote: { stufen: ['nacht.2'] },
    auge: { stufen: ['feuer.4*'] },
    rachen: { stufen: ['laub.0', 'laub.1'] },
  },
  zeichnung: (o) => {
    const [, s] = o.lokal;
    if (o.teil === 'kopf' || o.teil === 'schnauze' || o.teil === 'kiefer') {
      const a = Math.abs(s);
      if (o.teil === 'kiefer') return 'schwarz';
      if (a < 0.24) return 'weiss';
      if (a < 0.62) return 'schwarz';
      return 'weiss';
    }
    if (o.teil === 'ohr') return 'weiss';
    if (koerperTeil(o.teil) && o.normale[2] < -0.45) return 'schwarz';
    return null;
  },
});

const RUHE = { vlF: 0.8, hlF: -0.8 };

export const dachs = kreatur({
  id: 'dachs',
  zelle: 32,
  anker: [16, 22],
  hoehe: 'kugel',
  massstab: 0.92,
  plan,
  clips: [
    idleClip(RUHE, { ...RUHE, kopfNick: -6 }, { ...RUHE, hub: -0.5, kopfNick: -6, kopfHub: -0.4 }, { ...RUHE, hub: -0.5, kopfNick: 4 }),
    zyklusClip('move', 6, 10, (ph) => gangPose({ art: 'trab', schritt: 2, anheben: 1.4, koerperHub: 0.5, koerperNick: 2, kopfNick: 3, schwanz: 10 }, ph), [0, 3]),
    angriffClip({
      name: 'biss',
      fps: 10,
      aushol: [
        { hub: -0.6, vor: -1, kopfNick: 10, maul: 0.3, hlF: 0.5, hrF: 0.5 },
        { hub: -1.2, vor: -1.8, kopfNick: 16, maul: 0.7, hlF: 1, hrF: 1, stauch: -0.06 },
      ],
      halten: 2,
      schlag: { vor: 1.8, kopfVor: 1.4, kopfNick: -8, maul: 1, vlF: 1.2, vrF: 1.2 },
      schmierTeile: ['kopf'],
      treffer: { vor: 2.2, kopfVor: 1.8, kopfNick: -4, maul: 0.15, vlF: 1.6, vrF: 1.6 },
      nach: [{ vor: 0.8, vlF: 0.8, vrF: 0.8 }, RUHE],
    }),
    angriffClip({
      name: 'kratzer',
      fps: 10,
      aushol: [
        { nick: 8, hub: 0.6, vrU: 2.5, vrF: 0.5, kopfNick: 6 },
        { nick: 14, hub: 1.2, vrU: 4, vrF: 1, kopfNick: 10, maul: 0.4, vor: -0.8 },
      ],
      halten: 2,
      schlag: { nick: -4, vrU: 0.5, vrF: 4, kopfNick: -6, maul: 0.7, vor: 1 },
      schmierTeile: ['bein'],
      treffer: { nick: -6, vrU: 0, vrF: 4.5, kopfNick: -8, maul: 0.3, vor: 1.3 },
      nach: [{ vrF: 1.5, vor: 0.5 }, RUHE],
    }),
    vierbeinerTreffer(),
    vierbeinerTod(),
  ],
});

export default dachs.sprite;
