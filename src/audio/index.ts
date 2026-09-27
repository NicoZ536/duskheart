/**
 * Audio kernel (MASTERPROMPT §27, M3-33, M4-29): mixer graph, SFX synthesis and playback, the event → sound
 * table, the sounds of the base, the loops of what burns and works in the world and the runtime that connects them to
 * a game session. See src/audio/README.md.
 */
export { attachAudio, UNLOCK_EVENTS, type AudioRuntime, type AudioRuntimeOptions, type AudioSession, type AudioSettingsSource } from './runtime';
export { EVENT_SFX, SILENT_EVENTS, KERNEL_SFX, LOOP_SLOTS, cuesFor, createEventSfxContext, isLoopCue, recipeSound, type AudioCue, type EventSfxContext, type EventSfxWorld, type LoopCue } from './eventMap';
export * from './baseSounds';
export { LOOP_SCAN_SECONDS, LOOP_SOURCE_EVENTS, LoopDirector, MAX_WORLD_LOOPS, type LoopSink } from './loopSources';
export { AudioMixer, busGains, sliderGain, type AudioSettings, type MixLevels } from './mixer';
export { MAX_VOICES, SfxPlayer, type SfxCue, type SfxPlayerOptions } from './sfxPlayer';
export { renderSfx, renderTakes, shortTermLoudness, sfxSampleCount, LOUDNESS_AT_FULL, PEAK_CEILING } from './dsp/render';
export * from './spatial';
