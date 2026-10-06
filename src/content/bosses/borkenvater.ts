/**
 * The Borkenvater (MASTERPROMPT §20.2 no. 1 "verdorbener Uraltbaum. Wurzelstöße in Linien (telegraphierte Bodenrisse),
 * beschworene Zweiglinge. Phase 2: Borkenpanzer – nur glühende Knoten verwundbar, Blättersturm senkt die Sicht. Phase 3:
 * Raserei; Feuer richtet doppelten Schaden an, die Arena brennt teilweise. Drop: Kernholz."; docs/SPIEL.md §22; M7-33, M7-34).
 *
 * **Balance on Normal** (§D; tests/unit/game/boss-framework.test.ts checks the limits):
 * - 1 600 HP behind bark armour 8 (R / (R + 50) ≈ 14 %): a bronze sword (12 cut) lands ≈ 10,3 – about 155 hits of a tier-1
 *   one-hander (§D "Bosse 120–200 Treffer-Äquivalente", "Kampfdauer 3–6 min" with the windows between its attacks and the
 *   armoured phase). Fire eats the dry bark (−0,25), in its rage twice (−1, §20.2 "Feuer richtet doppelten Schaden an").
 * - Its blows against tier-1 armour (bronze, R 12: × 50/62 ≈ 0,81) of the player's 100 HP: root thrust 34 → 27 %, root ring
 *   30 → 24 % (§D "schwere telegraphierte Attacke 20–30 %"), the rage's thrust 42 → 34 % and root fist 50 → 40 % (§D
 *   "Boss-Spezial 30–45 %"); nothing above `BALANCE.bosses.maxHitShare` (45 %) – no one-shot. Every attack telegraphs
 *   ≥ 0,7 s (the minimum is 0,4 s), the lines and the fist mark the ground (§4.6).
 * - Phase 2 (66 %): the bark closes, only three glowing knots at its roots take damage (`schwachstellen`); a leaf storm
 *   lowers the sight for 8 s. Phase 3 (33 %): rage – faster (tempo 1,35), fire ×2, a ring of the arena burns for 12 s.
 * - Loot: Kernholz (unique, the T1 pickaxe), its crown (trophy), the heart shard, 3–5 bark resin, 4–6 Lumen shards.
 */
import type { BossInput } from './schema';

/** Root thrust: lines of cracks from the trunk towards the player, then roots burst up along them. */
const wurzelstoss = (id: string, anzahl: number, winkelGrad: number, schaden: number, telegraphSekunden: number) =>
  ({ id, art: 'flaeche', form: 'linie', schaden, schadensart: 'wucht', telegraphSekunden, reichweitePx: 176, breitePx: 20, winkelGrad, anzahl, gewicht: 3, abklingSekunden: 2.5, clip: 'wurzelstoss' }) as const;

