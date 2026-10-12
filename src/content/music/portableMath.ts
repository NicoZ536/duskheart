/**
 * Portable sine, cosine and powers of two for the music (docs/SPIEL.md §28 "Musik-Rendering: Node und Worker bitgleich";
 * ADR-0210): the music's render path (the synth's sine table, note frequencies, envelope coefficients, pan, the chorus
 * detune, the biquad coefficients, the content's wavetables) takes every transcendental value from here.
 *
 * Since M7-76 the implementation lives in `src/engine/portableMath.ts`, shared with the simulation (one set of bits for
 * the game, the world and the music); this module names the music's part of it.
 */
export { PORTABLE_TRIG_MAX, pcos, pexp2, psin } from '../../engine/portableMath';
