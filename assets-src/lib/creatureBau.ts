/**
 * Baukasten der Kreaturkörper (M6, docs/ART.md §15): lokale Rahmen (Gelenke), Drehungen und die Abbildung
 * des Kreaturraums in die Welt je Blickrichtung. Ein Bauplan beschreibt seinen Körper im **Kreaturraum**:
 * `f` nach vorn (Schnauze), `s` zur rechten Körperseite, `u` nach oben; Ursprung = Mitte der Standfläche
 * auf dem Boden (= Anker des Sprites). `Bau` sammelt die Grundformen eines Frames bereits in Weltlage.
 *
 * Blickrichtungen: `right` (Profil, rechte Körperseite zum Betrachter), `down` (Gesicht zum Betrachter),
 * `up` (Rücken zum Betrachter). `left` entsteht im Renderer durch Spiegeln von `right` (`spiegelbar`) –
 * bis auf den Strandräuber (Waffenhand) sind alle Kreaturen symmetrisch gebaut.
 */
import type { Achsen, KreaturMaterial, Primitiv, StempelPixel, Szene, TeilDef, V3, Zeichnung } from './creatureRender';
import { normiere, plus } from './creatureRender';

/** Gezeichnete Blickrichtungen (left = gespiegeltes right). */
export const KREATUR_RICHTUNGEN = ['down', 'up', 'right'] as const;
export type KreaturRichtung = (typeof KREATUR_RICHTUNGEN)[number];

/** Grad → Bogenmaß. */
export const GRAD = Math.PI / 180;
/**
 * Verkürzung der Körperlänge von vorn und hinten gesehen: die Aufsicht zeigt Kreaturen dort gedrungener
 * (wie handgezeichnete SNES-Sprites), damit Kopf, Brust und Rücken zusammen lesbar bleiben.
 */
export const VERKUERZUNG = 0.66;
/** Verbreiterung von vorn und hinten gesehen: Schultern und Kopf tragen die Silhouette. */
export const VERBREITERUNG = 1.3;
/** Radius der Smear-Nachzieher relativ zum Teil. */
export const NACHZIEHER_SCHMAL = 0.72;
/** Kameraneigung je Blickrichtung (`sy = z + k · y`): im Profil flach, von vorn und hinten steil. */
export const NEIGUNG: Readonly<Record<KreaturRichtung, number>> = { right: 0.55, down: 0.65, up: 0.7 };

/** Drehung eines lokalen Rahmens in Grad: Nicken (Schnauze hoch +), Gieren (nach rechts +), Rollen (rechte Seite runter +). */
export interface Dreh {
  readonly nick?: number;
  readonly gier?: number;
  readonly roll?: number;
}

/** Ein Rahmen im Kreaturraum: Ursprung und Achsen (vorn, rechts, oben). */
export interface Rahmen {
  readonly o: V3;
  readonly a: Achsen;
}

export const KOERPER: Rahmen = {
  o: [0, 0, 0],
  a: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
};

/** Vektor aus Rahmenkoordinaten (vorn, rechts, oben) in Elternkoordinaten (ohne Ursprung). */
export function richtungIn(r: Rahmen, v: V3): V3 {
  const [f, s, u] = r.a;
  return [f[0] * v[0] + s[0] * v[1] + u[0] * v[2], f[1] * v[0] + s[1] * v[1] + u[1] * v[2], f[2] * v[0] + s[2] * v[1] + u[2] * v[2]];
}

/** Punkt aus Rahmenkoordinaten in Elternkoordinaten. */
export function punktIn(r: Rahmen, p: V3): V3 {
  return plus(r.o, richtungIn(r, p));
}

/** Dreht die Achsen eines Rahmens um seine eigenen Achsen: erst Gieren, dann Nicken, dann Rollen. */
function gedreht(a: Achsen, d: Dreh): Achsen {
  let [f, s, u] = a;
  const gier = (d.gier ?? 0) * GRAD;
  if (gier !== 0) {
    const c = Math.cos(gier);
    const k = Math.sin(gier);
    [f, s] = [normiere(plus(scale(f, c), scale(s, k))), normiere(plus(scale(s, c), scale(f, -k)))];
  }
  const nick = (d.nick ?? 0) * GRAD;
  if (nick !== 0) {
    const c = Math.cos(nick);
    const k = Math.sin(nick);
    [f, u] = [normiere(plus(scale(f, c), scale(u, k))), normiere(plus(scale(u, c), scale(f, -k)))];
  }
  const roll = (d.roll ?? 0) * GRAD;
  if (roll !== 0) {
    const c = Math.cos(roll);
    const k = Math.sin(roll);
    [s, u] = [normiere(plus(scale(s, c), scale(u, -k))), normiere(plus(scale(u, c), scale(s, k)))];
  }
  return [f, s, u];
}

function scale(v: V3, k: number): V3 {
  return [v[0] * k, v[1] * k, v[2] * k];
}

