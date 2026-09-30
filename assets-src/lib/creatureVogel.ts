/**
 * Bauplan Vogel (M6, docs/ART.md §15): Bodenvogel (Wachtel) und Flieger (Möwe) aus einem Körper –
 * Rumpf, Kopf auf kurzem Hals, Schnabel (zwei gekreuzte Dreiecke, öffnet mit `schnabel`), Schwanzfächer,
 * Flügel (angelegt als Ellipsoid an der Flanke, gespreizt als gepfeilte Fläche mit dunkler Spitze, die
 * um die Längsachse schlägt) und dünne Läufe mit Zehen.
 *
 * Posenwerte: Körper `hub`, `vor` (px), `nick` (Grad), `roll`/`liegen` (Tod); Kopf `kopfNick`,
 * `kopfVor`, `kopfHub`, `schnabel` (0…1), `augenZu`; Flügel `fluegel` (0 angelegt … 1 gespreizt),
 * `schlag` (Grad, hoch +); Läufe `lF`/`rF` (px vor), `lU`/`rU` (px angehoben), `beineEin` (0…1
 * eingezogen im Flug); `schwanz` (Grad hoch +), `faecher` (0…1 gespreizt).
 */
import type { Bauplan } from './creature';
import type { Werte } from './creatureAnim';
import { type Bau, KOERPER, punktIn, rahmen, type Stempel } from './creatureBau';
import { normiere, plus, type KreaturMaterial, type V3, type Zeichnung } from './creatureRender';
import { fern, haltungVon, koerperRahmen, zeige, type Kugel } from './creatureVierbeiner';

export interface VogelArt {
  readonly rumpf: Kugel;
  readonly kopf: Kugel & { readonly gelenk: readonly [number, number] };
  /** Schnabel relativ zur Kopfmitte: Ansatz (vorn, oben), Länge, Breite, Höhe; Material `schnabel`. */
  readonly schnabel: { readonly f: number; readonly u: number; readonly laenge: number; readonly breite: number; readonly hoehe: number; readonly neigung?: number };
  readonly augen: { readonly f: number; readonly s: number; readonly u: number; readonly seite: Stempel; readonly vorn: Stempel; readonly zu?: Stempel };
  /** Schwanzfächer: Ansatz (Kreaturraum), Länge, Breite, Winkel (Grad, hoch +). */
  readonly schwanz: { readonly f: number; readonly u: number; readonly laenge: number; readonly breite: number; readonly winkel: number };
  /** Flügel: Schulter (Kreaturraum), Spannweite und Tiefe gespreizt, angelegt als Ellipsoid (Radien). */
  readonly fluegel: { readonly f: number; readonly u: number; readonly s: number; readonly spanne: number; readonly tiefe: number; readonly angelegt: V3; readonly spitze: number };
  readonly beine: { readonly f: number; readonly spur: number; readonly laenge: number; readonly zehen: number };
  readonly materialien: Readonly<Record<string, KreaturMaterial>>;
  readonly zeichnung?: Zeichnung;
  readonly hoeheBezug: number;
  readonly extra?: (bau: Bau, r: { readonly kopf: ReturnType<typeof rahmen>; readonly koerper: ReturnType<typeof rahmen>; readonly w: Werte; readonly nur: ReadonlySet<string> | null }) => void;
}

const w0 = (w: Werte, k: string): number => w[k] ?? 0;

