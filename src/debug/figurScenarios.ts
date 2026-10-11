/**
 * Screenshot scenarios of strand I (M7-17, M7-52 … M7-54; MASTERPROMPT §31.5): the character creation, the figure with a chosen
 * appearance in the game view, and the two elites of Grünhain. The in-game pictures look for the nearest open meadow round
 * Grünhain's showcase (`pictureSpot`, like the creature pictures, src/debug/kreaturenGruenhain.ts), set clock and clear weather,
 * spawn the player (god mode) and their cast with explicit places, then step a fixed number of times – the same picture on every
 * run. Only commands set the state up. Registered in src/debug/scenarios.ts with one line.
 *
 * - `ui-charakter`: the character creation over the game view (mounted on its own, like `ui-laden`): name „Mira“, body shape
 *   Schmal, olive skin, two braids in copper, a green top and linen trousers – the preview walking in its four facings at a
 *   still clip position, the focus on the row Frisur.
 * - `figur-aussehen`: noon on the meadow – the player as chosen in the creation (Kräftig, brown skin, the curls in black,
 *   red top, grey trousers) facing the viewer.
 * - `figur-aussehen-helm`: the same figure with long hair in blond under a leather cap: the hair falls from under the brim
 *   (mask frames `frisur_lang_helm`), nothing pokes through the cap.
 * - `figur-musizieren`: the first figure at noon playing the flute (M7-77): the pose `musizieren`, the flute in both hands,
 *   three notes rising over the head.
 * - `elite-graufang`: dusk (19:00, spring) – Graufang, the lead wolf, between two wolves of his night (the dark coat, the
 *   silver ruff, the cold light eyes beside the wolves' ember ones).
 * - `elite-alter-hauer`: noon – the Old Tusker beside a boar of the forest (grey head, scars, mud, yellowed tusks).
 * - `fang-reuse` (M7-86): two fish traps set at a shore at noon after three days in the water (the `angeln` picture of
 *   strand D shows none).
 */
import { h, render as renderPreact } from 'preact';
import type { GameCommand } from '../game/commands';
import { equipmentRef } from '../game/items/slots';
import type { Simulation } from '../game/sim';
import type { RenderSceneId } from '../render/scenes/ids';
import type { GameCameraStart } from '../render/world/gameScene';
import { surfaceWorldQuery } from '../render/world/surfaceScene';
import { TILE_PX } from '../world/model/coords';
import { BindingSet } from '../engine/input/bindings';
import { ActionReader } from '../engine/input/reader';
import { InputState } from '../engine/input/state';
import { createI18n, FALLBACK_LANG, isLang } from '../i18n';
import { FocusManager } from '../ui/focus/manager';
import { Charakter } from '../ui/screens/charakter/Charakter';
import type { CharakterForm } from '../ui/screens/charakter/modell';
import { goodSpot, pictureSpot, type Picture, type Role } from './kreaturenGruenhain';
import { clearCreatures, STOCK_CLEARING } from './scenarioCreatures';

/** Where the camera starts: Grünhain's showcase window. */
const START: GameCameraStart = { kind: 'biom', biome: 'gruenhain' };
/** Presentation time of the frozen picture [s]. */
const PICTURE_TIME = 0.4;
/** Frames until the picture counts as stable. */
const SETTLE_FRAMES = 8;
/** Frames of the character creation (web font, glyph atlas, the decoded game atlas of the preview). */
const UI_SETTLE_FRAMES = 45;
/** Simulation steps after the cast appeared. */
const STEPS_AFTER = 2;

const DUSK = { hour: 19, minute: 0 } as const;
const NOON = { hour: 12, minute: 0 } as const;

/** The appearance of the in-game pictures (`appearance.set`). */
const AUSSEHEN = { type: 'appearance.set', name: 'Mira', form: 'kraeftig', haut: 'haut_5', frisur: 'locken', haar: 'haar_3', oberteil: 'kleid_2', hose: 'kleid_5' } as const satisfies GameCommand;
/** Under the cap: long hair in blond. */
const AUSSEHEN_HELM = { ...AUSSEHEN, frisur: 'lang', haar: 'haar_4', oberteil: 'kleid_3', hose: 'kleid_4' } as const satisfies GameCommand;

/** The form of the character creation's picture. */
export const CHARAKTER_SZENARIO_FORM: CharakterForm = { name: 'Mira', form: 'schmal', haut: 'haut_3', frisur: 'zoepfe', haar: 'haar_6', oberteil: 'kleid_3', hose: 'kleid_4' };

interface FigurPicture extends Picture {
  /** Commands after the player stands (appearance, equipment). */
  readonly einrichten?: readonly GameCommand[];
  /** Presentation time of the picture [s] (default `PICTURE_TIME`): the notes of the music rise with it. */
  readonly bildZeit?: number;
}

