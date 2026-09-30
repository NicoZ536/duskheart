/**
 * Kreatur-Sprite-Generator (M6, MASTERPROMPT §4.4/§4.5/§5 „Generatoren … Kreatur-Varianten“,
 * docs/ART.md §15 „Kreaturen (M6)“, docs/SPIEL.md §11/§14): aus einem Bauplan (Körperbau + Farben) und
 * Clip-Plänen (Posen, Abspielfolge, Ausholphasen) entsteht das Sprite `kreatur_<id>` mit den Clips
 * `<aktion>_<richtung>` für `down`, `up` und `right`; `left` spiegelt der Renderer (`spiegelbar`).
 *
 * Ablauf je Frame: Pose → Bauplan setzt Grundformen (`Bau`) → `rendere` rastert (Form-Schattierung,
 * Kontaktschatten, Kontur, Einzelpixel-Bereinigung). Smear-Posen zeichnen Nachzieher der bewegten Teile in
 * einer hellen Stufe hinter den Körper. Gleiche Frames (gleiche Pixel) werden geteilt; Haltephasen sind
 * wiederholte Frames in der Abspielfolge. Alles ist deterministisch: gleiche Definition ⇒ gleiche Pixel.
 */
import { createHash } from 'node:crypto';
import { Bau, KREATUR_RICHTUNGEN, type Haltung, type KreaturRichtung } from './creatureBau';
import { mische, plusW, type KlipPlan, type Pose, type Werte } from './creatureAnim';
import { rendere, STUFE_SCHMIER, type KreaturMaterial, type KreaturRaster, type Zeichnung } from './creatureRender';
import { spriteFromPixels, type HeightHint, type PixelFrameInput, type Sprite } from './sprite';

/** Kleine, mittlere, große Kreaturen (§4.4). */
export const KREATUR_ZELLEN = { klein: 16, mittel: 32, gross: 64 } as const;

/** Nachzieher liegen so weit hinter dem Körper (px Tiefe). */
const NACHZIEHER_TIEFE = 64;
/** Präfix der Kreatur-Sprites (docs/SPIEL.md §11). */
export const KREATUR_PRAEFIX = 'kreatur_';

/** Bauplan: Körper, Farben und Kontur einer Kreatur. */
export interface Bauplan {
  readonly materialien: Readonly<Record<string, KreaturMaterial>>;
  /** Rückenhöhe (px) als Bezug der Umgebungsverdeckung. */
  readonly hoeheBezug: number;
  /** Konturfarbe (`nacht.1`) oder `null` (Schattenbrut: Randsaum statt Kontur). */
  readonly kontur: string | null;
  readonly saum?: string;
  readonly zeichnung?: Zeichnung;
  /** Setzt die Grundformen einer Pose. `nurTeile`: nur diese Teile (Nachzieher im Smear). */
  baue(bau: Bau, w: Werte, nurTeile: ReadonlySet<string> | null): void;
  /** Haltung des ganzen Körpers in einer Pose (Kippen, Stauchen). */
  haltung?(w: Werte): Haltung;
  /** Zusätzliches Gieren des ganzen Körpers je Richtung (Krabbe: seitwärts laufend zum Betrachter gedreht). */
  readonly gier?: Partial<Record<KreaturRichtung, number>>;
  /** Verbreiterung von vorn und hinten (Standard `VERBREITERUNG`; breite Körper wie Krabben 1). */
  readonly verbreiterung?: number;
}

/** Haltung einer Pose samt Gieren der Richtung. */
function haltungIn(plan: Bauplan, richtung: KreaturRichtung, w: Werte): Haltung {
  const h = plan.haltung?.(w) ?? {};
  const gier = plan.gier?.[richtung] ?? 0;
  return gier === 0 ? h : { ...h, dreh: { ...(h.dreh ?? {}), gier: (h.dreh?.gier ?? 0) + gier } };
}

