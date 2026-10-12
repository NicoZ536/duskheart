/**
 * M7-53 Körperformen als Sprite-Layer über allen Spieleranimationen (MASTERPROMPT §26 „Charaktererstellung (Name, Körperform
 * …)“, §4.5 „Ausrüstungs-Layer über alle Spieleranimationen“; docs/SPIEL.md §26 „Körperformen“). Belegt am erzeugten Atlas
 * (`npm run assets`, src/generated/atlas.ts):
 * - Jede Form (`spieler_schmal_basis`, `spieler_kraeftig_basis` und ihre Kleidungs-Layer) hat genau die Frames, die Zelle und
 *   den Anker von `spieler_basis`; ihre Ansichts-Clips sind die von `spieler_basis` Bild für Bild – der Renderer spielt die
 *   248 Clips von `spieler_basis` auf dem Körper der Form (src/render/game/playerFigure.ts, `formBody`).
 * - **Sockel-Mapping je Form**: Hand und Nebenhand wandern mit den Schultern der Form (`schulterVersatz`,
 *   assets-src/sprites/figuren/_spieler_formen.ts) – in jedem stehenden Bild genau um den Schulterversatz der Blickrichtung
 *   (beim Rundumhieb der gedrehten Richtung), in den gedrehten Sonderbildern (Liegen, Rollen) um denselben Versatz mit dem
 *   Körper gedreht, beide Hände um dieselbe Drehung. Kopf, Last und Wasserlinie bleiben in jedem stehenden Bild, wo sie in
 *   `mittel` sind (Helme und Frisuren sitzen in jeder Form auf denselben Pixeln).
 * - **Rüstung je Form** (M7-110): jedes der zwölf Rüstungsteile hat in `schmal` und `kraeftig` seinen Layer
 *   (`ausruestung_<id>_<form>`, assets-src/sprites/figuren/ruestung_formen.ts) aus den Posen des Körpers der Form – jedes Pixel
 *   auf dem Körper der Form, das Fasergewand deckt Pixel für Pixel Tunika und Hose der Form, der Helm liegt am Kopfsockel auf
 *   dem Kopf; im Atlas liegen die Overlays beschnitten (`zuschnitt`, das Rechteck in der Zelle); der Renderer zeichnet die
 *   Figur mit Rüstung in der gewählten Form statt in `mittel`.
 */
import { describe, expect, it } from 'vitest';
import { RICHTUNGEN, type Richtung } from '../../../assets-src/lib/figure';
import { istSonder } from '../../../assets-src/sprites/figuren/_spieler_aktionen';
import { frameDefs } from '../../../assets-src/sprites/figuren/_spieler_bilder';
import { KOERPERFORMEN, schulterVersatz } from '../../../assets-src/sprites/figuren/_spieler_formen';
import { gedrehteRichtung, istGedreht } from '../../../assets-src/sprites/figuren/_spieler_kampf';
import type { AtlasManifest, AtlasSprite, SocketTrack } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { formBodySpriteId as koerperSpriteId, formLayerSpriteId as formLayerId } from '../../../src/render/game/playerFigure';
import { BODY_SHAPE_IDS } from '../../../src/content/appearance';
import { MAX_SPRITE_COLORS, spriteColorCount, spriteFromPixels, TRANSPARENT, type Sprite } from '../../../assets-src/lib/sprite';
import { checkSprite } from '../../../tools/assets/spriteChecks';
import { formSprites } from '../../../assets-src/sprites/figuren/spieler_formen';
import ruestungFormen, { RUESTUNG_FORMEN } from '../../../assets-src/sprites/figuren/ruestung_formen';
import bronze from '../../../assets-src/sprites/ausruestung/ruestung_bronze';
import { itemLayerSpriteId } from '../../../src/content/items/index';
import { RUESTUNG } from '../../../src/content/items/ruestung';
import { buildPlayerFigure, DRAWN_LOOK } from '../../../src/render/game/playerFigure';

function manifest(): AtlasManifest {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Kein erzeugter Atlas – erst `npm run assets`');
  return manifestFromGenerated(mod);
}

