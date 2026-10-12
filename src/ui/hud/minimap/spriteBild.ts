/**
 * Symbole aus dem Spielatlas für das DOM-Overlay (M3-28/M3-29): Die HUD-Symbole (`assets-src/sprites/ui`,
 * Zustands-Icons `zustand_<id>`, Item-Icons `icon_<item>`) liegen palettenindiziert im Spielatlas
 * (`public/generated/atlas-albedo.png`: Rotkanal = Palettenindex 1…64, Alpha = deckend; docs/RENDER.md §2).
 * Die Minimap braucht genau diese Indizes (sie malt selbst in Palettenfarben), Textzeilen brauchen ein Bild.
 *
 * `spriteBilder(doc)` lädt den Atlas einmal je Dokument, dekodiert ihn ohne Farbumrechnung und
 * Vormultiplikation (wie der Renderer) und schneidet Frames bei Bedarf aus: `indizes()` für Leinwände,
 * `url()` als `data:`-PNG in Palettenfarben für `<img>`. Bis der Atlas da ist, liefern beide `null`;
 * `bereit` meldet das Ende des Ladens (Screenshots warten darauf).
 *
 * Ein Frame kommt immer als ganze Zelle (`mass`): ein beschnittener Frame (Sprite-Angabe `zuschnitt` – Rüstungs- und
 * Kleidungs-Layer, M7-110, M7-125) liegt im Atlas nur mit dem Rechteck seiner deckenden Pixel, sein Anker im Rechteck
 * (`ax`, `ay`) sagt, wo es in der Zelle sitzt (`zellIndizes`). Minimap, Kompass und Charaktervorschau legen die Zelle am
 * Sprite-Anker an wie bisher.
 */
import { signal, type ReadonlySignal } from '@preact/signals';
import { ATLAS, SPRITES, type AtlasSprite } from '../../../generated/atlas';
import { DURCHSICHTIG, PALETTE_RGBA32 } from './palette';

/** Lesezugriff auf Symbole als Palettenindizes (Minimap-Zeichnung; in Tests durch Attrappen ersetzbar). */
export interface SymbolQuelle {
  /**
   * Palettenindizes des Frames in seiner ganzen Zelle (`mass`: Breite × Höhe, Zeile für Zeile, 0 = durchsichtig – auch ein
   * beschnittener Frame), oder `null` (unbekannt/noch nicht geladen).
   */
  indizes(id: string, frame?: number): Uint8Array | null;
  /** Zellgröße und Bezugspunkt eines Symbols, oder `null`, wenn es das Symbol nicht gibt. */
  mass(id: string): SymbolMass | null;
}

export interface SymbolMass {
  readonly breite: number;
  readonly hoehe: number;
  /** Bezugspunkt in Zellkoordinaten (Sprite-Anker). */
  readonly ankerX: number;
  readonly ankerY: number;
  readonly frames: number;
}

export interface SpriteBilder extends SymbolQuelle {
  /** Der Atlas ist dekodiert (`indizes`/`url` liefern Bilder). */
  readonly bereit: ReadonlySignal<boolean>;
  /** Warum das Laden scheiterte (auch als Konsolenfehler gemeldet), sonst `null`. */
  readonly fehler: ReadonlySignal<string | null>;
  /** `data:`-URL (PNG, Palettenfarben) eines Frames für `<img>`, oder `null`. */
  url(id: string, frame?: number): string | null;
}

const RGBA = 4;
const ALPHA = 3;

/**
 * Atlas-Rechteck eines Frames mit seinem Anker darin (`ax`, `ay`): der Zell-Anker, bei einem beschnittenen Frame minus Schnitt.
 * Ohne Anker (Manifeste vor M7-130 nennen ihn nur bei beschnittenen Frames) ist das Rechteck die ganze Zelle.
 */
export interface RahmenRechteck {
  readonly w: number;
  readonly h: number;
  readonly ax?: number;
  readonly ay?: number;
}

/**
 * Die Palettenindizes eines Frames in seiner ganzen Zelle (`m`: Breite × Höhe, Anker) aus den RGBA-Pixeln `px` seines
 * Atlas-Rechtecks `r` (Rotkanal = Palettenindex, Alpha 0 = durchsichtig): der Ausschnitt liegt in der Zelle um den Schnitt
 * versetzt – Zell-Anker minus Rechteck-Anker (M7-125). Ein unbeschnittener Frame füllt die Zelle Pixel für Pixel.
 */
