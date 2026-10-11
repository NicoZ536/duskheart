/**
 * Erbauer-Konstrukt (erste Reihe; MASTERPROMPT §20.1 „Erbauer-Konstrukte“, docs/SPIEL.md §26, M7-15, Strang C): 32×32, ein
 * gedrungener Wächter aus behauenem Stein (`stein.1`–`stein.4`) mit Bronzegelenken (`sand.1`–`sand.3`), einem glimmenden
 * Augenschlitz und einem Glutkern hinter der Brustrinne (`feuer.4*` – ein Wächter der dunklen Gewölbe). Bauplan
 * assets-src/sprites/gewoelbe/_konstrukt.ts.
 *
 * Clips nach docs/ART.md §15.3: `idle` 8@8 (der Kern pulst nicht – Stein atmet nicht: nur ein schweres Nachsacken), `move` 6@8
 * (stampfend, Events `schritt` 0/3), `attack_faust` 11@10 (Ausholen 0–6 = 0,7 s wie `ausholzeit`: beide Fäuste steigen über
 * den Kopf, der Leib staucht sich · Schlag 7 · Treffer 8), `hit`, `death` (die Glieder fallen vom Rumpf, er sackt zusammen).
 */
import { kreatur } from '../../lib/creature';
import { angriffClip, idleClip, todClip, trefferClip, zyklusClip } from '../../lib/creatureAnim';
import { konstrukt } from '../gewoelbe/_konstrukt';

const plan = konstrukt({
  // Etwas größer als die Grundmaße: der Wächter füllt seine 32er-Zelle wie ein ausgewachsener Gegner (≈ 18 px hoch).
  k: 1.25,
  materialien: {
    stein: { stufen: ['stein.1', 'stein.2', 'stein.3', 'stein.4'], schwellen: [0.34, 0.58, 0.82] },
    bronze: { stufen: ['sand.0', 'sand.2', 'sand.3'], schwellen: [0.45, 0.78] },
    auge: { stufen: ['feuer.4*'] },
    kern: { stufen: ['feuer.3*'] },
    rinne: { stufen: ['nacht.1'] },
    wurzel: { stufen: ['holz.1'] },
    moos: { stufen: ['gras.2'] },
  },
  wurzeln: 0,
  moos: 0,
  wurzelArm: false,
  seed: 7101,
});

const RUHE = { armL: 0.02, armR: 0.02 };

export const erbauerKonstrukt1 = kreatur({
  id: 'erbauer_konstrukt_1',
  zelle: 32,
  anker: [16, 28],
  hoehe: 'block',
  plan,
  clips: [
    idleClip(RUHE, { ...RUHE, duck: 0.3 }, { ...RUHE, duck: 0.6, armL: 0.06, armR: 0.06 }, { ...RUHE, duck: 0.3 }),
    zyklusClip('move', 6, 8, (ph) => ({ ...RUHE, gang: ph, schritt: 2.2, hub: 0.5 * Math.abs(Math.cos(2 * Math.PI * ph)), wackeln: 4 * Math.sin(2 * Math.PI * ph), armL: 0.08 + 0.08 * Math.sin(2 * Math.PI * ph), armR: 0.08 - 0.08 * Math.sin(2 * Math.PI * ph) }), [0, 3]),
    angriffClip({
      name: 'faust',
      fps: 10,
      aushol: [
        { armL: 0.4, armR: 0.4, duck: 0.2, nick: -4 },
        { armL: 0.75, armR: 0.75, duck: 0.5, nick: -8 },
        { armL: 0.95, armR: 0.95, duck: 0.8, nick: -10, vor: -0.8 },
      ],
      halten: 4,
      schlag: { armL: 0.95, armR: 0.95, schlag: 0.9, nick: 10, vor: 1.5 },
      schmierTeile: ['arm'],
      treffer: { armL: 0.95, armR: 0.95, schlag: 1, nick: 14, vor: 2, duck: 0.6 },
      nach: [{ armL: 0.5, armR: 0.5, schlag: 0.4, nick: 4, vor: 1 }, { ...RUHE }],
    }),
    trefferClip({ ...RUHE, vor: -1.2, nick: -8, wackeln: -6, armL: 0.2 }, { ...RUHE, duck: 0.6, wackeln: 3 }),
    todClip(
      [
        { ...RUHE, vor: -1, nick: -8, wackeln: -6 },
        { ...RUHE, zerfall: 0.25, duck: 0.6, wackeln: 8 },
        { armL: 0.3, armR: 0.1, zerfall: 0.5, liegen: 0.4, roll: 10 },
        { armL: 0.4, armR: 0.2, zerfall: 0.8, liegen: 0.8, roll: 14 },
        { armL: 0.4, armR: 0.2, zerfall: 0.85, liegen: 0.85, roll: 15 },
      ],
      3,
    ),
  ],
});

/** Im Kontaktbogen der Gewölbe-Kreaturen (`kreaturen-m7-gewoelbe.png`). */
export default erbauerKonstrukt1.sprite;
