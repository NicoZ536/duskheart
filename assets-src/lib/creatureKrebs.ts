/**
 * Bauplan Krebstier (M6, docs/ART.md §15): Krabbe (breiter, flacher Panzer, geht seitwärts und zeigt
 * dabei ihr Gesicht) und Scherenkrebs (Hummerform: Panzer mit gegliedertem Hinterleib, große Scheren nach
 * vorn, Fühler). Beine als Gelenkketten, die reihum anheben; Scheren aus Arm (Linie), Scherenhand
 * (Ellipsoid) und beweglichem Finger (Fläche); Augen auf Stielen.
 *
 * Posenwerte: `hub`, `vor`, `seite` (px), `nick`, `roll`/`liegen` (Tod), `gang` (Phase 0…1 der
 * Beinfolge), `gangHub` (px Beinhub), `schereL`/`schereR` (Grad gehoben), `schereVor` (px nach vorn),
 * `zangeL`/`zangeR` (0…1 geöffnet), `schwanz` (Grad eingerollt, Hummer), `augenZu`, `beineEin` (0…1
 * angezogen, Tod).
 */
import type { Bauplan } from './creature';
import type { Werte } from './creatureAnim';
import { type Bau, KOERPER, punktIn, rahmen, type KreaturRichtung, type Stempel } from './creatureBau';
import { plus, type KreaturMaterial, type V3, type Zeichnung } from './creatureRender';
import { fern, haltungVon, koerperRahmen, zeige, type Kugel } from './creatureVierbeiner';

export interface KrebsArt {
  readonly panzer: Kugel;
  /** Hinterleib (Hummer): Glieder hinter dem Panzer, jedes etwas schmaler. */
  /** Hinterleib (Hummer): Glieder, Länge, Maße und Grundkrümmung nach unten (Grad über alle Glieder). */
  readonly hinterleib?: { readonly glieder: number; readonly laenge: number; readonly breite: number; readonly hoehe: number; readonly kruemmung?: number };
  /** Augenstiele: Ansatz relativ zur Panzermitte (vorn, seitlich, oben), Stiellänge, Stempel. */
  readonly augen: { readonly f: number; readonly s: number; readonly u: number; readonly stiel: number; readonly seite: Stempel; readonly vorn: Stempel; readonly zu: Stempel };
  /** Laufbeine je Seite: erste Reihe (vorn, relativ), Abstand der Reihen, Reichweite, Kniehöhe. */
  readonly beine: { readonly paare: number; readonly f0: number; readonly abstand: number; readonly reichweite: number; readonly knie: number };
  /**
   * Scheren: Schulter (relativ zur Panzermitte), Armlänge, Scherenhand (Radien), Fingerlänge, Spreizung nach außen (Grad,
   * Standard 18; weiter gespreizt stehen die Scheren von vorn gesehen neben dem Körper statt vor ihm).
   */
  readonly scheren: { readonly f: number; readonly s: number; readonly u: number; readonly arm: number; readonly hand: V3; readonly finger: number; readonly spreizung?: number };
  readonly fuehler?: { readonly laenge: number };
  /** Gierwinkel je Richtung (Krabbe: im Profil zum Betrachter gedreht). */
  readonly gier?: Partial<Record<KreaturRichtung, number>>;
  readonly materialien: Readonly<Record<string, KreaturMaterial>>;
  readonly zeichnung?: Zeichnung;
  readonly hoeheBezug: number;
  /** Verbreiterung von vorn und hinten (Standard 1: Krebse sind schon breit). */
  readonly verbreiterung?: number;
}

const w0 = (w: Werte, k: string): number => w[k] ?? 0;
/** Standard-Spreizung der Scheren nach außen [Grad]. */
const SCHEREN_SPREIZUNG = 18;

