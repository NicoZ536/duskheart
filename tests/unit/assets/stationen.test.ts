/**
 * M4-05/M4-06/M4-20/M4-21 (Sprite-Teil): Stationen, Lager und Herdfeuer als `obj_<id>` (docs/SPIEL.md §8).
 * Belegt am Pixel:
 * - Jede Station aus SPIEL §8 (T0 und T1), jedes Lager und das Herdfeuer hat `obj_<id>` in der Gruppe
 *   `stationen` und ein Icon `icon_<id>` (Lagerfeuer und Werkbank aus M3-16); die Glutkerne haben Icons.
 * - Anker = Mitte der Vorderkante (x = w/2, y = h − 2), 1 px Luft unter dem Fuß.
 * - Nur Feuer und Glut leuchten, und nur in den laufenden Zuständen; kalte Zustände sind dunkel; der
 *   Lichtsockel liegt in jedem leuchtenden Frame auf einem leuchtenden Pixel.
 * - Flammen laufen mit 10–12 fps und jede Flammenform ist eine eigene Zeichnung; das Herdfeuer trägt sechs
 *   Glutkern-Sockel auf seinem Steinring.
 * - Lager: `zu` und `offen` unterscheiden sich; die Truhe hat Bronze mit Metallflag.
 * - Alle: Palettenfarben, ≤ 12 Farben, keine Befunde des Paletten-Validators.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import t0 from '../../../assets-src/sprites/stationen/t0';
import t1 from '../../../assets-src/sprites/stationen/t1';
import herdfeuer from '../../../assets-src/sprites/stationen/herdfeuer';
import lager from '../../../assets-src/sprites/lager/lager';
import stationIcons from '../../../assets-src/sprites/icons/stationen';
import lagerIcons from '../../../assets-src/sprites/icons/lager';
import grundlagen from '../../../assets-src/sprites/icons/grundlagen';
import lagerfeuer from '../../../assets-src/sprites/platzierbar/lagerfeuer';
import { STATIONEN_GRUPPE } from '../../../assets-src/sprites/stationen/_stationen';
import { MATERIAL_BITS, MAX_SPRITE_COLORS, TRANSPARENT, spriteColorCount, type Sprite, type SpriteFrame } from '../../../assets-src/lib/sprite';
import { paletteRef } from '../../../assets-src/palette';
import { checkSprite } from '../../../tools/assets/spriteChecks';

const ALLE: readonly Sprite[] = [...t0, ...t1, ...herdfeuer, ...lager];
const ICONS: readonly Sprite[] = [...stationIcons, ...lagerIcons];

function hole(id: string): Sprite {
  const s = ALLE.find((x) => x.id === id);
  if (s === undefined) throw new Error(`Sprite ${id} fehlt`);
  return s;
}

function frame(s: Sprite, i: number): SpriteFrame {
  const f = s.frames[i];
  if (f === undefined) throw new Error(`${s.id}: Frame ${i} fehlt`);
  return f;
}

function spielIds(titel: string): string[] {
  const text = readFileSync(join(process.cwd(), 'docs/SPIEL.md'), 'utf8');
  const z = text.split('\n').find((l) => l.startsWith(`- **${titel}`));
  if (z === undefined) throw new Error(`docs/SPIEL.md: Zeile „${titel}“ fehlt`);
  return [...z.matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1] ?? '');
}

/** Stationen T0 und T1 (die Zeile nennt beide Stufen), Lager, Herdfeuer mit Glutkernen. */
const STATIONEN = spielIds('Stationen T0 (M4-05)').filter((id) => !id.startsWith('stufe'));
const LAGER = spielIds('Lagerung (M4-21)');
const HERD = spielIds('Herdfeuer (M4-20)');
const GLUTKERNE = Array.from({ length: 6 }, (_, i) => `glutkern_${i + 1}`);

function leuchtet(f: SpriteFrame): number {
  let n = 0;
  f.index.forEach((v, p) => {
    if (v !== TRANSPARENT && (f.emissive[p] ?? 0) > 0) n++;
  });
  return n;
}

