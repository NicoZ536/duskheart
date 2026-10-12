/**
 * Night life at the lights (M7-149; MASTERPROMPT §6.2 "Nacht: … Glühwürmchen …", docs/ART.md §19.1 Grünhain-Politur): moths
 * flutter round the warm lights on spring, summer and autumn nights – a handful at each placed torch, camp fire and lamp in
 * view, never at a carried one (it moves on), never by day, in the rain, in snow or in a sandstorm.
 *
 * - `motte`: a moth – a dusky fleck of one or two pixels (`erde.2`, darkening to `erde.1`, its wings turning: it
 *   twinkles), lit by the scene, not glowing: against the bright pool of a fire it stands as a dark speck, as moths do
 *   against a lamp; a few pixels off into the night it sinks into the dark (a pale moth vanished in the lit sand – the first
 *   version, `sand.4`). No gravity, a strong drag and a fast swirl: it does not fly straight but tumbles round where it was
 *   born, for 3–5 s.
 * - `motten_licht`: the moths of a light – born on an ellipse of 40 × 20 px round its flame, from the flame's height up to
 *   20 px over it, thrown sideways round the light (`tangential`); one and a half a second keep five to eight in the air.
 * - `LIGHT_VISITORS_NACHTLEBEN`: where and when (`Lichtgast`, schema `lightVisitorSchema`): the warm lights – torch, camp
 *   fire, resin lamps, lanterns – not the stone fireplace (it stands in a room), the cold Lumen lantern and the firefly jar;
 *   below the fireflies' daylight (0.2, src/render/surface/params.ts), as they do.
 */
import type { LightVisitorInput, ParticleEmitterInput, ParticleKindInput } from './schema';

export const PARTICLE_KINDS_NACHTLEBEN: readonly ParticleKindInput[] = [
  {
    // A moth: a dusky fleck that tumbles round the light – drag 2.5/s holds its own speed down, a swirl of 34 px/s at 2.6 Hz
    // throws it about; its brightness twinkles as its wings turn to the light and away.
    id: 'motte',
    form: 'punkt',
    groesse: { min: 1, max: 2 },
    wachstum: 1,
    farben: ['erde.2', 'erde.2', 'erde.1'],
    deckung: { start: 1, ende: 0.8 },
    emissiv: 0,
    flackern: 0.35,
    leben: { min: 3, max: 5 },
    schwerkraft: 0,
    widerstand: 2.5,
    wind: 0.25,
    wirbel: 34,
    wirbelTakt: 2.6,
    boden: 'abprallen',
  },
];

export const PARTICLE_EMITTERS_NACHTLEBEN: readonly ParticleEmitterInput[] = [
  // One and a half moths a second round a light, each living 3–5 s: five to eight flutter there at once.
  { id: 'motten_licht', art: 'motte', rate: 1.5, flaeche: { form: 'kreis', breite: 40, tiefe: 20 }, hoehe: { min: 0, max: 20 }, tempo: { min: 8, max: 20 }, richtung: 0, streuung: 90, ausrichtung: 'tangential', steigen: { min: -6, max: 6 } },
];

export const LIGHT_VISITORS_NACHTLEBEN: readonly LightVisitorInput[] = [
  {
    emitter: 'motten_licht',
    lichter: ['fackel', 'lagerfeuer', 'harzlampe', 'harzlampe_wand', 'laterne_stehend', 'laternenpfahl'],
    tageslichtUnter: 0.2,
    jahreszeiten: ['fruehling', 'sommer', 'herbst'],
  },
];
