/**
 * Input actions (MASTERPROMPT §26 "Standardbelegung", §19.1, §16.6, §31.6).
 *
 * Game code never asks for physical keys; it asks for actions. Every action is
 * active in a set of input contexts so the same physical input can mean
 * different things in different modes (e.g. F toggles the light while playing,
 * but mirrors the ghost preview in build mode).
 */

/** Input contexts: normal play, build mode (overlay on play), and menus/screens. */
export const INPUT_CONTEXTS = ['play', 'build', 'ui'] as const;
export type InputContext = (typeof INPUT_CONTEXTS)[number];

/** Every action the player can trigger. Order defines the rebinding UI order. */
export const ACTIONS = [
  // Movement & aiming
  'moveUp',
  'moveDown',
  'moveLeft',
  'moveRight',
  'aimUp',
  'aimDown',
  'aimLeft',
  'aimRight',
  'sprint',
  'sneak',
  'roll',
  // Combat
  'attack',
  'block',
  // World actions
  'interact',
  'belt',
  'toggleLight',
  // Building
  'build',
  'rotate',
  'mirror',
  'pipette',
  'undo',
  // Screens
  'inventory',
  'crafting',
  'map',
  'chronicle',
  'settlers',
  'pause',
  // Hotbar
  'hotbar1',
  'hotbar2',
  'hotbar3',
  'hotbar4',
  'hotbar5',
  'hotbar6',
  'hotbar7',
  'hotbar8',
  'hotbar9',
  'hotbar10',
  'hotbarNext',
  'hotbarPrev',
  // Menu navigation
  'uiUp',
  'uiDown',
  'uiLeft',
  'uiRight',
  'uiConfirm',
  'uiBack',
  'uiTabNext',
  'uiTabPrev',
  // Developer tools (§31.6)
  'debugOverlay',
  'debugConsole',
  'screenshotMode',
] as const;
export type Action = (typeof ACTIONS)[number];

/** Grouping used by the rebinding screen. */
export const ACTION_CATEGORIES = ['movement', 'combat', 'actions', 'building', 'screens', 'hotbar', 'menu', 'debug'] as const;
export type ActionCategory = (typeof ACTION_CATEGORIES)[number];

/** Actions whose activation can be switched between "hold" and "toggle" (setting). */
export const MODAL_ACTIONS = ['sprint', 'sneak', 'block'] as const;
export type ModalAction = (typeof MODAL_ACTIONS)[number];
export type ActivationMode = 'hold' | 'toggle';

/** The ten hotbar slot actions in slot order (keys 1–0). */
export const HOTBAR_ACTIONS = [
  'hotbar1',
  'hotbar2',
  'hotbar3',
  'hotbar4',
  'hotbar5',
  'hotbar6',
  'hotbar7',
  'hotbar8',
  'hotbar9',
  'hotbar10',
] as const satisfies readonly Action[];

export interface ActionInfo {
  /** Contexts in which the action fires. Conflicts are only reported for overlapping contexts. */
  readonly contexts: readonly InputContext[];
  readonly category: ActionCategory;
  /** True if the action carries a meaningful analog value (sticks, triggers). */
  readonly analog: boolean;
}

const PLAY: readonly InputContext[] = ['play'];
const BUILD: readonly InputContext[] = ['build'];
const WORLD: readonly InputContext[] = ['play', 'build'];
const UI: readonly InputContext[] = ['ui'];
const PLAY_UI: readonly InputContext[] = ['play', 'ui'];
const ALL: readonly InputContext[] = INPUT_CONTEXTS;

function info(contexts: readonly InputContext[], category: ActionCategory, analog = false): ActionInfo {
  return { contexts, category, analog };
}

