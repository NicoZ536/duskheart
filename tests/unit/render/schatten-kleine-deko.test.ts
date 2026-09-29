/**
 * M5-56: kleine und selbstleuchtende Deko wirft keinen Punktlichtschatten (MASTERPROMPT §6.1 Pass 5). Kleine Pflanzen mit
 * einer Occluder-Ellipse von 3 × 1,5 px (`pflanze_leuchtpilz`, `_steinpilz`, `_kraeuter` …) standen fast so hoch wie die
 * Flamme einer Fackel und warfen 100–150 px lange schwarze Speichen, dunkle Keile durch den Nebelschein; der Leuchtpilz
 * den dunkelsten. Jetzt bleibt ihre Standfläche aus der Occluder-Maske (`shadowlessDecor`, `SHADOWLESS_DECOR`):
 * - klein: Standfläche bis 16 px² und höchstens 24 px hoch (Pflanzen, Setzlinge) – kein Schatten, kein AO-Fleck; Schilf
 *   und Kaktus (27–30 px) stehen wie ein dünner Stamm und werfen weiter;
 * - selbstleuchtend: ein Sprite mit Emission, das kein Licht beherbergt (kein Sockel `licht`: Leuchtpilz, Kristalle,
 *   Glutgestein, Leuchtbäume) – sein eigenes Glühen füllt den Schatten, den es werfen würde.
 * Lichtgehäuse (Stationen, Lampen, Herdfeuer: Sockel `licht`) bleiben Werfer und Gehäuse, auch kalt; Stämme, Felsen,
 * Möbel bleiben. Sonne und Mond werfen die Silhouetten aller weiter.
 */
import { describe, expect, it } from 'vitest';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import type { AtlasManifest, AtlasSprite } from '../../../src/render/assets/atlas';
import { SpriteDesc, SpriteList } from '../../../src/render/batch/spriteList';
import { castsSunShadow, gridCastSpriteIds } from '../../../src/render/light/lightClasses';
import { lightShadow, OccluderField } from '../../../src/render/light/lightMath';
import { footprintArea, OccluderList, shadowlessDecor, SpriteOccluders, spriteTop } from '../../../src/render/light/occluders';
import { OCCLUDER_CLASS, SDF, SHADOWLESS_DECOR } from '../../../src/render/light/params';
import { jumpFloodSteps } from '../../../src/render/passes/occluderPass';

/** A synthetic atlas sprite: one 16×32 frame at (fx, 0), anchor (8, 31), `top` px high above its anchor. */
function sprite(id: string, fx: number, occluder: AtlasSprite['occluder'], top: number, opts: { emissive?: boolean; socket?: string } = {}): AtlasSprite {
  return {
    id,
    group: 'probe',
    size: [16, 32],
    frames: [{ x: fx, y: 0, w: 16, h: 32, ax: 8, ay: 31 }],
    clips: {},
    sockets: opts.socket === undefined ? {} : { [opts.socket]: [[8, 26]] },
    heightHint: 'kugel',
    emissive: opts.emissive ?? false,
    symmetric: true,
    bounds: { x: 2, y: 31 - top, w: 12, h: top + 1 },
    occluder,
  };
}

const PLANT = { kind: 'ellipse', x: 8, y: 30, rx: 3, ry: 1.5 } as const;
const SPRITES: Record<string, AtlasSprite> = {
  kraut: sprite('kraut', 0, PLANT, 11),
  setzling: sprite('setzling', 16, { kind: 'ellipse', x: 8, y: 30, rx: 1.5, ry: 1 }, 19),
  leuchtpilz: sprite('leuchtpilz', 32, PLANT, 11, { emissive: true }),
  kristall: sprite('kristall', 48, { kind: 'ellipse', x: 8, y: 29, rx: 10, ry: 5 }, 25, { emissive: true }),
  stamm: sprite('stamm', 64, { kind: 'ellipse', x: 9, y: 30, rx: 2, ry: 1.5 }, 27),
  fels: sprite('fels', 80, { kind: 'ellipse', x: 8, y: 29, rx: 6, ry: 2.5 }, 9),
  lampe: sprite('lampe', 96, { kind: 'ellipse', x: 8, y: 29, rx: 3, ry: 2 }, 18, { emissive: true, socket: SHADOWLESS_DECOR.lightSocket }),
  ofen: sprite('ofen', 112, { kind: 'ellipse', x: 8, y: 26, rx: 13, ry: 4 }, 27, { emissive: true, socket: SHADOWLESS_DECOR.lightSocket }),
};
const MANIFEST: AtlasManifest = { width: 128, height: 32, paletteRows: [], sourceHash: 'probe', sprites: SPRITES };

function push(list: SpriteList, id: string, x: number, y: number): void {
  const d = new SpriteDesc();
  d.frame = SPRITES[id]?.frames[0] ?? null;
  d.x = x;
  d.y = y;
  d.layer = 'objects';
  list.push(d);
}

