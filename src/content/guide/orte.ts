/**
 * Funke comments and context hints of strand B (docs/SPIEL.md §17, §18; M7-07 … M7-09, M7-38 … M7-40): the first place, the
 * shrine's blessing, the look-out tower, the announcement of every world event that runs (priority 3, `ankuendigung.funke`
 * of the register), the first lightning strike nearby.
 */
import type { GuideHintInput } from './schema';

/** Seconds before an event announcement may speak again: the next run of the same event is days away anyway. */
const EVENT_REPEAT_SECONDS = 1200;

export const GUIDE_HINTS_B: readonly GuideHintInput[] = [
  {
    id: 'funke_ort_erster',
    kanal: 'funke',
    text: { de: 'Ein Ort der Alten! Truhen, Spuren … und Wächter. Sieh dich vorsichtig um.', en: 'A place of the old ones! Chests, traces … and guards. Look around carefully.' },
    ausloeser: { art: 'ereignis', ereignis: 'placeDiscovered' },
    prioritaet: 2,
    einmalig: true,
  },
  {
    id: 'funke_ort_segen',
    kanal: 'funke',
    text: { de: 'Der Schrein segnet dich – eine Weile heilst du schneller und fürchtest weniger.', en: 'The shrine blesses you – for a while you heal faster and fear less.' },
    ausloeser: { art: 'ereignis', ereignis: 'shrineBlessed' },
    prioritaet: 1,
    einmalig: true,
  },
  {
    id: 'funke_ort_turm',
    kanal: 'funke',
    text: { de: 'Von hier oben siehst du weit. Die Karte hat sich gefüllt – schau nach!', en: 'From up here you see far. The map has filled in – take a look!' },
    ausloeser: { art: 'ereignis', ereignis: 'towerClimbed' },
    prioritaet: 2,
    einmalig: true,
  },
  {
    id: 'funke_ereignis_finstermond',
    kanal: 'funke',
    text: { de: 'Heute Nacht bleibt der Mond fort. Finstermond – halte das Feuer hoch!', en: 'Tonight the moon stays away. Darkmoon – keep the fire high!' },
    ausloeser: { art: 'ereignis', ereignis: 'worldEventAnnounced', wo: { event: 'finstermond' } },
    prioritaet: 3,
    einmalig: false,
    abklingSekunden: EVENT_REPEAT_SECONDS,
  },
  {
    id: 'funke_ereignis_lumenregen',
    kanal: 'funke',
    text: { de: 'Sieh nur, der Himmel glüht! Gleich fallen Lumen-Scherben – sammle sie!', en: 'Look, the sky is glowing! Lumen shards are about to fall – gather them!' },
    ausloeser: { art: 'ereignis', ereignis: 'worldEventAnnounced', wo: { event: 'lumenregen' } },
    prioritaet: 3,
    einmalig: false,
    abklingSekunden: EVENT_REPEAT_SECONDS,
  },
  {
    id: 'funke_ereignis_sonnenfinsternis',
    kanal: 'funke',
    text: { de: 'Die Sonne verdunkelt sich! Gleich wird es Nacht – mitten am Tag.', en: 'The sun is darkening! Night is coming – in the middle of the day.' },
    ausloeser: { art: 'ereignis', ereignis: 'worldEventAnnounced', wo: { event: 'sonnenfinsternis' } },
    prioritaet: 3,
    einmalig: false,
    abklingSekunden: EVENT_REPEAT_SECONDS,
  },
  {
    id: 'funke_ereignis_waldbrand',
    kanal: 'funke',
    text: { de: 'Ein trockenes Gewitter! Blitze können den Wald entzünden – weg von den Bäumen!', en: 'A dry thunderstorm! Lightning can set the forest alight – away from the trees!' },
    ausloeser: { art: 'ereignis', ereignis: 'worldEventAnnounced', wo: { event: 'waldbrand' } },
    prioritaet: 3,
    einmalig: false,
    abklingSekunden: EVENT_REPEAT_SECONDS,
  },
  {
    id: 'funke_blitz',
    kanal: 'funke',
    text: { de: 'Das war knapp! Blitze suchen hohe Bäume und Metall – meide sie im Gewitter.', en: 'That was close! Lightning seeks tall trees and metal – avoid them in a storm.' },
    ausloeser: { art: 'ereignis', ereignis: 'lightningStruck' },
    prioritaet: 3,
    einmalig: true,
  },
];
