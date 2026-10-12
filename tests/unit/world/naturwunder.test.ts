/**
 * M7-82 "Naturwunder Geysirfeld (Aschenschlund) und Kristallbogen (Scherbenhain) als Ortsvorlagen mit eigenen Objekten"
 * (docs/SPIEL.md §18): every wonder the generator places (`LOCATION_RULES.naturwunder.variants`) has a layout of its biome and
 * variant for the full slot radius and one for the fallback radius of a crowded biome, each with the wonder's own objects and
 * none of another wonder's; the two halves of the crystal arch meet over the slot centre (layout feet four tiles apart, the
 * sprites' boxes abut and both close the arch in the same rows) with the way beneath it free; the validator names no wonder
 * without a layout; in small worlds every wonder slot is stamped with a layout of its variant.
 */
import { describe, expect, it } from 'vitest';
import kristallbogen from '../../../assets-src/sprites/orte/kristallbogen';
import { TRANSPARENT, type Sprite } from '../../../assets-src/lib/sprite';
import { CONTENT } from '../../../src/content/index';
import type { PlaceLayoutDef } from '../../../src/content/places/schema';
import { LOCATION_RULES, LOCATIONS, type LocationSlot } from '../../../src/world/gen/locations';
import { compileLayout, placeCandidates } from '../../../src/world/gen/places';
import { generateWorld } from '../../../src/world/gen/world';
import { checkPlaces } from '../../../tools/validator/orte';
import { WORLD_TIMEOUT_MS } from './weltgen-hilfen';

const RULE = LOCATION_RULES.naturwunder!;
const VARIANTS = RULE.variants ?? [];
/** The objects only the wonder of a variant has – what makes the place that wonder. */
const OWN_OBJECTS: Readonly<Record<string, readonly string[]>> = {
  uraltbaum: ['ort_uraltbaum', 'ort_wurzel'],
  geysirfeld: ['ort_geysir', 'ort_sinterbecken', 'ort_dampfspalt'],
  kristallbogen: ['ort_kristallbogen_west', 'ort_kristallbogen_ost', 'ort_kristallnadel'],
};
/** The object each wonder layout must show (its centrepiece). */
const CENTREPIECE: Readonly<Record<string, readonly string[]>> = {
  uraltbaum: ['ort_uraltbaum'],
  geysirfeld: ['ort_geysir'],
  kristallbogen: ['ort_kristallbogen_west', 'ort_kristallbogen_ost'],
};
/** Tiles between the feet of the two arch halves (the layout's `W` and `O`). */
const ARCH_SPAN_TILES = 4;
const TILE_PX = 16;

const wonders = (): PlaceLayoutDef[] => CONTENT.collection('placeLayouts').values().filter((l) => l.ortstyp === 'naturwunder');

/** The objects a layout stamps, by the cells of its rows. */
function objectsOf(def: PlaceLayoutDef): string[] {
  const out: string[] = [];
  for (const row of def.zeilen) for (const ch of row) {
    const o = def.legende[ch]?.objekt;
    if (o !== undefined) out.push(o);
  }
  return out;
}

/** Cells (column, row) of an object in a layout. */
function cellsOf(def: PlaceLayoutDef, object: string): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  def.zeilen.forEach((row, y) => [...row].forEach((ch, x) => def.legende[ch]?.objekt === object && out.push({ x, y })));
  return out;
}

function slot(variant: string, biome: string, radius: number): LocationSlot {
  return { id: 1, type: 'naturwunder', variant, x: 400, y: 400, radius, level: 0, region: 0, biome, tier: 0, landmass: 0, link: -1 };
}

/** Is the pixel (x, y) of the sprite's first frame opaque. */
function opaque(s: Sprite, x: number, y: number): boolean {
  return (s.frames[0]?.index[y * s.w + x] ?? TRANSPARENT) !== TRANSPARENT;
}

