/**
 * Eichhörnchen (Grünhain, friedlich; MASTERPROMPT §20.1, docs/ART.md §15): 16×16, fuchsrotes Fell (`laub`)
 * mit hellem Bauch, Pinselohren und einem buschigen Schwanz, der sich über den Rücken rollt. Sitzt
 * aufgerichtet; `move` springt in Sätzen. Kein Angriff.
 */
import { kreatur } from '../../lib/creature';
import { idleClip, zyklusClip } from '../../lib/creatureAnim';
import { gangPose, koerperTeil, vierbeiner, vierbeinerTod, vierbeinerTreffer } from '../../lib/creatureVierbeiner';

const plan = vierbeiner({
  rumpf: { f: -0.3, u: 3.8, r: [2.2, 1.9, 2.4], nick: 38 },
  kopf: { f: 1.5, u: 6.6, r: [2, 1.9, 1.9], gelenk: [0.8, 5.6] },
  schnauze: { f: 1.3, u: -0.5, r: [1, 0.95, 0.85] },
  ohren: { form: 'spitz', f: -0.5, s: 1.1, u: 1.3, laenge: 2, breite: 1.3, neigung: 5, spreizung: 14 },
  augen: { f: 1.1, s: 1.15, u: 0.4, seite: [[0, 0, 'auge', 0]], vorn: [[0, 0, 'auge', 0]], zu: [[0, 0, 'auge', 0]] },
  beine: { vornF: 1.3, hintenF: -1.1, spur: 1, gelenkU: 2.4, dicke: [1, 1], pfote: 0.8, hintenKnick: -1 },
  schwanz: { form: 'buschig', f: -1.9, u: 2.6, laenge: 6.6, dicke: 2.2, winkel: 50, kruemmung: 32, material: 'schweif' },
  hoeheBezug: 7,
  verbreiterung: 1.5,
  materialien: {
    fell: { stufen: ['laub.1', 'laub.2', 'laub.3', 'laub.4'], schwellen: [0.36, 0.52, 0.82] },
    bauch: { stufen: ['sand.3', 'sand.4'], schwellen: [0.5] },
    schweif: { stufen: ['laub.1', 'laub.2', 'laub.3'], schwellen: [0.45, 0.8] },
    bein: { stufen: ['laub.1', 'laub.2'] },
    pfote: { stufen: ['laub.1'] },
    auge: { stufen: ['nacht.1'] },
  },
  zeichnung: (o) => {
    if ((koerperTeil(o.teil) || o.teil === 'kopf') && o.normale[2] < -0.2 && o.normale[1] < 0.3) return 'bauch';
    return null;
  },
});

export const eichhoernchen = kreatur({
  id: 'eichhoernchen',
  zelle: 16,
  anker: [8, 12],
  hoehe: 'kugel',
  massstab: 0.8,
  plan,
  clips: [
    idleClip({}, { kopfNick: -8, schwanz: 6 }, { hub: -0.5, kopfNick: -8, schwanz: 10 }, { hub: -0.5, schwanz: 3 }),
    zyklusClip('move', 6, 12, (ph) => ({ ...gangPose({ art: 'hoppeln', schritt: 1.6, anheben: 1.2, koerperHub: 0.9, koerperNick: 12, kopfNick: 4, schwanz: 10 }, ph), nick: -28 + 10 * Math.sin(2 * Math.PI * ph), schwanz: -40 + 10 * Math.sin(2 * Math.PI * ph) }), [0], 'hoppeln'),
    vierbeinerTreffer({ vor: 1 }),
    vierbeinerTod({ vor: 1, schwanz: -30, beineAn: 0.3 }),
  ],
});

export default eichhoernchen.sprite;
