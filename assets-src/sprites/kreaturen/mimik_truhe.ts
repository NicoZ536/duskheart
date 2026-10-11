/**
 * Mimik-Truhe (Gewölbe-Gegner; MASTERPROMPT §21 „Mimik-Truhen“, docs/SPIEL.md §26, M7-15, Strang C): 32×32, getarnt eine
 * Erbauer-Truhe wie die echten der Gewölbe (`ort_truhe_*`): Holzkasten (`holz.1`–`holz.3`) mit gewölbtem Deckel, zwei
 * Eisenbänder (`stein.2`) und ein Messingschloss (`sand.3`) – zwölf Farben mit Kontur. Erwacht klappt der Deckel auf: dahinter ein dunkler
 * Schlund (`nacht.0`), eine Zahnreihe an Kasten- und Deckelkante (`stein.5`), eine rote Zunge (`laub.1`/`laub.2`) und zwei
 * Glutaugen im Spalt (`feuer.4*` – sie ist ein Wächter der dunklen Gewölbe). Bauplan eigens: Kasten aus Flächen, Deckel als
 * halbes Ellipsoid über dem Scharnier hinten.
 *
 * Clips nach docs/ART.md §15.3: `tarnung` (eine Truhe, die kaum merklich atmet), `erwachen` 6@10 (= 0,6 s wie das KI-Profil:
 * der Deckel zuckt, hebt sich, die Augen glimmen auf, er klafft), `idle` (Deckel halb offen, Zunge), `move` 6@10 (hüpfend,
 * Events `schritt` 0/3), `attack_biss` 10@10 (Ausholen 0–4 = 0,5 s wie `ausholzeit`: der Deckel reißt weit auf · Schlag 5 ·
 * Treffer 6), `attack_schnappen` 9@10 (0,4 s), `hit`, `death` (kippt, der Deckel fällt schlaff auf).
 */
import { kreatur, type Bauplan } from '../../lib/creature';
import { angriffClip, idleClip, klip, pose, todClip, trefferClip, zyklusClip, type Werte } from '../../lib/creatureAnim';
import { KOERPER, rahmen, type Bau } from '../../lib/creatureBau';
import type { V3 } from '../../lib/creatureRender';
import { zeige } from '../../lib/creatureVierbeiner';

const w0 = (w: Werte, k: string): number => w[k] ?? 0;

/** Halbe Länge (vorn–hinten), halbe Breite, Kastenhöhe, Deckelhöhe [px]. */
const L = 4.6;
const B = 7;
const H = 5.6;
const D = 3.2;
/** Größter Öffnungswinkel des Deckels [Grad]. */
const AUF = 62;

/** Kasten aus vier ebenen Seiten (die Oberseite ist der Deckel bzw. der Schlund). */
function kasten(bau: Bau): void {
  const r = KOERPER;
  bau.flaeche('kasten', r, [
    [L, -B, 0],
    [L, B, 0],
    [L, B, H],
    [L, -B, H],
  ]);
  bau.flaeche('kasten', r, [
    [-L, -B, 0],
    [-L, B, 0],
    [-L, B, H],
    [-L, -B, H],
  ]);
  for (const s of [-B, B]) {
    bau.flaeche('kasten', r, [
      [-L, s, 0],
      [L, s, 0],
      [L, s, H],
      [-L, s, H],
    ]);
  }
  // Eisenbänder senkrecht über die Vorderseite und die Seiten, die Bodenleiste.
  for (const s of [-B * 0.55, B * 0.55]) bau.linie('band', r, [L + 0.15, s, 0.2], [L + 0.15, s, H], 1, 1);
  for (const s of [-B, B]) bau.linie('band', r, [-L, s * 1.02, 0.6], [L, s * 1.02, 0.6], 1, 0);
}

