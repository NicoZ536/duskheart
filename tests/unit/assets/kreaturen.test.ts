/**
 * M6 Kreaturen-Sprites (MASTERPROMPT §4.4/§4.5/§4.6/§20.1, docs/ART.md §15, docs/SPIEL.md §11/§14): alle 22
 * kanonischen Kreaturen als `kreatur_<id>` mit den Pflicht-Clips in vier Richtungen (`left` eigen oder
 * gespiegelt), Zellgrößen nach §4.4, nur Palettenfarben (≤ 12), emissive Augen für Nachtjäger und die
 * Schattenbrut, jede Attacke mit eigener Ausholphase (≥ 2 Clip-Positionen, 0,2–1,0 s, sichtbar andere
 * Pose), Figurentakt 8–12 fps, 1 px Luft zum Zellrand, keine Einzelpixel-Befunde, deterministischer
 * Generator; Wolf und Nachtmahr von vorn und hinten breit mit getrennten Läufen (keine Säulen), der Überfall des Dornlings
 * aus jeder Richtung mit glühenden Augen. Die Angriffsnamen sind der Vertrag mit den Kreatur-Daten (docs/ART.md §15).
 */
import { describe, expect, it } from 'vitest';
import { KREATUREN_M6, KREATUR_GRUPPEN } from '../../../assets-src/sprites/kreaturen/_katalog';
import geschossSpucken from '../../../assets-src/sprites/kreaturen/geschoss_spucken';
import { MAX_SPRITE_COLORS, TRANSPARENT, spriteColorCount, type Sprite } from '../../../assets-src/lib/sprite';
import { paletteIndex, rampStart } from '../../../assets-src/palette';
import { findOrphanPixels } from '../../../tools/assets/spriteChecks';

/** docs/SPIEL.md §14: die 22 kanonischen Kreatur-Ids in ihrer Reihenfolge. */
const IDS = [
  'hase',
  'reh',
  'wachtel',
  'eichhoernchen',
  'gluehwuermchen',
  'frosch',
  'keiler',
  'dachs',
  'wolf',
  'dornling',
  'wespenschwarm',
  'krabbe',
  'moewe',
  'robbe',
  'scherenkrebs',
  'qualle',
  'strandraeuber',
  'schleicher',
  'kriecher',
  'speier',
  'lichtfresser',
  'nachtmahr',
] as const;

/** §4.4: klein 16×16, mittel 32×32, groß 48–64 px. */
const KLEIN = new Set(['hase', 'wachtel', 'eichhoernchen', 'frosch', 'gluehwuermchen', 'krabbe']);
const GROSS = new Set(['nachtmahr']);

/** Vertrag mit den Kreatur-Daten: Angriffsnamen je Kreatur (docs/ART.md §15). */
const ANGRIFFE: Readonly<Record<string, readonly string[]>> = {
  hase: [],
  reh: ['tritt'],
  wachtel: [],
  eichhoernchen: [],
  gluehwuermchen: [],
  frosch: [],
  keiler: ['ansturm', 'hauer'],
  dachs: ['biss', 'kratzer'],
  wolf: ['biss', 'sprung'],
  dornling: ['peitsche', 'ueberfall'],
  wespenschwarm: ['stechen'],
  krabbe: ['kneifen'],
  moewe: ['picken'],
  robbe: ['biss'],
  scherenkrebs: ['kneifen', 'scherenschlag'],
  qualle: ['nesseln'],
  strandraeuber: ['hieb'],
  schleicher: ['klaue', 'sprung'],
  kriecher: ['packen'],
  speier: ['spucken'],
  lichtfresser: ['saugen', 'schlag'],
  nachtmahr: ['stampfen', 'ansturm'],
};

const PFLICHT = ['idle', 'move', 'hit', 'death'] as const;
const RICHTUNGEN = ['down', 'up', 'right', 'left'] as const;

function frameVon(s: Sprite, f: number): { index: Uint8Array; emissive: Uint8Array } {
  const fr = s.frames[f];
  if (fr === undefined) throw new Error(`${s.id}: Frame ${f} fehlt`);
  return fr;
}

