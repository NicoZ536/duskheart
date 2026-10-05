/**
 * M6-11 Waffen T0–T1 und M6-09 Schilde, M6-08 Wurfwaffen (MASTERPROMPT §5 „Materialstufen“, §4.5 „Ausrüstung als Layer
 * … mit Hand-Sockeln pro Frame“; docs/SPIEL.md §14): jede Waffe hat ihren Hand-Layer `ausruestung_<id>` und jedes neue
 * Item sein Icon. Belegt am Sprite:
 * - Vertrag mit dem Rig: Anker = Griff, die zwölf Werkzeuglagen, der leere Frame, die gespannte Sehne (vier Lagen); Halte-Clips je
 *   Richtung; Kampfclips für die Aktionen der Klasse mit derselben Länge, Bildrate und Schleife wie der Körper-Clip;
 *   Werkzeugschlag-Clips nur für die Äxte (sie fällen Bäume).
 * - Lagen: im Smear-Bild eines Hiebs der Schmierbogen, im Stoß die Klinge nach vorn, der geworfene Speer ist fort,
 *   der Bogen zeigt beim Vollauszug in allen vier Richtungen die gespannte Sehne und den Pfeil entlang des Ziels (er steht
 *   quer zur Schussrichtung: im Profil aufrecht, nach unten und oben waagerecht).
 * - Materialstufen: Bronze ist die umgefärbte Metallform (keine `stein`-Pixel mehr, Metallflag), die T0-Waffe derselben
 *   Klasse sitzt in derselben Zelle mit demselben Griff und Wirkpunkt.
 * - Palette und Icons wie die M3-Icons: 16×16, Luft zum Rand, Kontur, ≤ 12 Farben, keine Einzelpixel, alle verschieden.
 */
import { describe, expect, it } from 'vitest';
import { RICHTUNGEN } from '../../../assets-src/lib/figure';
import { MATERIAL_BITS, MAX_SPRITE_COLORS, TRANSPARENT, spriteColorCount, spriteHasEmissive, type Sprite } from '../../../assets-src/lib/sprite';
import { paletteIndex, rampStart } from '../../../assets-src/palette';
import spieler from '../../../assets-src/sprites/figuren/spieler_basis';
import { ICON_ANKER, ICON_GROESSE, ICON_GRUPPE } from '../../../assets-src/sprites/icons/_icon';
import { kampfAktionen, WAFFEN_FRAME, WAFFEN_GRUPPE, type HandKlasse } from '../../../assets-src/sprites/waffen/_waffe';
import fernkampf from '../../../assets-src/sprites/waffen/fernkampf';
import waffenIcons from '../../../assets-src/sprites/waffen/icons';
import nahkampf from '../../../assets-src/sprites/waffen/nahkampf';
import schilde from '../../../assets-src/sprites/waffen/schilde';
import { itemFigureLayer, itemIconId, itemLayerSpriteId } from '../../../src/content/items/index';
import { MUNITION } from '../../../src/content/items/munition';
import { SCHILDE } from '../../../src/content/items/schilde';
import { WAFFEN } from '../../../src/content/items/waffen';
import { checkSprite } from '../../../tools/assets/spriteChecks';

const HAND: readonly Sprite[] = [...nahkampf, ...fernkampf];
const ALLE: readonly Sprite[] = [...HAND, ...schilde];
const byId = new Map(ALLE.map((s) => [s.id, s]));

function layer(id: string): Sprite {
  const s = byId.get(itemLayerSpriteId(id));
  if (s === undefined) throw new Error(`Hand-Layer von ${id} fehlt`);
  return s;
}

function deckend(s: Sprite, frame: number): number {
  return s.frames[frame]?.index.reduce((n, v) => n + (v === TRANSPARENT ? 0 : 1), 0) ?? 0;
}

/** Palettenindizes der Rampe `stein` (Quelle der Materialstufen). */
const STEIN = new Set(Array.from({ length: 6 }, (_, i) => rampStart('stein') + i));

