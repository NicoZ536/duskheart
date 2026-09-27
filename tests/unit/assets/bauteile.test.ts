/**
 * M4-13: modulare Bauteil-Sprites (docs/SPIEL.md §8, Vertrag in `assets-src/sprites/bau/_bau.ts`).
 * Belegt am Pixel:
 * - Jedes Bauteil aus SPIEL §8 hat ein Sprite `bau_<id>` (Gruppe `bauteile`) und ein Icon `icon_<id>`.
 * - Wände: 16 Masken × Fassung A/B + Schnitt; eine Seite deckt den Zellrand genau dann, wenn die Maske
 *   dort verbindet; 16 px sichtbare Front; verbundene Nachbarn stoßen lückenlos aneinander (gleiche
 *   Deckung an der gemeinsamen Kante); der Schnitt kappt auf 4 px.
 * - Dächer: jede Deckung trägt das Dachflag, innen volle Fläche, offene Seiten enden mit Überstand, der
 *   Schnitt ist innen und vorn leer.
 * - Böden: volle Fliese innen, Kante (Kontur) an offenen Seiten; Steg mit Pfählen nur an offener Südseite.
 * - Türen, Tor, Fenster, Falltür: Clips und Zustände; offene Tür gibt die Öffnung frei; nur erleuchtete
 *   Fenster leuchten.
 * - Alle: Palettenfarben, ≤ 12 Farben, keine Befunde des Paletten-Validators.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import waende from '../../../assets-src/sprites/bau/waende';
import daecher from '../../../assets-src/sprites/bau/daecher';
import boeden from '../../../assets-src/sprites/bau/boeden';
import tueren from '../../../assets-src/sprites/bau/tueren';
import fenster from '../../../assets-src/sprites/bau/fenster';
import saeulen from '../../../assets-src/sprites/bau/saeulen';
import zaeune from '../../../assets-src/sprites/bau/zaeune';
import zugang from '../../../assets-src/sprites/bau/zugang';
import bauIcons from '../../../assets-src/sprites/icons/bau';
import { AUFRECHT_ANKER, AUFRECHT_ZELLE, BAND_BIS, BAND_VON, BAU_GRUPPE, DACH_ARTEN, MASKE, MASKEN, dachGrenzen, inBand } from '../../../assets-src/sprites/bau/_bau';
import { ICON_GRUPPE } from '../../../assets-src/sprites/icons/_icon';
import { MATERIAL_BITS, MAX_SPRITE_COLORS, TRANSPARENT, spriteColorCount, type Sprite, type SpriteFrame } from '../../../assets-src/lib/sprite';
import { paletteRef } from '../../../assets-src/palette';
import { checkSprite } from '../../../tools/assets/spriteChecks';

const ALLE: readonly Sprite[] = [...waende, ...daecher, ...boeden, ...tueren, ...fenster, ...saeulen, ...zaeune, ...zugang];

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

function deckt(s: Sprite, f: SpriteFrame, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < s.w && y < s.h && (f.index[y * s.w + x] ?? TRANSPARENT) !== TRANSPARENT;
}

function spalte(s: Sprite, f: SpriteFrame, x: number): string {
  return Array.from({ length: s.h }, (_, y) => (deckt(s, f, x, y) ? '#' : '.')).join('');
}

function zeile(s: Sprite, f: SpriteFrame, y: number, von = 0, bis = s.w): string {
  return Array.from({ length: bis - von }, (_, i) => (deckt(s, f, von + i, y) ? '#' : '.')).join('');
}

/** Kanonische Ids aus docs/SPIEL.md §8 (Aufzählungspunkt mit dem Titel `titel`). */
function spielIds(titel: string): string[] {
  const text = readFileSync(join(process.cwd(), 'docs/SPIEL.md'), 'utf8');
  const z = text.split('\n').find((l) => l.startsWith(`- **${titel}`));
  if (z === undefined) throw new Error(`docs/SPIEL.md: Zeile „${titel}“ fehlt`);
  return [...z.matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1] ?? '');
}

const BAUTEILE = spielIds('Bauteile (M4-12)');
const WAENDE = ['bau_wand_palisade', 'bau_wand_holz', 'bau_wand_fachwerk', 'bau_wand_stein'];

