/**
 * Fallengeist (Gewölbe-Gegner; MASTERPROMPT §21 „Fallengeister“, docs/SPIEL.md §26, M7-15, Strang C): 32×32, ein schwebender
 * Faden aus kaltem Licht – ein runder Kopf über einem Leib, der sich zu einem wehenden Schweif verjüngt (`eis.0`–`eis.3`, Kontur
 * `nacht.1`), zwei dünne Arme mit Krallenfingern, dunkle Augenhöhlen mit eisblauen Lichtern darin (`wasser.5*`) und ein
 * Leuchtkern (`eis.4*`). Er schwebt eine Handbreit über dem Boden (Pose `schweben`), der Schweif wellt sich mit der Phase.
 * Bauplan eigens.
 *
 * Clips nach docs/ART.md §15.3: `idle` 8@8 (auf und ab, der Schweif wellt), `move` 6@10 (vorgeneigt gleitend), `attack_kaelte`
 * 10@10 (Ausholen 0–4 = 0,5 s wie `ausholzeit`: die Arme breiten sich, der Leib bläht sich · Schlag 5: er stößt hindurch ·
 * Treffer 6), `hit`, `death` (er zerfasert und sinkt).
 */
import { kreatur, type Bauplan } from '../../lib/creature';
import { angriffClip, idleClip, todClip, trefferClip, zyklusClip, type Werte } from '../../lib/creatureAnim';
import { KOERPER, rahmen, type Bau } from '../../lib/creatureBau';
import { plus, type V3 } from '../../lib/creatureRender';
import { fern, zeige } from '../../lib/creatureVierbeiner';

const w0 = (w: Werte, k: string): number => w[k] ?? 0;
/** Schwebehöhe der Leibmitte über dem Boden [px]. */
const SCHWEBEN = 10;

const plan: Bauplan = {
  materialien: {
    leib: { stufen: ['eis.0', 'eis.1', 'eis.2', 'eis.3'], schwellen: [0.3, 0.55, 0.8] },
    schweif: { stufen: ['eis.0', 'eis.1', 'eis.2'], schwellen: [0.4, 0.75] },
    arm: { stufen: ['eis.1', 'eis.2'] },
    hoehle: { stufen: ['nacht.1'] },
    auge: { stufen: ['wasser.5*'] },
    kern: { stufen: ['eis.4*'] },
  },
  hoeheBezug: SCHWEBEN + 8,
  kontur: 'nacht.1',
  verbreiterung: 1.1,
  haltung: (w: Werte) => ({
    dreh: { nick: w0(w, 'nick'), roll: w0(w, 'roll') },
    drehpunkt: [0, 0, SCHWEBEN] as V3,
    versatz: [w0(w, 'vor'), 0, w0(w, 'hub') - w0(w, 'sinken') * 6] as V3,
    stauch: 1 + 0.15 * w0(w, 'blaehen') - 0.3 * w0(w, 'sinken'),
  }),
  baue(bau: Bau, w: Werte, nur: ReadonlySet<string> | null): void {
    bau.teil('leib', 'leib', 'leib');
    bau.teil('schweif', 'schweif', 'leib');
    bau.teil('arm', 'arm', 'arm');
    bau.teil('hoehle', 'hoehle', 'leib');
    bau.teil('auge', 'auge', 'leib');
    bau.teil('kern', 'kern', 'leib');
    const welle = w0(w, 'welle');
    const zerfasern = w0(w, 'sinken');
    const blaehen = w0(w, 'blaehen');
    if (zeige(nur, 'leib')) {
      // Kopf und Leib.
      bau.ellipsoid('leib', KOERPER, [0.5, 0, SCHWEBEN + 4.4], [3.6, 3.8, 3.6]);
      bau.ellipsoid('leib', KOERPER, [-0.2, 0, SCHWEBEN], [3.2 + blaehen * 0.8, 3.9 + blaehen * 1.1, 3.4]);
      // Der Schweif: nach hinten unten, sich verjüngend, mit der Phase gewellt.
      const glieder = 4;
      for (let i = 1; i <= glieder; i++) {
        const t = i / glieder;
        const r = (1 - t * 0.75) * 3 * (1 - zerfasern * 0.4);
        const p: V3 = [-1.2 - t * 5.4, Math.sin(2 * Math.PI * (welle + t * 0.6)) * 2.2 * t, SCHWEBEN - 2 - t * 6];
        bau.ellipsoid('schweif', KOERPER, p, [r * 1.1, r, r * 0.9]);
      }
      // Augenhöhlen und Lichter darin; vorn ein Leuchtkern in der Brust.
      const kopf = rahmen(KOERPER, [0.5, 0, SCHWEBEN + 4.4]);
      for (const seite of [-1, 1]) {
        bau.punkt('hoehle', kopf, [3.2, seite * 1.5, 0.2], [1, seite * 0.35, 0.1], [[0, 0, 'hoehle', 0], [0, 1, 'hoehle', 0]], { nachAussen: true });
        bau.punkt('auge', kopf, [3.4, seite * 1.5, 0.3], [1, seite * 0.35, 0.1], [[0, 0, 'auge', 0]], { nachAussen: true, obenauf: true });
      }
      bau.punkt('kern', KOERPER, [3, 0, SCHWEBEN - 0.2], [1, 0, 0], [[0, 0, 'kern', 0], [0, 1, 'kern', 0]], { nachAussen: true });
    }
    if (zeige(nur, 'arm')) {
      const breit = w0(w, 'breit');
      const stoss = w0(w, 'stoss');
      for (const seite of [-1, 1]) {
        // Die Arme greifen nach vorn und zur Seite (keine Beine: die Hände hängen nie bis zum Boden).
        const schulter: V3 = [0.4, seite * 3.4, SCHWEBEN + 1.4];
        const hand: V3 = plus(schulter, [2.6 + stoss * 3 - breit * 1.2, seite * (1.8 + breit * 3), -0.8 + breit * 2.4 + Math.sin(2 * Math.PI * welle) * 0.7]);
        const ellbogen: V3 = plus(schulter, [1.2, seite * (1.4 + breit * 1.6), 0.2 + breit]);
        const st = fern(bau, seite, false) ? 0 : 1;
        bau.zug('arm', KOERPER, [schulter, ellbogen, hand], 1, st);
        // Drei Krallenfinger.
        for (const f of [-0.7, 0, 0.7]) bau.linie('arm', KOERPER, hand, plus(hand, [1.2, seite * 0.5 + f * 0.8, -0.9]), 1, st);
      }
    }
  },
};