describe('M6-11 Hand-Layer der Waffen', () => {
  it('jede Waffe (Kategorie waffe) und jeder Schild hat genau seinen Layer; Wurfwaffen und Munition sind nicht auf der Figur', () => {
    const erwartet = [...WAFFEN, ...SCHILDE].filter((i) => itemFigureLayer(i) !== null).map((i) => itemLayerSpriteId(i.id));
    expect(erwartet).toHaveLength(20);
    expect([...ALLE.map((s) => s.id)].sort()).toEqual([...erwartet].sort());
    for (const i of MUNITION) expect(itemFigureLayer(i), i.id).toBeNull();
    for (const s of ALLE) expect(s.group, s.id).toBe(WAFFEN_GRUPPE);
  });

  it('Vertrag mit dem Rig: quadratische Zelle, Anker = Griff; 19 Frames (mit den zwei Lagen in der Faust; Bögen 23: die vier Schräglagen); Halte-Clips je Richtung; Wirkpunkt je Frame', () => {
    for (const s of HAND) {
      expect(s.w, s.id).toBe(s.h);
      expect(s.anchor, s.id).toEqual([(s.w - 1) / 2, (s.h - 1) / 2]);
      expect(s.frames, s.id).toHaveLength((/bogen$/.test(s.id) ? WAFFEN_FRAME.gespanntNO : WAFFEN_FRAME.schmierHintenFaust) + 1);
      for (const r of RICHTUNGEN) expect(s.clips[r]?.frames, `${s.id} ${r}`).toHaveLength(1);
      expect(s.sockets.wirkpunkt, s.id).toHaveLength(s.frames.length);
      expect(deckend(s, WAFFEN_FRAME.leer), s.id).toBe(0);
    }
  });

  it('Kampfclips der Klasse: je Richtung so lang, so schnell und so geschlossen wie der Körper-Clip', () => {
    for (const w of WAFFEN.filter((i) => i.kategorie === 'waffe')) {
      const s = layer(w.id);
      const klasse = w.waffe?.klasse as HandKlasse;
      const aktionen = kampfAktionen(klasse);
      expect(aktionen.length, w.id).toBeGreaterThan(0);
      for (const a of aktionen) {
        for (const r of RICHTUNGEN) {
          const eigen = s.clips[`${a.name}_${r}`];
          const koerper = spieler.clips[`${a.name}_${r}`];
          expect(eigen, `${w.id} ${a.name}_${r}`).toBeDefined();
          expect([eigen?.frames.length, eigen?.fps, eigen?.loop], `${w.id} ${a.name}_${r}`).toEqual([koerper?.frames.length, koerper?.fps, koerper?.loop]);
        }
      }
      // Only the class's actions: a sword has no bow clip.
      const fremd = Object.keys(s.clips).filter((c) => /^(attack|heavy)_/.test(c) && !aktionen.some((a) => c.startsWith(`${a.name}_`)));
      expect(fremd, w.id).toEqual([]);
    }
  });

  it('Werkzeugschlag-Clips tragen nur die Äxte (sie fällen Bäume, §19.2)', () => {
    for (const s of HAND) {
      const axt = /axt$/.test(s.id);
      expect(RICHTUNGEN.every((r) => s.clips[`tool_${r}`] !== undefined), s.id).toBe(axt);
    }
  });

  it('Lagen im Kampf: Hieb mit Schmierbogen, Stoß nach vorn, der Speer fliegt, der Bogen spannt', () => {
    const schwert = layer('bronzeschwert');
    expect(schwert.clips.attack_schwert_right?.frames[3]).toBe(WAFFEN_FRAME.schmierRechts);
    expect(schwert.clips.attack_schwert_left?.frames[3]).toBe(WAFFEN_FRAME.schmierLinks);
    expect(schwert.clips.attack_schwert_down?.frames[3]).toBe(WAFFEN_FRAME.schmierVorn);
    // From behind the blow goes over the head away from the viewer (M6-Gate, waffe-rotation): swept across the body
    // (`schmierLinks`, the old pin) the blade lay level at the chest and a blow north read as a blow west. Since the second
    // review (the raised arm a black stick: the grip covered fist and sleeve) the fist holds it: its arc frame in the fist
    // (`schmierHintenFaust`, the pin `schmierHinten` before).
    expect(schwert.clips.attack_schwert_up?.frames[3]).toBe(WAFFEN_FRAME.schmierHintenFaust);
    const speer = layer('bronzespeer');
    expect(speer.clips.attack_speer_right?.frames[2]).toBe(WAFFEN_FRAME.o);
    expect(speer.clips.attack_speer_down?.frames[2]).toBe(WAFFEN_FRAME.s);
    const wurf = speer.clips.heavy_speer_right?.frames ?? [];
    expect(wurf.slice(0, 5)).not.toContain(WAFFEN_FRAME.leer);
    expect(wurf.slice(5)).toEqual(wurf.slice(5).map(() => WAFFEN_FRAME.leer));
    const bogen = layer('kurzbogen');
    const auszug = bogen.clips.attack_bogen_right?.frames ?? [];
    expect(auszug).toContain(WAFFEN_FRAME.gespannt);
    expect(bogen.clips.attack_bogen_left?.frames).toContain(WAFFEN_FRAME.gespanntGespiegelt);
    expect(deckend(bogen, WAFFEN_FRAME.gespannt)).toBeGreaterThan(deckend(bogen, WAFFEN_FRAME.n));
    // The bow stands upright in every picture; it never shows a swing.
    expect(auszug.every((f) => f === WAFFEN_FRAME.n || f === WAFFEN_FRAME.gespannt)).toBe(true);
  });

  it('der Bogen steht quer zum Ziel und spannt in allen vier Richtungen: Sehne zurückgezogen, Pfeil entlang des Ziels (M6-Gate)', () => {
    const SEHNE = paletteIndex('sand.4');
    const SPITZE = paletteIndex('stein.4');
    const ZIEL: Readonly<Record<(typeof RICHTUNGEN)[number], readonly [number, number]>> = { down: [0, 1], up: [0, -1], right: [1, 0], left: [-1, 0] };
    const GESPANNT = { down: WAFFEN_FRAME.gespanntVorn, up: WAFFEN_FRAME.gespanntHinten, right: WAFFEN_FRAME.gespannt, left: WAFFEN_FRAME.gespanntGespiegelt } as const;
    for (const id of ['kurzbogen', 'kompositbogen']) {
      const s = layer(id);
      for (const r of RICHTUNGEN) {
        // The held full draw (body picture 2 of the shot: clip positions 2–4) shows the drawn bow of the facing.
        expect(s.clips[`attack_bogen_${r}`]?.frames.slice(2, 5), `${id} ${r}`).toEqual([GESPANNT[r], GESPANNT[r], GESPANNT[r]]);
        const [zx, zy] = ZIEL[r];
        // Pixels of the drawn frame along the aim (from the grip) and across it.
        const px: { laengs: number; quer: number; v: number }[] = [];
        s.frames[GESPANNT[r]]?.index.forEach((v, i) => {
          if (v === TRANSPARENT) return;
          const dx = (i % s.w) - s.anchor[0];
          const dy = Math.floor(i / s.w) - s.anchor[1];
          px.push({ laengs: dx * zx + dy * zy, quer: dx * zy - dy * zx, v });
        });
        // Arrowhead beyond the grip towards the target, on the aim line.
        const spitze = px.filter((p) => p.v === SPITZE);
        expect(spitze.length, `${id} ${r} Pfeilspitze`).toBeGreaterThan(0);
        for (const p of spitze) {
          expect(p.laengs, `${id} ${r} Spitze voraus`).toBeGreaterThanOrEqual(2);
          expect(Math.abs(p.quer), `${id} ${r} Spitze auf der Ziellinie`).toBeLessThanOrEqual(2);
        }
        // The string pulled back towards the archer: its apex ≥ 6 px behind the grip.
        const sehne = Math.min(...px.filter((p) => p.v === SEHNE).map((p) => p.laengs));
        expect(sehne, `${id} ${r} Sehne`).toBeLessThanOrEqual(-6);
        // The bow lies across the aim: wider across than along.
        const quer = Math.max(...px.map((p) => p.quer)) - Math.min(...px.map((p) => p.quer)) + 1;
        const laengs = Math.max(...px.map((p) => p.laengs)) - Math.min(...px.map((p) => p.laengs)) + 1;
        expect(quer, `${id} ${r} quer`).toBeGreaterThanOrEqual(15);
        expect(laengs, `${id} ${r} längs`).toBeLessThan(quer);
      }
    }
  });

  it('attacking north the weapon rises over the head on the strike frame (M6-Gate, waffe-rotation): blow and thrust read as going north', () => {
    // Before, the back view swept the blade level across the chest (a blow north read as a blow west) and thrust the spear
    // into the torso at hip height (its tip under the hair: a staff held upright).
    const UEBER_KOPF: readonly [string, number][] = [
      ['bronzeschwert', 3],
      ['bronzekampfaxt', 3],
      ['holzkeule', 3],
      ['bronzespeer', 8],
      ['bronzezweihaender', 3],
      ['bronzedolch', 0],
    ];
    for (const [id, mindestens] of UEBER_KOPF) {
      const s = layer(id);
      const klasse = WAFFEN.find((w) => w.id === id)?.waffe?.klasse as HandKlasse;
      const aktion = kampfAktionen(klasse).find((a) => a.name === `attack_${klasse}`);
      const pos = aktion?.events.find((e) => e.name === 'schwung' || e.name === 'treffer')?.frame;
      if (aktion === undefined || pos === undefined) throw new Error(`${id}: kein Schlagbild`);
      const body = spieler.clips[`attack_${klasse}_up`]?.frames[pos];
      const frame = s.clips[`attack_${klasse}_up`]?.frames[pos];
      if (body === undefined || frame === undefined) throw new Error(`${id}: Clip fehlt`);
      const hand = spieler.sockets.hand?.[body];
      const scheitel = spieler.sockets.last?.[body];
      const wirk = s.sockets.wirkpunkt?.[frame];
      if (!hand || !scheitel || !wirk) throw new Error(`${id}: Sockel fehlt`);
      // The weapon's point (blade's middle, club's head, spear's tip) above the top of the head.
      expect(scheitel[1] - (hand[1] + wirk[1] - s.anchor[1]), id).toBeGreaterThanOrEqual(mindestens);
    }
  });

  it('aimed diagonally the drawn bow shows its frame drawn at 45° (M6-Gate, waffe-rotation): across the diagonal, string back, arrow along it', () => {
    // Turned pixel by pixel the drawn bow fell apart at 45° (the string a strap across the body, a limb a single stroke).
    const SEHNE = paletteIndex('sand.4');
    const SPITZE = paletteIndex('stein.4');
    /** The diagonal frames and their aims (screen: +y south). */
    const SCHRAEG = [
      [WAFFEN_FRAME.gespanntSO, 1, 1],
      [WAFFEN_FRAME.gespanntSW, -1, 1],
      [WAFFEN_FRAME.gespanntNW, -1, -1],
      [WAFFEN_FRAME.gespanntNO, 1, -1],
    ] as const;
    /** The drawn frame of each facing turned one step clockwise and counter-clockwise (`_rechtsrum`, `_linksrum`). */
    const GEDREHT = {
      right: [WAFFEN_FRAME.gespanntSO, WAFFEN_FRAME.gespanntNO],
      down: [WAFFEN_FRAME.gespanntSW, WAFFEN_FRAME.gespanntSO],
      left: [WAFFEN_FRAME.gespanntNW, WAFFEN_FRAME.gespanntSW],
      up: [WAFFEN_FRAME.gespanntNO, WAFFEN_FRAME.gespanntNW],
    } as const;
    for (const id of ['kurzbogen', 'kompositbogen']) {
      const s = layer(id);
      for (const [frame, ux, uy] of SCHRAEG) {
        const zx = ux / Math.SQRT2;
        const zy = uy / Math.SQRT2;
        const px: { laengs: number; quer: number; v: number }[] = [];
        s.frames[frame]?.index.forEach((v, i) => {
          if (v === TRANSPARENT) return;
          const dx = (i % s.w) - s.anchor[0];
          const dy = Math.floor(i / s.w) - s.anchor[1];
          px.push({ laengs: dx * zx + dy * zy, quer: dx * zy - dy * zx, v });
        });
        const label = `${id} Frame ${frame}`;
        const spitze = px.filter((p) => p.v === SPITZE);
        expect(spitze.length, label).toBeGreaterThan(0);
        for (const p of spitze) {
          expect(p.laengs, `${label} Spitze voraus`).toBeGreaterThanOrEqual(2);
          expect(Math.abs(p.quer), `${label} Spitze auf der Ziellinie`).toBeLessThanOrEqual(1.5);
        }
        expect(Math.min(...px.filter((p) => p.v === SEHNE).map((p) => p.laengs)), `${label} Sehne`).toBeLessThanOrEqual(-5);
        const quer = Math.max(...px.map((p) => p.quer)) - Math.min(...px.map((p) => p.quer)) + 1;
        const laengs = Math.max(...px.map((p) => p.laengs)) - Math.min(...px.map((p) => p.laengs)) + 1;
        expect(quer, `${label} quer`).toBeGreaterThanOrEqual(14);
        expect(laengs, `${label} längs`).toBeLessThan(quer);
      }
      for (const r of RICHTUNGEN) {
        const clip = s.clips[`attack_bogen_${r}`];
        const [cw, ccw] = GEDREHT[r];
        // Position for position the clip of the facing; where it shows the drawn frame, the diagonal one.
        for (const [suffix, schraeg] of [
          ['_rechtsrum', cw],
          ['_linksrum', ccw],
        ] as const) {
          const turned = s.clips[`attack_bogen_${r}${suffix}`];
          expect(turned?.frames.length, `${id} ${r}${suffix}`).toBe(clip?.frames.length);
          expect([turned?.fps, turned?.loop], `${id} ${r}${suffix}`).toEqual([clip?.fps, clip?.loop]);
          clip?.frames.forEach((f, i) => {
            const gespannt = f === WAFFEN_FRAME.gespannt || f === WAFFEN_FRAME.gespanntGespiegelt || f === WAFFEN_FRAME.gespanntVorn || f === WAFFEN_FRAME.gespanntHinten;
            expect(turned?.frames[i], `${id} ${r}${suffix} @${i}`).toBe(gespannt ? schraeg : f);
          });
        }
      }
    }
    // Only bows carry turned clips.
    for (const s of HAND.filter((x) => !/bogen$/.test(x.id))) expect(Object.keys(s.clips).filter((c) => /_(rechtsrum|linksrum)$/.test(c)), s.id).toEqual([]);
  });

  it('in der erhobenen Faust (M6-Gate, waffe-rotation N): die Lage ohne das Feld um den Griff, sonst dieselben Pixel – Kontur oder leer nur am Feld', () => {
    const KONTUR = paletteIndex('nacht.1');
    const PAARE = [
      [WAFFEN_FRAME.nFaust, WAFFEN_FRAME.n],
      [WAFFEN_FRAME.schmierHintenFaust, WAFFEN_FRAME.schmierHinten],
    ] as const;
    for (const s of HAND) {
      const [ax, ay] = s.anchor;
      for (const [faust, lage] of PAARE) {
        const f = s.frames[faust]?.index;
        const g = s.frames[lage]?.index;
        if (f === undefined || g === undefined) throw new Error(s.id);
        expect(s.sockets.wirkpunkt?.[faust], `${s.id} ${faust} Wirkpunkt`).toEqual(s.sockets.wirkpunkt?.[lage]);
        let frei = 0;
        for (let y = 0; y < s.h; y++) {
          for (let x = 0; x < s.w; x++) {
            const i = y * s.w + x;
            const dx = x - ax;
            const dy = y - ay;
            const label = `${s.id} ${faust} (${dx}, ${dy})`;
            // The fist's field: the grip with its outline, the row above the grip pixel and its own.
            if (dx >= -1 && dx <= 1 && dy >= -1 && dy <= 0) {
              expect(f[i], label).toBe(TRANSPARENT);
              if (g[i] !== TRANSPARENT) frei++;
            } else if (Math.abs(dx) <= 2 && dy >= -2 && dy <= 1) {
              // At the field a lone pixel turns outline or goes.
              expect([g[i], KONTUR, TRANSPARENT], label).toContain(f[i]);
            } else expect(f[i], label).toBe(g[i]);
          }
        }
        // The grip was there: the fist takes its place.
        expect(frei, `${s.id} ${faust}`).toBeGreaterThan(0);
      }
    }
  });

  it('der Schmierbogen im Profil beginnt erst 70° über der Waagerechten am Griff (M6-Gate, hitstop) und läuft bis zum Kopf', () => {
    for (const s of HAND.filter((x) => x.frames[WAFFEN_FRAME.schmierRechts] !== undefined)) {
      const rechts = s.frames[WAFFEN_FRAME.schmierRechts]?.index;
      const links = s.frames[WAFFEN_FRAME.schmierLinks]?.index;
      const o = s.frames[WAFFEN_FRAME.o]?.index;
      if (rechts === undefined || links === undefined || o === undefined) throw new Error(s.id);
      const [ax, ay] = s.anchor;
      let bogen = 0;
      rechts.forEach((v, i) => {
        const x = i % s.w;
        const y = Math.floor(i / s.w);
        // Facing left: the mirror image.
        expect(links[y * s.w + (s.w - 1 - x)], `${s.id} links (${x}, ${y})`).toBe(v);
        if (v === TRANSPARENT || o[i] !== TRANSPARENT) return;
        bogen++;
        const grad = (Math.atan2(ay - y, x - ax) * 180) / Math.PI;
        expect(grad, `${s.id} (${x}, ${y})`).toBeLessThanOrEqual(70);
        expect(grad, `${s.id} (${x}, ${y})`).toBeGreaterThanOrEqual(0);
      });
      // A weapon with a smear keeps an arc.
      if (bogen > 0) expect(bogen, s.id).toBeGreaterThanOrEqual(3);
    }
  });

  it('Materialstufen: Bronze ist umgefärbt (Metallflag, keine stein-Pixel), die T0-Waffe der Klasse teilt Zelle, Griff und Wirkpunkt', () => {
    for (const id of ['bronzeschwert', 'bronzekampfaxt', 'bronzestreitkolben', 'bronzespeer', 'bronzedolch', 'bronzezweihaender', 'bronzegrossaxt', 'bronzekriegshammer', 'armbrust']) {
      const s = layer(id);
      let metall = 0;
      let stein = 0;
      for (const f of s.frames) {
        f.index.forEach((v, p) => {
          if (STEIN.has(v)) stein++;
          if (v !== TRANSPARENT && ((f.material[p] ?? 0) & MATERIAL_BITS.metall) !== 0) metall++;
        });
      }
      expect(stein, `${id}: stein-Pixel`).toBe(0);
      expect(metall, id).toBeGreaterThan(0);
    }
    // The stone tier keeps its stone: the flint blade is knapped stone, not metal.
    expect(layer('feuersteinklinge').frames[0]?.index.some((v) => STEIN.has(v))).toBe(true);
    expect(layer('feuersteinklinge').frames[0]?.material.some((m) => (m & MATERIAL_BITS.metall) !== 0)).toBe(false);
    for (const [t0, t1] of [
      ['feuersteinklinge', 'bronzeschwert'],
      ['steinkampfaxt', 'bronzekampfaxt'],
      ['knochenkeule', 'bronzestreitkolben'],
      ['knochendolch', 'bronzedolch'],
      ['felsbrecher', 'bronzekriegshammer'],
    ] as const) {
      const a = layer(t0);
      const b = layer(t1);
      expect([a.w, a.h, a.anchor, a.sockets], `${t0}/${t1}`).toEqual([b.w, b.h, b.anchor, b.sockets]);
    }
  });

  it('Schilde halten in der Nebenhand: Anker = Griff hinter dem Buckel, ein Bild je Richtung; Bronze mit Metallrand', () => {
    for (const id of ['holzschild', 'bronzeschild']) {
      const s = layer(id);
      expect(s.anchor, id).toEqual([5, 5]);
      RICHTUNGEN.forEach((r, i) => expect(s.clips[r]?.frames, `${id} ${r}`).toEqual([i]));
    }
    expect(layer('bronzeschild').frames[0]?.material.some((m) => (m & MATERIAL_BITS.metall) !== 0)).toBe(true);
  });

  it('≤ 12 Farben, nur Palettenfarben, keine verwaisten Einzelpixel', () => {
    for (const s of ALLE) {
      expect(spriteColorCount(s), s.id).toBeLessThanOrEqual(MAX_SPRITE_COLORS);
      expect(checkSprite(s), s.id).toEqual({ errors: [], warnings: [] });
    }
  });
});

