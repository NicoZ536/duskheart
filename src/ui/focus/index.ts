/**
 * UI screen foundation (MASTERPROMPT §26, §29; M3-31): focus navigation with a visible focus frame
 * for keyboard and controller, the screen stack of the game (input context, pause, tab switch), the
 * full-screen layer with pixel-snapped centring and the button prompts of the hint lines.
 */
export { activeGameScreens, GAME_SCREENS, GameScreens, type GameScreensHandle, type GameScreensProps } from './GameScreens';
export { designPixel, ScreenLayer, snapCentre, type ScreenLayerProps } from './Layer';
export { FOCUS_ATTR, FOCUS_VISIBLE_ATTR, FocusManager, type FocusElement, type FocusRoot, type FocusScope, type NavAction } from './manager';
export { inBeam, NAV_DIRECTIONS, navScore, pickInDirection, type NavDirection, type NavRect } from './nav';
export { actionPrompt, usesGamepad } from './prompts';
export { REPEAT_DELAY_MS, REPEAT_INTERVAL_MS, ScreenController, type ScreenControllerOptions, type ScreenId, type ScreenInput, type ScreenSpec } from './screens';
export { focusable, useFocusScope, type FocusScopeHandlers } from './useFocusScope';
