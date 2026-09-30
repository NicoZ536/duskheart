/**
 * Animationshilfen der Kreaturen (M6, MASTERPROMPT §4.5, docs/ART.md §4 und §15): Posen als benannte
 * Zahlenwerte (Versätze gegenüber der Grundhaltung, fehlende Werte = 0), Mischen, Überschwingen,
 * Smear und die Bausteine der Pflicht-Clips – Idle als Atemwelle, Bewegungszyklen, Angriffe mit
 * eigener Ausholphase, Treffer und Tod. Haltephasen entstehen durch wiederholte Frames in der
 * Abspielfolge, nicht durch mehr Zeichnungen.
 *
 * Ein Clip-Plan nennt seine eindeutigen Posen, die Abspielfolge (Positionen → Pose), Bildrate, Schleife,
 * Frame-Events und – bei Angriffen – die Clip-Positionen der Ausholphase (`ausholen`), die die
 * Gameplay-Stränge als Telegraph lesen (docs/ART.md §15).
 */

/** Posenwerte: Name → Versatz (px, Grad oder Anteil 0…1, je Bauplan dokumentiert). */
export type Werte = Readonly<Record<string, number>>;

/** Smear: Nachzieher der genannten Teile zwischen der Vorpose `von` und der Pose selbst. */
export interface Schmier {
  readonly von: Werte;
  /** Anteile 0…1 des Wegs von `von` zur Pose, an denen Nachzieher gezeichnet werden. */
  readonly anteile: readonly number[];
  /** Teile (Bauplan-Namen), die nachgezogen werden; leer = der ganze Körper. */
  readonly teile: readonly string[];
}

export interface Pose {
  readonly w: Werte;
  readonly schmier?: Schmier;
}

export interface KlipEvent {
  /** Position im Clip (nicht der Sprite-Frame). */
  readonly frame: number;
  readonly name: string;
}

export interface KlipPlan {
  /** Aktionsname im Clip `<name>_<richtung>` (z. B. `idle`, `move`, `attack_biss`). */
  readonly name: string;
  readonly fps: number;
  readonly loop: boolean;
  readonly posen: readonly Pose[];
  /** Abspielfolge: Pose je Clip-Position. */
  readonly folge: readonly number[];
  readonly events: readonly KlipEvent[];
  /** Angriffe: Clip-Positionen der Ausholphase (einschließlich). */
  readonly ausholen?: { readonly von: number; readonly bis: number };
}

/** Wert einer Pose (fehlend = 0). */
export function wert(w: Werte, name: string): number {
  return w[name] ?? 0;
}