describe('Kleine und selbstleuchtende Deko ohne Punktlichtschatten (M5-56)', () => {
  it('die Regel: klein nach Standfläche und Höhe, selbstleuchtend nach Emission ohne Lichtsockel', () => {
    const why = (id: string): string | null => shadowlessDecor(SPRITES[id] as AtlasSprite);
    expect(footprintArea(PLANT)).toBeLessThanOrEqual(SHADOWLESS_DECOR.maxAreaPx);
    expect(why('kraut')).toBe('klein');
    expect(why('setzling')).toBe('klein');
    expect(why('leuchtpilz')).toBe('klein');
    expect(why('kristall')).toBe('selbstleuchtend');
    // A thin trunk (tall), a rock (wider), a lamp and a kiln (housings, cold or burning) keep their footprints.
    expect(why('stamm')).toBeNull();
    expect(why('fels')).toBeNull();
    expect(why('lampe')).toBeNull();
    expect(why('ofen')).toBeNull();
    expect(spriteTop(SPRITES['stamm'] as AtlasSprite)).toBeGreaterThan(SHADOWLESS_DECOR.maxTopPx);
  });

  it('die Occluder-Quellen des Frames lassen sie aus der Maske – die übrigen stehen wie zuvor am Anker', () => {
    const occ = new SpriteOccluders();
    occ.bind(MANIFEST);
    expect(occ.size).toBe(4);
    const list = new SpriteList();
    for (const [i, id] of Object.keys(SPRITES).entries()) push(list, id, 40 + 30 * i, 60);
    const out = new OccluderList();
    expect(occ.collect(list, out)).toBe(4);
    // The records left: the trunk (x 160 + 1), the rock, the lamp, the kiln.
    const xs = Array.from({ length: out.count }, (_, k) => out.records[k * 8] ?? 0);
    expect(xs).toEqual([161, 190, 220, 250]);
  });

  it('keine Speiche mehr: der Boden hinter einer Pflanze im Fackellicht bleibt hell, ein Fels wirft weiter seinen Schatten', () => {
    // A stake torch at (40, 40), its flame 14 px up; a plant (top 11 px) 20 px east of it, a rock (top 9 px) 20 px west.
    const torch: [number, number] = [40, 40];
    const flame = 14;
    const occ = new SpriteOccluders();
    occ.bind(MANIFEST);
    const field = (fromSprites: boolean): OccluderField => {
      const list = new OccluderList();
      if (fromSprites) {
        const sprites = new SpriteList();
        push(sprites, 'kraut', 60, 41);
        push(sprites, 'fels', 20, 42);
        occ.collect(sprites, list);
      } else {
        // Before: the plant's ellipse stood in the mask like any decor.
        list.push(1, 60, 40, 3, 1.5, 11, OCCLUDER_CLASS.decor);
        list.push(1, 20, 40, 6, 2.5, 9, OCCLUDER_CLASS.decor);
      }
      const f = new OccluderField(0, 0, 160, 80);
      f.draw(list);
      f.flood(jumpFloodSteps(SDF.firstStepPx));
      return f;
    };
    const before = field(false);
    const now = field(true);
    // Behind the plant, 20 and 40 px further east: the spoke (a ray low enough to pass under the plant's top).
    for (const x of [80.5, 100.5]) {
      expect(lightShadow(before, [x, 40.5], 0, false, false, torch, flame, 0, -1, false)[0], `vorher ${x}`).toBe(0);
      expect(lightShadow(now, [x, 40.5], 0, false, false, torch, flame, 0, -1, false)[0], `jetzt ${x}`).toBe(1);
    }
    // The rock west of the torch still shadows the ground right behind it.
    expect(lightShadow(now, [8.5, 40.5], 0, false, false, torch, flame, 0, -1, false)[0]).toBe(0);
  });

  it('das Spiel-Atlas-Manifest: alle Pflanzen mit Standfläche und die Leuchtenden ohne Schatten, Gehäuse, Stämme und Felsen mit', () => {
    const mod = generatedAtlasModule();
    if (mod === null) return;
    const m = manifestFromGenerated(mod);
    const s = (id: string): AtlasSprite => {
      const x = m.sprites[id];
      if (x === undefined) throw new Error(`${id} fehlt`);
      return x;
    };
    // Every small plant and every sapling; the tall ones (reed 30 px, cactus 27 px) stand like a thin trunk and cast.
    const plants = Object.values(m.sprites).filter((x) => (x.group === 'pflanzen' || x.id.endsWith('_setzling')) && x.occluder !== undefined && x.occluder.kind !== 'none');
    const small = plants.filter((p) => spriteTop(p) <= SHADOWLESS_DECOR.maxTopPx);
    expect(small.length).toBeGreaterThanOrEqual(20);
    for (const p of small) expect(shadowlessDecor(p), p.id).not.toBeNull();
    for (const id of ['pflanze_schilf', 'pflanze_kaktus']) expect(shadowlessDecor(s(id)), id).toBeNull();
    for (const id of ['pflanze_leuchtpilz', 'pflanze_steinpilz', 'pflanze_kraeuter', 'pflanze_fasergras']) expect(shadowlessDecor(s(id)), id).toBe('klein');
    for (const id of ['kristall_lumen', 'erz_lumenit', 'fels_gross_glutadern']) expect(shadowlessDecor(s(id)), id).toBe('selbstleuchtend');
    // Housings of a light keep their footprint (their rays pass it, their body is lit through its openings).
    for (const id of ['obj_lehmofen', 'obj_koehlermeiler', 'obj_schmelzofen', 'obj_herdfeuer', 'obj_kamin_stein', 'obj_harzlampe', 'obj_laterne_stehend', 'obj_laternenpfahl']) {
      expect(s(id).emissive, id).toBe(true);
      expect(shadowlessDecor(s(id)), id).toBeNull();
    }
    for (const id of ['baum_eiche', 'baum_tanne', 'baum_eiche_stumpf', 'fels_klein', 'fels_gross', 'obj_hocker_holz', 'obj_vase_keramik']) expect(shadowlessDecor(s(id)), id).toBeNull();
    // Sun and moon still cast their silhouettes.
    const grid = gridCastSpriteIds();
    for (const id of ['pflanze_leuchtpilz', 'pflanze_fasergras', 'kristall_lumen']) expect(castsSunShadow(s(id), grid), id).toBe(true);
  });
});