describe('M4-13 Bauteile: Vollständigkeit', () => {
  it('jedes Bauteil aus SPIEL §8 hat bau_<id> in der Gruppe bauteile und ein Icon icon_<id>', () => {
    // 24 since the stained-glass window (§16.2 "Fenster (Öffnung, Glas, Buntglas)", review M4 #7).
    expect(BAUTEILE.length).toBe(24);
    const ids = new Set(ALLE.map((s) => s.id));
    for (const id of BAUTEILE) expect(ids.has(`bau_${id}`), id).toBe(true);
    for (const s of ALLE) expect(s.group, s.id).toBe(BAU_GRUPPE);
    expect(bauIcons.map((s) => s.id).sort()).toEqual(BAUTEILE.map((id) => `icon_${id}`).sort());
    for (const s of bauIcons) expect(s.group, s.id).toBe(ICON_GRUPPE);
  });

  it('Palettenfarben, ≤ 12 Farben, keine Befunde (Einzelpixel, Fremdfarben) bei Teilen und Icons', () => {
    for (const s of [...ALLE, ...bauIcons]) {
      const r = checkSprite(s);
      expect(r.errors, s.id).toEqual([]);
      expect(r.warnings, s.id).toEqual([]);
      expect(spriteColorCount(s), s.id).toBeLessThanOrEqual(MAX_SPRITE_COLORS);
    }
  });

  it('Icons: 16×16 mit 1 px Luft, kräftige Silhouette, alle verschieden', () => {
    const bilder = new Set<string>();
    for (const s of bauIcons) {
      const f = frame(s, 0);
      expect([s.w, s.h], s.id).toEqual([16, 16]);
      for (let i = 0; i < 16; i++) for (const [x, y] of [[i, 0], [i, 15], [0, i], [15, i]] as const) expect(deckt(s, f, x, y), `${s.id} Rand (${x}, ${y})`).toBe(false);
      expect(f.index.filter((v) => v !== TRANSPARENT).length, s.id).toBeGreaterThanOrEqual(48);
      bilder.add(f.index.join(','));
    }
    expect(bilder.size).toBe(bauIcons.length);
  });
});

