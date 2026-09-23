# CREDITS – DUSKHEARTH

Hier steht nur, was das Spiel tatsächlich verwendet und ausliefert.

## Grafik
- Alle Sprites (`assets-src/sprites/**`), die Master-Palette und die Palettenzeilen sind eigens für DUSKHEARTH gezeichnet bzw. entworfen. Sie enthalten keine Fremdgrafiken, keine Vorlagen und keine nachgezeichneten Motive. Stilrichtlinien stehen in docs/ART.md.
- Die UI-Grafik (`assets-src/ui/**`: Holz-, Eisen- und Pergamentrahmen, Slots, Schaltflächen, Leisten, Scrollbar) ist ebenso eigens gezeichnet und nutzt nur Farben der Master-Palette.

## Schrift
| Schrift | Urheber | Lizenz | Paket | Version | Verwendung |
|---|---|---|---|---|---|
| Pixelify Sans (Schnitt 400, Teilmengen latin + latin-ext) | The Pixelify Sans Project Authors (https://github.com/eifetx/Pixelify-Sans) | OFL-1.1 (SIL Open Font License 1.1, Text im Paket unter `LICENSE`) | @fontsource/pixelify-sans | 5.2.7 | DOM-Overlay (CSS-Schrift) und WebGL-Text (zur Laufzeit per Canvas2D in einen Glyphenatlas gebacken, `src/render/text`) |

Die Schrift wird unverändert ausgeliefert; der Glyphenatlas entsteht erst im Browser und wird nicht als eigene Schriftdatei weitergegeben.

## Software im ausgelieferten Build
| Paket | Version | Lizenz | Urheber |
|---|---|---|---|
| preact | 10.29.8 | MIT | Jason Miller |
| @preact/signals, @preact/signals-core | 2.11.2 / 1.14.4 | MIT | Preact Team |
| zod | 4.6.5 | MIT | Colin McDonnell |
| Workbox (core, precaching, routing, strategies; Service Worker der PWA) | 7.4 | MIT | Google LLC |
