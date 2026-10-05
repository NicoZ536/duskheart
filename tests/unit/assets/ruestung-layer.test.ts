/**
 * M6-12 Rüstung T0–T1 und M6-31 Leder (MASTERPROMPT §4.5 „Ausrüstungs-Layer über alle Spieleranimationen“, §15.2): die
 * Layer der drei Sets, ihre Icons, die Stationen Webstuhl, Schneidertisch und Gerbrahmen. Belegt am Pixel:
 * - Overlays (Körper, Beine, Füße) haben genau die Frames, die Zelle und den Anker von `spieler_basis`; kein Pixel liegt
 *   neben dem Körper (die Silhouette bleibt die des Körpers – auch liegend, rollend, schwimmend und im Kampf).
 * - Das Fasergewand ersetzt Tunika und Hose Pixel für Pixel (dieselben Masken in allen Frames), das Lederwams ist
 *   ärmellos (nur ein Teil der Tunika), die Stiefel reichen eine Reihe höher als die Schuhe des Körpers.
 * - Helme sind Sockel-Layer am Kopfsockel: je Körperclip ein Clip derselben Länge, am Sockel gesetzt liegen sie auf dem Kopf.
 * - Bronze ist über die Materialstufe umgefärbt (Metallflag, keine `stein`-Pixel).
 * - Im Renderer: Kopf, Körper, Beine und Füße zugleich; die Füße über der Hose, der Körper darüber (Slot `fuesse`).
 * - Stationen: Zelle, Anker auf der Vorderkante mit 1 px Luft, Clips je Art; Icons wie alle Item-Icons.
 */
import { describe, expect, it } from 'vitest';
import { MATERIAL_BITS, MAX_SPRITE_COLORS, TRANSPARENT, spriteColorCount, type Sprite } from '../../../assets-src/lib/sprite';
import { paletteIndex, rampStart } from '../../../assets-src/palette';
import kleidung from '../../../assets-src/sprites/ausruestung/kleidung';
import bronze from '../../../assets-src/sprites/ausruestung/ruestung_bronze';
import faser from '../../../assets-src/sprites/ausruestung/ruestung_faser';
import ruestungIcons from '../../../assets-src/sprites/ausruestung/ruestung_icons';
import leder from '../../../assets-src/sprites/ausruestung/ruestung_leder';
import spieler from '../../../assets-src/sprites/figuren/spieler_basis';
import { ICON_ANKER, ICON_GROESSE } from '../../../assets-src/sprites/icons/_icon';
import gerbrahmen from '../../../assets-src/sprites/stationen/gerbrahmen';
import schneidertisch from '../../../assets-src/sprites/stationen/schneidertisch';
import webstuhl from '../../../assets-src/sprites/stationen/webstuhl';
import { itemFigureLayer, itemIconId, itemLayerSpriteId } from '../../../src/content/items/index';
import { RUESTUNG, RUESTUNG_STATIONEN } from '../../../src/content/items/ruestung';
import { RUESTUNGSSETS } from '../../../src/content/ruestungssets';
import { stationSpriteId } from '../../../src/content/stations';
import { atlasFrameOf, FIGURE_LAYER_ORDER, defaultFigureState } from '../../../src/render/anim/figure';
import type { AtlasManifest } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc, type SpriteFrameRef, type SpriteList } from '../../../src/render/batch/spriteList';
import { buildPlayerFigure } from '../../../src/render/game/playerFigure';
import { checkSprite } from '../../../tools/assets/spriteChecks';

const LAYER: readonly Sprite[] = [...faser, ...leder, ...bronze];
const byId = new Map(LAYER.map((s) => [s.id, s]));
const [tunika, hose] = kleidung;

function layer(id: string): Sprite {
  const s = byId.get(itemLayerSpriteId(id));
  if (s === undefined) throw new Error(`Layer von ${id} fehlt`);
  return s;
}

function maske(s: Sprite, f: number): string {
  return Array.from(s.frames[f]?.index ?? [], (v) => (v === TRANSPARENT ? '.' : '#')).join('');
}

const STEIN = new Set(Array.from({ length: 6 }, (_, i) => rampStart('stein') + i));
const TEILE = RUESTUNG.filter((i) => i.kategorie === 'ruestung');