/** Kindrahmen: Ursprung in Elternkoordinaten des Rahmens `eltern`, gedreht um `dreh`. */
export function rahmen(eltern: Rahmen, o: V3, dreh: Dreh = {}): Rahmen {
  return { o: punktIn(eltern, o), a: gedreht(eltern.a, dreh) };
}

/** Globale Haltung eines Frames: Versatz und Drehung des ganzen Körpers um einen Drehpunkt. */
export interface Haltung {
  readonly versatz?: V3;
  readonly dreh?: Dreh;
  /** Drehpunkt im Kreaturraum (Standard: Ursprung). */
  readonly drehpunkt?: V3;
  /** Senkrechte Stauchung um den Boden (1 = keine; Antizipation < 1, Streckung > 1). */
  readonly stauch?: number;
}

/** Weltachsen je Richtung: Bilder von vorn, rechts, oben. */
const RICHTUNGSACHSEN: Readonly<Record<KreaturRichtung, Achsen>> = {
  right: [
    [1, 0, 0],
    [0, -1, 0],
    [0, 0, 1],
  ],
  down: [
    [0, -1, 0],
    [-1, 0, 0],
    [0, 0, 1],
  ],
  up: [
    [0, 1, 0],
    [1, 0, 0],
    [0, 0, 1],
  ],
};

/** Stempel-Kurzform: [dx, dy, material, stufe]. */
export type Stempel = readonly (readonly [number, number, string, number])[];

function stempel(s: Stempel): StempelPixel[] {
  return s.map(([dx, dy, material, stufe]) => ({ dx, dy, material, stufe }));
}

export interface EllipsoidOpt {
  readonly schnitt?: number;
  readonly stufe?: number;
  readonly tiefenVersatz?: number;
}

/**
 * Sammelt die Grundformen eines Frames. Alle Koordinaten sind im Kreaturraum (bzw. in einem Rahmen
 * darin); `Bau` wendet Haltung und Blickrichtung an.
 */
export class Bau {
  private readonly teile: TeilDef[] = [];
  private readonly teilNr = new Map<string, number>();
  private readonly prims: Primitiv[] = [];
  private readonly welt: Achsen;
  private haltung: Achsen;
  private h: Haltung = {};
  /** Nachzieher-Modus (Smear): Tiefenversatz und feste Stufe; Merkmale entfallen. */
  private schmierTiefe = 0;
  private schmierStufe: number | null = null;

  constructor(
    readonly richtung: KreaturRichtung,
    private readonly breite: number = VERBREITERUNG,
    private readonly massstab: number = 1,
  ) {
    this.welt = RICHTUNGSACHSEN[richtung];
    this.haltung = KOERPER.a;
  }

  /** Setzt die Haltung für die folgenden Grundformen (je Pose, auch je Nachzieher). */
  halte(h: Haltung): void {
    this.h = h;
    this.haltung = gedreht(KOERPER.a, h.dreh ?? {});
  }

  /** Schaltet den Nachzieher-Modus (Smear) ein (`stufe` ≠ null) oder aus. */
  nachzieher(tiefe: number, stufe: number | null): void {
    this.schmierTiefe = tiefe;
    this.schmierStufe = stufe;
  }

  /** Ob gerade Nachzieher gezeichnet werden. */
  get imSmear(): boolean {
    return this.schmierStufe !== null;
  }

  private smearOpt(): { tiefenVersatz?: number; stufe?: number } {
    return this.schmierStufe === null ? {} : { tiefenVersatz: this.schmierTiefe, stufe: this.schmierStufe };
  }

  /** Meldet ein Teil an (Material, Gruppe); liefert seine Nummer. */
  teil(name: string, material: string, gruppe: string = name): number {
    const vorhanden = this.teilNr.get(name);
    if (vorhanden !== undefined) return vorhanden;
    const nr = this.teile.length;
    this.teile.push({ name, material, gruppe });
    this.teilNr.set(name, nr);
    return nr;
  }

  private nr(name: string): number {
    const n = this.teilNr.get(name);
    if (n === undefined) throw new Error(`Kreatur: Teil ${name} nicht angemeldet`);
    return n;
  }

  /** Verkürzung der Körperlänge in den Blickrichtungen von vorn und hinten (Stilmittel der Aufsicht). */
  private get verkuerzung(): number {
    return this.richtung === 'right' ? 1 : VERKUERZUNG;
  }

  /** Verbreiterung der Körperbreite von vorn und hinten. */
  private get verbreiterung(): number {
    return this.richtung === 'right' ? 1 : this.breite;
  }

  /** Kreaturraum → Welt (Haltung, Stauchung, Verkürzung, Richtung). */
  weltPunkt(p: V3): V3 {
    const dp = this.h.drehpunkt ?? [0, 0, 0];
    const lokal: V3 = [p[0] - dp[0], p[1] - dp[1], p[2] - dp[2]];
    const g = plus(dp, richtungIn({ o: [0, 0, 0], a: this.haltung }, lokal));
    const v = this.h.versatz ?? [0, 0, 0];
    return this.skaliert([g[0] + v[0], g[1] + v[1], g[2] + v[2]]);
  }