const PICTURES: readonly FigurPicture[] = [
  {
    name: 'figur-aussehen',
    description: 'M7-52 … M7-54: Mittag auf der Grünhain-Wiese – die Figur, wie sie in der Charaktererstellung gewählt wurde: Körperform Kräftig, braune Haut, Locken in Schwarz, rotes Oberteil, graue Hose, von vorn',
    time: NOON,
    cast: [],
    naturalGround: true,
    treeFree: true,
    clearStock: true,
    einrichten: [AUSSEHEN],
  },
  {
    name: 'figur-aussehen-helm',
    description: 'M7-54: dieselbe Figur mit langem blondem Haar unter einer Lederkappe – das Haar fällt unter der Krempe hervor (Maskenframes frisur_lang_helm), nichts ragt durch die Kappe; grünes Oberteil, Leinenhose',
    time: NOON,
    cast: [],
    naturalGround: true,
    treeFree: true,
    clearStock: true,
    einrichten: [AUSSEHEN_HELM, { type: 'inventory.give', item: 'lederkappe', count: 1 }, { type: 'inventory.move', from: { bereich: 'inventar', index: 0 }, to: equipmentRef('kopf') }],
  },
  {
    name: 'figur-musizieren',
    description: 'M7-77: Mittag – dieselbe Figur spielt Flöte, von vorn: die Musizierpose (Clip musizieren), die Flöte als Hand-Layer an beiden Händen, drei Noten steigen über dem Kopf auf (die älteste verblasst)',
    time: NOON,
    cast: [],
    naturalGround: true,
    treeFree: true,
    clearStock: true,
    // Three notes in the air: the newest just out, one at half height, the oldest fading (`PLAYER_NOTES`: one every 0,7 s, 1,9 s each).
    bildZeit: 1.6,
    einrichten: [
      AUSSEHEN,
      { type: 'inventory.give', item: 'floete', count: 1 },
      { type: 'inventory.move', from: { bereich: 'inventar', index: 0 }, to: { bereich: 'schnellleiste', index: 0 } },
      { type: 'instrument.play', from: { bereich: 'schnellleiste', index: 0 } },
    ],
  },
  {
    name: 'elite-graufang',
    description: 'M7-17: Grünhain in der Abenddämmerung (19:00, Frühling) – Graufang, der Leitwolf, neben zwei Wölfen: dunkles Schiefergrau mit silbergrauem Nackenkamm, kalt-hell leuchtende Augen neben den Glutaugen der Wölfe, etwas größer',
    time: DUSK,
    cast: [
      { creature: 'graufang', dx: 3, dy: 0 },
      { creature: 'wolf', dx: 2, dy: 3 },
      { creature: 'wolf', dx: 5, dy: 2 },
    ],
    naturalGround: true,
    treeFree: true,
    clearStock: true,
  },
  {
    name: 'elite-alter-hauer',
    description: 'M7-17: Mittag – der Alte Hauer neben einem Keiler des Waldes: ergrauter Kopf, helle Narben auf den Flanken, getrockneter Schlamm an Bauch und Läufen, vergilbte Hauer, tief glühende Augen',
    time: NOON,
    cast: [
      // Both on the player's east side (the spot of the Graufang picture): a spot with room either side of the player is rare
      // round the showcase's meadow.
      { creature: 'alter_hauer', dx: 3, dy: 0 },
      { creature: 'keiler', dx: 4, dy: 3 },
    ],
    naturalGround: true,
    treeFree: true,
    clearStock: true,
  },
];

interface FigurRender {
  showScene(id: RenderSceneId): void;
  setDebugView(name: string): void;
  sceneReady(): boolean;
  startGameCamera(start: GameCameraStart): void;
  gameCamera(): { layer: number; tx: number; ty: number } | null;
}

interface FigurContext {
  freezeAt(seconds: number): void;
  readonly render?: FigurRender;
  readonly session?: { command(raw: unknown): unknown; step(): void; sim?(): Simulation };
}