/** Vogel-Bauplan aus einer Artbeschreibung. */
export function vogel(art: VogelArt): Bauplan {
  const C: V3 = [art.rumpf.f, 0, art.rumpf.u];
  const imKoerper = (f: number, s: number, u: number): V3 => [f - C[0], s, u - C[2]];
  return {
    materialien: art.materialien,
    hoeheBezug: art.hoeheBezug,
    kontur: 'nacht.1',
    ...(art.zeichnung === undefined ? {} : { zeichnung: art.zeichnung }),
    haltung: (w: Werte) => haltungVon(art, w),
    baue(bau: Bau, w: Werte, nur: ReadonlySet<string> | null): void {
      bau.teil('rumpf', 'gefieder', 'koerper');
      bau.teil('kopf', 'kopf', 'kopf');
      bau.teil('schnabel', 'schnabel', 'schnabel');
      bau.teil('auge', 'auge', 'kopf');
      bau.teil('fluegel', 'fluegel', 'fluegel');
      bau.teil('spitze', 'spitze', 'fluegel');
      bau.teil('schwanz', 'schwanz', 'schwanz');
      bau.teil('bein', 'bein', 'bein');

      const koerper = koerperRahmen(art, w);
      if (zeige(nur, 'rumpf')) bau.ellipsoid('rumpf', koerper, [0, 0, 0], art.rumpf.r, { nick: art.rumpf.nick ?? 0 });

      // Kopf und Schnabel.
      const [gf, gu] = art.kopf.gelenk;
      const gelenk = rahmen(koerper, imKoerper(gf + w0(w, 'kopfVor'), 0, gu + w0(w, 'kopfHub')), { nick: w0(w, 'kopfNick') });
      const kopf = rahmen(gelenk, [art.kopf.f - gf, 0, art.kopf.u - gu]);
      if (zeige(nur, 'kopf')) {
        bau.ellipsoid('kopf', kopf, [0, 0, 0], art.kopf.r);
        const sn = art.schnabel;
        const oben = rahmen(kopf, [sn.f, 0, sn.u], { nick: (sn.neigung ?? 0) + w0(w, 'schnabel') * 12 });
        const unten = rahmen(kopf, [sn.f, 0, sn.u], { nick: (sn.neigung ?? 0) - w0(w, 'schnabel') * 18 });
        const b = sn.breite / 2;
        for (const r of [oben, unten]) {
          const h = r === oben ? sn.hoehe * 0.6 : -sn.hoehe * 0.4;
          bau.flaeche('schnabel', r, [
            [0, -b, 0],
            [0, b, 0],
            [sn.laenge, 0, 0],
          ]);
          bau.flaeche('schnabel', r, [
            [0, 0, h],
            [0, 0, 0],
            [sn.laenge, 0, 0],
          ]);
        }
        const au = art.augen;
        for (const seite of [-1, 1]) {
          const [rf, rs, ru] = art.kopf.r;
          const n = normiere([au.f / (rf * rf), (au.s * seite) / (rs * rs), au.u / (ru * ru)]);
          const zu = w0(w, 'augenZu') > 0.5;
          bau.punkt('auge', kopf, [au.f, au.s * seite, au.u], n, zu ? (au.zu ?? au.seite) : bau.richtung === 'right' ? au.seite : au.vorn, { nachAussen: true });
        }
      }

      // Schwanzfächer.
      if (zeige(nur, 'schwanz')) {
        const sw = art.schwanz;
        const r = rahmen(koerper, imKoerper(sw.f, 0, sw.u), { nick: 180 - sw.winkel - w0(w, 'schwanz') });
        const b = (sw.breite / 2) * (1 + 0.5 * w0(w, 'faecher'));
        bau.flaeche('schwanz', r, [
          [0, -b * 0.5, 0],
          [0, b * 0.5, 0],
          [sw.laenge, b, 0],
          [sw.laenge * 1.05, 0, 0],
          [sw.laenge, -b, 0],
        ]);
      }

      // Flügel: angelegt (Ellipsoid) oder gespreizt (Fläche, schlägt um die Längsachse).
      if (zeige(nur, 'fluegel')) {
        const fl = art.fluegel;
        const offen = w0(w, 'fluegel');
        for (const seite of [-1, 1]) {
          const schulter = rahmen(koerper, imKoerper(fl.f, fl.s * seite, fl.u), { roll: -seite * w0(w, 'schlag') });
          if (offen < 0.35) {
            const [a, bq, c] = fl.angelegt;
            bau.ellipsoid('fluegel', schulter, [-a * 0.55, 0, -c * 0.2], [a, bq, c], { nick: -8 });
          } else {
            const sp = fl.spanne * offen * seite;
            const t = fl.tiefe;
            const knick = sp * 0.55;
            const innen: V3[] = [
              [t * 0.35, 0, 0],
              [t * 0.2, knick, 0],
              [-t * 0.7, knick, 0],
              [-t * 0.6, 0, 0],
            ];
            const aussen: V3[] = [
              [t * 0.2, knick, 0],
              [-t * 0.05, sp, 0],
              [-t * 0.3, sp * 0.97, 0],
              [-t * 0.7, knick, 0],
            ];
            bau.flaeche('fluegel', schulter, innen);
            bau.flaeche(fl.spitze > 0 ? 'spitze' : 'fluegel', schulter, aussen);
          }
        }
      }

      // Läufe mit Zehen (im Flug eingezogen).
      if (zeige(nur, 'bein')) {
        const bn = art.beine;
        const ein = w0(w, 'beineEin');
        for (const seite of [-1, 1]) {
          const k = seite > 0 ? 'r' : 'l';
          const huefte = punktIn(koerper, imKoerper(bn.f, bn.spur * seite, art.rumpf.u - art.rumpf.r[2] * 0.7));
          const boden: V3 = [bn.f + w0(w, `${k}F`) + w0(w, 'vor'), bn.spur * seite, w0(w, `${k}U`)];
          const eingezogen: V3 = plus(huefte, [-bn.laenge * 0.6, 0, -1]);
          const fuss: V3 = ein > 0 ? [boden[0] + (eingezogen[0] - boden[0]) * ein, boden[1] + (eingezogen[1] - boden[1]) * ein, boden[2] + (eingezogen[2] - boden[2]) * ein] : boden;
          const stufe = fern(bau, seite, false) ? 0 : 1;
          bau.linie('bein', KOERPER, huefte, fuss, 1, stufe);
          if (bn.zehen > 0 && ein < 0.5) bau.linie('bein', KOERPER, fuss, plus(fuss, [bn.zehen, 0, 0]), 1, stufe);
        }
      }

      art.extra?.(bau, { kopf, koerper, w, nur });
    },
  };
}