export interface KreaturDef {
  /** Kanonische Kreatur-Id (docs/SPIEL.md §14); das Sprite heißt `kreatur_<id>`. */
  readonly id: string;
  /** Zellgröße (quadratisch): 16, 32, 48 oder 64. */
  readonly zelle: number;
  /** Fußpunkt (Mitte der Standfläche). */
  readonly anker: readonly [number, number];
  readonly hoehe: HeightHint;
  readonly plan: Bauplan;
  readonly clips: readonly KlipPlan[];
  readonly einzelpixel?: string;
  readonly ausnahmeFarben?: string;
  /** Gleichmäßiger Maßstab des Körpers (Feinabstimmung der Größe in der Zelle, Standard 1). */
  readonly massstab?: number;
  /**
   * Zuschläge auf alle Posen einer Blickrichtung – Stilmittel wie beim Zeichnen von Hand, z. B. von vorn
   * aufgestellte Ohren, die im Profil nach hinten liegen.
   */
  readonly jeRichtung?: Partial<Record<KreaturRichtung, Werte>>;
}

/** Rendert eine Pose in einer Richtung (mit Nachziehern bei Smear-Posen). */
export function renderePose(def: KreaturDef, richtung: KreaturRichtung, roh: Pose): KreaturRaster {
  const bau = new Bau(richtung, def.plan.verbreiterung, def.massstab ?? 1);
  const zuschlag = def.jeRichtung?.[richtung];
  const p: Pose = zuschlag === undefined ? roh : { w: plusW(roh.w, zuschlag), ...(roh.schmier === undefined ? {} : { schmier: { ...roh.schmier, von: plusW(roh.schmier.von, zuschlag) } }) };
  if (p.schmier !== undefined) {
    const teile = p.schmier.teile.length === 0 ? null : new Set(p.schmier.teile);
    for (const a of p.schmier.anteile) {
      const w = mische(p.schmier.von, p.w, a);
      bau.nachzieher(NACHZIEHER_TIEFE, STUFE_SCHMIER);
      bau.halte(haltungIn(def.plan, richtung, w));
      def.plan.baue(bau, w, teile);
    }
    bau.nachzieher(0, null);
  }
  bau.halte(haltungIn(def.plan, richtung, p.w));
  def.plan.baue(bau, p.w, null);
  const s = bau.szene(def.plan.materialien, def.plan.hoeheBezug, def.plan.zeichnung);
  return rendere(s, { w: def.zelle, h: def.zelle, anker: def.anker, kontur: def.plan.kontur, ...(def.plan.saum === undefined ? {} : { saum: def.plan.saum }) });
}

/** Ein Clip des fertigen Sprites samt Ausholphase (für Doku, Tests und Gameplay-Daten). */
export interface KreaturClipInfo {
  readonly clip: string;
  readonly aktion: string;
  readonly richtung: string;
  readonly frames: readonly number[];
  readonly fps: number;
  readonly loop: boolean;
  readonly ausholen: { readonly von: number; readonly bis: number } | null;
}

export interface KreaturErgebnis {
  readonly sprite: Sprite;
  readonly clips: readonly KreaturClipInfo[];
  /** Erzeugt das Ergebnis aus derselben Definition neu (Determinismus-Prüfung). */
  readonly erzeuge: () => KreaturErgebnis;
}

function schluessel(r: KreaturRaster): string {
  return createHash('sha1').update(r.index).update(r.emissiv).digest('hex');
}

