/**
 * The live preview of the character creation (docs/SPIEL.md §26 "Live-Vorschau der Figur (4 Richtungen, Idle/Gehen) über
 * dieselben Sprites wie im Spiel"; M7-52): the figure composed from the game atlas the way the game view draws it
 * (src/render/game/playerFigure.ts) – the body of the shape played with the clips of `spieler_basis`, the shipwrecked's
 * trousers and tunic of that shape, the hairstyle on the head socket in the head pose of the body frame
 * (`frisur_kopfposen`) – each layer through its palette row (skin, trousers, top, hair). Pure: the pixels come from a
 * `SymbolQuelle` (the atlas decoded to palette indices, src/ui/hud/minimap/spriteBild.ts), the result is a cell of palette
 * indices (0 = transparent).
 */
import type { SymbolQuelle } from '../../hud/minimap/spriteBild';
import type { CharakterForm } from './modell';

/** What the preview reads of a sprite of the manifest. */
export interface VorschauSprite {
  readonly size: readonly [number, number];
  readonly anchor: readonly [number, number];
  readonly frames: readonly unknown[];
  readonly clips: Readonly<Record<string, { readonly frames: readonly number[] }>>;
  readonly sockets: Readonly<Record<string, readonly (readonly [number, number] | null)[]>>;
}

/** A palette row: `map[i − 1]` is the index that colour i becomes. */
export interface VorschauZeile {
  readonly id: string;
  readonly map: readonly number[];
}

/** The game's body, clothes, hair and table sprites (names as in src/render/game/playerFigure.ts). */
const BASIS = 'spieler_basis';
const TUNIKA = 'ausruestung_leinentunika';
const HOSE = 'ausruestung_leinenhose';
const KOPFPOSEN = 'frisur_kopfposen';
/** The hairstyle that is the body's own hair in its drawn colour (no layer over it, as in the game). */
const EIGENES_HAAR = { frisur: 'scheitel', haar: 'haar_1' } as const;

function formId(sprite: string, form: string, basis = false): string {
  if (form === 'mittel') return sprite;
  return basis ? `spieler_${form}_basis` : `${sprite}_${form}`;
}

/** Copies the opaque pixels of `src` (w × h, its cell placed with its top left at (ox, oy)) into `out` (cw × ch) through `map`. */
function lege(out: Uint8Array, cw: number, ch: number, src: Uint8Array, w: number, h: number, ox: number, oy: number, map: readonly number[] | null): void {
  for (let y = 0; y < h; y++) {
    const ty = oy + y;
    if (ty < 0 || ty >= ch) continue;
    for (let x = 0; x < w; x++) {
      const tx = ox + x;
      if (tx < 0 || tx >= cw) continue;
      const v = src[y * w + x] ?? 0;
      if (v === 0) continue;
      out[ty * cw + tx] = map === null ? v : (map[v - 1] ?? v);
    }
  }
}

/** The head pose of every body frame of shape `form` (`frisur_kopfposen`, clips `<form>_<n>`). */
export function kopfposen(table: VorschauSprite | undefined, form: string): number[] {
  const out: number[] = [];
  if (table === undefined) return out;
  for (let n = 0; ; n++) {
    const clip = table.clips[`${form}_${n}`];
    if (clip === undefined) return out;
    out.push(...clip.frames);
  }
}

/**
 * The figure of `form` in clip `<aktion>_<richtung>` at clip position `position` as palette indices (the body's cell,
 * 32 × 32), or null while a sprite or its pixels are missing.
 */
export function vorschauBild(
  quelle: Pick<SymbolQuelle, 'indizes'>,
  sprites: Readonly<Record<string, VorschauSprite>>,
  zeilen: readonly VorschauZeile[],
  form: CharakterForm,
  aktion: string,
  richtung: string,
  position: number,
): Uint8Array | null {
  const basis = sprites[BASIS];
  const clip = basis?.clips[`${aktion}_${richtung}`];
  if (basis === undefined || clip === undefined || clip.frames.length === 0) return null;
  const frame = clip.frames[((position % clip.frames.length) + clip.frames.length) % clip.frames.length] ?? 0;
  const [cw, ch] = basis.size;
  const rowMap = (id: string): readonly number[] | null => zeilen.find((z) => z.id === id)?.map ?? null;
  const out = new Uint8Array(cw * ch);
  const bodyId = formId(BASIS, form.form, true);
  const body = sprites[bodyId];
  const bodyPx = quelle.indizes(bodyId, frame);
  if (body === undefined || bodyPx === null) return null;
  lege(out, cw, ch, bodyPx, cw, ch, 0, 0, rowMap(form.haut));
  // The rig's order facing the viewer: body, trousers, tunic, then the head (FIGURE_LAYER_ORDER).
  for (const [sprite, palette] of [
    [HOSE, form.hose],
    [TUNIKA, form.oberteil],
  ] as const) {
    const id = formId(sprite, form.form);
    const px = quelle.indizes(id, frame);
    if (px === null) return null;
    lege(out, cw, ch, px, cw, ch, 0, 0, rowMap(palette));
  }
  if (form.frisur === EIGENES_HAAR.frisur && form.haar === EIGENES_HAAR.haar) return out;
  const hairId = `frisur_${form.frisur}`;
  const hair = sprites[hairId];
  const pose = kopfposen(sprites[KOPFPOSEN], form.form)[frame];
  const kopf = body.sockets['kopf']?.[frame];
  if (hair === undefined || pose === undefined || kopf === undefined || kopf === null) return out;
  const hairPx = quelle.indizes(hairId, pose);
  if (hairPx === null) return null;
  lege(out, cw, ch, hairPx, hair.size[0], hair.size[1], kopf[0] - hair.anchor[0], kopf[1] - hair.anchor[1], rowMap(form.haar));
  return out;
}
