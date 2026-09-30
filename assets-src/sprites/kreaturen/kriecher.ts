/**
 * Kriecher (Schattenbrut, hält fest; MASTERPROMPT §12.4, §20.1, docs/ART.md §15): 32×32, ein flacher Leib
 * aus Tinten-Rauch, der hinten zerfasert, auf zwei langen Krallenarmen; Augen `verderb.4*`. Angriff
 * `packen`: Arme heben sich weit (Ausholen), der Leib schnellt vor, die Krallen schließen sich. Zusätzlich
 * `festhalten` (Schleife: hält das Ziel und zerrt).
 */
import { kreatur } from '../../lib/creature';
import { angriffClip, idleClip, klip, pose, todClip, trefferClip, zyklusClip } from '../../lib/creatureAnim';
import { kriecher as kriecherPlan } from '../../lib/creatureSchatten';

const plan = kriecherPlan({
  rumpf: { f: -1.5, u: 4.4, r: [6, 3.6, 2.8] },
  kopf: { f: 4.6, u: 5.4, r: [2.5, 2.5, 2.2] },
  arme: { schulterF: 2.4, schulterS: 2.8, schulterU: 5.6, laenge: 7, reichweite: 7.5 },
  augen: {
    f: 1.9,
    s: 1.1,
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
  augenMaterial: 'verderb.4*',
  hoeheBezug: 8,
});

export const kriecher = kreatur({
  id: 'kriecher',
  zelle: 32,
  anker: [16, 24],
  hoehe: 'kugel',
  plan,
  clips: [
    idleClip({ rauch: 0 }, { rauch: 0.25, lF: 0.5, kopfNick: -5 }, { rauch: 0.5, hub: -0.6, lF: 0.5, rF: -0.5, kopfNick: -5 }, { rauch: 0.75, hub: -0.6, rF: -0.5 }),
    zyklusClip(
      'move',
      6,
      10,
      (ph) => ({ lF: 2.2 * Math.cos(2 * Math.PI * ph), rF: -2.2 * Math.cos(2 * Math.PI * ph), lU: Math.max(0, -Math.sin(2 * Math.PI * ph)) * 1.6, rU: Math.max(0, Math.sin(2 * Math.PI * ph)) * 1.6, vor: 0.5 * Math.sin(4 * Math.PI * ph), nick: 3 * Math.sin(2 * Math.PI * ph), rauch: ph }),
      [0, 3],
    ),
    angriffClip({
      name: 'packen',
      fps: 10,
      aushol: [
        { arme: 25, lU: 3, rU: 3, lF: -1, rF: -1, vor: -1, hub: 0.5, maul: 0.3, rauch: 0.1 },
        { arme: 45, lU: 6, rU: 6, lF: -2, rF: -2, vor: -2, hub: 1.5, nick: 10, maul: 0.7, rauch: 0.2 },
      ],
      halten: 3,
      schlag: { arme: 5, lU: 1, rU: 1, lF: 3, rF: 3, vor: 3, nick: -6, maul: 1, greifen: 0.5, rauch: 0.3 },
      schmierTeile: ['arm', 'kopf'],
      treffer: { lF: 3.5, rF: 3.5, vor: 3.5, nick: -8, maul: 0.6, greifen: 1, rauch: 0.4 },
      nach: [{ lF: 2, rF: 2, vor: 2, greifen: 1, maul: 0.3, rauch: 0.5 }, { lF: 1, rF: 1, vor: 1, greifen: 0.6, rauch: 0.6 }],
    }),
    klip(
      'festhalten',
      8,
      true,
      [pose({ lF: 2, rF: 2, vor: 1.5, greifen: 1, maul: 0.6, rauch: 0 }), pose({ lF: 1.2, rF: 1.2, vor: 0.5, greifen: 1, maul: 0.8, nick: 4, rauch: 0.33 }), pose({ lF: 1.6, rF: 1.6, vor: 1, greifen: 1, maul: 0.4, nick: -3, rauch: 0.66 })],
      [0, 1, 2],
    ),
    trefferClip({ vor: -1.5, hub: 1, arme: 20, lU: 2, rU: 2, kopfNick: 15, rauch: 0.2 }, { vor: -0.5, hub: -0.5, kopfNick: -5, rauch: 0.4 }),
    todClip(
      [
        { vor: -1.5, hub: 1, arme: 20, lU: 2, rU: 2, kopfNick: 15, rauch: 0.1 },
        { hub: -1, vor: 1.5, zerfall: 0.3, lF: 1, rF: 1, kopfNick: -10, rauch: 0.3 },
        { hub: -2, vor: 2.5, zerfall: 0.6, lF: 2, rF: 2, greifen: 0.3, rauch: 0.5 },
        { hub: -3, vor: 2.5, zerfall: 0.9, lF: 2.5, rF: 2.5, rauch: 0.7 },
        { hub: -3.5, vor: 2.5, zerfall: 1, lF: 2.5, rF: 2.5, rauch: 0.9 },
      ],
      2,
    ),
  ],
});

export default kriecher.sprite;
