/**
 * Conditions of the places (docs/SPIEL.md §18 "segen", §29 "Zustand `gesegnet`"; M7-08; strand B): the blessing of a shrine
 * (§21 "Schreine (zeitweiliger Segen)"). Spread into `CONDITIONS` (src/content/conditions.ts); the shrine gives it for its
 * `segen.sekunden` (src/content/places/typen.ts), the icon is `zustand_gesegnet` (assets-src/sprites/zustaende/zustaende.ts, with the condition icons).
 */
import type { ConditionInput } from '../conditions';

export const PLACE_CONDITIONS: readonly ConditionInput[] = [
  {
    id: 'gesegnet',
    name: { de: 'Gesegnet', en: 'Blessed' },
    beschreibung: {
      de: 'Der Segen eines Schreins der Erbauer: Leben und Ausdauer regenerieren ein Viertel schneller, und die Furcht weicht um 0,5 pro Sekunde. Der Schrein segnet erst nach einigen Tagen wieder.',
      en: 'The blessing of a Builder shrine: health and stamina regenerate a quarter faster, and fear fades by 0.5 per second. The shrine blesses again only after some days.',
    },
    art: 'gut',
    // The shrine applies it for its own seconds (`segen.sekunden`); this is the length of a blessing given otherwise.
    dauer: { art: 'zeit', sekunden: 600 },
    stapel: { regel: 'erneuern' },
    wirkung: { lebensRegeneration: 1.25, ausdauerRegeneration: 1.25, furchtProSekunde: -0.5 },
    sichtbar: 'lichtaura',
    sound: 'sfx_zustand_gesegnet',
  },
];