describe('M4-05/M4-06/M4-20/M4-21 Stations-Sprites: Vollständigkeit', () => {
  it('jede Station, jedes Lager und das Herdfeuer aus SPIEL §8 hat obj_<id> in der Gruppe stationen', () => {
    expect(STATIONEN.length).toBe(12);
    expect(LAGER).toEqual(['kiste_holz', 'truhe', 'lagerregal']);
    expect(HERD[0]).toBe('herdfeuer');
    const ids = new Set(ALLE.map((s) => s.id));
    for (const id of [...STATIONEN, ...LAGER, 'herdfeuer', 'herdfeuer_glutkern']) expect(ids.has(`obj_${id}`), id).toBe(true);
    for (const s of ALLE) expect(s.group, s.id).toBe(STATIONEN_GRUPPE);
  });

  it('Icons: jede Station (Lagerfeuer und Werkbank aus M3-16), jedes Lager, Herdfeuer und alle sechs Glutkerne', () => {
    const vorhanden = new Set([...ICONS, ...grundlagen].map((s) => s.id));
    for (const id of [...STATIONEN, ...LAGER, 'herdfeuer', ...GLUTKERNE]) expect(vorhanden.has(`icon_${id}`), id).toBe(true);
    const eigene = ICONS.map((s) => s.id).sort();
    expect(eigene).toEqual([...STATIONEN.filter((id) => id !== 'lagerfeuer' && id !== 'werkbank'), ...LAGER, 'herdfeuer', ...GLUTKERNE].map((id) => `icon_${id}`).sort());
    const bilder = new Set(ICONS.map((s) => frame(s, 0).index.join(',')));
    expect(bilder.size).toBe(ICONS.length);
    for (const s of ICONS) {
      const f = frame(s, 0);
      for (let i = 0; i < 16; i++) for (const [x, y] of [[i, 0], [i, 15], [0, i], [15, i]] as const) expect(f.index[y * 16 + x], `${s.id} Rand (${x}, ${y})`).toBe(TRANSPARENT);
      expect(f.emissive.some((e) => e > 0), `${s.id}: Icons leuchten nicht`).toBe(false);
    }
  });

  it('Palettenfarben, ≤ 12 Farben, keine Befunde bei Stationen und Icons', () => {
    for (const s of [...ALLE, ...ICONS]) {
      const r = checkSprite(s);
      expect(r.errors, s.id).toEqual([]);
      expect(r.warnings, s.id).toEqual([]);
      expect(spriteColorCount(s), s.id).toBeLessThanOrEqual(MAX_SPRITE_COLORS);
    }
  });

  it('Anker = Mitte der Vorderkante mit 1 px Luft darunter; der Fuß steht auf der Ankerzeile', () => {
    // Das Lagerfeuer als Station übernimmt Anker und Bild des platzierten Lagerfeuers (M3-22).
    expect(hole('obj_lagerfeuer').anchor).toEqual(lagerfeuer.anchor);
    for (const s of ALLE) {
      if (s.id === 'obj_herdfeuer_glutkern' || s.id === 'obj_lagerfeuer') continue;
      expect(s.anchor, s.id).toEqual([s.w / 2, s.h - 2]);
      for (const [i, f] of s.frames.entries()) {
        for (let x = 0; x < s.w; x++) expect(f.index[(s.h - 1) * s.w + x], `${s.id} F${i} Luft (${x})`).toBe(TRANSPARENT);
        expect(Array.from({ length: s.w }, (_, x) => f.index[(s.h - 2) * s.w + x]).some((v) => v !== TRANSPARENT), `${s.id} F${i} Fuß`).toBe(true);
      }
    }
  });
});

