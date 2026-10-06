/**
 * Funke comments and context hints of strand F (docs/SPIEL.md §22, §23; M7-32 … M7-37): the Borkenvater waking and his
 * phases (what to dodge, where to strike), the warden fallen and the beacon to light, the beacon burning, the light zone,
 * the heart shard, the Lumen lantern and the travel between the fires.
 */
import type { GuideHintInput } from './schema';

export const GUIDE_HINTS_F: readonly GuideHintInput[] = [
  {
    id: 'funke_boss_erwacht',
    kanal: 'funke',
    text: { de: 'Der Borkenvater! Sieh auf den Boden – wo es reißt, stoßen Wurzeln hervor.', en: 'The Barkfather! Watch the ground – where it cracks, roots burst out.' },
    ausloeser: { art: 'ereignis', ereignis: 'bossAwakened', wo: { boss: 'borkenvater' } },
    prioritaet: 3,
    einmalig: true,
  },
  {
    id: 'funke_boss_knoten',
    kanal: 'funke',
    text: { de: 'Die Borke ist zu hart! Triff die glühenden Knoten an seinen Wurzeln!', en: 'The bark is too hard! Strike the glowing knots on his roots!' },
    ausloeser: { art: 'ereignis', ereignis: 'bossPhaseChanged', wo: { boss: 'borkenvater', phase: 1 } },
    prioritaet: 3,
    einmalig: true,
  },
  {
    id: 'funke_boss_raserei',
    kanal: 'funke',
    text: { de: 'Er rast! Feuer trifft ihn jetzt doppelt – doch die Arena brennt mit.', en: 'He rages! Fire hurts him twice over now – but the arena burns too.' },
    ausloeser: { art: 'ereignis', ereignis: 'bossPhaseChanged', wo: { boss: 'borkenvater', phase: 2 } },
    prioritaet: 3,
    einmalig: true,
  },
  {
    id: 'funke_leuchtfeuer_bereit',
    kanal: 'funke',
    text: { de: 'Der Wächter ist gefallen. Geh zum Leuchtfeuer und entzünde es!', en: 'The warden has fallen. Go to the beacon and light it!' },
    ausloeser: { art: 'ereignis', ereignis: 'bossDefeated', wo: { boss: 'borkenvater' } },
    prioritaet: 2,
    einmalig: true,
  },
  {
    id: 'funke_leuchtfeuer_entzuendet',
    kanal: 'funke',
    text: { de: 'Es brennt wieder! Spürst du, wie das Land aufatmet? Es lehrt uns Neues.', en: 'It burns again! Can you feel the land breathe? It teaches us new things.' },
    ausloeser: { art: 'ereignis', ereignis: 'beaconLit' },
    prioritaet: 2,
    einmalig: true,
  },
  {
    id: 'funke_erleuchtet',
    kanal: 'funke',
    text: { de: 'Im Licht des Leuchtfeuers wagt sich keine Schattenbrut heran.', en: 'No shadowspawn dares to come into the beacon’s light.' },
    ausloeser: { art: 'zustand', zustand: 'erleuchtet' },
    prioritaet: 1,
    einmalig: true,
  },
  {
    id: 'hinweis_herzsplitter',
    kanal: 'hinweis',
    text: { de: 'Herzsplitter: Benutze ihn – dein Leben steigt dauerhaft um 10.', en: 'Heart shard: use it – your health rises by 10 for good.' },
    ausloeser: { art: 'besitz', item: 'herzsplitter', anzahl: 1 },
    prioritaet: 1,
    einmalig: true,
  },
  {
    id: 'hinweis_lumen_laterne',
    kanal: 'hinweis',
    text: { de: 'Lumen-Laterne: in die Nebenhand, Lumen-Scherben laden sie. Ihr Licht brennt Schattenbrut.', en: 'Lumen lantern: off hand, Lumen shards charge it. Its light burns shadowspawn.' },
    ausloeser: { art: 'besitz', item: 'lumen_laterne', anzahl: 1 },
    prioritaet: 1,
    einmalig: true,
  },
  {
    id: 'hinweis_schnellreise',
    kanal: 'hinweis',
    text: { de: 'E an Leuchtfeuer, Herdfeuer oder Wegstein öffnet die Reise – sie kostet Lumen-Scherben.', en: 'E at a beacon, hearth fire or waystone opens travel – it costs Lumen shards.' },
    ausloeser: { art: 'freischaltung', freischaltung: 'lf1_wegsteine' },
    prioritaet: 1,
    einmalig: true,
  },
];