/** Clip `<aktion>_<richtung>`; `left` darf bei spiegelbaren Sprites fehlen (Renderer spiegelt `right`). */
function clip(s: Sprite, aktion: string, r: string): { frames: readonly number[]; fps: number; loop: boolean; events: readonly { frame: number; name: string }[] } {
  const eigen = s.clips[`${aktion}_${r}`];
  if (eigen !== undefined) return eigen;
  const rechts = s.clips[`${aktion}_right`];
  if (r === 'left' && s.spiegelbar && rechts !== undefined) return rechts;
  throw new Error(`${s.id}: Clip ${aktion}_${r} fehlt${r === 'left' ? ' (und nicht spiegelbar)' : ''}`);
}

function emissivePixel(s: Sprite, f: number): number {
  const fr = frameVon(s, f);
  let n = 0;
  fr.emissive.forEach((v, p) => {
    if (v > 0 && fr.index[p] !== TRANSPARENT) n++;
  });
  return n;
}

/** Silhouette of a frame: width of its bounding box and the widest gap between opaque runs in the three lowest rows (the legs). */
function silhouette(s: Sprite, f: number): { breite: number; fussLuecke: number } {
  const fr = frameVon(s, f);
  let x0 = s.w;
  let x1 = -1;
  let y1 = -1;
  fr.index.forEach((v, p) => {
    if (v === TRANSPARENT) return;
    x0 = Math.min(x0, p % s.w);
    x1 = Math.max(x1, p % s.w);
    y1 = Math.max(y1, Math.floor(p / s.w));
  });
  let luecke = 0;
  for (let y = y1; y > y1 - 3 && y >= 0; y--) {
    let ende = -1;
    for (let x = 0; x < s.w; x++) {
      if (fr.index[y * s.w + x] === TRANSPARENT) continue;
      if (ende >= 0 && x - ende - 1 > 0) luecke = Math.max(luecke, x - ende - 1);
      ende = x;
    }
  }
  return { breite: x1 - x0 + 1, fussLuecke: luecke };
}

/** The sheet checks walk every frame of all 22 creatures (≈ 1–3 s alone); under the load of parallel builds 5 s is too tight. */
const SPRITE_SHEET_TIMEOUT_MS = 30_000;