describe('M6-12/M6-31 Rüstungs-Layer über allen Spieleranimationen', () => {
  it('jedes Rüstungsteil der drei Sets hat seinen Layer auf dem Platz seines Ausrüstungsplatzes', () => {
    expect(TEILE).toHaveLength(12);
    expect(LAYER.map((s) => s.id).sort()).toEqual(TEILE.map((i) => itemLayerSpriteId(i.id)).sort());
    expect(RUESTUNGSSETS.flatMap((s) => s.teile).sort()).toEqual(TEILE.map((i) => i.id).sort());
    for (const i of TEILE) expect(itemFigureLayer(i), i.id).toBe(i.ausruestung === 'brust' ? 'koerper' : i.ausruestung);
  });

  it('Overlays: Frames, Zelle und Anker des Körpers; kein Pixel neben dem Körper, in keinem Frame', () => {
    for (const i of TEILE.filter((t) => t.ausruestung !== 'kopf')) {
      const s = layer(i.id);
      expect([s.w, s.h, s.anchor, s.frames.length], i.id).toEqual([spieler.w, spieler.h, spieler.anchor, spieler.frames.length]);
      let leer = 0;
      s.frames.forEach((f, fi) => {
        const koerper = spieler.frames[fi]?.index ?? new Uint8Array();
        let n = 0;
        f.index.forEach((v, p) => {
          if (v === TRANSPARENT) return;
          n++;
          if ((koerper[p] ?? TRANSPARENT) === TRANSPARENT) throw new Error(`${i.id}: Frame ${fi} Pixel ${p} neben dem Körper`);
        });
        if (n === 0) leer++;
      });
      // Worn on body and feet, the pieces are seen in (almost) every picture – only a few frames hide them (the swimmer
      // under water); the trousers show below the tunic's hem only (their mask is the linen trousers', see below).
      if (i.ausruestung !== 'beine') expect(leer / s.frames.length, i.id).toBeLessThan(0.1);
    }
  });

  it('das Fasergewand ersetzt Tunika und Hose Pixel für Pixel, das Wams ist ärmellos, die Schuhe aller Sets reichen über den Knöchel', () => {
    if (tunika === undefined || hose === undefined) throw new Error('Kleidung fehlt');
    const hemd = layer('faserhemd');
    const fhose = layer('faserhose');
    const wams = layer('lederwams');
    const fuesse = ['faserschuhe', 'lederstiefel', 'bronzestiefel'].map(layer);
    let wamsKleiner = 0;
    for (let f = 0; f < spieler.frames.length; f++) {
      expect(maske(hemd, f), `Hemd Frame ${f}`).toBe(maske(tunika, f));
      expect(maske(fhose, f), `Hose Frame ${f}`).toBe(maske(hose, f));
      const w = maske(wams, f);
      const t = maske(tunika, f);
      let neben = 0;
      for (let p = 0; p < w.length; p++) if (w[p] === '#' && t[p] !== '#') neben++;
      expect(neben, `Wams Frame ${f}`).toBe(0);
      if (w.split('#').length < t.split('#').length) wamsKleiner++;
      // Fibre wraps, leather cuff, bronze shin: the feet of every set take the ankle row above the body's shoes.
      const [a, b, c] = fuesse.map((x) => maske(x, f));
      expect([b, c], `Füße Frame ${f}`).toEqual([a, a]);
    }
    expect(wamsKleiner).toBeGreaterThan(spieler.frames.length / 2);
    const koerperSchuhe = (f: number): number => {
      const idx = spieler.frames[f]?.index ?? new Uint8Array();
      const schuh = new Set([paletteIndex('erde.1'), paletteIndex('erde.2')]);
      return idx.reduce((n, v) => n + (schuh.has(v) ? 1 : 0), 0);
    };
    const idle = spieler.clips.idle_down?.frames[0] ?? 0;
    expect(maske(fuesse[0] as Sprite, idle).split('#').length - 1).toBeGreaterThan(koerperSchuhe(idle));
  });

  it('Helme sind Sockel-Layer: je Körperclip ein Clip gleicher Länge, Halte-Clips; am Kopfsockel liegen sie auf dem Kopf', () => {
    for (const id of ['faserkappe', 'lederkappe', 'bronzehelm']) {
      const s = layer(id);
      for (const [name, c] of Object.entries(spieler.clips)) {
        const h = s.clips[name];
        expect(h?.frames.length, `${id} ${name}`).toBe(c.frames.length);
        expect(h?.fps, `${id} ${name}`).toBe(c.fps);
      }
      for (const r of ['down', 'up', 'right', 'left']) expect(s.clips[r]?.frames, `${id} ${r}`).toHaveLength(1);
      // Set on the socket of every body frame, the helmet lies on the head: every pixel on a body pixel.
      for (const [name, c] of Object.entries(spieler.clips)) {
        c.frames.forEach((bf, pos) => {
          const hf = s.clips[name]?.frames[pos] ?? 0;
          const k = spieler.sockets.kopf?.[bf];
          if (k === undefined) throw new Error(`Kopfsockel fehlt in Frame ${bf}`);
          s.frames[hf]?.index.forEach((v, p) => {
            if (v === TRANSPARENT) return;
            const x = k[0] + (p % s.w) - s.anchor[0];
            const y = k[1] + Math.floor(p / s.w) - s.anchor[1];
            if ((spieler.frames[bf]?.index[y * spieler.w + x] ?? TRANSPARENT) === TRANSPARENT) throw new Error(`${id} ${name}[${pos}]: Pixel neben dem Kopf`);
          });
        });
      }
    }
  });

  it('Bronze über die Materialstufe: Metallflag, keine stein-Pixel; ≤ 12 Farben, palettenrein', () => {
    for (const s of bronze) {
      let metall = 0;
      for (const f of s.frames) {
        f.index.forEach((v, p) => {
          if (STEIN.has(v)) throw new Error(`${s.id}: stein-Pixel`);
          if (v !== TRANSPARENT && ((f.material[p] ?? 0) & MATERIAL_BITS.metall) !== 0) metall++;
        });
      }
      expect(metall, s.id).toBeGreaterThan(0);
    }
    for (const s of LAYER) {
      expect(spriteColorCount(s), s.id).toBeLessThanOrEqual(MAX_SPRITE_COLORS);
      expect(checkSprite(s).errors, s.id).toEqual([]);
    }
  });
});