/** The Borkenvater of Grünhain. */
export const BORKENVATER: BossInput = {
  id: 'borkenvater',
  name: { de: 'Borkenvater', en: 'Barkfather' },
  titel: { de: 'Der Borkenvater', en: 'The Barkfather' },
  beschreibung: {
    de: 'Ein Uraltbaum, dessen Herz die Nacht vergiftet hat. Er hütet die erloschene Flamme des Grünhains und reißt jeden mit seinen Wurzeln zu Boden, der sich ihr nähert.',
    en: 'An ancient tree whose heart the night has poisoned. It guards the dead flame of the Greenwood and drags down with its roots anyone who comes near it.',
  },
  biom: 'gruenhain',
  arena: 'bossarena_gruenhain_01',
  zugang: { art: 'betreten' },
  leben: 1600,
  ruestung: 8,
  // Bark and heartwood: blades bite less, a blunt blow cracks it, fire eats the dry bark; the night's poison is in it.
  resistenzen: { hieb: 0.1, stich: 0.2, wucht: -0.1, feuer: -0.25, frost: 0.2, gift: 0.5, licht: -0.2, schatten: 0.5 },
  radiusPx: 24,
  sprite: 'boss_borkenvater',
  musik: 'borkenvater',
  phasen: [
    {
      id: 'erwachen',
      abLebensanteil: 1,
      verwundbar: 'koerper',
      tempo: 1,
      uebergangSekunden: 0,
      angriffe: [
        wurzelstoss('wurzelstoss', 3, 50, 34, 0.9),
        // Roots stamp up all around the trunk: punishes standing close.
        { id: 'wurzelring', art: 'flaeche', form: 'ring', schaden: 30, schadensart: 'wucht', telegraphSekunden: 0.8, reichweitePx: 72, breitePx: 40, gewicht: 2, abklingSekunden: 5, clip: 'stampfen' },
        { id: 'zweiglinge', art: 'beschwoerung', kreatur: 'zweigling', anzahl: 2, maxGleichzeitig: 4, gewicht: 1, abklingSekunden: 14, clip: 'beschwoeren' },
      ],
    },
    {
      id: 'borkenpanzer',
      abLebensanteil: 0.66,
      verwundbar: 'schwachstellen',
      // Three glowing knots on the roots around the trunk [px from the trunk's foot]: south-west, east, south.
      schwachstellen: [
        { id: 'knoten_west', dx: -26, dy: 6, radiusPx: 9 },
        { id: 'knoten_ost', dx: 26, dy: 4, radiusPx: 9 },
        { id: 'knoten_sued', dx: 2, dy: 24, radiusPx: 9 },
      ],
      tempo: 1.15,
      uebergangSekunden: 2,
      angriffe: [
        wurzelstoss('wurzelstoss', 5, 80, 34, 0.8),
        { id: 'blaettersturm', art: 'arena', effekt: 'blaettersturm', sekunden: 8, gewicht: 1, abklingSekunden: 16, clip: 'blaettersturm' },
        { id: 'zweiglinge', art: 'beschwoerung', kreatur: 'zweigling', anzahl: 3, maxGleichzeitig: 5, gewicht: 1, abklingSekunden: 14, clip: 'beschwoeren' },
        { id: 'wurzelring', art: 'flaeche', form: 'ring', schaden: 30, schadensart: 'wucht', telegraphSekunden: 0.8, reichweitePx: 72, breitePx: 40, gewicht: 1, abklingSekunden: 6, clip: 'stampfen' },
      ],
    },
    {
      id: 'raserei',
      abLebensanteil: 0.33,
      verwundbar: 'koerper',
      tempo: 1.35,
      uebergangSekunden: 2,
      // Rage: the bark cracks open and dries out – fire burns it twice as hard (§20.2).
      resistenzen: { feuer: -1 },
      angriffe: [
        wurzelstoss('wurzelstoss', 5, 90, 42, 0.7),
        // A fist of roots bursts up under the player.
        { id: 'wurzelfaust', art: 'flaeche', form: 'kreis', schaden: 50, schadensart: 'wucht', telegraphSekunden: 0.8, reichweitePx: 168, breitePx: 56, gewicht: 2, abklingSekunden: 4, clip: 'wurzelstoss', wucht: 5 },
        { id: 'arena_brennt', art: 'arena', effekt: 'arena_brennt', sekunden: 12, gewicht: 1, abklingSekunden: 20, clip: 'raserei' },
        { id: 'zweiglinge', art: 'beschwoerung', kreatur: 'zweigling', anzahl: 2, maxGleichzeitig: 4, gewicht: 1, abklingSekunden: 16, clip: 'beschwoeren' },
      ],
    },
  ],
  beute: {
    einzigartig: ['kernholz'],
    trophaee: 'trophaee_borkenvater',
    herzsplitter: 'herzsplitter',
    weitere: [
      { item: 'borkenharz', anzahl: [3, 5] },
      { item: 'lumen_scherbe', anzahl: [4, 6] },
    ],
  },
};
