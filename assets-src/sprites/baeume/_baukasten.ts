/**
 * Gemeinsamer Baukasten der 14 Baumarten (M2-20): aus einer Artbeschreibung entstehen drei Sprites mit
 * derselben Id-Wurzel wie das Welt-Objekt (docs/WORLD.md §7):
 * - `baum_<art>`: Frame 0 belaubt; Laubbäume zusätzlich Frame 1 kahl (Winter, Schnee auf den Ästen).
 *   Clips `fruehling`/`sommer`/`herbst`/`winter` nennen den Frame je Jahreszeit, Obstbäume haben dazu
 *   `abgeerntet` (belaubt ohne Früchte). Die Palettenzeile je Jahreszeit steht in `LAUB_ZEILEN`
 *   (assets-src/paletteRows.ts).
 * - `baum_<art>_stumpf`: Stumpf nach dem Fällen (Jahresringe, Rinde der Art).
 * - `baum_<art>_setzling`: Setzling (40 % Chance beim Fällen, §14).
 *
 * Stamm und Astgerüst werden einmal gezeichnet und von allen Frames geteilt: die kahle Krone zeigt
 * dasselbe Gerüst, das in der belaubten Krone durch Lücken und an der Unterkante sichtbar ist. Alle
 * Formen sind deterministisch (eigener Generator je Art).
 */
import type { Rng } from '../../../src/engine/rng';
import { defineGenerator, type GeneratorResult } from '../../lib/generator';
import { krone, type Krone, type KronenParameter } from '../../lib/foliage';
import { outlineOf } from '../../lib/foliageRelief';
import {
  Bild,
  KRONE_FLAGS,
  LAUB_GRAS,
  astGeruest,
  baumSprite,
  maleKrone,
  saeubere,
  schmueckeKrone,
  schneeAufAesten,
  stammUnterKrone,
  zeichneAeste,
  zeichneStamm,
  type Ast,
  type GeruestParameter,
  type KronenFarben,
  type KronenSchmuck,
  type RindenFarben,
  type SchnittFarben,
  type StammParameter,
} from '../../lib/tree';
import { MATERIAL_BITS, spriteFromPixels, type Sprite } from '../../lib/sprite';
import { stumpfSprite, type StumpfForm } from './_stumpf';

/** Kontaktbogen `baeume.png`. */
export const GRUPPE = 'baeume';

/** Frame-Index je Jahreszeit. */
export type Jahreszeiten = Readonly<Record<'fruehling' | 'sommer' | 'herbst' | 'winter', number>>;
/** Laubbaum: Winter kahl (Frame 1). */
export const LAUBWECHSEL: Jahreszeiten = { fruehling: 0, sommer: 0, herbst: 0, winter: 1 };
/** Immergrün: immer Frame 0 (Farbe über die Zeile der Jahreszeit). */
export const IMMERGRUEN: Jahreszeiten = { fruehling: 0, sommer: 0, herbst: 0, winter: 0 };

/** Kahle Krone (Winter): Schneefarben (hell, Schatten) oder `null` für keinen Schnee. */
export interface KahlParameter {
  readonly schnee: readonly [string, string] | null;
  /** Hängende Zweige (Weide): Länge in px, die von jeder Zweigspitze herabhängt. */
  readonly haengen?: number;
}

export interface StumpfArt {
  readonly form: StumpfForm;
  readonly schnitt: SchnittFarben;
  /** Eigene Rindenfarben des Stumpfes (Standard: Stammfarben). */
  readonly rinde?: RindenFarben;
}

export interface SetzlingArt {
  readonly w: number;
  readonly h: number;
  /** Eigene Zeichnung (Nadel-, Palmen- und Kristallsetzlinge); sonst kleine Laubkrone. */
  readonly zeichne?: (b: Bild, rng: Rng) => void;
  readonly massen?: KronenParameter['massen'];
  readonly stammHoehe?: number;
}