describe('M4-13 Wände: Autoverbindung mit 16 Masken', () => {
  it('48 Frames 16×32, Anker [8, 31], Clips a, b, schnitt als Maskentabellen, flach, nichts leuchtet', () => {
    for (const id of WAENDE) {
      const s = hole(id);
      expect([s.w, s.h, s.frames.length], id).toEqual([...AUFRECHT_ZELLE, 3 * MASKEN]);
      expect(s.anchor, id).toEqual(AUFRECHT_ANKER);
      expect(s.hoehe, id).toBe('flach');
      expect(s.schatten, id).toBe('silhouette');
      expect(s.clips.a?.frames, id).toEqual(Array.from({ length: MASKEN }, (_, m) => m));
      expect(s.clips.b?.frames, id).toEqual(Array.from({ length: MASKEN }, (_, m) => MASKEN + m));
      expect(s.clips.schnitt?.frames, id).toEqual(Array.from({ length: MASKEN }, (_, m) => 2 * MASKEN + m));
      for (const f of s.frames) expect(f.emissive.some((v) => v > 0), id).toBe(false);
    }
  });

  it('Rand gedeckt genau dort, wo die Maske verbindet; Front nur ohne Südnachbarn', () => {
    for (const id of WAENDE) {
      const s = hole(id);
      for (let m = 0; m < 2 * MASKEN; m++) {
        const f = frame(s, m);
        const mm = m % MASKEN;
        expect(spalte(s, f, 0).includes('#'), `${id} F${m} West`).toBe((mm & MASKE.w) !== 0);
        expect(spalte(s, f, 15).includes('#'), `${id} F${m} Ost`).toBe((mm & MASKE.o) !== 0);
        expect(zeile(s, f, 0, BAND_VON, BAND_BIS).includes('#'), `${id} F${m} Nord`).toBe((mm & MASKE.n) !== 0);
        // Fußzeile der Front (Zeile 26) unter dem Band: nur wenn die Wand nach Süden endet.
        expect(zeile(s, f, 26, BAND_VON, BAND_BIS).includes('#'), `${id} F${m} Süd`).toBe((mm & MASKE.s) === 0);
        // Unter der Front bleibt der Boden des Tiles frei.
        expect(zeile(s, f, 31), `${id} F${m} unten`).toBe('.'.repeat(16));
      }
    }
  });

  it('gerader Ost-West-Lauf: 16 px sichtbare Front über die ganze Breite, Bodenkontakt nacht.1', () => {
    const quer = MASKE.o | MASKE.w;
    for (const id of WAENDE) {
      const s = hole(id);
      const f = frame(s, quer);
      for (let y = BAND_BIS; y < BAND_BIS + 16; y++) expect(zeile(s, f, y), `${id} Zeile ${y}`).toBe('#'.repeat(16));
      for (let x = 0; x < 16; x++) expect(paletteRef(f.index[26 * 16 + x] ?? 0), `${id} Fuß ${x}`).toBe('nacht.1');
    }
  });

  it('Nachbarn stoßen nahtlos: gleiche Deckung an gemeinsamen Kanten (alle Masken, beide Fassungen)', () => {
    for (const id of WAENDE) {
      const s = hole(id);
      for (let a = 0; a < 2 * MASKEN; a++) {
        for (let b = 0; b < 2 * MASKEN; b++) {
          const fa = frame(s, a);
          const fb = frame(s, b);
          if ((a % MASKEN & MASKE.o) !== 0 && (b % MASKEN & MASKE.w) !== 0) {
            // Die Front eines Ost-West-Laufs deckt an der gemeinsamen Kante beidseits dieselben 16 Zeilen,
            // die Kappe endet nicht davor (unterste Kappenzeile gedeckt).
            const front = '#'.repeat(16);
            expect(spalte(s, fa, 15).slice(BAND_BIS, BAND_BIS + 16), `${id} ${a}|${b}`).toBe(front);
            expect(spalte(s, fb, 0).slice(BAND_BIS, BAND_BIS + 16), `${id} ${a}|${b}`).toBe(front);
            expect(deckt(s, fa, 15, BAND_BIS - 1) && deckt(s, fb, 0, BAND_BIS - 1), `${id} ${a}|${b} Kappe`).toBe(true);
          }
          if ((a % MASKEN & MASKE.s) !== 0 && (b % MASKEN & MASKE.n) !== 0) {
            // Nord-Süd-Lauf: unterste Kappenzeile von a trifft oberste von b.
            expect(zeile(s, fa, 15, BAND_VON, BAND_BIS), `${id} ${a}/${b}`).toBe('#'.repeat(BAND_BIS - BAND_VON));
            expect(zeile(s, fb, 0, BAND_VON, BAND_BIS).includes('#'), `${id} ${a}/${b}`).toBe(true);
          }
        }
      }
    }
  });

  it('Schnitt: auf 4 px gekappt – oberhalb der gesenkten Kappe nichts, Front 4 Zeilen', () => {
    for (const id of WAENDE) {
      const s = hole(id);
      const f = frame(s, 2 * MASKEN + (MASKE.o | MASKE.w));
      for (let y = 0; y < 17; y++) expect(zeile(s, f, y), `${id} Zeile ${y}`).toBe('.'.repeat(16));
      for (let y = 23; y < 27; y++) expect(zeile(s, f, y), `${id} Zeile ${y}`).toBe('#'.repeat(16));
    }
  });

  it('Stand der Wand im Band: inBand folgt der Maske', () => {
    expect(inBand(0, 8, 8)).toBe(true);
    expect(inBand(0, 0, 8)).toBe(false);
    expect(inBand(MASKE.w, 0, 8)).toBe(true);
    expect(inBand(MASKE.n, 8, 0)).toBe(true);
    expect(inBand(MASKE.n, 0, 0)).toBe(false);
  });
});

