/**
 * Audio kernel (MASTERPROMPT §27, M3-33): mixer graph, SFX synthesis and playback, the event → sound
 * table and the runtime that connects them to a game session. See src/audio/README.md.
 */
export { attachAudio, UNLOCK_EVENTS, type AudioRuntime, type AudioRuntimeOptions, type AudioSession, type AudioSettingsSource } from './runtime';
export { EVENT_SFX, SILENT_EVENTS, KERNEL_SFX, LOOP_SLOTS, cuesFor, createEventSfxContext, isLoopCue, type AudioCue, type EventSfxContext, type LoopCue } from './eventMap';
export { AudioMixer, busGains, sliderGain, type AudioSettings, type MixLevels } from './mixer';
export { MAX_VOICES, SfxPlayer, type SfxCue, type SfxPlayerOptions } from './sfxPlayer';
export { renderSfx, renderTakes, shortTermLoudness, sfxSampleCount, LOUDNESS_AT_FULL, PEAK_CEILING } from './dsp/render';
export * from './spatial';