/** Die Formen mit eigenen Sprites (`mittel` sind die Sprites bis M6). */
const EIGENE_FORMEN = BODY_SHAPE_IDS.filter((f) => f !== 'mittel');
const M = manifest();
const BASIS = sprite('spieler_basis');
/** Die Frame-Definitionen in Sprite-Reihenfolge: Pose, Sonderbild oder gedrehtes Bild, je mit Blickrichtung. */
const DEFS = frameDefs();

function sprite(id: string): AtlasSprite {
  const s = M.sprites[id];
  if (s === undefined) throw new Error(`Sprite ${id} fehlt im Atlas`);
  return s;
}

function track(s: AtlasSprite, name: string): SocketTrack {
  const t = s.sockets[name];
  if (t === undefined) throw new Error(`${s.id}: Sockel ${name} fehlt`);
  return t;
}

type Punkt = readonly [number, number];

/** Versatz des Sockels `name` in Frame `f` der Form gegen `mittel`, oder null, wo er in einer der beiden fehlt. */
function versatz(form: AtlasSprite, name: string, f: number): Punkt | null {
  const a = track(BASIS, name)[f];
  const b = track(form, name)[f];
  if (a === null || a === undefined || b === null || b === undefined) return null;
  return [b[0] - a[0], b[1] - a[1]];
}

/** `v` um `k` Vierteldrehungen gedreht (Bildkoordinaten, y nach unten). */
function gedreht(v: Punkt, k: number): Punkt {
  let [x, y] = v;
  for (let i = 0; i < k; i++) [x, y] = [-y, x];
  return [x + 0, y + 0];
}

/** Welche Blickrichtung der Körper in Frame `f` zeigt, ob er gedreht sein darf (Sonderbild). */
function art(f: number): { richtung: Richtung; drehbar: boolean } {
  const e = DEFS[f];
  if (e === undefined) throw new Error(`Frame ${f} ohne Definition`);
  const [def, richtung] = e;
  if (istGedreht(def)) return { richtung: gedrehteRichtung(richtung, def.gedreht), drehbar: false };
  return { richtung, drehbar: istSonder(def) };
}

describe('M7-53 Körperformen: Sprites wie spieler_basis', () => {
  it('drei Formen (Inhalt und Zeichnung gleich), zwei mit eigenen Sprites; mittel sind die Sprites bis M6', () => {
    expect(KOERPERFORMEN).toEqual(['schmal', 'mittel', 'kraeftig']);
    expect([...BODY_SHAPE_IDS]).toEqual([...KOERPERFORMEN]);
    expect(EIGENE_FORMEN).toEqual(['schmal', 'kraeftig']);
    expect(koerperSpriteId('mittel')).toBe('spieler_basis');
    expect(formLayerId('ausruestung_leinentunika', 'mittel')).toBe('ausruestung_leinentunika');
    expect(formLayerId('ausruestung_leinenhose', 'kraeftig')).toBe('ausruestung_leinenhose_kraeftig');
  });

  it('jede Form hat Frames, Zelle und Anker von spieler_basis; ihre Ansichts-Clips sind die von spieler_basis', () => {
    expect(DEFS).toHaveLength(BASIS.frames.length);
    for (const form of EIGENE_FORMEN) {
      for (const id of [koerperSpriteId(form), formLayerId('ausruestung_leinentunika', form), formLayerId('ausruestung_leinenhose', form)]) {
        const s = sprite(id);
        expect(s.group, id).toBe('koerperformen');
        expect(s.size, id).toEqual(BASIS.size);
        expect(s.frames, id).toHaveLength(BASIS.frames.length);
        for (let f = 0; f < s.frames.length; f++) expect([s.frames[f]?.ax, s.frames[f]?.ay], `${id} Frame ${f}`).toEqual([BASIS.frames[f]?.ax, BASIS.frames[f]?.ay]);
        expect(Object.keys(s.clips).sort(), id).toEqual(RICHTUNGEN.flatMap((r) => [`idle_${r}`, `walk_${r}`]).sort());
        for (const [name, clip] of Object.entries(s.clips)) expect(clip.frames, `${id} ${name}`).toEqual(BASIS.clips[name]?.frames);
      }
      expect(Object.keys(sprite(koerperSpriteId(form)).sockets).sort()).toEqual(Object.keys(BASIS.sockets).sort());
    }
  });
});