  /** Stauchung (senkrecht), Verkürzung (Länge) und Richtung auf einen Kreaturraum-Vektor. */
  private skaliert(q: V3): V3 {
    const st = this.h.stauch ?? 1;
    const m = this.massstab;
    return richtungIn({ o: [0, 0, 0], a: this.welt }, [q[0] * this.verkuerzung * m, q[1] * this.verbreiterung * m, q[2] * st * m]);
  }

  /** Richtung im Kreaturraum → Welt (Drehung der Haltung und Richtung, ohne Skalierung). */
  weltRichtung(v: V3): V3 {
    return richtungIn({ o: [0, 0, 0], a: this.welt }, richtungIn({ o: [0, 0, 0], a: this.haltung }, v));
  }

  /** Linearer Anteil der Abbildung Kreaturraum → Welt (für Ellipsoid-Halbachsen). */
  private weltLinear(v: V3): V3 {
    return this.skaliert(richtungIn({ o: [0, 0, 0], a: this.haltung }, v));
  }

  /** Ellipsoid im Rahmen `r` (Mitte in Rahmenkoordinaten, Radien vorn/seitlich/oben, eigene Drehung). */
  ellipsoid(teil: string, r: Rahmen, mitte: V3, radienVoll: V3, dreh: Dreh = {}, opt: EllipsoidOpt = {}): void {
    // Nachzieher sind schmaler als das Teil selbst: der Smear verjüngt sich zur Bewegungsspur.
    const radien: V3 = this.imSmear ? [radienVoll[0] * NACHZIEHER_SCHMAL, radienVoll[1] * NACHZIEHER_SCHMAL, radienVoll[2] * NACHZIEHER_SCHMAL] : radienVoll;
    const [af, as, au] = gedreht(r.a, dreh);
    const matrix: Achsen = [this.weltLinear(scale(af, radien[0])), this.weltLinear(scale(as, radien[1])), this.weltLinear(scale(au, radien[2]))];
    this.prims.push({ art: 'ellipsoid', teil: this.nr(teil), mitte: this.weltPunkt(punktIn(r, mitte)), matrix, ...opt, ...this.smearOpt() });
  }

  /** Ebenes, konvexes Vieleck (Punkte im Rahmen `r`). */
  flaeche(teil: string, r: Rahmen, punkte: readonly V3[], opt: { stufe?: number; tiefenVersatz?: number } = {}): void {
    this.prims.push({ art: 'flaeche', teil: this.nr(teil), punkte: punkte.map((p) => this.weltPunkt(punktIn(r, p))), ...opt, ...this.smearOpt() });
  }

  /** Linie fester Pixelbreite (Beine, Fühler). */
  linie(teil: string, r: Rahmen, von: V3, bis: V3, breite: number, stufe: number, opt: { material?: string; tiefenVersatz?: number } = {}): void {
    const sm = this.smearOpt();
    const b = this.imSmear ? Math.max(1, breite - 1) : breite;
    this.prims.push({ art: 'linie', teil: this.nr(teil), von: this.weltPunkt(punktIn(r, von)), bis: this.weltPunkt(punktIn(r, bis)), breite: b, stufe: sm.stufe ?? stufe, ...opt, ...(sm.tiefenVersatz === undefined ? {} : { tiefenVersatz: sm.tiefenVersatz }) });
  }

  /** Linienzug durch mehrere Punkte. */
  zug(teil: string, r: Rahmen, punkte: readonly V3[], breite: number, stufe: number, opt: { material?: string; tiefenVersatz?: number } = {}): void {
    for (let i = 0; i + 1 < punkte.length; i++) this.linie(teil, r, punkte[i] as V3, punkte[i + 1] as V3, breite, stufe, opt);
  }

  /** Merkmal (Auge, Nase) an einem Punkt mit Oberflächennormale (Rahmenkoordinaten); `null` = ohne Sichtprüfung der Normale. */
  punkt(teil: string, r: Rahmen, ort: V3, normale: V3 | null, s: Stempel, opt: { nachAussen?: boolean; obenauf?: boolean } = {}): void {
    if (this.imSmear) return;
    this.prims.push({
      art: 'punkt',
      teil: this.nr(teil),
      ort: this.weltPunkt(punktIn(r, ort)),
      normale: normale === null ? null : normiere(this.weltRichtung(richtungIn(r, normale))),
      stempel: stempel(s),
      ...opt,
    });
  }

  /** Fertige Szene. */
  szene(materialien: Readonly<Record<string, KreaturMaterial>>, hoeheBezug: number, zeichnung?: Zeichnung): Szene {
    return { teile: [...this.teile], materialien, primitive: [...this.prims], hoeheBezug, neigung: NEIGUNG[this.richtung], ...(zeichnung === undefined ? {} : { zeichnung }) };
  }
}