describe('M4-13 Dächer', () => {
  const ids = ['bau_dach_stroh', 'bau_dach_schindel', 'bau_dach_glas'];

  it('64 Frames (sued, first, nord, schnitt × 16 Masken), alle Pixel mit Dachflag, flach', () => {
    expect(DACH_ARTEN).toEqual(['sued', 'first', 'nord', 'schnitt']);
    for (const id of ids) {
      const s = hole(id);
      expect(s.frames.length, id).toBe(4 * MASKEN);
      expect(s.anchor, id).toEqual(AUFRECHT_ANKER);
      DACH_ARTEN.forEach((art, i) => expect(s.clips[art]?.frames, `${id} ${art}`).toEqual(Array.from({ length: MASKEN }, (_, m) => i * MASKEN + m)));
      for (const f of s.frames) f.index.forEach((v, p) => v !== TRANSPARENT && expect((f.material[p] ?? 0) & MATERIAL_BITS.dach, id).toBe(MATERIAL_BITS.dach));
    }
  });

  it('innen volle Fläche auf Wandhöhe; offene Seiten enden mit Überstand; Traufe nur vorn', () => {
    for (const id of ids) {
      const s = hole(id);
      for (let art = 0; art < 3; art++) {
        const voll = frame(s, art * MASKEN + MASKEN - 1);
        for (let y = 0; y < 16; y++) expect(zeile(s, voll, y), `${id} Art ${art} Zeile ${y}`).toBe('#'.repeat(16));
        for (let y = 16; y < 32; y++) expect(zeile(s, voll, y), `${id} Art ${art} Zeile ${y}`).toBe('.'.repeat(16));
        for (let m = 0; m < MASKEN; m++) {
          const f = frame(s, art * MASKEN + m);
          const g = dachGrenzen(m);
          expect(spalte(s, f, 0).includes('#'), `${id} ${art}/${m} West`).toBe((m & MASKE.w) !== 0);
          expect(spalte(s, f, 15).includes('#'), `${id} ${art}/${m} Ost`).toBe((m & MASKE.o) !== 0);
          // Offene Südseite: Fläche bis zur Traufe, darunter 2 Zeilen Stirn, dann frei.
          if ((m & MASKE.s) === 0) {
            expect(zeile(s, f, g.y1 + 2).includes('#'), `${id} ${art}/${m} Traufe`).toBe(true);
            expect(zeile(s, f, g.y1 + 3), `${id} ${art}/${m} unter der Traufe`).toBe('.'.repeat(16));
          }
        }
      }
    }
  });

  it('Schnitt: innen und an offener Südseite leer, an Rückseite und Giebeln ein Rand', () => {
    for (const id of ids) {
      const s = hole(id);
      const schnitt = (m: number): SpriteFrame => frame(s, 3 * MASKEN + m);
      expect(schnitt(MASKEN - 1).index.every((v) => v === TRANSPARENT), id).toBe(true);
      const nurSuedOffen = MASKEN - 1 - MASKE.s;
      expect(schnitt(nurSuedOffen).index.every((v) => v === TRANSPARENT), id).toBe(true);
      expect(schnitt(MASKEN - 1 - MASKE.n).index.some((v) => v !== TRANSPARENT), id).toBe(true);
      expect(schnitt(MASKEN - 1 - MASKE.w).index.some((v) => v !== TRANSPARENT), id).toBe(true);
    }
  });
});