export function krebs(art: KrebsArt): Bauplan {
  const rumpf = art.panzer;
  return {
    materialien: art.materialien,
    hoeheBezug: art.hoeheBezug,
    kontur: 'nacht.1',
    ...(art.zeichnung === undefined ? {} : { zeichnung: art.zeichnung }),
    haltung: (w: Werte) => haltungVon({ rumpf }, w),
    ...(art.gier === undefined ? {} : { gier: art.gier }),
    verbreiterung: art.verbreiterung ?? 1,
    baue(bau: Bau, w: Werte, nur: ReadonlySet<string> | null): void {
      bau.teil('panzer', 'panzer', 'koerper');
      bau.teil('hinterleib', 'panzer', 'hinterleib');
      bau.teil('auge', 'auge', 'auge');
      bau.teil('stiel', 'bein', 'auge');
      bau.teil('bein', 'bein', 'bein');
      bau.teil('schere', 'schere', 'schere');
      bau.teil('finger', 'schere', 'schere');
      bau.teil('fuehler', 'bein', 'fuehler');
      const koerper = koerperRahmen({ rumpf }, w);
      const [pf, ps, pu] = rumpf.r;
      if (zeige(nur, 'panzer')) {
        bau.ellipsoid('panzer', koerper, [0, 0, 0], rumpf.r, { nick: rumpf.nick ?? 0 });
        const hl = art.hinterleib;
        if (hl !== undefined) {
          let r = rahmen(koerper, [-pf * 0.85, 0, -pu * 0.1], { nick: 0 });
          const glied = hl.laenge / hl.glieder;
          for (let i = 0; i < hl.glieder; i++) {
            const k = 1 - (i / hl.glieder) * 0.35;
            bau.ellipsoid('hinterleib', r, [-glied * 0.5, 0, 0], [glied * 0.62, hl.breite * k, hl.hoehe * k]);
            r = rahmen(r, [-glied, 0, 0], { nick: -((hl.kruemmung ?? 0) + w0(w, 'schwanz')) / hl.glieder });
          }
          // Schwanzfächer.
          bau.flaeche('hinterleib', r, [
            [0, -hl.breite * 0.9, 0],
            [0, hl.breite * 0.9, 0],
            [-glied * 1.2, hl.breite * 1.2, -0.3],
            [-glied * 1.3, 0, -0.3],
            [-glied * 1.2, -hl.breite * 1.2, -0.3],
          ]);
        }
      }
      // Augen auf Stielen.
      if (zeige(nur, 'panzer')) {
        const au = art.augen;
        for (const seite of [-1, 1]) {
          const fuss = punktIn(koerper, [au.f, au.s * seite, au.u]);
          const kopf = punktIn(koerper, [au.f + au.stiel * 0.3, au.s * seite * 1.15, au.u + au.stiel]);
          bau.linie('stiel', KOERPER, fuss, kopf, 1, 1);
          const zu = w0(w, 'augenZu') > 0.5;
          bau.punkt('auge', KOERPER, kopf, null, zu ? au.zu : bau.richtung === 'right' && art.gier?.right === undefined ? au.seite : au.vorn, { nachAussen: true, obenauf: true });
        }
        if (art.fuehler !== undefined) {
          for (const seite of [-1, 1]) {
            const a = punktIn(koerper, [pf * 0.9, 0.6 * seite, pu * 0.2]);
            const m: V3 = plus(a, [art.fuehler.laenge * 0.5, 0.6 * seite, art.fuehler.laenge * 0.35]);
            const e: V3 = plus(m, [art.fuehler.laenge * 0.5, 0.4 * seite, -art.fuehler.laenge * 0.1]);
            bau.zug('fuehler', KOERPER, [a, m, e], 1, 0);
          }
        }
      }
      // Laufbeine: je Seite `paare` Gelenkketten; reihum angehoben.
      if (zeige(nur, 'bein')) {
        const b = art.beine;
        const ein = w0(w, 'beineEin');
        for (const seite of [-1, 1]) {
          for (let i = 0; i < b.paare; i++) {
            const f = b.f0 - i * b.abstand;
            const phase = w0(w, 'gang') + i * 0.5 + (seite > 0 ? 0.25 : 0);
            const hub = Math.max(0, Math.sin(2 * Math.PI * phase)) * w0(w, 'gangHub');
            const ansatz = punktIn(koerper, [f, ps * 0.8 * seite, -pu * 0.2]);
            const reich = b.reichweite * (1 - ein * 0.6);
            // Fächerförmig gespreizt (vordere Beine nach vorn, hintere nach hinten), damit sich die Beine im
            // Profil nicht zu einem Kamm stapeln; die ferne Seite sitzt einen halben Schritt versetzt.
            const facher = i - (b.paare - 1) / 2 + (seite < 0 ? 0.35 : 0);
            const knie: V3 = plus(ansatz, [-facher * 1.1, reich * 0.55 * seite, b.knie + hub * 0.5 - ein]);
            const spitze: V3 = [rumpf.f + f - facher * 2 + w0(w, 'vor'), (ps + reich) * seite + w0(w, 'seite'), hub + ein * 2];
            const st = fern(bau, seite, false) ? 0 : 1;
            bau.linie('bein', KOERPER, ansatz, knie, 1, st);
            bau.linie('bein', KOERPER, knie, spitze, 1, st);
          }
        }
      }
      // Scheren: Arm, Hand, beweglicher Finger.
      if (zeige(nur, 'schere')) {
        const sc = art.scheren;
        for (const seite of [-1, 1]) {
          const k = seite > 0 ? 'R' : 'L';
          const schulter = rahmen(koerper, [sc.f, sc.s * seite, sc.u], { nick: w0(w, `schere${k}`), gier: -seite * (sc.spreizung ?? SCHEREN_SPREIZUNG) });
          const hand = rahmen(schulter, [sc.arm + w0(w, 'schereVor'), 0, 0]);
          bau.linie('schere', schulter, [0, 0, 0], [sc.arm + w0(w, 'schereVor'), 0, 0], 2, 1);
          bau.ellipsoid('schere', hand, [sc.hand[0] * 0.6, 0, 0], sc.hand);
          const offen = w0(w, `zange${k}`) * 35;
          const finger = rahmen(hand, [sc.hand[0] * 1.1, 0, sc.hand[2] * 0.2], { nick: offen });
          bau.flaeche('finger', finger, [
            [0, -sc.hand[1] * 0.5, 0],
            [0, sc.hand[1] * 0.5, 0],
            [sc.finger, 0, -0.3],
          ]);
          const fest = rahmen(hand, [sc.hand[0] * 1.1, 0, -sc.hand[2] * 0.3], { nick: -offen * 0.3 });
          bau.flaeche('finger', fest, [
            [0, -sc.hand[1] * 0.5, 0],
            [0, sc.hand[1] * 0.5, 0],
            [sc.finger * 0.9, 0, 0.3],
          ]);
        }
      }
    },
  };
}
