/**
 * Wurzelhüter (Mini-Boss der Grünhain-Gewölbe; MASTERPROMPT §21 „Mini-Boss“, docs/SPIEL.md §26, M7-15, Strang C): 64×64, ein
 * Erbauer-Konstrukt, doppelt so groß, das die Wurzeln des Grünhains überwuchert haben – Stein (`stein.1`–`stein.4`) unter
 * Wurzelsträngen (`holz.0`/`holz.2`), Moospolster (`gras.1`/`gras.3`) auf Schultern und Kopf, Bronzegelenke, der rechte Arm
 * ein Wurzelbündel (die Peitsche), Augenschlitz und Brustkern glühen (`feuer.4*`). Bauplan
 * assets-src/sprites/gewoelbe/_konstrukt.ts mit Maßstab 2,6.
 *
 * Clips nach docs/ART.md §15.3: `idle` 8@8, `move` 6@8 (Events `schritt` 0/3), `attack_peitsche` 13@10 (Ausholen 0–7 = 0,8 s wie
 * `ausholzeit`: das Wurzelbündel hebt sich weit nach hinten · Schlag 8 · Treffer 9), `attack_stampfen` 13@10 (0,8 s: die
 * Steinfaust steigt, der Leib staucht sich – dann stampft er), `hit`, `death` (die Glieder fallen, die Wurzeln bleiben).
 */
import { kreatur } from '../../lib/creature';
import { angriffClip, idleClip, todClip, trefferClip, zyklusClip } from '../../lib/creatureAnim';
import { konstrukt } from '../gewoelbe/_konstrukt';

const plan = konstrukt({
  // Ein Mini-Boss füllt seine 64er-Zelle: gut 2½-mal so groß wie das Grundmaß (≈ 38 px hoch, ≈ 36 px breit).
  k: 2.6,
  materialien: {
    stein: { stufen: ['stein.1', 'stein.2', 'stein.3', 'stein.4'], schwellen: [0.34, 0.58, 0.82] },
    // Zwölf Farben mit Kontur: Bronze, Wurzeln und Moos je zweistufig, Augen und Kern in einem Glutton.
    bronze: { stufen: ['sand.0', 'sand.3'], schwellen: [0.55] },
    auge: { stufen: ['feuer.4*'] },
    kern: { stufen: ['feuer.4*'] },
    rinne: { stufen: ['nacht.1'] },
    wurzel: { stufen: ['holz.0', 'holz.2'], schwellen: [0.5] },
    moos: { stufen: ['gras.1', 'gras.3'], schwellen: [0.5] },
  },
  wurzeln: 10,
  moos: 3,
  wurzelArm: true,
  seed: 8263,
});

const RUHE = { armL: 0.04, armR: 0.1 };

export const wurzelhueter = kreatur({
  id: 'wurzelhueter',
  zelle: 64,
  anker: [32, 56],
  hoehe: 'block',
  plan,
  clips: [
    idleClip(RUHE, { ...RUHE, duck: 0.3, armR: 0.16 }, { ...RUHE, duck: 0.5, armR: 0.2 }, { ...RUHE, duck: 0.3, armR: 0.14 }),
    zyklusClip('move', 6, 8, (ph) => ({ ...RUHE, gang: ph, schritt: 4, hub: Math.abs(Math.cos(2 * Math.PI * ph)), wackeln: 4 * Math.sin(2 * Math.PI * ph), armL: 0.08 + 0.1 * Math.sin(2 * Math.PI * ph) }), [0, 3]),
    angriffClip({
      name: 'peitsche',
      fps: 10,
      aushol: [
        { ...RUHE, armR: 0.5, duck: 0.2, nick: -4 },
        { ...RUHE, armR: 0.8, duck: 0.4, nick: -8, wackeln: -4 },
        { ...RUHE, armR: 1, duck: 0.5, nick: -10, wackeln: -6, vor: -1 },
      ],
      halten: 5,
      schlag: { ...RUHE, armR: 0.3, peitsche: 0.8, nick: 8, wackeln: 6, vor: 1 },
      schmierTeile: ['wurzel'],
      treffer: { ...RUHE, armR: 0.1, peitsche: 1, nick: 10, wackeln: 8, vor: 1.5 },
      nach: [{ ...RUHE, peitsche: 0.4, nick: 4 }, { ...RUHE }],
    }),
    angriffClip({
      name: 'stampfen',
      fps: 10,
      aushol: [
        { ...RUHE, armL: 0.5, duck: 0.2, hub: 1 },
        { ...RUHE, armL: 0.85, duck: 0.4, hub: 2.5, nick: -6 },
        { ...RUHE, armL: 1, duck: 0.6, hub: 3.5, nick: -8 },
      ],
      halten: 5,
      schlag: { ...RUHE, armL: 0.9, schlag: 1, duck: 1, nick: 10 },
      schmierTeile: ['arm'],
      treffer: { ...RUHE, armL: 0.9, schlag: 1, duck: 1.2, nick: 12, hub: -0.5 },
      nach: [{ ...RUHE, armL: 0.4, schlag: 0.4, duck: 0.5 }, { ...RUHE }],
    }),
    trefferClip({ ...RUHE, vor: -1.5, nick: -8, wackeln: -6 }, { ...RUHE, duck: 0.6, wackeln: 3 }),
    todClip(
      [
        { ...RUHE, vor: -1.5, nick: -8, wackeln: -6 },
        { ...RUHE, zerfall: 0.25, duck: 0.6, wackeln: 8 },
        { armL: 0.3, armR: 0.1, zerfall: 0.5, liegen: 0.4, roll: 8 },
        { armL: 0.4, armR: 0.2, zerfall: 0.8, liegen: 0.8, roll: 12 },
        { armL: 0.4, armR: 0.2, zerfall: 0.85, liegen: 0.85, roll: 13 },
      ],
      3,
    ),
  ],
});

/** Im Kontaktbogen der Gewölbe-Kreaturen (`kreaturen-m7-gewoelbe.png`). */
export default wurzelhueter.sprite;