describe('M4-13 Böden, Steg, Zäune', () => {
  it('Böden: 2 Fassungen × 16 Masken, 16×16, Anker [0, 0]; innen voll, offene Seiten mit dunkler Kante', () => {
    for (const id of ['bau_boden_holz', 'bau_boden_stein', 'bau_boden_lehm']) {
      const s = hole(id);
      expect([s.w, s.h, s.frames.length], id).toEqual([16, 16, 2 * MASKEN]);
      expect(s.anchor, id).toEqual([0, 0]);
      for (const fassung of [0, MASKEN]) {
        const voll = frame(s, fassung + MASKEN - 1);
        const einzel = frame(s, fassung);
        expect(voll.index.every((v) => v !== TRANSPARENT), id).toBe(true);
        const kontur = einzel.index[0] ?? 0;
        // Einzelstück: der ganze Rand ist die Kante (eine Farbe, die dunkelste des Randes).
        for (let i = 0; i < 16; i++) for (const [x, y] of [[i, 0], [i, 15], [0, i], [15, i]] as const) expect(einzel.index[y * 16 + x], `${id} Rand (${x}, ${y})`).toBe(kontur);
        // Innen hat die volle Fliese keine Kante am Rand (das Muster läuft ohne Kontur weiter).
        for (let i = 0; i < 16; i++) for (const [x, y] of [[i, 0], [i, 15], [0, i], [15, i]] as const) expect(voll.index[y * 16 + x], `${id} voll (${x}, ${y})`).not.toBe(kontur);
      }
    }
  });

  it('Steg: Stirnbalken und Pfähle nur an offener Südseite, darüber das Deck', () => {
    const s = hole('bau_steg_holz');
    expect([s.w, s.h, s.frames.length]).toEqual([16, 24, MASKEN]);
    for (let m = 0; m < MASKEN; m++) {
      const f = frame(s, m);
      const unten = Array.from({ length: 8 }, (_, i) => zeile(s, f, 16 + i)).join('');
      expect(unten.includes('#'), `F${m}`).toBe((m & MASKE.s) === 0);
      for (let y = 0; y < 16; y++) expect(zeile(s, f, y), `F${m} Deck ${y}`).toBe('#'.repeat(16));
    }
  });

  it('Zäune: Pfosten immer, Riegel bzw. Mauer nur zu verbundenen Seiten', () => {
    for (const id of ['bau_zaun_holz', 'bau_zaun_stein']) {
      const s = hole(id);
      expect(s.frames.length, id).toBe(MASKEN);
      for (let m = 0; m < MASKEN; m++) {
        const f = frame(s, m);
        expect(spalte(s, f, 8).includes('#'), `${id} F${m} Mitte`).toBe(true);
        expect(spalte(s, f, 0).includes('#'), `${id} F${m} West`).toBe((m & MASKE.w) !== 0);
        expect(spalte(s, f, 15).includes('#'), `${id} F${m} Ost`).toBe((m & MASKE.o) !== 0);
      }
    }
  });
});