export const fallengeist = kreatur({
  id: 'fallengeist',
  zelle: 32,
  anker: [16, 28],
  hoehe: 'kugel',
  plan,
  clips: [
    idleClip({ welle: 0 }, { welle: 0.25, hub: 0.8 }, { welle: 0.5, hub: 1.4 }, { welle: 0.75, hub: 0.8 }),
    zyklusClip('move', 6, 10, (ph) => ({ welle: ph, nick: 10, vor: 0.5, hub: 0.8 * Math.sin(2 * Math.PI * ph) })),
    angriffClip({
      name: 'kaelte',
      fps: 10,
      // Die Arme breiten sich, der Leib bläht sich auf – dann stößt er durch sein Opfer hindurch.
      aushol: [
        { welle: 0.2, breit: 0.6, blaehen: 0.4, hub: 1, nick: -6 },
        { welle: 0.4, breit: 1, blaehen: 1, hub: 2, nick: -12, vor: -1 },
      ],
      halten: 3,
      schlag: { welle: 0.6, stoss: 1, nick: 16, vor: 3, hub: 0.5 },
      schmierTeile: [],
      treffer: { welle: 0.7, stoss: 1, nick: 18, vor: 3.5 },
      nach: [{ welle: 0.85, stoss: 0.4, nick: 8, vor: 1.5 }, { welle: 0 }],
    }),
    trefferClip({ welle: 0.3, vor: -2, nick: -12, roll: -8 }, { welle: 0.5, blaehen: 0.3, hub: -0.5 }),
    todClip(
      [
        { welle: 0.3, vor: -2, nick: -12 },
        { welle: 0.5, breit: 0.6, sinken: 0.25, roll: 8 },
        { welle: 0.7, breit: 0.8, sinken: 0.55, roll: 14 },
        { welle: 0.85, breit: 0.6, sinken: 0.85, roll: 18 },
        { welle: 0.9, breit: 0.5, sinken: 0.95, roll: 20 },
      ],
      3,
    ),
  ],
});

/** Im Kontaktbogen der Gewölbe-Kreaturen (`kreaturen-m7-gewoelbe.png`). */
export default fallengeist.sprite;