/** A scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export interface FigurScenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: FigurContext): void;
  ready(): boolean;
}

function inGame(p: FigurPicture): FigurScenario {
  let render: FigurRender | null = null;
  let session: NonNullable<FigurContext['session']> | null = null;
  let phase: 'welt' | 'ort' | 'raeumen' | 'tiere' | 'fertig' = 'welt';
  let steps = 0;
  let player = { tx: 0, ty: 0 };
  return {
    name: p.name,
    description: p.description,
    settleFrames: SETTLE_FRAMES,
    setup(ctx) {
      if (ctx.render === undefined || ctx.session === undefined) throw new Error(`Szenario ${p.name} braucht Renderer und Sitzung`);
      render = ctx.render;
      session = ctx.session;
      phase = 'welt';
      steps = 0;
      render.startGameCamera(START);
      render.showScene('spiel');
      render.setDebugView('off');
      ctx.freezeAt(p.bildZeit ?? PICTURE_TIME);
    },
    ready() {
      const r = render;
      const s = session;
      if (r === null || s === null || !r.sceneReady()) return false;
      switch (phase) {
        case 'welt':
          if (r.gameCamera() === null) return false;
          s.command({ type: 'setSeason', season: 'fruehling' });
          s.command({ type: 'setTime', hour: p.time.hour, minute: p.time.minute });
          s.command({ type: 'setWeather', state: 'klar' });
          s.step();
          phase = 'ort';
          return false;
        case 'ort': {
          const at = r.gameCamera();
          const q = surfaceWorldQuery();
          if (at === null || q === null) return false;
          q.layer = 0;
          const spot = pictureSpot(q, at.tx, at.ty, p);
          if (spot === null) return false;
          player = spot;
          s.command({ type: 'player.spawn', tx: spot.tx, ty: spot.ty, layer: 0 });
          s.command({ type: 'debug.god', on: true });
          s.step();
          for (const c of p.einrichten ?? []) s.command(c);
          s.step();
          phase = p.clearStock === true ? 'raeumen' : 'tiere';
          return false;
        }
        case 'raeumen':
          clearCreatures(s, 0, (player.tx + 0.5) * TILE_PX, (player.ty + 0.5) * TILE_PX, STOCK_CLEARING);
          s.step();
          phase = 'tiere';
          return false;
        case 'tiere': {
          const q = surfaceWorldQuery();
          if (q === null) return false;
          if (steps === 0) {
            if (p.cast.some((c: Role) => q.groundAt(player.tx + c.dx, player.ty + c.dy) === null)) return false;
            q.layer = 0;
            const again = goodSpot(q, player.tx, player.ty, p.cast, p.naturalGround === true, p.treeFree === true);
            if (again === null) return false;
            if (!again) {
              phase = 'ort';
              return false;
            }
            for (const c of p.cast) s.command({ type: 'creature.spawn', creature: c.creature, count: c.count ?? 1, x: (player.tx + c.dx + 0.5) * TILE_PX, y: (player.ty + c.dy + 0.5) * TILE_PX, layer: 0 });
          }
          s.step();
          steps++;
          if (steps >= (p.steps ?? STEPS_AFTER)) phase = 'fertig';
          return false;
        }
        case 'fertig':
          return true;
      }
    },
  };
}

/** The character creation mounted over the view, with its picture's form and a still preview (`standbild`). */
function charakterShot(): FigurScenario {
  let mounted = false;
  let host: HTMLElement | null = null;
  let focus: FocusManager | null = null;
  return {
    name: 'ui-charakter',
    description:
      'M7-52: Charaktererstellung – Name „Mira“, Vorschau der Figur in vier Richtungen beim Gehen (Körperform Schmal, Haut Oliv, zwei Zöpfe in Kupfer, grünes Oberteil, Leinenhose), darunter die Zeilen Körperform, Hautfarbe, Frisur (Fokus), Haarfarbe, Oberteil, Hose und die Knöpfe Welt betreten, Stehen, Zurück',
    settleFrames: UI_SETTLE_FRAMES,
    setup(ctx) {
      ctx.freezeAt(PICTURE_TIME);
    },
    ready() {
      if (!mounted) {
        const lang = document.documentElement.lang;
        const i18n = createI18n(isLang(lang) ? lang : FALLBACK_LANG);
        i18n.onMissing((key, l) => console.error(`i18n: Schlüssel „${key}“ fehlt (${l})`));
        host = document.body.appendChild(document.createElement('div'));
        focus = new FocusManager();
        // The default bindings, so the hint line names the keys (keyboard, the device of a fresh start).
        const input = new ActionReader(new InputState(), new BindingSet());
        const form = CHARAKTER_SZENARIO_FORM;
        renderPreact(
          h(Charakter, {
            i18n,
            focus,
            input,
            form,
            setForm: () => undefined,
            geprueft: false,
            onWeiter: () => undefined,
            onFehler: () => undefined,
            onZurueck: () => undefined,
            standbild: { gehen: true, position: 1 },
          }),
          host,
        );
        mounted = true;
        return false;
      }
      const row = document.querySelector('[data-zeile="frisur"]');
      if (focus === null || !(row instanceof HTMLElement)) return false;
      focus.keysUsed();
      focus.focus(row);
      return true;
    },
  };
}

/** The pictures of strand I. */
/** How far the trap picture looks for a shore round the camera [tiles]. */
const SHORE_SEARCH = 32;
/** Game days the traps lie in the water before the picture (each dawn a trap may catch, `BALANCE.fishing.trap`). */
const TRAP_DAYS = 3;

