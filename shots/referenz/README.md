# shots/referenz – freigegebene Referenzbilder (MASTERPROMPT §31.5)

Geprüfte Screenshots aus `shots/latest/` (gitignored) werden nach der Bewertung hierher übernommen; UI-Screens werden per Pixel-Diff dagegen verglichen.

Erzeugt mit `npm run shot -- <szenario>` (Chromium headless, WebGL2 über SwiftShader, 1920×1080 bei DPR 1, Screenshot-Modus, eingefrorene Zeit). Sprache der Texte: die des Browsers (en-US).

## M1 (freigegeben 2026-09-23)

| Bild | Szenario | Geprüft |
|---|---|---|
| `aufloesungen-1920x1080.png` · `-2560x1440` · `-3440x1440` · `-3840x2160` | `aufloesungen` | Grünhain-Lichtung (Bild hinter der Titelkarte) bei den vier Beispielen aus §4.2: intern 480/480/640/480 × 270; `npm run shot` und `render-aufloesungen.spec.ts` prüfen jedes interne Pixel als einfarbigen Block (×4 und ×8 vollständig, ×5,33 ohne Randpixel), schwarze Seitenbalken bei 3440×1440. Warme Fackelinseln in kühler Dämmerung, Normal-Mapping an Figur und Felsen, geditherte Bandsäume. |
| `normalmap.png` | `normalmap` | Nachtlichtung: wanderndes Warmlicht, Fackel, Lumenit-Glühen; Lichtseite der Felsen und Figuren hell, Schattenseite im Blau der Nacht; Licht je internem Pixel, kein Verschmieren. |
| `post-grundlage.png` | `post-grundlage` | HDR über 1 an der Tonemapping-Schulter (Fels und Gras brennen zu Weiß), Outline der Figur nach Post, Kamera auf Subpixel-Position. |
| `palette.png` | `palette` | Dieselben Spielatlas-Sprites und Bodenkacheln in den Palettenzeilen Sommer, Herbst, Winter, Verderbnis; Beschriftung als Welt-UI. |
| `palette-swap.png` | `palette-swap` | Szenenatlas: Baum in vier Laubzeilen, Figur in vier Trachten; nur Palettenfarben (E2E). |
| `welt-ui.png` | `welt-ui` | Namen, Lebens-/Ausdauerleisten, Heil- und Schadenszahlen, Interaktionsmarker mit Tastenkappe über der umrandeten Fackel, Äxte in Raritätsfarben; pixelscharf, nachts unverändert in UI-/Palettenfarben. |
| `tilemap.png` | `tilemap` | Vier Chunks treffen sich in der Bildmitte, Weg über die Chunkgrenze, keine Nähte. |
| `ysort.png` | `ysort` | Figur hinter dem Baum von Stamm und Krone verdeckt, davor überlappend; Durchblick-Kreis unter der Krone. |
| `anim-layers.png` | `anim-layers` | Helm, Schwert, Fackel an den Sockeln jedes Frames in vier Richtungen; Waffe hinter dem Körper von hinten. |
| `gbuffer-albedo.png` · `gbuffer-normal.png` · `gbuffer-emissiv.png` | `gbuffer-*` | G-Buffer-Anhänge einzeln im Render-Debugger. |
| `schrift.png` | `schrift` | Pixelschrift im DOM und per WebGL-Glyphenatlas bei 4×/2×/1×; WebGL pixelgenau, DOM mit bekannter Randglättung von Pixelify Sans (ADR-0013). |
| `ui-kit.png` | `ui-kit` | Holz, Eisen, Pergament, Slots, Schaltflächen in allen Zuständen, Leisten, Pixel-Scrollbar bei 1×–4×. |