/** Lineare Mischung zweier Posen (t = 0 → a, t = 1 → b). */
export function mische(a: Werte, b: Werte, t: number): Werte {
  const out: Record<string, number> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out[k] = (a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * t;
  return out;
}

/** Überschwingen: über `b` hinaus in Bewegungsrichtung a → b um den Anteil `k`. */
export function ueberschwinge(a: Werte, b: Werte, k: number): Werte {
  return mische(a, b, 1 + k);
}

/** Summe von Posen (Überlagerung, z. B. Atemwelle + Kopfneigung). */
export function plusW(...ws: readonly Werte[]): Werte {
  const out: Record<string, number> = {};
  for (const w of ws) for (const [k, v] of Object.entries(w)) out[k] = (out[k] ?? 0) + v;
  return out;
}

/** Skaliert alle Werte. */
export function malW(w: Werte, k: number): Werte {
  return Object.fromEntries(Object.entries(w).map(([n, v]) => [n, v * k]));
}

/** Pose ohne Smear. */
export function pose(w: Werte): Pose {
  return { w };
}

/** Smear-Pose: `w` mit Nachziehern der `teile` von `von` aus (Standard: zwei Nachzieher). */
export function smear(von: Werte, w: Werte, teile: readonly string[] = [], anteile: readonly number[] = [0.35, 0.7]): Pose {
  return { w, schmier: { von, anteile, teile } };
}

/** Sanftes Ein- und Ausschwingen 0…1. */
export function weich(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Idle als Welle (docs/ART.md §4): vier Posen, Ruhe- und Tiefpunkt je drei Bilder gehalten. */
export function idleClip(ruhe: Werte, vor: Werte, tief: Werte, nach: Werte, fps = 8): KlipPlan {
  return { name: 'idle', fps, loop: true, posen: [ruhe, vor, tief, nach].map(pose), folge: [0, 0, 0, 1, 2, 2, 2, 3], events: [] };
}

/** Bewegungszyklus aus `n` Phasen (0 ≤ phase < 1); Schritt-Events an den genannten Positionen. */
export function zyklusClip(name: string, n: number, fps: number, bei: (phase: number, i: number) => Werte, schritte: readonly number[] = [], event = 'schritt'): KlipPlan {
  const posen = Array.from({ length: n }, (_, i) => pose(bei(i / n, i)));
  return { name, fps, loop: true, posen, folge: posen.map((_, i) => i), events: schritte.map((frame) => ({ frame, name: event })) };
}

export interface AngriffPlan {
  /** Angriffsname (Clip `attack_<name>_<richtung>`). */
  readonly name: string;
  readonly fps: number;
  /** Ausholposen (Antizipation), zunehmend tiefer; mindestens zwei. */
  readonly aushol: readonly Werte[];
  /** Wie oft die tiefste Ausholpose zusätzlich gehalten wird (Telegraph-Dauer). */
  readonly halten: number;
  /** Schlagpose; ihr Frame ist ein Smear von der tiefsten Ausholpose aus. */
  readonly schlag: Werte;
  /** Teile, die im Smear nachgezogen werden (leer = ganzer Körper). */
  readonly schmierTeile?: readonly string[];
  /** Trefferpose (Überschwingen über den Schlag hinaus); Event `treffer`. */
  readonly treffer: Werte;
  /** Rückkehr (Nachfedern) zur Ruhe, mindestens eine Pose. */
  readonly nach: readonly Werte[];
  /** Wiederholungen der Schlagpose vor dem Treffer (Anlauf eines Ansturms). */
  readonly anlauf?: readonly Werte[];
}

/**
 * Angriff mit lesbarer Ausholphase (§4.5, §19.4 Telegraphs): Ausholposen (Positionen 0 … n−1, die
 * tiefste gehalten), Smear-Schlag, Treffer (überschwingend), Nachfedern. Events: `ausholen` (0),
 * `schlag` (Smear), `treffer`.
 */
export function angriffClip(a: AngriffPlan): KlipPlan {
  if (a.aushol.length < 2) throw new Error(`Angriff ${a.name}: mindestens zwei Ausholposen`);
  const tief = a.aushol[a.aushol.length - 1] as Werte;
  const posen: Pose[] = [...a.aushol.map(pose)];
  const folge: number[] = a.aushol.map((_, i) => i);
  for (let i = 0; i < a.halten; i++) folge.push(a.aushol.length - 1);
  const ausholenBis = folge.length - 1;
  const anlauf = a.anlauf ?? [];
  let vorher = tief;
  for (const w of anlauf) {
    posen.push(smear(vorher, w, a.schmierTeile ?? []));
    folge.push(posen.length - 1);
    vorher = w;
  }
  posen.push(smear(vorher, a.schlag, a.schmierTeile ?? []));
  const schlagPos = folge.length;
  folge.push(posen.length - 1);
  posen.push(pose(a.treffer));
  const trefferPos = folge.length;
  folge.push(posen.length - 1);
  for (const w of a.nach) {
    posen.push(pose(w));
    folge.push(posen.length - 1);
  }
  return {
    name: `attack_${a.name}`,
    fps: a.fps,
    loop: false,
    posen,
    folge,
    events: [
      { frame: 0, name: 'ausholen' },
      { frame: schlagPos, name: 'schlag' },
      { frame: trefferPos, name: 'treffer' },
    ],
    ausholen: { von: 0, bis: ausholenBis },
  };
}

/** Treffer: zurückgeworfen, eingesackt (2 Frames, §4.5). */
export function trefferClip(zurueck: Werte, eingesackt: Werte, fps = 8): KlipPlan {
  return { name: 'hit', fps, loop: false, posen: [pose(zurueck), pose(eingesackt)], folge: [0, 1], events: [{ frame: 0, name: 'getroffen' }] };
}

/** Tod: Treffer, Einknicken …, Aufprall (federt nach), Liegen; Event `aufprall`. */
export function todClip(posen: readonly Werte[], aufprall: number, fps = 8): KlipPlan {
  return { name: 'death', fps, loop: false, posen: posen.map(pose), folge: posen.map((_, i) => i), events: [{ frame: aufprall, name: 'aufprall' }] };
}

/** Frei definierter Clip (Sonderzustände: Tarnung, Erwachen, Gehen am Boden). */
export function klip(name: string, fps: number, loop: boolean, posen: readonly Pose[], folge: readonly number[], events: readonly KlipEvent[] = []): KlipPlan {
  return { name, fps, loop, posen, folge, events };
}
