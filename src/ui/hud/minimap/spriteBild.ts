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
 */
import { signal, type ReadonlySignal } from '@preact/signals';
import { ATLAS, SPRITES, type AtlasSprite } from '../../../generated/atlas';
import { DURCHSICHTIG, PALETTE_RGBA32 } from './palette';

/** Lesezugriff auf Symbole als Palettenindizes (Minimap-Zeichnung; in Tests durch Attrappen ersetzbar). */
export interface SymbolQuelle {
  /** Palettenindizes des Frames (Zeile für Zeile, 0 = durchsichtig), oder `null` (unbekannt/noch nicht geladen). */
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
    const rect = s?.frames[Math.max(0, Math.min(frame, (s?.frames.length ?? 1) - 1))];
    if (this.bild === null) return null;
    if (rect === undefined) {
      this.indexCache.set(key, null);
      return null;
    }
    this.schnitt.width = rect.w;
    this.schnitt.height = rect.h;
    const ctx = this.schnitt.getContext('2d', { willReadFrequently: true });
    if (ctx === null) return null;
    ctx.clearRect(0, 0, rect.w, rect.h);
    ctx.drawImage(this.bild, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    const px = ctx.getImageData(0, 0, rect.w, rect.h, { colorSpace: 'srgb' }).data;
    const out = new Uint8Array(rect.w * rect.h);
    for (let i = 0; i < out.length; i++) out[i] = (px[i * RGBA + ALPHA] ?? 0) === 0 ? DURCHSICHTIG : (px[i * RGBA] ?? 0);
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
    const ctx = c.getContext('2d');
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