describe('M4-05/M4-06/M4-20 Licht und Takt', () => {
  const brennend = ['obj_lagerfeuer', 'obj_lehmofen', 'obj_schmelzofen', 'obj_koehlermeiler', 'obj_herdfeuer'];

  it('nur Feuer und Glut leuchten, nur in laufenden Zuständen; aus und fertig sind dunkel', () => {
    for (const s of ALLE) {
      s.frames.forEach((f, i) =>
        f.index.forEach((v, p) => {
          if (v === TRANSPARENT || (f.emissive[p] ?? 0) === 0) return;
          const ref = paletteRef(v);
          expect(ref.startsWith('feuer.') || ref === 'laub.3', `${s.id} F${i} ${ref}`).toBe(true);
        }),
      );
      for (const name of ['aus', 'fertig', 'asche', 'leer', 'belegt', 'zu', 'offen']) for (const i of s.clips[name]?.frames ?? []) expect(leuchtet(frame(s, i)), `${s.id} ${name}`).toBe(0);
    }
    for (const id of brennend) {
      const s = hole(id);
      expect(s.clips.aus?.frames.length, id).toBeGreaterThan(0);
      for (const i of s.clips.brennt?.frames ?? []) expect(leuchtet(frame(s, i)), `${id} brennt ${i}`).toBeGreaterThan(0);
    }
    // Stationen ohne Feuer leuchten nie.
    for (const id of ['obj_werkbank', 'obj_saegebock', 'obj_steinmetzbank', 'obj_trockengestell', 'obj_werkbank_2', 'obj_amboss_bronze', 'obj_schleifstein', 'obj_spinnrad', 'obj_kiste_holz', 'obj_truhe', 'obj_lagerregal']) {
      for (const f of hole(id).frames) expect(leuchtet(f), id).toBe(0);
    }
  });

  it('Lichtsockel in jedem brennenden Frame auf einem leuchtenden Pixel', () => {
    for (const id of brennend) {
      const s = hole(id);
      const licht = s.sockets.licht;
      expect(licht, id).toBeDefined();
      for (const i of s.clips.brennt?.frames ?? []) {
        const [x, y] = licht?.[i] ?? [0, 0];
        expect(frame(s, i).emissive[y * s.w + x], `${id} F${i} (${x}, ${y})`).toBe(1);
      }
    }
  });

  it('Flammen 10–12 fps, jede Flammenform eigens gezeichnet; Glut pulsiert langsamer', () => {
    for (const id of ['obj_lagerfeuer', 'obj_lehmofen', 'obj_schmelzofen', 'obj_herdfeuer']) {
      const c = hole(id).clips.brennt;
      expect(c?.fps, id).toBeGreaterThanOrEqual(10);
      expect(c?.fps, id).toBeLessThanOrEqual(12);
      const s = hole(id);
      const formen = new Set((c?.frames ?? []).map((i) => frame(s, i).index.join(',')));
      expect(formen.size, id).toBe(new Set(c?.frames ?? []).size);
    }
    expect(hole('obj_koehlermeiler').clips.brennt?.fps).toBeLessThan(10);
    expect(hole('obj_herdfeuer').clips.glut?.fps).toBeLessThan(10);
  });

  it('Lagerfeuer als Station: alle Clips des platzierten Lagerfeuers plus arbeitet (Bratspieß)', () => {
    const s = hole('obj_lagerfeuer');
    for (const name of Object.keys(lagerfeuer.clips)) expect(s.clips[name]?.frames, name).toEqual(lagerfeuer.clips[name]?.frames);
    const arbeitet = s.clips.arbeitet?.frames ?? [];
    expect(arbeitet.length).toBe(lagerfeuer.clips.brennt?.frames.length);
    for (const i of arbeitet) expect(leuchtet(frame(s, i))).toBeGreaterThan(0);
  });

  it('Herdfeuer: 48×48, sechs Glutkern-Sockel auf dem Steinring, Glutkern pulsiert emissiv', () => {
    const s = hole('obj_herdfeuer');
    expect([s.w, s.h]).toEqual([48, 48]);
    const f = frame(s, 0);
    for (let n = 1; n <= 6; n++) {
      const p = s.sockets[`glutkern_${n}`]?.[0];
      expect(p, `glutkern_${n}`).toBeDefined();
      const [x, y] = p ?? [0, 0];
      const v = f.index[y * s.w + x] ?? TRANSPARENT;
      expect(v, `glutkern_${n}`).not.toBe(TRANSPARENT);
      expect(paletteRef(v).startsWith('stein.') || paletteRef(v) === 'nacht.1', `glutkern_${n} ${paletteRef(v)}`).toBe(true);
    }
    const kern = hole('obj_herdfeuer_glutkern');
    expect(kern.clips.idle?.loop).toBe(true);
    for (const k of kern.frames) expect(leuchtet(k)).toBeGreaterThan(10);
  });
});

describe('M4-21 Lager', () => {
  it('zu und offen unterscheiden sich, die Truhe trägt Bronze mit Metallflag', () => {
    for (const id of ['obj_kiste_holz', 'obj_truhe', 'obj_lagerregal']) {
      const s = hole(id);
      const zu = s.clips.zu?.frames[0] ?? -1;
      const offen = s.clips.offen?.frames[0] ?? -1;
      expect(frame(s, zu).index.join(','), id).not.toBe(frame(s, offen).index.join(','));
    }
    expect(frame(hole('obj_truhe'), 0).material.some((b) => (b & MATERIAL_BITS.metall) !== 0)).toBe(true);
  });
});
