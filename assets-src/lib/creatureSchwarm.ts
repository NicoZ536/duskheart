/**
 * Bauplan Insektenschwarm (M6, docs/ART.md §15): eine Wolke kleiner Insekten (Wespen, Glühwürmchen) –
 * jedes Tier ist ein handgesetzter Stempel (Körper, Flügel oben/unten), der auf einer eigenen,
 * geschlossenen Bahn um die Schwarmmitte kreist. Die Bahnen sind aus einem Seed fest, ganzzahlige
 * Umläufe je Zyklus schließen jede Schleife nahtlos. Die Kontur zieht der Renderer um jedes Tier.
 *
 * Posenwerte: `phase` (0…1 im Bewegungszyklus), `dichte` (0…1 zieht den Schwarm zusammen), `vor` (px
 * zur Blickrichtung), `hub` (px), `streuung` (0…1 treibt die Tiere auseinander – Treffer), `fall`
 * (0…1 Tiere sinken zu Boden – Tod), `leuchten` (0…1 Leuchtstärke der Glühwürmchen).
 */
import { Rng } from '../../src/engine/rng';
import type { Bauplan } from './creature';
import type { Werte } from './creatureAnim';
import { type Bau, KOERPER, type Stempel } from './creatureBau';
import type { KreaturMaterial, V3 } from './creatureRender';

export interface Insekt {
  /** Stempel mit Flügeln oben und unten (Flügelschlag wechselt je Frame). */
  readonly oben: Stempel;
  readonly unten: Stempel;
  /** Am Boden liegend (Tod). */
  readonly liegend: Stempel;
  /** Leuchtende Variante (Glühwürmchen): ersetzt `oben`/`unten`, wenn `leuchten` ≥ 0,5. */
  readonly hell?: { readonly oben: Stempel; readonly unten: Stempel };
}

export interface SchwarmArt {
  readonly anzahl: number;
  /** Halbachsen der Schwarmwolke (vorn, seitlich, oben) und Schwebehöhe der Mitte. */
  readonly wolke: V3;
  readonly hoehe: number;
  readonly insekt: Insekt;
  /** Bahnradius relativ zur Wolke (Standard 0,25; klein = die Tiere schweben ruhig an ihrem Platz). */
  readonly bahn?: number;
  readonly seed: number;
  readonly materialien: Readonly<Record<string, KreaturMaterial>>;
}

interface Bahn {
  readonly mitte: V3;
  readonly radius: V3;
  readonly umlaeufe: number;
  readonly phase: number;
  readonly flatter: number;
}

export function schwarm(art: SchwarmArt): Bauplan {
  const rng = new Rng(art.seed);
  const bahn = art.bahn ?? 0.25;
  // Bahnmitten gleichmäßig auf einer Spirale verteilt (keine Klumpen), Bahnradien klein dagegen.
  const bahnen: Bahn[] = Array.from({ length: art.anzahl }, (_, i) => {
    const t = (i + 0.5) / art.anzahl;
    const winkel = i * 2.39996;
    const r = Math.sqrt(t) * 0.75;
    return {
    // Höhen in drei Lagen (unten, Mitte, oben), damit sich die Tiere nicht zu einem Band stapeln.
    mitte: [Math.cos(winkel) * r * art.wolke[0], Math.sin(winkel) * r * art.wolke[1], (((i % 3) - 1) * 0.6 + rng.float(-0.1, 0.1)) * art.wolke[2]],
    radius: [rng.float(0.72, 1.2) * bahn * art.wolke[0], rng.float(0.72, 1.2) * bahn * art.wolke[1], rng.float(0.2, 0.4) * art.wolke[2]],
    umlaeufe: 1 + (i % 2),
    phase: rng.float(0, 1),
    flatter: i % 2,
    };
  });
  return {
    materialien: art.materialien,
    hoeheBezug: art.hoehe + art.wolke[2],
    kontur: 'nacht.1',
    verbreiterung: 1,
    baue(bau: Bau, w: Werte): void {
      bau.teil('insekt', 'koerper', 'insekt');
      const ph = w['phase'] ?? 0;
      const dichte = 1 - 0.55 * (w['dichte'] ?? 0);
      const streu = 1 + 0.9 * (w['streuung'] ?? 0);
      const fall = w['fall'] ?? 0;
      const vor = w['vor'] ?? 0;
      const hub = w['hub'] ?? 0;
      const orte = bahnen.map((b, i) => {
        const a = 2 * Math.PI * (b.umlaeufe * ph + b.phase);
        const r = dichte * streu;
        const f = b.mitte[0] * r + Math.cos(a) * b.radius[0] * r + vor;
        const s = b.mitte[1] * r + Math.sin(a) * b.radius[1] * r;
        const schwebe = art.hoehe + hub + b.mitte[2] + Math.sin(2 * a) * b.radius[2];
        const u = schwebe * (1 - fall) + 0.5 * fall;
        return { ort: [f, s, u] as V3, i, b };
      });
      // Maler-Reihenfolge: hintere Tiere zuerst (die Stempel liegen obenauf).
      const tiefe = (p: V3): number => bau.weltPunkt(p)[1];
      orte.sort((p, q) => tiefe(q.ort) - tiefe(p.ort) || p.i - q.i);
      const frameGerade = Math.round(ph * 12) % 2 === 0;
      for (const { ort, b } of orte) {
        const liegt = fall > 0.85;
        const hell = (w['leuchten'] ?? 0) >= 0.5 && art.insekt.hell !== undefined && ((b.flatter === 0) === frameGerade || (w['leuchten'] ?? 0) >= 0.95);
        const oben = (b.flatter === 0) === frameGerade;
        const st = liegt ? art.insekt.liegend : hell && art.insekt.hell !== undefined ? (oben ? art.insekt.hell.oben : art.insekt.hell.unten) : oben ? art.insekt.oben : art.insekt.unten;
        bau.punkt('insekt', KOERPER, ort, null, st, { obenauf: true });
      }
    },
  };
}