/** Baut das Sprite `kreatur_<id>`: alle Clips in allen gezeichneten Richtungen, gleiche Frames geteilt. */
export function kreatur(def: KreaturDef): KreaturErgebnis {
  const frames: KreaturRaster[] = [];
  const nachSchluessel = new Map<string, number>();
  const spriteClips: Record<string, { frames: number[]; fps: number; loop: boolean; events: { frame: number; name: string }[] }> = {};
  const infos: KreaturClipInfo[] = [];
  const aufnehmen = (r: KreaturRaster): number => {
    const k = schluessel(r);
    const vorhanden = nachSchluessel.get(k);
    if (vorhanden !== undefined) return vorhanden;
    frames.push(r);
    nachSchluessel.set(k, frames.length - 1);
    return frames.length - 1;
  };
  for (const richtung of KREATUR_RICHTUNGEN) {
    for (const clip of def.clips) {
      const bilder = clip.posen.map((p) => aufnehmen(renderePose(def, richtung, p)));
      const name = `${clip.name}_${richtung}`;
      const seq = clip.folge.map((i) => {
        const f = bilder[i];
        if (f === undefined) throw new Error(`Kreatur ${def.id}: ${name} nennt Pose ${i}, es gibt ${bilder.length}`);
        return f;
      });
      spriteClips[name] = { frames: seq, fps: clip.fps, loop: clip.loop, events: clip.events.map((e) => ({ ...e })) };
      infos.push({ clip: name, aktion: clip.name, richtung, frames: seq, fps: clip.fps, loop: clip.loop, ausholen: clip.ausholen ?? null });
    }
  }
  const pixel: PixelFrameInput[] = frames.map((f) => ({ index: f.index, emissive: f.emissiv }));
  const sprite = spriteFromPixels(
    {
      id: `${KREATUR_PRAEFIX}${def.id}`,
      size: [def.zelle, def.zelle],
      anchor: [def.anker[0], def.anker[1]],
      hoehe: def.hoehe,
      clips: spriteClips,
      occluder: { kind: 'none' },
      // Alle Baupläne sind links-rechts-symmetrisch gebaut: `left` spiegelt der Renderer aus `right`.
      spiegelbar: true,
      ...(def.einzelpixel === undefined ? {} : { einzelpixel: def.einzelpixel }),
      ...(def.ausnahmeFarben === undefined ? {} : { ausnahmeFarben: def.ausnahmeFarben }),
    },
    pixel,
  );
  return { sprite, clips: infos, erzeuge: () => kreatur(def) };
}

/**
 * Geschoss einer Kreatur (`geschoss_<name>`, z. B. die Spucke des Speiers): ein richtungsloses Sprite, im
 * Flug nach rechts gezeichnet (der Kampf-Renderer dreht es in die Flugrichtung); Clips ohne Richtung
 * (`flug`, `aufprall`).
 */
export function geschoss(def: { readonly name: string; readonly zelle: number; readonly anker: readonly [number, number]; readonly plan: Bauplan; readonly clips: readonly KlipPlan[] }): Sprite {
  const frames: KreaturRaster[] = [];
  const nachSchluessel = new Map<string, number>();
  const clips: Record<string, { frames: number[]; fps: number; loop: boolean; events: { frame: number; name: string }[] }> = {};
  const kd: KreaturDef = { id: def.name, zelle: def.zelle, anker: def.anker, hoehe: 'kugel', plan: def.plan, clips: def.clips };
  for (const clip of def.clips) {
    const bilder = clip.posen.map((p) => {
      const r = renderePose(kd, 'right', p);
      const k = schluessel(r);
      const vorhanden = nachSchluessel.get(k);
      if (vorhanden !== undefined) return vorhanden;
      frames.push(r);
      nachSchluessel.set(k, frames.length - 1);
      return frames.length - 1;
    });
    clips[clip.name] = { frames: clip.folge.map((i) => bilder[i] ?? 0), fps: clip.fps, loop: clip.loop, events: clip.events.map((e) => ({ ...e })) };
  }
  return spriteFromPixels(
    { id: `geschoss_${def.name}`, size: [def.zelle, def.zelle], anchor: [def.anker[0], def.anker[1]], hoehe: 'kugel', clips, occluder: { kind: 'none' }, schatten: 'none', spiegelbar: true },
    frames.map((f) => ({ index: f.index, emissive: f.emissiv })),
  );
}