/** A free shore tile near (tx, ty) with water one and two tiles towards (ux, uy); null while a chunk is missing. */
function shoreSpot(tx: number, ty: number): { x: number; y: number; ux: number; uy: number } | null | undefined {
  const q = surfaceWorldQuery();
  if (q === null) return null;
  q.layer = 0;
  for (let r = 0; r <= SHORE_SEARCH; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = tx + dx;
        const y = ty + dy;
        const g = q.groundAt(x, y);
        if (g === null) return null;
        if (!q.freeAt(x, y)) continue;
        for (const [ux, uy] of [
          [0, 1],
          [1, 0],
          [-1, 0],
          [0, -1],
        ] as const) {
          if (q.groundAt(x + ux, y + uy)?.water === true && q.groundAt(x + 2 * ux, y + 2 * uy)?.water === true && q.groundAt(x + ux + uy, y + uy + ux)?.water === true) return { x, y, ux, uy };
        }
      }
    }
  }
  return undefined;
}

/**
 * `fang-reuse` (M7-86): two fish traps set at a Grünhain shore at noon, after `TRAP_DAYS` days in the water – the woven basket
 * half sunk with its float on the line, readable against the shallows and the foam (`obj_reuse`, assets-src/sprites/feld/fang.ts).
 */
function reuseShot(): FigurScenario {
  let render: FigurRender | null = null;
  let session: NonNullable<FigurContext['session']> | null = null;
  let phase: 'welt' | 'ufer' | 'warten' | 'fertig' = 'welt';
  let centre = { tx: 0, ty: 0 };
  let steps = 0;
  return {
    name: 'fang-reuse',
    description:
      'M7-86: Mittag im Sommer an einem Grünhain-Ufer – zwei gesetzte Reusen halb im Wasser neben dem Spieler, nach drei Tagen: dunkles Geflecht mit hellen Ruten, die schwarze Trichteröffnung, die Schaumlinie am Wasserrand und der rot-weiße Schwimmer an der Leine; eine Reuse mit Fang (Fischschwanz im Korb)',
    settleFrames: SETTLE_FRAMES,
    setup(ctx) {
      if (ctx.render === undefined || ctx.session === undefined) throw new Error('Szenario fang-reuse braucht Renderer und Sitzung');
      render = ctx.render;
      session = ctx.session;
      phase = 'welt';
      steps = 0;
      render.startGameCamera(START);
      render.showScene('spiel');
      render.setDebugView('off');
      ctx.freezeAt(PICTURE_TIME);
    },
    ready() {
      const r = render;
      const s = session;
      if (r === null || s === null || !r.sceneReady()) return false;
      switch (phase) {
        case 'welt': {
          const at = r.gameCamera();
          if (at === null) return false;
          centre = { tx: at.tx, ty: at.ty };
          s.command({ type: 'setSeason', season: 'sommer' });
          s.command({ type: 'setTime', hour: NOON.hour, minute: NOON.minute });
          s.command({ type: 'setWeather', state: 'klar' });
          s.command({ type: 'player.spawn', tx: centre.tx, ty: centre.ty, layer: 0 });
          s.command({ type: 'debug.god', on: true });
          s.command({ type: 'inventory.give', item: 'reuse', count: 2 });
          s.step();
          phase = 'ufer';
          return false;
        }
        case 'ufer': {
          const spot = shoreSpot(centre.tx, centre.ty);
          if (spot === null) return false;
          if (spot === undefined) throw new Error(`Szenario fang-reuse: kein Ufer im Umkreis von ${SHORE_SEARCH} Kacheln`);
          s.command({ type: 'player.teleport', x: (spot.x + 0.5) * TILE_PX, y: (spot.y + 0.5) * TILE_PX, layer: 0 });
          s.command({ type: 'creature.kill', radius: 24 });
          s.step();
          // The fresh player's bags were empty: the traps lie in the first inventory slot.
          s.command({ type: 'fishing.placeTrap', from: { bereich: 'inventar', index: 0 }, tx: spot.x + spot.ux, ty: spot.y + spot.uy });
          s.step();
          s.command({ type: 'fishing.placeTrap', from: { bereich: 'inventar', index: 0 }, tx: spot.x + spot.ux + spot.uy, ty: spot.y + spot.uy + spot.ux });
          s.step();
          // Days in the water, back at noon: the dawns let the traps catch (frozen time catches up like a jump).
          s.command({ type: 'advanceTime', minutes: TRAP_DAYS * 24 * 60 });
          s.step();
          phase = 'warten';
          return false;
        }
        case 'warten':
          s.step();
          steps++;
          if (steps >= STEPS_AFTER) phase = 'fertig';
          return false;
        case 'fertig':
          return true;
      }
    },
  };
}

export function figurScenarios(): FigurScenario[] {
  return [charakterShot(), ...PICTURES.map(inGame), reuseShot()];
}