describe('M6-12 Rüstung im Renderer: Kopf, Körper, Beine und Füße zugleich', () => {
  const MANIFEST: AtlasManifest = (() => {
    const mod = generatedAtlasModule();
    if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
    return manifestFromGenerated(mod);
  })();

  it('die Stiefel haben ihren Slot über der Hose, der Körper liegt darüber; alle vier Teile werden gezeichnet', () => {
    for (const order of Object.values(FIGURE_LAYER_ORDER)) {
      expect(order.indexOf('fuesse')).toBe(order.indexOf('beine') + 1);
      expect(order.indexOf('koerper')).toBeGreaterThan(order.indexOf('fuesse'));
    }
    const rig = buildPlayerFigure(MANIFEST, [
      { slot: 'kopf', sprite: 'ausruestung_bronzehelm' },
      { slot: 'koerper', sprite: 'ausruestung_bronzebrustpanzer' },
      { slot: 'beine', sprite: 'ausruestung_bronzebeinschienen' },
      { slot: 'fuesse', sprite: 'ausruestung_bronzestiefel' },
    ]);
    if (rig === null) throw new Error('keine Spielerfigur');
    expect(rig.clothing).toEqual(['ausruestung_bronzehelm', 'ausruestung_bronzebrustpanzer', 'ausruestung_bronzebeinschienen', 'ausruestung_bronzestiefel']);
    const owner = new Map<SpriteFrameRef, string>();
    for (const s of Object.values(MANIFEST.sprites)) for (const f of s.frames) owner.set(f, s.id);
    // The actions the renderer plays today (the combat clips follow with M6-38).
    for (const action of ['idle', 'walk', 'tool', 'roll', 'sleep', 'swim']) {
      expect(rig.available.has(action), action).toBe(true);
      for (const direction of ['down', 'up', 'right', 'left'] as const) {
        const ids: string[] = [];
        // The helmet on its socket comes as a copy of its frame grounded on the feet (M6-Gate, `groundedFrame`): its atlas frame.
        const list = { push: (d: SpriteDesc) => ids.push(d.frame === null ? '?' : (owner.get(atlasFrameOf(d.frame)) ?? '?')) } as unknown as SpriteList;
        rig.rig.emit(list, new SpriteDesc(), { ...defaultFigureState(), action, direction, time: 0.1 });
        expect(ids.filter((id) => id.startsWith('ausruestung_bronze')), `${action} ${direction}`).toHaveLength(4);
        expect(ids.indexOf('ausruestung_bronzestiefel'), `${action} ${direction}`).toBeGreaterThan(ids.indexOf('ausruestung_bronzebeinschienen'));
      }
    }
  });
});