/** Metadata for every action (contexts, category, analog flag). */
export const ACTION_INFO: Readonly<Record<Action, ActionInfo>> = {
  moveUp: info(WORLD, 'movement', true),
  moveDown: info(WORLD, 'movement', true),
  moveLeft: info(WORLD, 'movement', true),
  moveRight: info(WORLD, 'movement', true),
  aimUp: info(WORLD, 'movement', true),
  aimDown: info(WORLD, 'movement', true),
  aimLeft: info(WORLD, 'movement', true),
  aimRight: info(WORLD, 'movement', true),
  sprint: info(WORLD, 'movement'),
  sneak: info(PLAY, 'movement'),
  roll: info(PLAY, 'movement'),
  attack: info(WORLD, 'combat', true),
  block: info(WORLD, 'combat', true),
  interact: info(WORLD, 'actions'),
  belt: info(PLAY, 'actions'),
  toggleLight: info(PLAY, 'actions'),
  build: info(WORLD, 'building'),
  rotate: info(BUILD, 'building'),
  mirror: info(BUILD, 'building'),
  pipette: info(BUILD, 'building'),
  undo: info(BUILD, 'building'),
  inventory: info(WORLD, 'screens'),
  crafting: info(WORLD, 'screens'),
  map: info(WORLD, 'screens'),
  chronicle: info(WORLD, 'screens'),
  settlers: info(WORLD, 'screens'),
  pause: info(WORLD, 'screens'),
  hotbar1: info(PLAY_UI, 'hotbar'),
  hotbar2: info(PLAY_UI, 'hotbar'),
  hotbar3: info(PLAY_UI, 'hotbar'),
  hotbar4: info(PLAY_UI, 'hotbar'),
  hotbar5: info(PLAY_UI, 'hotbar'),
  hotbar6: info(PLAY_UI, 'hotbar'),
  hotbar7: info(PLAY_UI, 'hotbar'),
  hotbar8: info(PLAY_UI, 'hotbar'),
  hotbar9: info(PLAY_UI, 'hotbar'),
  hotbar10: info(PLAY_UI, 'hotbar'),
  hotbarNext: info(PLAY, 'hotbar'),
  hotbarPrev: info(PLAY, 'hotbar'),
  uiUp: info(UI, 'menu', true),
  uiDown: info(UI, 'menu', true),
  uiLeft: info(UI, 'menu', true),
  uiRight: info(UI, 'menu', true),
  uiConfirm: info(UI, 'menu'),
  uiBack: info(UI, 'menu'),
  uiTabNext: info(UI, 'menu'),
  uiTabPrev: info(UI, 'menu'),
  debugOverlay: info(ALL, 'debug'),
  debugConsole: info(ALL, 'debug'),
  screenshotMode: info(ALL, 'debug'),
};

const ACTION_SET: ReadonlySet<string> = new Set<string>(ACTIONS);

/** Type guard for untrusted strings (save data, console input). */
export function isAction(value: string): value is Action {
  return ACTION_SET.has(value);
}

/** Stable numeric index of an action (for typed-array lookups in the reader). */
export const ACTION_INDEX: Readonly<Record<Action, number>> = Object.fromEntries(
  ACTIONS.map((a, i) => [a, i] as const),
) as Record<Action, number>;

export function isModalAction(action: Action): action is ModalAction {
  return (MODAL_ACTIONS as readonly string[]).includes(action);
}

/** True if the action fires in the given context. */
export function isActionActive(action: Action, context: InputContext): boolean {
  return ACTION_INFO[action].contexts.includes(context);
}

/** Contexts shared by two actions (empty if they can never fire at the same time). */
export function sharedContexts(a: Action, b: Action): InputContext[] {
  const other = ACTION_INFO[b].contexts;
  return ACTION_INFO[a].contexts.filter((c) => other.includes(c));
}

/** i18n key of the action's display name (rebinding UI, prompts). */
export function actionLabelKey(action: Action): string {
  return `input.action.${action}`;
}

/** All actions of a category in display order. */
export function actionsInCategory(category: ActionCategory): Action[] {
  return ACTIONS.filter((a) => ACTION_INFO[a].category === category);
}