describe('M6-11 Icons der Waffen, Schilde, Munition und Wurfwaffen', () => {
  const KONTUR = paletteIndex('nacht.1');
  const d = (s: Sprite, x: number, y: number): boolean => x >= 0 && y >= 0 && x < s.w && y < s.h && (s.frames[0]?.index[y * s.w + x] ?? TRANSPARENT) !== TRANSPARENT;

  it('jedes Item hat genau sein Icon', () => {
    const erwartet = [...WAFFEN, ...MUNITION, ...SCHILDE].map((i) => itemIconId(i.id)).sort();
    expect(waffenIcons.map((s) => s.id).sort()).toEqual(erwartet);
    expect(new Set(waffenIcons.map((s) => s.frames[0]?.index.join(','))).size).toBe(waffenIcons.length);
  });

  it('16×16, Anker unten Mitte, Luft zum Rand, klare Silhouette mit Kontur, ≤ 12 Farben ohne Einzelpixel; nur der Leuchtpfeil leuchtet', () => {
    for (const s of waffenIcons) {
      expect([s.w, s.h, s.frames.length, s.group], s.id).toEqual([ICON_GROESSE, ICON_GROESSE, 1, ICON_GRUPPE]);
      expect(s.anchor, s.id).toEqual(ICON_ANKER);
      let pixel = 0;
      let rand = 0;
      let kontur = 0;
      for (let y = 0; y < s.h; y++) {
        for (let x = 0; x < s.w; x++) {
          if (!d(s, x, y)) continue;
          expect(x > 0 && y > 0 && x < s.w - 1 && y < s.h - 1, `${s.id} Rand (${x}, ${y})`).toBe(true);
          pixel++;
          if ([d(s, x + 1, y), d(s, x - 1, y), d(s, x, y + 1), d(s, x, y - 1)].includes(false)) {
            rand++;
            if (s.frames[0]?.index[y * s.w + x] === KONTUR) kontur++;
          }
        }
      }
      expect(pixel, s.id).toBeGreaterThanOrEqual(48);
      expect(kontur / rand, s.id).toBeGreaterThanOrEqual(0.65);
      expect(spriteColorCount(s), s.id).toBeLessThanOrEqual(MAX_SPRITE_COLORS);
      expect(checkSprite(s), s.id).toEqual({ errors: [], warnings: [] });
      expect(spriteHasEmissive(s), s.id).toBe(s.id === 'icon_pfeil_leucht');
    }
  });

  it('Bronze-Icons sind die umgefärbte Metallform (Metallflag, keine stein-Pixel)', () => {
    for (const s of waffenIcons.filter((x) => /bronze|armbrust/.test(x.id))) {
      const f = s.frames[0];
      expect(f?.index.some((v) => STEIN.has(v)), s.id).toBe(false);
      expect(f?.material.some((m) => (m & MATERIAL_BITS.metall) !== 0), s.id).toBe(true);
    }
  });
});