export interface BaumArt {
  readonly art: string;
  readonly seed: number;
  readonly w: number;
  readonly h: number;
  readonly stamm: Omit<StammParameter, 'x' | 'fuss'>;
  readonly fussX: number;
  readonly fussY: number;
  /** Unterste Stammzeile, wenn der Stamm über dem Boden endet (Stelzwurzeln); Standard `fussY`. */
  readonly stammFuss?: number;
  /** Zeichnet nach dem Stamm (Stelzwurzeln u. Ä.), in allen Frames gleich. */
  readonly amStamm?: (b: Bild) => void;
  /** Laubkrone aus Blattmassen (fehlt bei eigener Kronenzeichnung). */
  readonly krone?: KronenParameter;
  readonly kroneFarben?: KronenFarben;
  /** Zeile, ab der der Stamm unter der Krone verschattet ist. */
  readonly kroneUnten?: number;
  /** Astgerüst in der Kronenform (Raumkolonisation). */
  readonly geruest?: GeruestParameter;
  /** Abstand der Anziehungspunkte zur Kronenkontur (px, Standard 2; kleine Büschel 0). */
  readonly geruestRand?: number;
  /** Ab dieser Astdicke (px) scheinen Äste in der belaubten Krone durch. */
  readonly sichtbareAeste?: number;
  /** Eigene Kronenzeichnung (Nadelbäume, Palme, Kristallkrone), nach `krone` gemalt. */
  readonly eigeneKrone?: (b: Bild, rng: Rng) => void;
  readonly kahl?: KahlParameter;
  readonly jahreszeiten: Jahreszeiten;
  /** Früchte (Obstbäume): Frame „abgeerntet“ = belaubt ohne Schmuck. */
  readonly fruechte?: KronenSchmuck;
  readonly stumpf: StumpfArt;
  readonly setzling: SetzlingArt;
  readonly einzelpixel?: string;
}

/** Schrumpft eine Maske um `n` px (Anziehungspunkte bleiben innerhalb der Kronenkontur). */
function schrumpfe(mask: Uint8Array, w: number, h: number, n: number): Uint8Array {
  let cur = Uint8Array.from(mask);
  for (let i = 0; i < n; i++) {
    const next = Uint8Array.from(cur);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if ((cur[p] ?? 0) === 0) continue;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || cur[p - 1] === 0 || cur[p + 1] === 0 || cur[p - w] === 0 || cur[p + w] === 0) next[p] = 0;
      }
    }
    cur = next;
  }
  return cur;
}

/** Kleine Laubkrone für Setzlinge (glatte Massen, Kontur in der Kronenrampe). */
function setzlingLaub(rng: Rng, a: BaumArt, s: SetzlingArt): Bild {
  const b = new Bild(s.w, s.h);
  const f = a.stamm.farben;
  const fuss = s.h - 2;
  const x = Math.floor(s.w / 2);
  const top = fuss - (s.stammHoehe ?? 8);
  for (let y = top; y <= fuss; y++) {
    b.set(x - 1, y, f.kontur);
    b.set(x, y, y === fuss ? f.kontur : f.mitte);
    b.set(x + 1, y, f.kontur);
  }
  if (s.massen !== undefined) {
    const k = krone(rng, s.w, s.h, { massen: s.massen, buendel: 0, schwellen: [0.28, 0.42, 0.58, 0.74] });
    maleKrone(b, k, a.kroneFarben ?? LAUB_GRAS, 2);
  }
  return b;
}

/** Bild ohne Schmuck: an Schmuckpixeln die Pixel des schmucklosen Bildes. */
function ohneSchmuck(voll: Bild, leer: Bild, schmuck: Uint8Array): Bild {
  const b = voll.copy();
  schmuck.forEach((v, p) => {
    if (v === 0) return;
    b.index[p] = leer.index[p] ?? 0;
    b.emissive[p] = leer.emissive[p] ?? 0;
    b.material[p] = leer.material[p] ?? 0;
    b.hoehe[p] = leer.hoehe[p] ?? -1;
  });
  return b;
}

