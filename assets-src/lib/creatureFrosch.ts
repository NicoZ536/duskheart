/**
 * Bauplan Amphibie/Frosch (M6, docs/ART.md §15): gedrungener, vorn aufgerichteter Rumpf, breiter
 * flacher Kopf mit vorstehenden Augenkuppeln, Kehlsack, kurze Vorderbeine und gefaltete Sprungbeine
 * (Oberschenkel als Ellipsoid, Unterschenkel und Fuß als Linien), die sich beim Sprung nach hinten
 * strecken.
 *
 * Posenwerte: `hub`, `vor` (px), `nick` (Grad), `roll`/`liegen` (Tod), `sprung` (0…1 Sprungbeine
 * gestreckt), `vorder` (px Vorderbeine nach vorn), `vorderU` (px angehoben), `kehle` (0…1 Kehlsack
 * gebläht), `augenZu`, `maul` (0…1).
 */
import type { Bauplan } from './creature';
import type { Werte } from './creatureAnim';
import { type Bau, KOERPER, punktIn, type Stempel } from './creatureBau';
import { plus, type KreaturMaterial, type V3, type Zeichnung } from './creatureRender';
import { fern, haltungVon, koerperRahmen, zeige, type Kugel } from './creatureVierbeiner';

export interface FroschArt {
  readonly rumpf: Kugel;
  /** Kopf relativ zur Rumpfmitte (vorn, oben), Radien. */
  readonly kopf: { readonly f: number; readonly u: number; readonly r: V3 };
  /** Augenkuppeln relativ zur Kopfmitte, Radius; Pupillen-Stempel im Profil und von vorn. */
  readonly augen: { readonly f: number; readonly s: number; readonly u: number; readonly r: number; readonly seite: Stempel; readonly vorn: Stempel; readonly zu: Stempel };
  readonly kehle: { readonly f: number; readonly u: number; readonly r: V3 };
  readonly vorderbeine: { readonly f: number; readonly s: number; readonly laenge: number };
  readonly hinterbeine: { readonly f: number; readonly s: number; readonly oberschenkel: V3; readonly laenge: number };
  readonly materialien: Readonly<Record<string, KreaturMaterial>>;
  readonly zeichnung?: Zeichnung;
  readonly hoeheBezug: number;
}

const w0 = (w: Werte, k: string): number => w[k] ?? 0;