describe('M6-12/M6-31 Icons und Stationen der Rüstkammer', () => {
  const KONTUR = paletteIndex('nacht.1');

  it('Icons: Rüstung, Leder, Fasergewebe, Lederrucksack, die drei Stationen – wie alle Item-Icons', () => {
    const stationsIcons = [...webstuhl, ...schneidertisch, ...gerbrahmen].filter((s) => s.id.startsWith('icon_'));
    const icons = [...ruestungIcons, ...stationsIcons];
    expect(icons.map((s) => s.id).sort()).toEqual([...RUESTUNG, ...RUESTUNG_STATIONEN].map((i) => itemIconId(i.id)).sort());
    expect(new Set(icons.map((s) => s.frames[0]?.index.join(','))).size).toBe(icons.length);
    for (const s of icons) {
      expect([s.w, s.h, s.anchor], s.id).toEqual([ICON_GROESSE, ICON_GROESSE, ICON_ANKER]);
      const f = s.frames[0]?.index ?? new Uint8Array();
      const d = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < 16 && y < 16 && (f[y * 16 + x] ?? TRANSPARENT) !== TRANSPARENT;
      let pixel = 0;
      let rand = 0;
      let kontur = 0;
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          if (!d(x, y)) continue;
          expect(x > 0 && y > 0 && x < 15 && y < 15, `${s.id} Rand (${x}, ${y})`).toBe(true);
          pixel++;
          if (!d(x + 1, y) || !d(x - 1, y) || !d(x, y + 1) || !d(x, y - 1)) {
            rand++;
            if (f[y * 16 + x] === KONTUR) kontur++;
          }
        }
      }
      expect(pixel, s.id).toBeGreaterThanOrEqual(48);
      expect(kontur / rand, s.id).toBeGreaterThanOrEqual(0.65);
      expect(checkSprite(s), s.id).toEqual({ errors: [], warnings: [] });
    }
  });

  it('Stationen: obj_<id>, Anker auf der Vorderkante mit 1 px Luft darunter, Clips je Art', () => {
    const obj = (list: readonly Sprite[], id: string): Sprite => {
      const s = list.find((x) => x.id === stationSpriteId(id));
      if (s === undefined) throw new Error(`${id} fehlt`);
      return s;
    };
    const stationen: readonly [Sprite, readonly string[]][] = [
      [obj(webstuhl, 'webstuhl'), ['aus', 'arbeitet']],
      [obj(schneidertisch, 'schneidertisch'), ['aus', 'arbeitet']],
      [obj(gerbrahmen, 'gerbrahmen'), ['leer', 'belegt', 'arbeitet', 'fertig']],
    ];
    for (const [s, clips] of stationen) {
      expect(s.w, s.id).toBe(32);
      expect(s.anchor, s.id).toEqual([16, s.h - 2]);
      for (const f of s.frames) for (let x = 0; x < s.w; x++) expect(f.index[(s.h - 1) * s.w + x], `${s.id} unterste Zeile`).toBe(TRANSPARENT);
      expect(Object.keys(s.clips).sort(), s.id).toEqual([...clips].sort());
      expect(new Set(s.clips.arbeitet?.frames).size, s.id).toBeGreaterThan(1);
      expect(checkSprite(s), s.id).toEqual({ errors: [], warnings: [] });
    }
  });
});
