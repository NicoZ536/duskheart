/**
 * The pause menu's world view (MASTERPROMPT §29 "Schwierigkeit jederzeit änderbar (außer Unbarmherzig)"; docs/SPIEL.md
 * §25; M7-51): the world's changeable settings as rows – the preset, peaceful, the season length, the overrides of
 * hunger/thirst and enemy damage, the shadow flood and logistics realism – read from the session's sample
 * (`GameSession.sampleWorldSettings`) and changed only through commands (`world.setDifficulty`, `world.setSettings`).
 *
 * The simulation rests while the pause menu is open: a command takes effect in the first tick after "Weiter", so the view
 * shows the values the player chose (the sample with the changes sent since it opened). An Unbarmherzig world locks every
 * row but the season length; a running world does not offer Unbarmherzig – permadeath is chosen with a new world only,
 * never by a step too far in a list. Pure.
 */
import { DIFFICULTIES, type Difficulty } from '../../../content/balance/death';
import type { GameCommand } from '../../../game/commands';
import type { WorldSettingsSample } from '../../../game/samples/weltEinstellungen';
import { difficultyLocked } from '../../../game/worldsettings/formulas';
import { NEUE_WELT_ZEILEN, schritt, type NeueWeltForm, type NeueWeltZeile } from '../neue-welt/modell';

/** The rows of the world view, in display order. */
export const WELT_ZEILEN_IDS = ['schwierigkeit', 'friedlich', 'jahreszeitenLaenge', 'hungerDurst', 'gegnerschaden', 'schattenflut', 'logistikRealismus'] as const;
export type WeltZeileId = (typeof WELT_ZEILEN_IDS)[number];

/** The presets a running world may change to (no Unbarmherzig, see the module comment). */
export const LAUFENDE_STUFEN: readonly Difficulty[] = DIFFICULTIES.filter((d) => !difficultyLocked(d));

/** The world view's rows: the new-world rows of the same ids, the preset limited to `LAUFENDE_STUFEN`. */
export const WELT_ZEILEN: readonly NeueWeltZeile[] = WELT_ZEILEN_IDS.map((id) => {
  const row = NEUE_WELT_ZEILEN.find((r) => r.id === id);
  if (row === undefined) throw new Error(`pause/welt: no new-world row "${id}"`);
  return id === 'schwierigkeit' ? { ...row, values: LAUFENDE_STUFEN, wraps: false } : row;
});

/** The form of the world view from the sample (the immutable config fills the rest; name and seed are not shown). */
export function formAusProbe(p: Readonly<WorldSettingsSample>): NeueWeltForm {
  return {
    name: '',
    seedText: String(p.seed),
    groesse: p.groesse,
    schwierigkeit: p.schwierigkeit,
    friedlich: p.friedlich,
    tageslaenge: p.tageslaenge as NeueWeltForm['tageslaenge'],
    jahreszeitenLaenge: p.jahreszeitenLaenge,
    ressourcendichte: p.ressourcendichte,
    hungerDurst: p.hungerDurst,
    gegnerschaden: p.gegnerschaden,
    schattenflut: p.schattenflut === null ? 'aus' : p.schattenflut,
    logistikRealismus: p.logistikRealismus,
  };
}

/** Whether row `id` is locked in a world of difficulty `d` (Unbarmherzig: all but the season length). */
export function weltZeileGesperrt(d: Difficulty, id: string): boolean {
  return difficultyLocked(d) && id !== 'jahreszeitenLaenge';
}

/** The command that turns `vorher` into `nachher` for row `id`, or null when nothing changed. */
export function weltBefehl(id: string, vorher: NeueWeltForm, nachher: NeueWeltForm): GameCommand | null {
  switch (id) {
    case 'schwierigkeit':
      return nachher.schwierigkeit === vorher.schwierigkeit ? null : { type: 'world.setDifficulty', schwierigkeit: nachher.schwierigkeit };
    case 'friedlich':
      return nachher.friedlich === vorher.friedlich ? null : { type: 'world.setSettings', friedlich: nachher.friedlich };
    case 'jahreszeitenLaenge':
      return nachher.jahreszeitenLaenge === vorher.jahreszeitenLaenge ? null : { type: 'world.setSettings', jahreszeitenLaenge: nachher.jahreszeitenLaenge };
    case 'hungerDurst':
      return nachher.hungerDurst === vorher.hungerDurst ? null : { type: 'world.setSettings', hungerDurst: nachher.hungerDurst };
    case 'gegnerschaden':
      return nachher.gegnerschaden === vorher.gegnerschaden ? null : { type: 'world.setSettings', gegnerschaden: nachher.gegnerschaden };
    case 'schattenflut':
      return nachher.schattenflut === vorher.schattenflut ? null : { type: 'world.setSettings', schattenflut: nachher.schattenflut === 'aus' ? null : nachher.schattenflut };
    case 'logistikRealismus':
      return nachher.logistikRealismus === vorher.logistikRealismus ? null : { type: 'world.setSettings', logistikRealismus: nachher.logistikRealismus };
    default:
      return null;
  }
}

/** One step of row `id`: the new form and the command for it (null when the row is locked or did not move). */
export function weltSchritt(form: NeueWeltForm, id: string, dir: 1 | -1): { readonly form: NeueWeltForm; readonly befehl: GameCommand | null } {
  const row = WELT_ZEILEN.find((r) => r.id === id);
  if (row === undefined || weltZeileGesperrt(form.schwierigkeit, id)) return { form, befehl: null };
  const next = schritt(row, form, dir);
  return { form: next, befehl: weltBefehl(id, form, next) };
}
