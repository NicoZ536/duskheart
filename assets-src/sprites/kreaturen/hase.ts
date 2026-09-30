/**
 * Hase (Grünhain, friedlich; MASTERPROMPT §20.1, docs/ART.md §15): 16×16, erdbraunes Fell, heller Bauch,
 * lange Löffel mit dunklen Spitzen, weiße Blume. `move` hoppelt (Hinterläufe gemeinsam, Körper im Bogen).
 * Kein Angriff: der Hase flieht.
 */
import { kreatur } from '../../lib/creature';
import { idleClip, zyklusClip } from '../../lib/creatureAnim';
import { gangPose, koerperTeil, vierbeiner, vierbeinerTod, vierbeinerTreffer } from '../../lib/creatureVierbeiner';

const plan = vierbeiner({
  rumpf: { f: -0.6, u: 4.2, r: [2.7, 2.2, 2.3], nick: 12 },
  huefte: { f: -1.9, u: 3.8, r: [2.3, 2.3, 2.3] },
  kopf: { f: 2.2, u: 6.2, r: [2.2, 2, 2], gelenk: [1.4, 5] },
  schnauze: { f: 1.5, u: -0.5, r: [1.1, 1.1, 1] },
  ohren: { form: 'lang', f: -0.8, s: 0.95, u: 1.3, laenge: 3.4, breite: 1.9, neigung: 16, spreizung: 18, innen: 'ohrInnen' },
  augen: { f: 1.1, s: 1.25, u: 0.4, seite: [[0, 0, 'auge', 0]], vorn: [[0, 0, 'auge', 0]], zu: [[0, 0, 'auge', 0]] },
  beine: { vornF: 1.6, hintenF: -1.6, spur: 1.2, gelenkU: 2.8, dicke: [1, 1], pfote: 1, hintenKnick: -1 },
  schwanz: { form: 'stummel', f: -3.6, u: 4.8, laenge: 1.4, dicke: 1.1, winkel: 30, material: 'weiss' },
  hoeheBezug: 6.5,
  verbreiterung: 1.6,
  materialien: {
    fell: { stufen: ['erde.1', 'erde.2', 'erde.3', 'erde.4'], schwellen: [0.36, 0.52, 0.82] },
    bauch: { stufen: ['sand.3', 'sand.4'], schwellen: [0.5] },
    weiss: { stufen: ['sand.4', 'eis.4'], schwellen: [0.5] },
    spitze: { stufen: ['nacht.1'] },
    ohrInnen: { stufen: ['haut.3'] },
    bein: { stufen: ['erde.1', 'erde.2'] },
    pfote: { stufen: ['erde.2'] },
    auge: { stufen: ['nacht.1'] },
  },
  zeichnung: (o) => {
    if (o.teil === 'ohr' && o.lokal[2] > 0.55) return 'spitze';
    if ((koerperTeil(o.teil) || o.teil === 'kopf') && o.normale[2] < -0.5) return 'bauch';
    if (o.teil === 'schnauze' && o.normale[2] < 0) return 'bauch';
    return null;
  },
});

export const hase = kreatur({
  id: 'hase',
  zelle: 16,
  anker: [8, 12],
  hoehe: 'kugel',
  massstab: 0.78,
  jeRichtung: { down: { ohren: -18, ohrLang: 1.6, kopfHub: -0.8 }, up: { ohren: -10, ohrLang: 0.2 } },
  plan,
  clips: [
    idleClip({}, { kopfNick: -4, ohren: 4 }, { hub: -0.5, kopfNick: -4, ohren: 4 }, { hub: -0.5, ohren: -3 }),
    zyklusClip('move', 6, 12, (ph) => gangPose({ art: 'hoppeln', schritt: 1.8, anheben: 1.2, koerperHub: 0.7, koerperNick: 10, kopfNick: 4 }, ph), [0], 'hoppeln'),
    vierbeinerTreffer(),
    vierbeinerTod({ ohren: 50, beineAn: 0.3, kopfVor: -1.5 }),
  ],
});

export default hase.sprite;
