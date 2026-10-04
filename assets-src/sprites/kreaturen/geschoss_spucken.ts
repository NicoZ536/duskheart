/**
 * Geschoss `spucken` des Speiers (M6, docs/ART.md §15): 16×16, ein Klumpen violett glühender Tinte mit hellem Kern
 * (`verderb.4*`), Hülle (`verderb.3*`), dunklem Glutrand (`verderb.2*`) und Tintenkontur (`verderb.1`), dahinter ein
 * Schweif und ein abreißender Tropfen; im Flug nach rechts gezeichnet (der Kampf-Renderer dreht ihn in die Flugrichtung).
 * Clips `flug` (Schleife: Klumpen wabert, Tropfen reißt ab und holt auf) und `aufprall` (zerplatzt in Spritzer).
 *
 * M6-Gate (kampf-nacht): vorher ein 5 × 6 px großer zweifarbiger Block – die Ringe kamen aus der Himmelsschattierung (oben
 * hell, unten dunkel), Rand und Tropfen in `verderb.1` gingen in der Nachttönung unter. Jetzt liegen die Ringe um die Mitte
 * der zur Kamera gewandten Fläche (jede Drehung zeigt Kern, Hülle, Rand), Schweif und Tropfen glühen selbst und sind
 * mindestens 2 px stark, damit die gedrehte Figur (Pixel für Pixel im Low-Res-Puffer) keine Einzelpixel verliert.
 */
import { geschoss } from '../../lib/creature';
import { klip, pose, type Werte } from '../../lib/creatureAnim';
import type { Bau } from '../../lib/creatureBau';
import { KOERPER, NEIGUNG } from '../../lib/creatureBau';
import type { Trefferort } from '../../lib/creatureRender';

const w0 = (w: Werte, k: string): number => w[k] ?? 0;

/** Blickrichtung zur Kamera in der Profilansicht (Welt: −y zur Kamera, z oben), etwas nach oben gekippt: der Kern sitzt oben vorn. */
const ZUR_KAMERA = (() => {
  const k = NEIGUNG.right;
  const n = Math.hypot(1, k + 0.15);
  return [-1 / n, (k + 0.15) / n] as const;
})();

/**
 * Ringe nach Zuwendung zur Kamera (Skalarprodukt Normale · Kamera): Kern, Hülle, darunter der Glutrand. Schweif und Tropfen
 * (2 px) brauchen eine tiefere Hüllschwelle, sonst bestünden sie nur aus Rand und glühten nachts kaum.
 */
const RINGE = { kern: 0.9, huelle: 0.6, tropfen: 0.3 } as const;

/** Maße in Kreaturraum-px: Flughöhe der Mitte, Klumpen, Schweif, Tropfen. */
const MASS = {
  hoehe: 6,
  klumpen: { f: 1, r: [3, 2.7, 2.6] },
  schweif: { f: -1.6, u: 0.2, r: [1.8, 1.2, 1.1] },
  tropfen: { f: -4.9, u: 0.4, r: 1, zurueck: 0.5 },
} as const;

/** Schweif und Tropfen ohne eigenen Kern: der helle Fleck bleibt einer, vorn im Klumpen. */
function ring(o: Trefferort): string {
  const z = o.normale[1] * ZUR_KAMERA[0] + o.normale[2] * ZUR_KAMERA[1];
  if (o.teil !== 'klumpen') return z > RINGE.tropfen ? 'huelle' : 'rand';
  if (z > RINGE.kern) return 'kern';
  return z > RINGE.huelle ? 'huelle' : 'rand';
}

const plan = {
  hoeheBezug: 8,
  kontur: 'verderb.1',
  verbreiterung: 1,
  materialien: {
    kern: { stufen: ['verderb.4*'] },
    huelle: { stufen: ['verderb.3*'] },
    rand: { stufen: ['verderb.2*'] },
  },
  zeichnung: ring,
  baue(bau: Bau, w: Werte): void {
    bau.teil('klumpen', 'huelle', 'klumpen');
    bau.teil('tropfen', 'huelle', 'tropfen');
    const platz = w0(w, 'platz');
    const wabern = w0(w, 'wabern');
    const [rf, rs, ru] = MASS.klumpen.r;
    const g = 1 - 0.5 * platz;
    if (platz < 0.95) bau.ellipsoid('klumpen', KOERPER, [MASS.klumpen.f * (1 - platz), 0, MASS.hoehe - platz * 4], [rf * g * (1 + 0.12 * wabern), rs * g, ru * g * (1 - 0.1 * wabern)]);
    const t = w0(w, 'tropfen');
    if (platz === 0) {
      // Schweif: verjüngt sich hinter dem Klumpen; der Tropfen reißt ab (t) und fällt etwas zurück.
      const sw = MASS.schweif;
      bau.ellipsoid('tropfen', KOERPER, [sw.f + 0.3 * wabern, 0, MASS.hoehe + sw.u], [sw.r[0] * (1 - 0.15 * t), sw.r[1], sw.r[2]]);
      const tr = MASS.tropfen;
      bau.ellipsoid('tropfen', KOERPER, [tr.f - t * tr.zurueck, 0, MASS.hoehe + tr.u], [tr.r, tr.r, tr.r]);
    } else {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.3;
        const d = 1.5 + platz * 4.5;
        bau.ellipsoid('tropfen', KOERPER, [Math.cos(a) * d, Math.sin(a) * d * 0.6, 2 + Math.sin(a) * 2 * (1 - platz)], [1.2 - platz * 0.3, 1.1, 1]);
      }
    }
  },
};

export default geschoss({
  name: 'spucken',
  zelle: 16,
  anker: [8, 12],
  plan,
  clips: [
    klip('flug', 12, true, [pose({ wabern: 0, tropfen: 0 }), pose({ wabern: 1, tropfen: 0.4 }), pose({ wabern: 0.5, tropfen: 0.8 }), pose({ wabern: -0.6, tropfen: 1 })], [0, 1, 2, 3]),
    klip('aufprall', 12, false, [pose({ platz: 0.3 }), pose({ platz: 0.6 }), pose({ platz: 0.85 }), pose({ platz: 1 })], [0, 1, 2, 3], [{ frame: 0, name: 'aufprall' }]),
  ],
});