export function frosch(art: FroschArt): Bauplan {
  return {
    materialien: art.materialien,
    hoeheBezug: art.hoeheBezug,
    kontur: 'nacht.1',
    ...(art.zeichnung === undefined ? {} : { zeichnung: art.zeichnung }),
    haltung: (w: Werte) => haltungVon(art, w),
    baue(bau: Bau, w: Werte, nur: ReadonlySet<string> | null): void {
      bau.teil('rumpf', 'haut', 'koerper');
      bau.teil('kopf', 'haut', 'koerper');
      bau.teil('augenkuppel', 'haut', 'auge');
      bau.teil('pupille', 'pupille', 'auge');
      bau.teil('kehle', 'bauch', 'kehle');
      bau.teil('bein', 'bein', 'bein');
      bau.teil('schenkel', 'haut', 'schenkel');
      bau.teil('maul', 'maul', 'koerper');
      const koerper = koerperRahmen(art, w);
      const sprung = w0(w, 'sprung');
      if (zeige(nur, 'rumpf')) {
        bau.ellipsoid('rumpf', koerper, [0, 0, 0], art.rumpf.r, { nick: art.rumpf.nick ?? 0 });
        bau.ellipsoid('kopf', koerper, [art.kopf.f, 0, art.kopf.u], art.kopf.r);
        const k = art.kehle;
        const bl = 1 + 0.45 * w0(w, 'kehle');
        bau.ellipsoid('kehle', koerper, [k.f, 0, k.u - 0.3 * w0(w, 'kehle')], [k.r[0] * bl, k.r[1] * bl, k.r[2] * bl]);
        const au = art.augen;
        for (const seite of [-1, 1]) {
          const mitte: V3 = [art.kopf.f + au.f, au.s * seite, art.kopf.u + au.u];
          bau.ellipsoid('augenkuppel', koerper, mitte, [au.r, au.r, au.r]);
          // Pupille auf dem Pol der Kuppel, der zum Betrachter zeigt (Profil: seitlich, sonst vorn).
          const pol: V3 = bau.richtung === 'right' ? [-0.2, 0.4 * seite, 0.9] : [0.6, -0.45 * seite, 0.65];
          const zu = w0(w, 'augenZu') > 0.5;
          // Im Profil zeigt nur das nahe Auge eine Pupille (das ferne lugt als Kuppel darüber).
          if (bau.richtung !== 'up' && !(bau.richtung === 'right' && fern(bau, seite, false))) bau.punkt('pupille', koerper, plus(mitte, [pol[0] * au.r, pol[1] * au.r, pol[2] * au.r]), pol, zu ? au.zu : bau.richtung === 'right' ? au.seite : au.vorn, { nachAussen: true });
        }
        if (w0(w, 'maul') > 0.1) bau.ellipsoid('maul', koerper, [art.kopf.f + art.kopf.r[0] * 0.55, 0, art.kopf.u - art.kopf.r[2] * 0.35], [art.kopf.r[0] * 0.5, art.kopf.r[1] * 0.75, 0.4 + 0.8 * w0(w, 'maul')], {}, { tiefenVersatz: -0.2 });
      }
      if (zeige(nur, 'bein')) {
        const vb = art.vorderbeine;
        for (const seite of [-1, 1]) {
          const schulter = punktIn(koerper, [vb.f, vb.s * seite, 0]);
          const hand: V3 = [art.rumpf.f + vb.f + 0.6 + w0(w, 'vorder') + w0(w, 'vor'), vb.s * seite * 1.2, w0(w, 'vorderU')];
          const st = fern(bau, seite, false) ? 0 : 1;
          bau.linie('bein', KOERPER, schulter, hand, 1, st);
          bau.linie('bein', KOERPER, hand, plus(hand, [0.8, 0, 0]), 1, st);
          // Sprungbein als Z: Hüfte hinten → Knie vorn neben dem Bauch → Ferse hinten am Boden → Zehen nach vorn;
          // beim Sprung streckt sich die Kette nach hinten.
          const hb = art.hinterbeine;
          const t = sprung;
          const huefte = punktIn(koerper, [hb.f, hb.s * seite * 0.8, -0.2]);
          const ruhe = (a: V3, b: V3): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
          const basis = art.rumpf.f + w0(w, 'vor');
          const knie = ruhe([basis + hb.f + hb.laenge * 1.1, hb.s * seite * 1.15, 1.5 + w0(w, 'hub') * 0.5], plus(huefte, [-hb.laenge * 0.7, 0, -0.5]));
          const ferse = ruhe([basis + hb.f - hb.laenge * 0.25, hb.s * seite * 1.2, 0.3], plus(huefte, [-hb.laenge * 1.4, 0, -0.9]));
          const zehen = ruhe([basis + hb.f + hb.laenge * 0.55, hb.s * seite * 1.3, 0], plus(huefte, [-hb.laenge * 2, 0, -1.2]));
          bau.linie('bein', KOERPER, knie, ferse, 1, st);
          bau.linie('bein', KOERPER, ferse, zehen, 1, st);
          const mitteSchenkel: V3 = [(huefte[0] + knie[0]) / 2, (huefte[1] + knie[1]) / 2, (huefte[2] + knie[2]) / 2];
          const dx = knie[0] - huefte[0];
          const dz = knie[2] - huefte[2];
          const winkel = (Math.atan2(dz, dx) * 180) / Math.PI;
          bau.ellipsoid('schenkel', KOERPER, mitteSchenkel, [Math.max(hb.oberschenkel[0], Math.hypot(dx, dz) / 2 + 0.4), hb.oberschenkel[1], hb.oberschenkel[2]], { nick: winkel });
        }
      }
    },
  };
}
