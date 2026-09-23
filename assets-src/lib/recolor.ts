/**
 * Umfärbungen zur Build-Zeit (MASTERPROMPT §5 „Materialstufen“, „Möbel-Farbvarianten“):
 * - `recolor()`: wendet eine Palettenzeile (64 Indizes → Palettenindex) auf ein Sprite an.
 * - `materialStufen()`: eine Werkzeugform (Kopf in der Rampe `stein`) × 8 Material-Rampen →
 *   8 Stufen-Sprites `<id>_<material>` mit Metall-/Kristallglanz und Glühen nach `MATERIAL_TIERS`.
 * - `farbVarianten()`: Rampentausch je Variante, z. B. Stoff `laub` → `wasser` (blaues Bett).
 */
import { PALETTE_ROWS, MATERIAL_SOURCE_RAMP, MATERIAL_TIERS, identityMap, rampTargets, remapRamp, type MaterialTier } from '../paletteRows';
import { findRamp, rampStart } from '../palette';
import { MATERIAL_BITS, TRANSPARENT, spriteFromPixels, type PixelSpriteMeta, type Sprite, type SpriteFrame } from './sprite';

/** Metadaten eines Sprites als Eingabe für `spriteFromPixels` (mit neuer Id). */
export function spriteMeta(s: Sprite, id: string): PixelSpriteMeta {
  const meta: PixelSpriteMeta = {
    id,
    size: [s.w, s.h],
    anchor: [s.anchor[0], s.anchor[1]],
    hoehe: s.hoehe,
    clips: Object.fromEntries(Object.entries(s.clips).map(([k, c]) => [k, { frames: [...c.frames], fps: c.fps, loop: c.loop, events: c.events.map((e) => ({ ...e })) }])),
    sockets: Object.fromEntries(Object.entries(s.sockets).map(([k, pts]) => [k, pts.map((p) => [p[0], p[1]] as [number, number])])),
    occluder: { ...s.occluder },
    schatten: s.schatten,
    spiegelbar: s.spiegelbar,
  };
  if (s.group !== null) meta.group = s.group;
  if (s.hitbox !== null) meta.hitbox = [s.hitbox[0], s.hitbox[1], s.hitbox[2], s.hitbox[3]];
  if (s.ausnahmeFarben !== null) meta.ausnahmeFarben = s.ausnahmeFarben;
  if (s.einzelpixel !== null) meta.einzelpixel = s.einzelpixel;
  return meta;
}

/** Wie ein umgefärbtes Pixel zusätzlich markiert wird. */
export interface RecolorExtras {
  /** Nur Pixel mit diesen Quell-Indizes umfärben/markieren (Standard: alle). */
  readonly only?: ReadonlySet<number>;
  /** Materialflags, die umgefärbte Pixel zusätzlich erhalten. */
  readonly material?: number;
  /** Quell-Indizes, deren Pixel emissiv werden. */
  readonly emissive?: ReadonlySet<number>;
}

/** Wendet `map` (64 Einträge, Palettenindex i+1 → map[i]) auf alle Frames an; neue Id `id`. */
export function recolor(s: Sprite, id: string, map: readonly number[], extras: RecolorExtras = {}): Sprite {
  const frames = s.frames.map((f: SpriteFrame) => {
    const index = Uint8Array.from(f.index);
    const emissive = Uint8Array.from(f.emissive);
    const material = Uint8Array.from(f.material);
    f.index.forEach((v, p) => {
      if (v === TRANSPARENT || (extras.only !== undefined && !extras.only.has(v))) return;
      index[p] = map[v - 1] ?? v;
      if (extras.material !== undefined) material[p] = (material[p] ?? 0) | extras.material;
      if (extras.emissive?.has(v) === true) emissive[p] = 1;
    });
    return { index, emissive, material, heightOverride: f.heightOverride };
  });
  return spriteFromPixels(spriteMeta(s, id), frames);
}

function rampIndices(name: string, fromStep = 0): Set<number> {
  const ramp = findRamp(name);
  if (ramp === undefined) throw new Error(`Umfärbung: Rampe ${name} fehlt`);
  const start = rampStart(name);
  const out = new Set<number>();
  for (let i = fromStep; i < ramp.colors.length; i++) out.add(start + i);
  return out;
}

/**
 * Materialstufen (§13.2): färbt die `stein`-Pixel der Form über die Stufenzeile jedes Materials um.
 * Ergebnis: ein Sprite je Stufe (`<id>_stein`, `<id>_bronze` … `<id>_nachtstahl`).
 */
export function materialStufen(shape: Sprite, tiers: readonly MaterialTier[] = MATERIAL_TIERS): Sprite[] {
  const source = rampIndices(MATERIAL_SOURCE_RAMP);
  return tiers.map((t) => {
    const row = PALETTE_ROWS.find((r) => r.id === t.zeile);
    if (row === undefined) throw new Error(`Materialstufe ${t.id}: Palettenzeile ${t.zeile} fehlt`);
    const material = (t.metall ? MATERIAL_BITS.metall : 0) | (t.kristall ? MATERIAL_BITS.eis : 0);
    const extras: RecolorExtras = {
      only: source,
      material,
      emissive: t.leuchtetAb === null ? new Set() : rampIndices(MATERIAL_SOURCE_RAMP, t.leuchtetAb),
    };
    return recolor(shape, `${shape.id}_${t.id}`, row.map, extras);
  });
}

/** Eine Farbvariante: Id-Suffix und Rampentausch (`{ laub: 'wasser' }` oder Stufenliste). */
export interface FarbVariante {
  readonly id: string;
  readonly tausch: Readonly<Record<string, string | readonly string[]>>;
}

/** Stoffvarianten für Möbel, deren Stoff mit der Rampe `laub` (Rot) gezeichnet ist. */
export const STOFF_VARIANTEN: readonly FarbVariante[] = [
  { id: 'rot', tausch: {} },
  { id: 'gruen', tausch: { laub: 'gras' } },
  { id: 'blau', tausch: { laub: 'wasser' } },
  { id: 'violett', tausch: { laub: 'verderb' } },
  { id: 'ocker', tausch: { laub: 'sand' } },
  { id: 'grau', tausch: { laub: 'stein' } },
];

/** Holzvarianten für Möbel, deren Holz mit der Rampe `holz` (Eiche) gezeichnet ist. */
export const HOLZ_VARIANTEN: readonly FarbVariante[] = [
  { id: 'eiche', tausch: {} },
  { id: 'nussbaum', tausch: { holz: 'erde' } },
  { id: 'birke', tausch: { holz: ['sand.0', 'sand.1', 'sand.2', 'sand.3', 'sand.4'] } },
];

/** Möbel-/Objekt-Farbvarianten: ein Sprite je Variante (`<id>_<variante>`). */
export function farbVarianten(base: Sprite, varianten: readonly FarbVariante[]): Sprite[] {
  const ids = new Set<string>();
  return varianten.map((v) => {
    if (ids.has(v.id)) throw new Error(`Farbvariante ${v.id} doppelt für ${base.id}`);
    ids.add(v.id);
    const map = identityMap();
    for (const [from, to] of Object.entries(v.tausch)) remapRamp(map, from, typeof to === 'string' ? rampTargets(from, to) : to);
    return recolor(base, `${base.id}_${v.id}`, map);
  });
}