const plan: Bauplan = {
  materialien: {
    kasten: { stufen: ['holz.1', 'holz.2', 'holz.3'], schwellen: [0.4, 0.72] },
    deckel: { stufen: ['holz.1', 'holz.2', 'holz.3', 'holz.4'], schwellen: [0.36, 0.6, 0.84] },
    band: { stufen: ['stein.2'] },
    schloss: { stufen: ['stein.2', 'sand.3'] },
    schlund: { stufen: ['nacht.0'] },
    zunge: { stufen: ['laub.1', 'laub.2'], schwellen: [0.6] },
    zahn: { stufen: ['stein.5'] },
    auge: { stufen: ['feuer.4*'] },
  },
  hoeheBezug: H + D,
  kontur: 'nacht.1',
  verbreiterung: 1,
  haltung: (w: Werte) => ({
    dreh: { roll: w0(w, 'wackeln') + w0(w, 'roll'), nick: w0(w, 'nick') },
    drehpunkt: [0, 0, H * 0.5] as V3,
    versatz: [w0(w, 'vor'), 0, w0(w, 'hub') - w0(w, 'liegen') * 1.5] as V3,
    stauch: 1 + 0.06 * w0(w, 'atem') - 0.12 * w0(w, 'duck'),
  }),
  baue(bau: Bau, w: Werte, nur: ReadonlySet<string> | null): void {
    bau.teil('kasten', 'kasten', 'kasten');
    bau.teil('band', 'band', 'kasten');
    bau.teil('schloss', 'schloss', 'kasten');
    bau.teil('deckel', 'deckel', 'deckel');
    bau.teil('deckelband', 'band', 'deckel');
    bau.teil('schlund', 'schlund', 'schlund');
    bau.teil('zunge', 'zunge', 'schlund');
    bau.teil('zahn', 'zahn', 'schlund');
    bau.teil('auge', 'auge', 'schlund');
    const offen = w0(w, 'offen');
    if (zeige(nur, 'kasten')) {
      kasten(bau);
      if (offen > 0.05) {
        // Der Schlund: die dunkle Öffnung zwischen Kasten und Deckel, die Zunge darin.
        bau.flaeche('schlund', KOERPER, [
          [L * 0.92, -B * 0.92, H - 0.3],
          [L * 0.92, B * 0.92, H - 0.3],
          [-L * 0.92, B * 0.92, H - 0.3],
          [-L * 0.92, -B * 0.92, H - 0.3],
        ]);
        const zunge = w0(w, 'zunge');
        if (zunge > 0.05) bau.ellipsoid('zunge', KOERPER, [L * 0.2 + zunge * 2.2, 0, H + 0.2], [L * 0.55, B * 0.32, 0.9 + zunge * 0.4], { nick: -10 * zunge });
        // Zähne an der Oberkante des Kastens.
        for (let s = -B + 1.4; s <= B - 1.2; s += 2.2) bau.linie('zahn', KOERPER, [L - 0.2, s, H - 0.2], [L - 0.2, s, H + 0.9 * Math.min(1, offen * 1.6)], 1, 0);
      }
    }
    if (zeige(nur, 'deckel')) {
      // Der Deckel dreht um das Scharnier hinten oben.
      const winkel = AUF * offen;
      const r = rahmen(KOERPER, [-L, 0, H], { nick: winkel });
      bau.ellipsoid('deckel', r, [L, 0, 0], [L * 1.02, B * 1.02, D], {}, { schnitt: 0 });
      // Bänder über die Wölbung und das Schloss vorn.
      for (const s of [-B * 0.55, B * 0.55]) {
        const pts: V3[] = [];
        for (let k = 0; k <= 6; k++) {
          const t = (k / 6) * Math.PI;
          pts.push([L - Math.cos(t) * L * 1.04, s, Math.sin(t) * D * 1.04]);
        }
        bau.zug('deckelband', r, pts, 1, 1);
      }
      bau.punkt('schloss', r, [2 * L + 0.1, 0, 0.6], [1, 0, 0.1], [
        [0, 0, 'schloss', 1],
        [1, 0, 'schloss', 1],
        [0, 1, 'schloss', 0],
        [1, 1, 'schloss', 0],
      ]);
      if (offen > 0.15) {
        // Zähne an der Unterkante des Deckels, nach unten in den Schlund.
        for (let s = -B + 2.5; s <= B - 2; s += 2.2) bau.linie('zahn', r, [2 * L - 0.2, s, 0.1], [2 * L - 0.2, s, -0.9 * Math.min(1, offen * 1.6)], 1, 0);
        // Die Augen glimmen im Spalt unter dem Deckelrand.
        for (const seite of [-1, 1]) {
          bau.punkt('auge', r, [2 * L - 0.6, seite * 2.6, -0.7], [1, 0, -0.3], [[0, 0, 'auge', 0]], { nachAussen: true });
        }
      }
    }
  },
};