export function zellIndizes(px: ArrayLike<number>, r: RahmenRechteck, m: Pick<SymbolMass, 'breite' | 'hoehe' | 'ankerX' | 'ankerY'>): Uint8Array {
  const ox = m.ankerX - (r.ax ?? m.ankerX);
  const oy = m.ankerY - (r.ay ?? m.ankerY);
  const out = new Uint8Array(m.breite * m.hoehe);
  for (let y = 0; y < r.h; y++) {
    const zy = oy + y;
    if (zy < 0 || zy >= m.hoehe) continue;
    for (let x = 0; x < r.w; x++) {
      const zx = ox + x;
      if (zx < 0 || zx >= m.breite) continue;
      const i = (y * r.w + x) * RGBA;
      out[zy * m.breite + zx] = (px[i + ALPHA] ?? 0) === 0 ? DURCHSICHTIG : (px[i] ?? 0);
    }
  }
  return out;
}

function spriteVon(id: string): AtlasSprite | undefined {
  return Object.hasOwn(SPRITES, id) ? (SPRITES as Readonly<Record<string, AtlasSprite>>)[id] : undefined;
}

/** Maße eines Atlas-Sprites (ohne den Atlas zu laden). */
export function atlasMass(id: string): SymbolMass | null {
  const s = spriteVon(id);
  if (s === undefined) return null;
  return { breite: s.size[0], hoehe: s.size[1], ankerX: s.anchor[0], ankerY: s.anchor[1], frames: s.frames.length };
}

class AtlasBilder implements SpriteBilder {
  readonly bereit = signal(false);
  readonly fehler = signal<string | null>(null);
  private bild: ImageBitmap | null = null;
  private readonly indexCache = new Map<string, Uint8Array | null>();
  private readonly urlCache = new Map<string, string | null>();
  private readonly schnitt: HTMLCanvasElement;

  constructor(private readonly doc: Document) {
    this.schnitt = doc.createElement('canvas');
  }

  async lade(): Promise<void> {
    try {
      const img = new Image();
      img.src = new URL(ATLAS.albedoUrl, this.doc.baseURI).href;
      await img.decode();
      // Kanäle sind Palettenindizes und Flags, keine Farben: keine Farbraum-Umrechnung, keine Vormultiplikation.
      this.bild = await createImageBitmap(img, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      this.bereit.value = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.fehler.value = msg;
      console.error(`HUD-Symbole: Spielatlas ${ATLAS.albedoUrl} nicht ladbar – ${msg}`);
    }
  }

  mass(id: string): SymbolMass | null {
    return atlasMass(id);
  }

  indizes(id: string, frame = 0): Uint8Array | null {
    const key = `${id}#${frame}`;
    const cached = this.indexCache.get(key);
    if (cached !== undefined) return cached;
    const s = spriteVon(id);
    const rect: (RahmenRechteck & { readonly x: number; readonly y: number }) | undefined = s?.frames[Math.max(0, Math.min(frame, (s?.frames.length ?? 1) - 1))];
    const m = atlasMass(id);
    if (this.bild === null) return null;
    if (rect === undefined || m === null) {
      this.indexCache.set(key, null);
      return null;
    }
    this.schnitt.width = rect.w;
    this.schnitt.height = rect.h;
    const ctx = this.schnitt.getContext('2d', { willReadFrequently: true });
    if (ctx === null) return null;
    ctx.clearRect(0, 0, rect.w, rect.h);
    ctx.drawImage(this.bild, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    const out = zellIndizes(ctx.getImageData(0, 0, rect.w, rect.h, { colorSpace: 'srgb' }).data, rect, m);
    this.indexCache.set(key, out);
    return out;
  }

  url(id: string, frame = 0): string | null {
    const key = `${id}#${frame}`;
    const cached = this.urlCache.get(key);
    if (cached !== undefined) return cached;
    const idx = this.indizes(id, frame);
    const m = this.mass(id);
    if (idx === null || m === null) return null;
    const c = this.doc.createElement('canvas');
    c.width = m.breite;
    c.height = m.hoehe;
    // A canvas kept in memory: the image is encoded right away (`toDataURL`), and a GPU canvas would first wait for
    // the GPU to finish every frame queued before it – seconds under a software rasteriser (ADR M5-Integration).
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (ctx === null) return null;
    const img = ctx.createImageData(m.breite, m.hoehe);
    const ziel = new Uint32Array(img.data.buffer);
    for (let i = 0; i < idx.length; i++) ziel[i] = PALETTE_RGBA32[idx[i] ?? 0] ?? 0;
    ctx.putImageData(img, 0, 0);
    const url = c.toDataURL('image/png');
    this.urlCache.set(key, url);
    return url;
  }
}

const JE_DOKUMENT = new WeakMap<Document, AtlasBilder>();

/** Die Symbolquelle des Dokuments (lädt den Spielatlas beim ersten Aufruf). */
export function spriteBilder(doc: Document): SpriteBilder {
  let b = JE_DOKUMENT.get(doc);
  if (b === undefined) {
    b = new AtlasBilder(doc);
    JE_DOKUMENT.set(doc, b);
    void b.lade();
  }
  return b;
}