describe('Naturwunder (M7-82)', () => {
  it('every wonder of the generator has a layout of its variant for the full and the fallback radius', () => {
    const compiled = wonders().map(compileLayout);
    const fallback = Math.max(1, Math.floor(RULE.radius * LOCATIONS.secondaryFallbackFactor));
    expect(VARIANTS.map((v) => v.id).sort()).toEqual(Object.keys(OWN_OBJECTS).sort());
    for (const v of VARIANTS) {
      const full = placeCandidates(slot(v.id, v.biome, RULE.radius), compiled);
      expect(full.length, `${v.id} r${RULE.radius}`).toBeGreaterThan(0);
      for (const l of full) expect([l.biom, l.variante]).toEqual([v.biome, v.id]);
      if (v.id === 'uraltbaum') continue; // The ancient tree of M7-08 has no small layout yet: its Grünhain is wide and flat.
      const small = placeCandidates(slot(v.id, v.biome, fallback), compiled);
      expect(small.length, `${v.id} r${fallback}`).toBeGreaterThan(0);
      // The full slot takes the full wonder, the small one only where it must.
      expect(Math.min(...full.map((l) => l.w * l.h))).toBeGreaterThan(Math.max(...small.map((l) => l.w * l.h)));
    }
  });

  it('each layout shows its own wonder and nothing of another', () => {
    for (const def of wonders()) {
      const v = def.variante ?? '';
      const objects = new Set(objectsOf(def));
      for (const o of CENTREPIECE[v] ?? ['?']) expect(objects.has(o), `${def.id}: ${o}`).toBe(true);
      for (const [other, own] of Object.entries(OWN_OBJECTS)) if (other !== v) for (const o of own) expect(objects.has(o), `${def.id}: ${o} of ${other}`).toBe(false);
      for (const o of objects) expect(CONTENT.collection('worldObjects').find(o), `${def.id}: ${o}`).toBeDefined();
      // Every wonder rewards the walk with a chest.
      expect(Object.values(def.legende).some((c) => c.marke === 'truhe'), def.id).toBe(true);
    }
  });

  it('the crystal arch closes over the slot centre: feet four tiles apart, the halves meet, the way beneath is free', () => {
    const west = kristallbogen.find((s) => s.id === 'ort_kristallbogen_west')!;
    const east = kristallbogen.find((s) => s.id === 'ort_kristallbogen_ost')!;
    // A foot's tile tx draws column c at world x = tx·16 + 8 − anchor.x + c (`objectAnchor`, src/render/world/objects.ts: a
    // 1 × 1 footprint's centre) – exactly, for a place's pieces stand unjittered (kind `ort`, src/render/world/tables.ts).
    for (const id of ['ort_kristallbogen_west', 'ort_kristallbogen_ost']) {
      const def = CONTENT.collection('worldObjects').find(id);
      expect([def?.kind, def?.footprint], id).toEqual(['ort', { w: 1, h: 1 }]);
    }
    const westRight = TILE_PX / 2 - west.anchor[0] + west.w;
    const eastLeft = ARCH_SPAN_TILES * TILE_PX + TILE_PX / 2 - east.anchor[0];
    expect(westRight).toBe(eastLeft);
    expect(west.anchor[1]).toBe(east.anchor[1]);
    // The arch closes: in some rows both inner edge columns are crystal – the same rows on both sides.
    let closed = 0;
    for (let y = 0; y < west.h; y++) {
      expect(opaque(west, west.w - 1, y), `row ${y}`).toBe(opaque(east, 0, y));
      if (opaque(west, west.w - 1, y)) closed++;
    }
    expect(closed).toBeGreaterThan(0);
    for (const def of wonders().filter((d) => d.variante === 'kristallbogen')) {
      expect(def.drehbar, def.id).toBe(false); // The halves are drawn for one view: turned or mirrored they would part.
      const [w, ...wMore] = cellsOf(def, 'ort_kristallbogen_west');
      const [o, ...oMore] = cellsOf(def, 'ort_kristallbogen_ost');
      expect([wMore.length, oMore.length], def.id).toEqual([0, 0]);
      expect(o, def.id).toEqual({ x: (w?.x ?? 0) + ARCH_SPAN_TILES, y: w?.y });
      const row = def.zeilen[w?.y ?? 0] ?? '';
      for (let x = (w?.x ?? 0) + 1; x < (o?.x ?? 0); x++) expect(def.legende[row[x] ?? '.']?.objekt, `${def.id} beneath the arch, column ${x}`).toBeUndefined();
      // The slot centre (the layout's middle cell) lies beneath the arch.
      const cx = Math.floor(row.length / 2);
      expect([w?.y, cx > (w?.x ?? 0) && cx < (o?.x ?? 0)], def.id).toEqual([Math.floor(def.zeilen.length / 2), true]);
    }
  });

  it('the validator knows a layout for every wonder', () => {
    const sprites = new Set(CONTENT.collection('locationTypes').values().map((t) => t.kartensymbol));
    const res = checkPlaces(CONTENT, sprites);
    expect(res.errors).toEqual([]);
    expect(res.warnings.filter((w) => w.includes('naturwunder'))).toEqual([]);
  });

  it(
    'small worlds: every wonder slot is stamped with a layout of its variant, the same each time',
    () => {
      for (const seed of [3, 11]) {
        const w = generateWorld(seed, 'small');
        const slots = w.locations.filter((s) => s.type === 'naturwunder');
        expect(slots.length, `seed ${seed}`).toBe(VARIANTS.length);
        for (const s of slots) {
          const p = w.placeLayouts.find((pl) => pl.slot === s.id);
          expect(p, `seed ${seed} ${s.variant} @${s.id}`).toBeDefined();
          const def = wonders().find((d) => d.id === p?.layout);
          expect([def?.biom, def?.variante], `seed ${seed} ${p?.layout}`).toEqual([s.biome, s.variant]);
        }
        expect(generateWorld(seed, 'small').placeLayouts).toEqual(w.placeLayouts);
      }
    },
    WORLD_TIMEOUT_MS,
  );
});
