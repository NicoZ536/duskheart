/**
 * Lichtfresser (Schattenbrut; MASTERPROMPT §12.4, §20.1, docs/ART.md §15): 32×32, schwebender Schemen aus
 * Tinten-Rauch mit Haube, glühenden Augen `eis.4*`, einem Schlund, der beim Saugen violett aufglüht, und
 * sechs hängenden Tentakeln. Angriffe: `saugen` (Leib bläht sich, Tentakel greifen aus, gefangene
 * Lichtfunken `feuer*` wandern in den Schlund – löscht Fackeln, saugt Lumen) und `schlag` (ein Tentakel
 * peitscht vor).
 */
import { kreatur } from '../../lib/creature';
import { angriffClip, todClip, trefferClip, zyklusClip } from '../../lib/creatureAnim';
import { lichtfresser as lichtfresserPlan } from '../../lib/creatureSchatten';

const plan = lichtfresserPlan({
  schwebe: 12,
  leib: [3.6, 3.4, 4.6],
  haube: { f: 0.6, u: 3.4, r: [3.4, 3.6, 2.8] },
  schlund: { f: 2.8, u: 0.8, r: [1.2, 2, 1.6] },
  tentakel: { anzahl: 6, laenge: 6.5 },
  augen: {
    f: 3.1,
    s: 1.3,
    u: 2.6,
    seite: [
      [0, 0, 'auge', 0],
      [1, 0, 'auge', 0],
    ],
    vorn: [
      [0, 0, 'auge', 0],
      [1, 0, 'auge', 0],
    ],
  },
  augenMaterial: 'eis.4*',
  hoeheBezug: 18,
});

export const lichtfresser = kreatur({
  id: 'lichtfresser',
  zelle: 32,
  anker: [16, 27],
  hoehe: 'kugel',
  plan,
  clips: [
    zyklusClip('idle', 6, 8, (ph) => ({ phase: ph, rauch: ph, hub: 0.9 * Math.sin(2 * Math.PI * ph) })),
    zyklusClip('move', 6, 10, (ph) => ({ phase: ph * 2, rauch: ph, hub: 0.6 * Math.sin(2 * Math.PI * ph), nick: -8, vor: 1 }), [0], 'gleiten'),
    angriffClip({
      // 10 fps: six wind-up positions are 0,6 s, the run-up 0,1 s – the blow lands after 0,7 s (§19.4 "0,3–0,8 s").
      name: 'saugen',
      fps: 10,
      aushol: [
        { saugen: 0.3, phase: 0.1, rauch: 0.1, hub: 0.5 },
        { saugen: 0.6, phase: 0.2, rauch: 0.2, hub: 1, nick: 6 },
        { saugen: 0.85, phase: 0.3, rauch: 0.3, hub: 1.2, nick: 8 },
      ],
      halten: 3,
      anlauf: [{ saugen: 1, phase: 0.4, funken: 0.2, rauch: 0.4, nick: 4 }],
      schlag: { saugen: 1, phase: 0.5, funken: 0.55, rauch: 0.5, nick: 2 },
      schmierTeile: ['tentakel'],
      treffer: { saugen: 1, phase: 0.6, funken: 0.9, rauch: 0.6, nick: 0, hub: -0.5 },
      nach: [{ saugen: 0.5, phase: 0.7, rauch: 0.7 }, { saugen: 0.1, phase: 0.8, rauch: 0.8 }],
    }),
    angriffClip({
      name: 'schlag',
      fps: 10,
      aushol: [
        { phase: 0.1, peitsche: 0, nick: -8, vor: -1, rauch: 0.1 },
        { phase: 0.2, nick: -14, vor: -1.5, hub: 1, saugen: 0.3, rauch: 0.2 },
      ],
      halten: 2,
      schlag: { phase: 0.3, peitsche: 1, nick: 10, vor: 1.5, rauch: 0.3 },
      schmierTeile: ['tentakel'],
      treffer: { phase: 0.4, peitsche: 0.9, nick: 12, vor: 2, rauch: 0.4 },
      nach: [{ phase: 0.55, peitsche: 0.3, nick: 4, vor: 0.8, rauch: 0.5 }, { phase: 0.7, rauch: 0.6 }],
    }),
    trefferClip({ phase: 0.1, vor: -1.5, hub: 1.5, nick: -12, saugen: 0.2, rauch: 0.2 }, { phase: 0.3, vor: -0.5, hub: -0.5, nick: 4, rauch: 0.4 }),
    todClip(
      [
        { phase: 0.1, vor: -1.5, hub: 1.5, nick: -12, saugen: 0.5, rauch: 0.1 },
        { phase: 0.2, hub: -1, zerfall: 0.3, saugen: 0.2, rauch: 0.3 },
        { phase: 0.3, hub: -2.5, zerfall: 0.6, rauch: 0.5 },
        { phase: 0.35, hub: -3.5, zerfall: 0.85, rauch: 0.7, liegen: 0.3 },
        { phase: 0.35, hub: -4, zerfall: 1, rauch: 0.9, liegen: 0.5 },
      ],
      2,
    ),
  ],
});

export default lichtfresser.sprite;
