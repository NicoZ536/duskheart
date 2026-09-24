# CREDITS – DUSKHEARTH

Hier steht nur, was das Spiel tatsächlich verwendet und ausliefert.

## Grafik
- Alle Sprites (`assets-src/sprites/**`), die Master-Palette und die Palettenzeilen sind eigens für DUSKHEARTH gezeichnet bzw. entworfen. Sie enthalten keine Fremdgrafiken, keine Vorlagen und keine nachgezeichneten Motive. Stilrichtlinien stehen in docs/ART.md.
- Die UI-Grafik (`assets-src/ui/**`: Holz-, Eisen- und Pergamentrahmen, Slots, Schaltflächen, Leisten, Scrollbar) ist ebenso eigens gezeichnet und nutzt nur Farben der Master-Palette.

## Schrift
| Schrift | Urheber | Lizenz | Paket | Version | Verwendung |
|---|---|---|---|---|---|
| Fusion Pixel 10px Proportional SC (Schnitt 400, Teilmenge latin) | TakWolf (https://takwolf.com), Quelle https://github.com/TakWolf/fusion-pixel-font | OFL-1.1 (SIL Open Font License 1.1, reservierter Schriftname „Fusion Pixel“; Text im Paket unter `LICENSE`) | @fontsource/fusion-pixel-10px-proportional-sc | 5.3.0 | DOM-Overlay (CSS-Schrift) und WebGL-Text (zur Laufzeit per Canvas2D in einen Glyphenatlas gebacken, `src/render/text`), native Größe 10 px |
| DH Satzzeichen (lateinische Anführungszeichen ‘ ’ “ ”, Apostroph, Mittelpunkt ·, Auslassungspunkte …, Aufzählungspunkt •) | DUSKHEARTH, eigens gezeichnet (`assets-src/schrift/satzzeichen.ts`) | wie die übrigen eigenen Grafiken dieses Spiels | – | – | Ergänzung der Pixelschrift: `npm run assets` baut daraus eine TrueType-Schrift und bettet sie in `src/generated/ui-kit.css` ein (`unicode-range`, vor Fusion Pixel in der Schriftliste), ADR-0016 |

Fusion Pixel wird unverändert ausgeliefert (die WOFF2-Datei des Pakets); der Glyphenatlas entsteht erst im Browser und wird nicht als eigene Schriftdatei weitergegeben. „DH Satzzeichen“ enthält keine Glyphen aus Fusion Pixel und trägt dessen reservierten Namen nicht.

## Software im ausgelieferten Build
| Paket | Version | Lizenz | Urheber |
|---|---|---|---|
| preact | 10.29.8 | MIT | Jason Miller |
| @preact/signals, @preact/signals-core | 2.11.2 / 1.14.4 | MIT | Preact Team |
| zod | 4.6.5 | MIT | Colin McDonnell |
| Workbox (core, precaching, routing, strategies; Service Worker der PWA) | 7.4 | MIT | Google LLC |