describe('M7-53 Sockel-Mapping je Form', () => {
  it('der Schulterversatz: schmal je 1 px nach innen, kräftig je 1 px nach außen, im Profil keiner', () => {
    expect(schulterVersatz('mittel', 'down', 'r')).toBe(0);
    expect([schulterVersatz('schmal', 'down', 'r'), schulterVersatz('schmal', 'down', 'l')]).toEqual([1, -1]);
    expect([schulterVersatz('kraeftig', 'down', 'r'), schulterVersatz('kraeftig', 'down', 'l')]).toEqual([-1, 1]);
    expect([schulterVersatz('kraeftig', 'up', 'r'), schulterVersatz('kraeftig', 'up', 'l')]).toEqual([1, -1]);
    for (const form of KOERPERFORMEN) for (const r of ['right', 'left'] as const) expect([schulterVersatz(form, r, 'r') + 0, schulterVersatz(form, r, 'l') + 0]).toEqual([0, 0]);
  });

  for (const form of EIGENE_FORMEN) {
    it(`${form}: Hand und Nebenhand folgen den Schultern in jedem Bild, Kopf und Last bleiben`, () => {
      const s = sprite(koerperSpriteId(form));
      let stehend = 0;
      let gedrehteBilder = 0;
      let bewegt = 0;
      for (let f = 0; f < BASIS.frames.length; f++) {
        const { richtung, drehbar } = art(f);
        const hand = versatz(s, 'hand', f);
        const neben = versatz(s, 'nebenhand', f);
        const kopf = versatz(s, 'kopf', f);
        const last = versatz(s, 'last', f);
        expect([hand, neben, kopf, last].every((p) => p !== null), `Frame ${f}: Sockel fehlen`).toBe(true);
        if (hand === null || neben === null || kopf === null || last === null) continue;
        // `+ 0`: nach links ist der Versatz −0 (gespiegelt), der Sockel 0.
        const soll: [Punkt, Punkt] = [
          [schulterVersatz(form, richtung, 'r') + 0, 0],
          [schulterVersatz(form, richtung, 'l') + 0, 0],
        ];
        if (soll[0][0] !== 0) bewegt++;
        // Kopf und Last verschieben sich gemeinsam (das liegende Bild steht je nach Rumpfbreite 1 px höher), sonst nie.
        expect(last, `Frame ${f}: Last folgt dem Kopf`).toEqual(kopf);
        const relHand: Punkt = [hand[0] - kopf[0], hand[1] - kopf[1]];
        const relNeben: Punkt = [neben[0] - kopf[0], neben[1] - kopf[1]];
        if (!drehbar) {
          stehend++;
          expect(kopf, `Frame ${f} (${richtung}): Kopf bleibt`).toEqual([0, 0]);
          expect([hand, neben], `Frame ${f} (${richtung}): Hände am Schulterversatz`).toEqual(soll);
          continue;
        }
        // Sonderbild: beide Hände um dieselbe Vierteldrehung des Schulterversatzes, der Kopf höchstens 1 px.
        expect(Math.abs(kopf[0]) + Math.abs(kopf[1]), `Frame ${f}: Kopf`).toBeLessThanOrEqual(1);
        const k = [0, 1, 2, 3].find((d) => {
          const [a, b] = [gedreht(soll[0], d), gedreht(soll[1], d)];
          return a[0] === relHand[0] && a[1] === relHand[1] && b[0] === relNeben[0] && b[1] === relNeben[1];
        });
        expect(k, `Frame ${f} (${richtung}, Sonderbild): Hände ${String(relHand)} / ${String(relNeben)}, Schulterversatz ${String(soll[0])} / ${String(soll[1])}`).toBeDefined();
        if (k !== 0) gedrehteBilder++;
      }
      // Die Belegbreite: fast alle Bilder stehen, die liegenden (Tod, Schlaf) sind gedreht, in Hunderten wandern die Hände.
      expect(stehend).toBeGreaterThan(900);
      expect(gedrehteBilder).toBeGreaterThanOrEqual(4);
      expect(bewegt).toBeGreaterThan(500);
    });
  }
});