describe('M4-13 Türen, Tor, Fenster, Falltür, Säulen, Zugänge', () => {
  it('Türen: zu/halb/offen in beiden Wandrichtungen und Schnitt; offen gibt die Öffnung frei', () => {
    for (const id of ['bau_tuer_holz', 'bau_tuer_verstaerkt']) {
      const s = hole(id);
      expect(s.frames.length, id).toBe(7);
      expect(Object.keys(s.clips).sort(), id).toEqual(['oeffnen', 'oeffnen_seite', 'offen', 'offen_seite', 'schliessen', 'schliessen_seite', 'schnitt', 'zu', 'zu_seite']);
      expect(s.clips.oeffnen?.frames, id).toEqual([0, 1, 2]);
      expect(s.clips.oeffnen?.loop, id).toBe(false);
      // Mitte der Öffnung: zu gedeckt, offen frei.
      expect(deckt(s, frame(s, 0), 8, 20), id).toBe(true);
      expect(deckt(s, frame(s, 2), 8, 20), id).toBe(false);
      // Die Tür schließt bündig an die Wandfront an (Kappenoberkante Zeile 5, Fuß Zeile 26).
      expect(zeile(s, frame(s, 0), 5), id).toBe('#'.repeat(16));
      expect(deckt(s, frame(s, 0), 0, 26) && !deckt(s, frame(s, 0), 0, 27), id).toBe(true);
    }
    // Verstärkt: Bronzebeschläge mit Metallflag.
    const v = hole('bau_tuer_verstaerkt');
    expect(frame(v, 0).material.some((b) => (b & MATERIAL_BITS.metall) !== 0)).toBe(true);
  });

  it('Tor: 32×32 über zwei Tiles (Anker [16, 31]) und 16×48 in Nord-Süd-Linien (Anker [8, 47])', () => {
    const tor = hole('bau_tor_holz');
    const seite = hole('bau_tor_holz_seite');
    expect([tor.w, tor.h, tor.anchor, tor.frames.length]).toEqual([32, 32, [16, 31], 3]);
    expect([seite.w, seite.h, seite.anchor, seite.frames.length]).toEqual([16, 48, [8, 47], 3]);
    for (const s of [tor, seite]) expect(Object.keys(s.clips).sort(), s.id).toEqual(['oeffnen', 'offen', 'schliessen', 'zu']);
    expect(deckt(tor, frame(tor, 0), 16, 18)).toBe(true);
    expect(deckt(tor, frame(tor, 2), 16, 18)).toBe(false);
  });

  it('Fenster: Ost-West, Nord-Süd, erleuchtet und Schnitt; nur erleuchtete Frames leuchten, Glas glänzt', () => {
    for (const id of ['bau_fenster_offen', 'bau_fenster_glas', 'bau_fenster_buntglas']) {
      const s = hole(id);
      expect(Object.keys(s.clips).sort(), id).toEqual(['schnitt', 'seite', 'seite_licht', 'sued', 'sued_licht']);
      s.frames.forEach((f, i) => expect(f.emissive.some((e) => e > 0), `${id} F${i}`).toBe(i === 2 || i === 3));
    }
    for (const id of ['bau_fenster_glas', 'bau_fenster_buntglas']) expect(frame(hole(id), 0).material.some((b) => (b & MATERIAL_BITS.nass) !== 0), id).toBe(true);
  });

  it('Buntglas (§16.2): dieselbe Zarge wie das Glasfenster, rote, blaue, grüne und goldene Scheiben; erleuchtet leuchtet jede in ihrer Farbe', () => {
    const glas = hole('bau_fenster_glas');
    const bunt = hole('bau_fenster_buntglas');
    expect([bunt.w, bunt.h, bunt.anchor, bunt.frames.length]).toEqual([glas.w, glas.h, glas.anchor, glas.frames.length]);
    // The same frame and sill: only the opening (x 4–11, rows 13–19) differs.
    const opening = (x: number, y: number): boolean => x >= 4 && x <= 11 && y >= 13 && y <= 19;
    for (let y = 0; y < bunt.h; y++) for (let x = 0; x < bunt.w; x++) if (!opening(x, y)) expect(deckt(bunt, frame(bunt, 0), x, y), `${x},${y}`).toBe(deckt(glas, frame(glas, 0), x, y));
    const panes = (f: SpriteFrame, lit: boolean): Set<string> => {
      const ramps = new Set<string>();
      for (let y = 13; y <= 19; y++) {
        for (let x = 4; x <= 11; x++) {
          const p = y * bunt.w + x;
          const index = f.index[p] ?? TRANSPARENT;
          if (index === TRANSPARENT || (f.emissive[p] ?? 0) > 0 !== lit) continue;
          ramps.add(paletteRef(index).split('.')[0] ?? '');
        }
      }
      return ramps;
    };
    for (const ramp of ['feuer', 'wasser', 'gras', 'sand']) {
      expect(panes(frame(bunt, 0), false).has(ramp), `unlit ${ramp}`).toBe(true);
      expect(panes(frame(bunt, 2), true).has(ramp), `lit ${ramp}`).toBe(true);
    }
  });

  it('Falltür: Luke im Boden zu/offen (16×16) und aufgestellte Klappe halb/offen (aufrecht)', () => {
    const luke = hole('bau_falltuer_holz');
    const klappe = hole('bau_falltuer_holz_klappe');
    expect([luke.w, luke.h, luke.anchor, luke.frames.length]).toEqual([16, 16, [0, 0], 2]);
    expect([klappe.w, klappe.h, klappe.anchor, klappe.frames.length]).toEqual([...AUFRECHT_ZELLE, AUFRECHT_ANKER, 2]);
    expect(frame(luke, 0).index.join(',')).not.toBe(frame(luke, 1).index.join(','));
  });

  it('Säulen stehen frei mit Relief und so hoch wie eine Wand; Treppe in vier Richtungen, Leiter über die Kante', () => {
    for (const id of ['bau_saeule_holz', 'bau_saeule_stein']) {
      const s = hole(id);
      expect(s.hoehe, id).not.toBe('flach');
      expect(spalte(s, frame(s, 0), 8).indexOf('#'), id).toBeLessThanOrEqual(BAND_VON);
      expect(deckt(s, frame(s, 0), 8, 26), id).toBe(true);
    }
    const treppe = hole('bau_treppe_holz');
    expect(Object.keys(treppe.clips).sort()).toEqual(['nord', 'ost', 'sued', 'west']);
    expect(new Set(treppe.frames.map((f) => f.index.join(','))).size).toBe(4);
    const leiter = hole('bau_leiter_holz');
    expect([leiter.w, leiter.h, leiter.anchor]).toEqual([16, 20, [0, 4]]);
  });
});