/** Erwacht: der Deckel halb offen, die Zunge im Schlund. */
const WACH = { offen: 0.55, zunge: 0.4 };

export const mimikTruhe = kreatur({
  id: 'mimik_truhe',
  zelle: 32,
  anker: [16, 24],
  hoehe: 'block',
  plan,
  clips: [
    idleClip(WACH, { ...WACH, offen: 0.62, atem: 1 }, { offen: 0.5, zunge: 0.6, atem: 1.4 }, { ...WACH, offen: 0.6 }),
    zyklusClip(
      'move',
      6,
      10,
      (ph) => {
        const sprung = Math.max(0, Math.sin(2 * Math.PI * ph));
        return { ...WACH, offen: 0.45 + 0.25 * sprung, hub: 3 * sprung, duck: Math.max(0, -Math.sin(2 * Math.PI * ph)), wackeln: 5 * Math.sin(4 * Math.PI * ph) };
      },
      [0, 3],
    ),
    angriffClip({
      name: 'biss',
      fps: 10,
      // Der Deckel reißt auf, der Kasten duckt sich – dann schnellt er vor und schnappt zu.
      aushol: [
        { offen: 0.8, zunge: 0.6, duck: 0.6, nick: -6 },
        { offen: 1, zunge: 0.9, duck: 1, nick: -10, vor: -1 },
      ],
      halten: 3,
      schlag: { offen: 0.3, zunge: 0.2, hub: 3, vor: 3, nick: 8 },
      schmierTeile: ['deckel'],
      treffer: { offen: 0, hub: 1, vor: 3.5, nick: 6 },
      nach: [{ offen: 0.3, vor: 1.5 }, { ...WACH }],
    }),
    angriffClip({
      name: 'schnappen',
      fps: 10,
      aushol: [
        { offen: 0.75, zunge: 0.5, duck: 0.4 },
        { offen: 0.95, zunge: 0.8, duck: 0.8, nick: -6 },
      ],
      halten: 2,
      schlag: { offen: 0.25, hub: 2, vor: 2.5, nick: 6 },
      schmierTeile: ['deckel'],
      treffer: { offen: 0, hub: 0.5, vor: 3, nick: 4 },
      nach: [{ offen: 0.3, vor: 1 }, { ...WACH }],
    }),
    trefferClip({ offen: 0.8, zunge: 0.2, vor: -1.5, wackeln: -10, nick: -6 }, { offen: 0.4, duck: 0.6, wackeln: 4 }),
    todClip(
      [
        { offen: 0.9, vor: -1, wackeln: -10, nick: -6 },
        { offen: 1, zunge: 1, roll: 14, duck: 0.5 },
        { offen: 1, zunge: 1, roll: 30, liegen: 0.5 },
        { offen: 0.85, zunge: 0.8, roll: 40, liegen: 0.8 },
        { offen: 0.8, zunge: 0.8, roll: 42, liegen: 0.9 },
      ],
      3,
    ),
    // Getarnt: eine Truhe, die kaum merklich atmet.
    klip('tarnung', 4, true, [pose({}), pose({ atem: 0.6 })], [0, 0, 0, 1, 1, 0, 0, 0]),
    klip(
      'erwachen',
      10,
      false,
      [pose({ offen: 0.12, wackeln: 4 }), pose({ offen: 0.05, wackeln: -4 }), pose({ offen: 0.3, hub: 1 }), pose({ offen: 0.7, zunge: 0.6, hub: 2, nick: -4 }), pose({ offen: 0.85, zunge: 0.8, hub: 0.5 }), pose(WACH)],
      [0, 1, 2, 3, 4, 5],
      [{ frame: 3, name: 'erwacht' }],
    ),
  ],
});

/** Im Kontaktbogen der Gewölbe-Kreaturen (`kreaturen-m7-gewoelbe.png`). */
export default mimikTruhe.sprite;