describe('M7-110 Rüstung je Körperform', () => {
  /** Die zwölf Rüstungsteile der drei Sätze (Kopf, Brust, Beine, Füße). */
  const TEILE = RUESTUNG.filter((i) => i.kategorie === 'ruestung');
  const QUELLEN = new Map(ruestungFormen.map((s) => [s.id, s]));
  const quelle = (item: string, form: string): Sprite => {
    const s = QUELLEN.get(formLayerId(itemLayerSpriteId(item), form as never));
    if (s === undefined) throw new Error(`Layer ${item} in ${form} fehlt`);
    return s;
  };
  const maske = (s: Sprite | undefined, f: number): string => Array.from(s?.frames[f]?.index ?? [], (v) => (v === TRANSPARENT ? '.' : '#')).join('');

  it('jedes Teil hat in schmal und kräftig seinen Layer im Atlas: Overlays mit den Frames des Körpers, beschnitten in der Zelle; Helme mit den Clips des Helms in mittel', () => {
    expect(TEILE).toHaveLength(12);
    expect([...RUESTUNG_FORMEN]).toEqual(EIGENE_FORMEN);
    expect(ruestungFormen).toHaveLength(TEILE.length * EIGENE_FORMEN.length);
    let beschnitten = 0;
    for (const form of EIGENE_FORMEN) {
      for (const teil of TEILE) {
        const mittel = sprite(itemLayerSpriteId(teil.id));
        const s = sprite(formLayerId(itemLayerSpriteId(teil.id), form));
        expect(s.group, s.id).toBe('ruestung_formen');
        if (teil.ausruestung === 'kopf') {
          expect(Object.keys(s.clips).sort(), s.id).toEqual(Object.keys(mittel.clips).sort());
          continue;
        }
        expect([s.size, s.frames.length], s.id).toEqual([BASIS.size, BASIS.frames.length]);
        const zelle = generatedAtlasModule()?.SPRITES[s.id];
        if (zelle === undefined) throw new Error(`${s.id} fehlt im erzeugten Manifest`);
        const [axZ, ayZ] = zelle.anchor;
        for (const r of zelle.frames) {
          // The frame's rectangle lies in the cell: the anchor in the rectangle names where it sits.
          expect(r.ax, s.id).toBeDefined();
          const x = axZ - (r.ax ?? axZ);
          const y = ayZ - (r.ay ?? ayZ);
          expect(x >= 0 && y >= 0 && x + r.w <= BASIS.size[0] && y + r.h <= BASIS.size[1], `${s.id} ${JSON.stringify(r)}`).toBe(true);
          if (r.w < BASIS.size[0] || r.h < BASIS.size[1]) beschnitten++;
        }
      }
    }
    expect(beschnitten).toBeGreaterThan(EIGENE_FORMEN.length * 9 * 1000);
  });

  for (const form of EIGENE_FORMEN) {
    it(`${form}: jedes Pixel auf dem Körper der Form; das Fasergewand deckt Tunika und Hose der Form, Wams und Panzer folgen ihrem Rumpf`, () => {
      const [basis, , tunika, hose] = formSprites(form);
      if (basis === undefined || tunika === undefined || hose === undefined) throw new Error(`Körper ${form} fehlt`);
      const fehler: string[] = [];
      for (const teil of TEILE.filter((t) => t.ausruestung !== 'kopf')) {
        const s = quelle(teil.id, form);
        expect(s.frames, s.id).toHaveLength(basis.frames.length);
        s.frames.forEach((fr, f) => {
          const k = basis.frames[f]?.index;
          fr.index.forEach((v, p) => {
            if (v !== TRANSPARENT && (k?.[p] ?? TRANSPARENT) === TRANSPARENT) fehler.push(`${s.id} F${f} (${p % s.w}, ${Math.floor(p / s.w)})`);
          });
        });
      }
      expect(fehler.slice(0, 5)).toEqual([]);
      const hemd = quelle('faserhemd', form);
      const fhose = quelle('faserhose', form);
      const panzer = quelle('bronzebrustpanzer', form);
      const panzerMittel = bronze.find((b) => b.id === 'ausruestung_bronzebrustpanzer');
      let eigen = 0;
      for (let f = 0; f < basis.frames.length; f++) {
        expect(maske(hemd, f), `Hemd Frame ${f}`).toBe(maske(tunika, f));
        expect(maske(fhose, f), `Hose Frame ${f}`).toBe(maske(hose, f));
        // The form's own cuirass: its outline differs from the one of `mittel` (the narrower or broader torso).
        if (maske(panzer, f) !== maske(panzerMittel, f)) eigen++;
      }
      expect(eigen / basis.frames.length).toBeGreaterThan(0.9);
    });

    it(`${form}: der Helm der Form liegt am Kopfsockel jedes Körper-Frames auf dem Kopf`, () => {
      const [basis] = formSprites(form);
      if (basis === undefined) throw new Error(`Körper ${form} fehlt`);
      for (const id of ['faserkappe', 'lederkappe', 'bronzehelm']) {
        const s = quelle(id, form);
        for (const [name, c] of Object.entries(sprite('spieler_basis').clips)) {
          c.frames.forEach((bf, pos) => {
            const hf = s.clips[name]?.frames[pos] ?? 0;
            const k = basis.sockets.kopf?.[bf];
            if (k === undefined) throw new Error(`Kopfsockel fehlt in Frame ${bf}`);
            s.frames[hf]?.index.forEach((v, p) => {
              if (v === TRANSPARENT) return;
              const x = k[0] + (p % s.w) - s.anchor[0];
              const y = k[1] + Math.floor(p / s.w) - s.anchor[1];
              if ((basis.frames[bf]?.index[y * basis.w + x] ?? TRANSPARENT) === TRANSPARENT) throw new Error(`${s.id} ${name}[${pos}]: Pixel neben dem Kopf`);
            });
          });
        }
      }
    });
  }

  it('der Renderer zeichnet die Figur mit Rüstung in der gewählten Form (bis M7-53: in mittel)', () => {
    const satz = [
      { slot: 'kopf', sprite: 'ausruestung_lederkappe' },
      { slot: 'koerper', sprite: 'ausruestung_lederwams' },
      { slot: 'beine', sprite: 'ausruestung_lederhose' },
      { slot: 'fuesse', sprite: 'ausruestung_lederstiefel' },
    ] as const;
    for (const form of EIGENE_FORMEN) {
      const rig = buildPlayerFigure(M, satz, {}, { ...DRAWN_LOOK, form });
      if (rig === null) throw new Error('keine Spielerfigur');
      expect(rig.form, form).toBe(form);
      expect(rig.body.id, form).toBe(koerperSpriteId(form));
      expect(rig.clothing, form).toEqual(satz.map((c) => formLayerId(c.sprite, form)));
    }
    // Without the form's layers in the atlas the figure falls back to `mittel` (and the drawn layers).
    const ohne: AtlasManifest = { ...M, sprites: Object.fromEntries(Object.entries(M.sprites).filter(([id]) => !id.startsWith('ausruestung_leder') || !id.endsWith('_kraeftig'))) };
    const rueckfall = buildPlayerFigure(ohne, satz, {}, { ...DRAWN_LOOK, form: 'kraeftig' });
    expect(rueckfall?.form).toBe('mittel');
    expect(rueckfall?.clothing).toEqual(satz.map((c) => c.sprite));
  });
});

describe('M7-113 jede Form über allen Aktionsclips', () => {
  for (const form of EIGENE_FORMEN) {
    it(`${form}: angezogen (Körper, Hose, Tunika) in allen ${BASIS.frames.length} Frames ≤ 12 Farben und ohne Einzelpixel-Befund`, () => {
      const [basis, , tunika, hose] = formSprites(form);
      if (basis === undefined || tunika === undefined || hose === undefined) throw new Error(`Körper ${form} fehlt`);
      const frames = basis.frames.map((f, i) => {
        const out = Uint8Array.from(f.index);
        for (const layer of [hose, tunika]) layer.frames[i]?.index.forEach((v, p) => {
          if (v !== TRANSPARENT) out[p] = v;
        });
        return { index: out };
      });
      const komposit = spriteFromPixels({ id: `angezogen_${form}`, size: [basis.w, basis.h], anchor: [basis.anchor[0], basis.anchor[1]], hoehe: 'zylinder' }, frames);
      expect(spriteColorCount(komposit)).toBeLessThanOrEqual(MAX_SPRITE_COLORS);
      expect(checkSprite(komposit)).toEqual({ errors: [], warnings: [] });
    });
  }
});