/** Erzeugt die drei Sprites einer Baumart. */
export function baumArt(a: BaumArt): GeneratorResult {
  return defineGenerator(`baum_${a.art}`, (rng: Rng): Sprite[] => {
    const stamm: StammParameter = { ...a.stamm, x: a.fussX, fuss: a.stammFuss ?? a.fussY };
    const stammBild = new Bild(a.w, a.h);
    zeichneStamm(stammBild, rng, stamm);
    a.amStamm?.(stammBild);
    const k: Krone | null = a.krone === undefined ? null : krone(rng, a.w, a.h, a.krone);
    let geruest: Ast[] = [];
    if (k !== null && a.geruest !== undefined) {
      const form = schrumpfe(k.relief.mask, a.w, a.h, a.geruestRand ?? 2);
      geruest = astGeruest(rng, form, a.w, a.fussX + (a.stamm.neigung ?? 0), a.stamm.oben + 2, a.stamm.breiteOben / 2, a.geruest);
    }
    // Frame 0: belaubt.
    const bild = stammBild.copy();
    zeichneAeste(bild, geruest.filter((g) => g.d0 >= (a.sichtbareAeste ?? 2.5)), stamm.farben);
    if (k !== null) {
      maleKrone(bild, k, a.kroneFarben ?? LAUB_GRAS);
      if (a.kroneUnten !== undefined) stammUnterKrone(bild, stamm, a.kroneUnten);
    }
    a.eigeneKrone?.(bild, rng);
    const frames: Bild[] = [];
    let extra: Record<string, number> | undefined;
    let schmuck: Uint8Array | null = null;
    const leer = bild.copy();
    if (a.fruechte !== undefined && k !== null) schmuck = schmueckeKrone(bild, rng, k, a.fruechte, KRONE_FLAGS);
    saeubere(bild, schmuck ?? undefined);
    frames.push(bild);
    // Frame 1: kahl.
    if (a.kahl !== undefined) {
      const kb = stammBild.copy();
      const haengend: Ast[] = [];
      if ((a.kahl.haengen ?? 0) > 0) {
        const starts = new Set(geruest.map((g) => `${Math.round(g.x0)},${Math.round(g.y0)}`));
        for (const g of geruest) {
          if (starts.has(`${Math.round(g.x1)},${Math.round(g.y1)}`)) continue;
          const len = (a.kahl.haengen ?? 0) * rng.float(0.55, 1);
          const aussen = Math.sign(g.x1 - a.fussX) * rng.float(0.5, 2);
          haengend.push({ x0: g.x1, y0: g.y1, x1: g.x1 + aussen, y1: g.y1 + len, d0: 1, d1: 1 });
        }
      }
      const astMaske = zeichneAeste(kb, [...geruest, ...haengend], stamm.farben);
      if (a.kahl.schnee !== null) schneeAufAesten(kb, astMaske, a.kahl.schnee[0], a.kahl.schnee[1]);
      saeubere(kb);
      frames.push(kb);
    }
    // Obstbäume: abgeerntet.
    if (schmuck !== null) {
      saeubere(leer);
      frames.push(ohneSchmuck(bild, leer, schmuck));
      extra = { abgeerntet: frames.length - 1 };
    }
    const baum = baumSprite(
      {
        id: `baum_${a.art}`,
        group: GRUPPE,
        w: a.w,
        h: a.h,
        fussX: a.fussX,
        fussY: a.fussY,
        stammHalb: a.stamm.breiteFuss / 2,
        jahreszeiten: a.jahreszeiten,
        ...(extra !== undefined ? { extraClips: extra } : {}),
        ...(a.einzelpixel !== undefined ? { einzelpixel: a.einzelpixel } : {}),
      },
      frames,
    );
    const stumpfBild = stumpfSprite({ id: `baum_${a.art}_stumpf`, group: GRUPPE, form: a.stumpf.form, rinde: a.stamm.rinde, farben: a.stumpf.rinde ?? a.stamm.farben, schnitt: a.stumpf.schnitt });
    const s = a.setzling;
    let sb: Bild;
    if (s.zeichne !== undefined) {
      sb = new Bild(s.w, s.h);
      s.zeichne(sb, rng);
    } else sb = setzlingLaub(rng, a, s);
    saeubere(sb);
    const sf = sb.frame();
    // Setzling: Blätter wiegen sich im Wind; kein Blätterdach (zu klein, um die Figur zu verdecken).
    const material = Uint8Array.from(sf.material ?? new Uint8Array(s.w * s.h), (v) => ((v & KRONE_FLAGS) !== 0 ? MATERIAL_BITS.wind : v));
    const setzling = spriteFromPixels(
      {
        id: `baum_${a.art}_setzling`,
        group: GRUPPE,
        size: [s.w, s.h],
        anchor: [Math.floor(s.w / 2), s.h - 2],
        hoehe: 'kugel',
        hitbox: [Math.floor(s.w / 2) - 2, s.h - 5, 4, 4],
        occluder: { kind: 'ellipse', x: s.w / 2, y: s.h - 2.5, rx: 1.5, ry: 1 },
      },
      [{ ...sf, material }],
    );
    return [baum, stumpfBild, setzling];
  }).generate(a.seed, undefined);
}

/** Kontur einer beliebigen Maske in `farbe` auf leeren Pixeln (für eigene Kronen). */
export function konturUm(b: Bild, mask: Uint8Array, farbe: string, material = 0): void {
  outlineOf(mask, b.w, b.h).forEach((v, p) => {
    if (v === 0 || (b.index[p] ?? 0) !== 0) return;
    b.set(p % b.w, Math.floor(p / b.w), farbe, material, 1);
  });
}