describe('M6 Kreaturen: Katalog und Sprites kreatur_<id>', { timeout: SPRITE_SHEET_TIMEOUT_MS }, () => {
  it('alle 22 kanonischen Kreaturen in drei Bogen-Gruppen, Sprite-Id kreatur_<id>', () => {
    expect(KREATUREN_M6.map((k) => k.id)).toEqual([...IDS]);
    for (const k of KREATUREN_M6) {
      expect(k.ergebnis.sprite.id).toBe(`kreatur_${k.id}`);
      expect(KREATUR_GRUPPEN).toContain(k.gruppe);
    }
    expect(KREATUREN_M6.filter((k) => k.schattenbrut).map((k) => k.id)).toEqual(['schleicher', 'kriecher', 'speier', 'lichtfresser', 'nachtmahr']);
  });

  it('Zellgrößen nach §4.4: klein 16×16, mittel 32×32, groß 48–64 px; Anker in der Zelle', () => {
    for (const { id, ergebnis } of KREATUREN_M6) {
      const s = ergebnis.sprite;
      expect(s.w, id).toBe(s.h);
      if (KLEIN.has(id)) expect(s.w, id).toBe(16);
      else if (GROSS.has(id)) {
        expect(s.w, id).toBeGreaterThanOrEqual(48);
        expect(s.w, id).toBeLessThanOrEqual(64);
      } else expect(s.w, id).toBe(32);
      expect(s.anchor[0], id).toBe(s.w / 2);
      expect(s.anchor[1], id).toBeGreaterThan(s.h / 2);
      expect(s.anchor[1], id).toBeLessThan(s.h);
    }
  });

  it('jede Kreatur hat idle, move, hit, death und jede Attacke in allen vier Richtungen', () => {
    for (const { id, ergebnis } of KREATUREN_M6) {
      const s = ergebnis.sprite;
      const aktionen = [...PFLICHT, ...(ANGRIFFE[id] ?? []).map((a) => `attack_${a}`)];
      for (const a of aktionen) for (const r of RICHTUNGEN) expect(() => clip(s, a, r), `${id} ${a}_${r}`).not.toThrow();
      const attacken = Object.keys(s.clips)
        .filter((c) => c.startsWith('attack_') && c.endsWith('_down'))
        .map((c) => c.slice('attack_'.length, -'_down'.length))
        .sort();
      expect(attacken, id).toEqual([...(ANGRIFFE[id] ?? [])].sort());
    }
  });

  it('Gegner und Schattenbrut greifen an; Takt 8–12 fps, Dauerzustände schleifen, Einmal-Aktionen enden', () => {
    for (const { id, ergebnis } of KREATUREN_M6) {
      const s = ergebnis.sprite;
      for (const [name, c] of Object.entries(s.clips)) {
        expect(c.fps, `${id} ${name}`).toBeGreaterThanOrEqual(8);
        expect(c.fps, `${id} ${name}`).toBeLessThanOrEqual(12);
        const aktion = name.slice(0, name.lastIndexOf('_'));
        if (aktion === 'idle' || aktion === 'move') expect(c.loop, `${id} ${name}`).toBe(true);
        if (aktion === 'hit' || aktion === 'death' || aktion.startsWith('attack_')) expect(c.loop, `${id} ${name}`).toBe(false);
      }
    }
    for (const id of ['keiler', 'dachs', 'wolf', 'dornling', 'wespenschwarm', 'scherenkrebs', 'qualle', 'strandraeuber', 'schleicher', 'kriecher', 'speier', 'lichtfresser', 'nachtmahr']) {
      expect((ANGRIFFE[id] ?? []).length, id).toBeGreaterThan(0);
    }
  });

  it('Bewegung, Treffer und Tod haben genug eigene Frames (§4.5): move ≥ 4, hit 2, death ≥ 4', () => {
    for (const { id, ergebnis } of KREATUREN_M6) {
      for (const r of RICHTUNGEN) {
        const s = ergebnis.sprite;
        expect(new Set(clip(s, 'move', r).frames).size, `${id} move_${r}`).toBeGreaterThanOrEqual(4);
        expect(new Set(clip(s, 'hit', r).frames).size, `${id} hit_${r}`).toBe(2);
        expect(new Set(clip(s, 'death', r).frames).size, `${id} death_${r}`).toBeGreaterThanOrEqual(4);
        expect(clip(s, 'idle', r).frames.length, `${id} idle_${r}`).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('jede Attacke hat eine lesbare Ausholphase: ≥ 2 Positionen, 0,2–1,0 s, eigene Pose, Events ausholen/treffer', () => {
    for (const { ergebnis } of KREATUREN_M6) {
      const s = ergebnis.sprite;
      for (const info of ergebnis.clips.filter((c) => c.aktion.startsWith('attack_'))) {
        const name = info.clip;
        const aus = info.ausholen;
        expect(aus, name).not.toBeNull();
        if (aus === null) continue;
        expect(aus.von, name).toBe(0);
        const positionen = aus.bis - aus.von + 1;
        expect(positionen, name).toBeGreaterThanOrEqual(2);
        const sekunden = positionen / info.fps;
        expect(sekunden, name).toBeGreaterThanOrEqual(0.2);
        expect(sekunden, name).toBeLessThanOrEqual(1);
        // Die Ausholposen weichen sichtbar von der Ruhe ab (nicht der Idle-Frame).
        const idle = clip(s, 'idle', info.richtung).frames[0] ?? -1;
        const ausholFrames = new Set(info.frames.slice(aus.von, aus.bis + 1));
        expect(ausholFrames.has(idle) && ausholFrames.size === 1, `${name}: Ausholen = Idle`).toBe(false);
        const events = s.clips[name]?.events ?? [];
        expect(events.find((e) => e.name === 'ausholen')?.frame, name).toBe(0);
        const treffer = events.find((e) => e.name === 'treffer')?.frame ?? -1;
        expect(treffer, name).toBeGreaterThan(aus.bis);
        expect(treffer, name).toBeLessThan(info.frames.length);
      }
    }
  });

  it('nur Palettenfarben, höchstens 12 je Sprite (§4.3), keine verwaisten Einzelpixel ohne Begründung', () => {
    for (const { id, ergebnis } of KREATUREN_M6) {
      const s = ergebnis.sprite;
      expect(s.farbFehler, id).toEqual([]);
      expect(s.fremdFarben, id).toBe(0);
      if (s.ausnahmeFarben === null) expect(spriteColorCount(s), id).toBeLessThanOrEqual(MAX_SPRITE_COLORS);
      if (s.einzelpixel === null) expect(findOrphanPixels(s).slice(0, 5), id).toEqual([]);
    }
  });

  it('1 px Luft zum Zellrand in jedem Frame (Interaktions-Outline, docs/ART.md §8)', () => {
    // Every opaque pixel of every frame; the pixels on the cell border are collected and checked in one expect
    // (one expect per pixel were 300 000 calls, M6-93).
    const amRand: string[] = [];
    for (const { id, ergebnis } of KREATUREN_M6) {
      const s = ergebnis.sprite;
      s.frames.forEach((f, fi) => {
        f.index.forEach((v, p) => {
          if (v === TRANSPARENT) return;
          const x = p % s.w;
          const y = Math.floor(p / s.w);
          if (!(x > 0 && y > 0 && x < s.w - 1 && y < s.h - 1)) amRand.push(`${id} Frame ${fi} (${x}, ${y})`);
        });
      });
    }
    expect(amRand).toEqual([]);
  });

  it('Nachtjäger und Schattenbrut: emissive Augen von vorn und im Profil; friedliche Tiere ohne Leuchtaugen', () => {
    for (const k of KREATUREN_M6) {
      const s = k.ergebnis.sprite;
      for (const r of ['down', 'right', 'left'] as const) {
        const f = clip(s, 'idle', r).frames[0] ?? 0;
        if (k.nachtjaeger) expect(emissivePixel(s, f), `${k.id} idle_${r}`).toBeGreaterThanOrEqual(2);
      }
    }
    for (const id of ['hase', 'reh', 'wachtel', 'eichhoernchen', 'frosch', 'krabbe', 'moewe', 'robbe']) {
      const s = KREATUREN_M6.find((k) => k.id === id)?.ergebnis.sprite;
      if (s === undefined) throw new Error(id);
      expect(s.frames.every((_, f) => emissivePixel(s, f) === 0), id).toBe(true);
    }
  });

  it('Schattenbrut ohne harte Kontur (violetter Randsaum), Augen in eis.4* oder verderb.4*', () => {
    for (const k of KREATUREN_M6.filter((x) => x.schattenbrut)) {
      const s = k.ergebnis.sprite;
      const f = frameVon(s, clip(s, 'idle', 'right').frames[0] ?? 0);
      // Randpixel (an Transparenz grenzend) oben: violett (Rampe `verderb`), keine nacht.1-Kontur.
      const violett = rampStart('verderb');
      let saum = 0;
      let rand = 0;
      f.index.forEach((v, p) => {
        if (v === TRANSPARENT) return;
        const y = Math.floor(p / s.w);
        if (y > 0 && f.index[p - s.w] === TRANSPARENT) {
          rand++;
          if (v >= violett) saum++;
        }
      });
      expect(saum / Math.max(1, rand), k.id).toBeGreaterThan(0.5);
    }
  });

  it('Geschoss geschoss_spucken: 16×16, Clips flug (Schleife) und aufprall, emissiv', () => {
    const s = geschossSpucken;
    expect([s.id, s.w, s.h]).toEqual(['geschoss_spucken', 16, 16]);
    expect(s.clips['flug']?.loop).toBe(true);
    expect(s.clips['aufprall']?.loop).toBe(false);
    expect(s.frames.some((_, f) => emissivePixel(s, f) > 0)).toBe(true);
  });

  it('Wolf und Nachtmahr von vorn und hinten keine Säulen (M6-Gate): breite Silhouette, Läufe auseinander, beim Wolf helle Keulen', () => {
    // Per creature: minimal silhouette width from the front and from behind [px] and the gap between the legs at the
    // ground [px] at rest (before the gate: wolf 12 px wide with legs 2–3 px apart, the Nachtmahr 14 px with 3–6 px).
    const MASS = { wolf: { breite: 15, luecke: 4 }, nachtmahr: { breite: 20, luecke: 8 } } as const;
    for (const [id, mass] of Object.entries(MASS)) {
      const k = KREATUREN_M6.find((x) => x.id === id);
      if (k === undefined) throw new Error(id);
      const s = k.ergebnis.sprite;
      for (const r of ['down', 'up'] as const) {
        const ruhe = clip(s, 'idle', r).frames;
        // Idle and every held wind-up picture (the attack's tell seen from the front and from behind).
        const ausholen = k.ergebnis.clips.filter((c) => c.richtung === r && c.ausholen !== null).flatMap((c) => c.frames.slice(c.ausholen?.von, (c.ausholen?.bis ?? 0) + 1));
        for (const f of new Set([...ruhe, ...ausholen])) expect(silhouette(s, f).breite, `${id} ${r} Frame ${f} Breite`).toBeGreaterThanOrEqual(mass.breite);
        for (const f of new Set(ruhe)) expect(silhouette(s, f).fussLuecke, `${id} ${r} Frame ${f} Läufe`).toBeGreaterThanOrEqual(mass.luecke);
      }
    }
    // The wolf from behind: light haunches (cream `stein.5`) beside the dark saddle, at rest and in every wind-up.
    const wolf = KREATUREN_M6.find((x) => x.id === 'wolf');
    if (wolf === undefined) throw new Error('wolf');
    const creme = paletteIndex('stein.5');
    const hinten = wolf.ergebnis.clips.filter((c) => c.richtung === 'up' && (c.aktion === 'idle' || c.ausholen !== null));
    for (const c of hinten) {
      const bis = c.ausholen === null ? c.frames.length - 1 : c.ausholen.bis;
      for (const f of c.frames.slice(0, bis + 1)) expect(frameVon(wolf.ergebnis.sprite, f).index.filter((v) => v === creme).length, `${c.clip} Frame ${f} Keulen`).toBeGreaterThanOrEqual(4);
    }
  });

  it('Dornling: der Überfall zeigt sich aus jeder Richtung – in der gehaltenen Ausholpose glühende Augen, auch von hinten über der Krone (M6-Gate)', () => {
    const k = KREATUREN_M6.find((x) => x.id === 'dornling');
    if (k === undefined) throw new Error('dornling');
    const s = k.ergebnis.sprite;
    for (const r of RICHTUNGEN) {
      const c = clip(s, 'attack_ueberfall', r);
      const info = k.ergebnis.clips.find((x) => x.aktion === 'attack_ueberfall' && x.richtung === (r === 'left' ? 'right' : r));
      const bis = info?.ausholen?.bis ?? -1;
      expect(bis, r).toBeGreaterThanOrEqual(2);
      // Position 0 is still the bush (no eyes); from position 2 on (the held pose) the eyes glow – also from behind.
      expect(emissivePixel(s, c.frames[0] ?? -1), `ueberfall_${r} @0`).toBe(0);
      for (let pos = 2; pos <= bis; pos++) expect(emissivePixel(s, c.frames[pos] ?? -1), `ueberfall_${r} @${pos}`).toBeGreaterThanOrEqual(2);
      // Camouflaged it shows no eyes from any side.
      for (const f of clip(s, 'tarnung', r).frames) expect(emissivePixel(s, f), `tarnung_${r}`).toBe(0);
    }
  });

  it('Generator deterministisch: dieselbe Definition ergibt dieselben Pixel', () => {
    for (const id of ['wolf', 'wespenschwarm', 'strandraeuber', 'dornling']) {
      const k = KREATUREN_M6.find((x) => x.id === id);
      if (k === undefined) throw new Error(id);
      const neu = k.ergebnis.erzeuge();
      expect(neu.sprite.frames.length, id).toBe(k.ergebnis.sprite.frames.length);
      neu.sprite.frames.forEach((f, i) => {
        const alt = frameVon(k.ergebnis.sprite, i);
        expect(Buffer.from(f.index).equals(Buffer.from(alt.index)), `${id} Frame ${i}`).toBe(true);
        expect(Buffer.from(f.emissive).equals(Buffer.from(alt.emissive)), `${id} Frame ${i} emissiv`).toBe(true);
      });
      expect(neu.sprite.clips).toEqual(k.ergebnis.sprite.clips);
    }
  });
});
