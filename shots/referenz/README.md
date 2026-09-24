# shots/referenz – freigegebene Referenzbilder (MASTERPROMPT §31.5)

Geprüfte Screenshots aus `shots/latest/` (gitignored) werden nach der Bewertung hierher übernommen; UI-Screens werden per Pixel-Diff dagegen verglichen.

Erzeugt mit `npm run shot -- <szenario>` (Chromium headless, WebGL2 über SwiftShader, 1920×1080 bei DPR 1, Screenshot-Modus, eingefrorene Zeit). Sprache der Texte: die des Browsers (en-US).

## M1 (freigegeben 2026-09-23)

| Bild | Szenario | Geprüft |
|---|---|---|
| `aufloesungen-1920x1080.png` · `-2560x1440` · `-3440x1440` · `-3840x2160` | `aufloesungen` | Grünhain-Lichtung (Bild hinter der Titelkarte) bei den vier Beispielen aus §4.2: intern 480/480/640/480 × 270; `npm run shot` und `render-aufloesungen.spec.ts` prüfen jedes interne Pixel als einfarbigen Block (×4 und ×8 vollständig, ×5,33 ohne Randpixel), schwarze Seitenbalken bei 3440×1440. Warme Fackelinseln in kühler Nacht (M1-26), Normal-Mapping an Figur und Felsen, geditherte Bandsäume. |
| `normalmap.png` | `normalmap` | Nachtlichtung: wandernde Laterne, Fackel, Lumenit-Glühen; Lichtseite der Felsen und Figuren hell, Schattenseite im Blau der Nacht; Licht je internem Pixel, kein Verschmieren. Seit M1-26: Gras im Feuerschein bernstein bis golden, Weg orange, Dunkel blau-violett, Lumenit türkis. |
| `post-grundlage.png` | `post-grundlage` | Blaue Stunde: HDR über 1 an der Tonemapping-Schulter (Fels und Gras im Herz des Feuers hellgolden bis weiß), Outline der Figur nach Post, Kamera auf Subpixel-Position. |
| `palette.png` | `palette` | Dieselben Spielatlas-Sprites und Bodenkacheln in den Palettenzeilen Sommer, Herbst, Winter, Verderbnis; Beschriftung als Welt-UI. |
| `palette-swap.png` | `palette-swap` | Szenenatlas: Baum in vier Laubzeilen, Figur in vier Trachten; nur Palettenfarben (E2E). |
| `welt-ui.png` | `welt-ui` | Namen, Lebens-/Ausdauerleisten, Heil- und Schadenszahlen, Interaktionsmarker mit Tastenkappe über der umrandeten Fackel, Äxte in Raritätsfarben; pixelscharf, nachts unverändert in UI-/Palettenfarben. |
| `tilemap.png` | `tilemap` | Vier Chunks treffen sich in der Bildmitte, Weg über die Chunkgrenze, keine Nähte. Volles Tageslicht: jedes Pixel ist seine Palettenfarbe (`render-lichtfarbe.spec.ts`: Endbild = Albedo). |
| `ysort.png` | `ysort` | Figur hinter dem Baum von Stamm und Krone verdeckt, davor überlappend; Durchblick-Kreis unter der Krone. |
| `anim-layers.png` | `anim-layers` | Helm, Schwert, Fackel an den Sockeln jedes Frames in vier Richtungen; Waffe hinter dem Körper von hinten. |
| `gbuffer-albedo.png` · `gbuffer-normal.png` · `gbuffer-emissiv.png` | `gbuffer-*` | G-Buffer-Anhänge einzeln im Render-Debugger. |
| `schrift.png` | `schrift` | Pixelschrift im DOM und per WebGL-Glyphenatlas bei 4×/2×/1×; seit M1-27 Fusion Pixel 10 px mit der Ergänzungsschrift „DH Satzzeichen“, DOM und WebGL pixelgleich (ADR-0013, ADR-0016). |
| `ui-kit.png` | `ui-kit` | Holz, Eisen, Pergament, Slots, Schaltflächen in allen Zuständen, Leisten, Pixel-Scrollbar bei 1×–4×. |

## M1-26 Lichtfarbe (freigegeben 2026-09-24)

`normalmap`, `post-grundlage`, `aufloesungen-*`, `welt-ui` und `tilemap` neu aufgenommen (Lichtmodell ADR-0018; der Stand der Kacheln ist der Arbeitsstand von M1-29 mit den neuen Grasvarianten).

| Bild | Szenario | Geprüft |
|---|---|---|
| `gruenhain.png` | `gruenhain` | Titelbild bei Einbruch der Nacht: zwei Fackelinseln, Gras im Kern golden (Rot > Grün), zum Rand bernstein und braun, der Weg orange; außerhalb blau-violettes Mondlicht (Blau > Rot, Grün), Felsen im Dunkel violett, Kronen dunkelblau. Pixelprobe in `render-lichtfarbe.spec.ts`. |

## M1-Gate (freigegeben 2026-09-24)

Nach der Integration von M1-26…M1-33 (ADR-0019) neu aufgenommen: `gruenhain`, `normalmap`, `post-grundlage`, `aufloesungen-*` und `welt-ui` mit der stehenden Fackel (Licht im Flammenkern 19 px über dem Fuß, Pools auf die Bandstufen der M1-26-Freigabe ausgeglichen), `tilemap` mit den Grasgewichten 3 : 3 : 3 : 1, `schrift`, `ui-kit` und `palette` mit Fusion Pixel 10 px und der UI-Fase (M1-32). `palette-swap` ist unverändert.

| Bild | Szenario | Geprüft |
|---|---|---|
| `gruenhain.png` | `gruenhain` | Zwei stehende Fackeln (Pfahl zwischen Keilsteinen, Flamme über Kopfhöhe der Figur); Gras im Kern golden (138/112/40, Rot > Grün), Weg orange, außerhalb blau-violettes Mondlicht. |
| `welt-ui.png` | `welt-ui` | Marker mit Tastenkappe E und Aktionstext („Take torch“, en-US) über der Flammenspitze der umrandeten Fackel, frei von der Siedlerin; Namen, Leisten und Zahlen in Fusion Pixel pixelscharf. |
| `aufloesungen-*.png` | `aufloesungen` | Alle vier Beispiele aus §4.2 scharf: 1920×1080 und 3840×2160 ganzzahlig (×4, ×8), 2560×1440 und 3440×1440 ×5,33 mit 129 600/129 600 bzw. 172 800/172 800 einfarbigen Blöcken, keine hellen Balkenpixel. |
| `schrift.png` | `schrift` | 203 Glyphen, 0 unklare Abtastungen, 0 abgeschnitten, 0 fehlend; 5/S, 0/O, 1/l/I unterscheidbar; „Welt“ und Funke’s ohne Geviertlücken. |
| `ui-kit.png` | `ui-kit` | Knöpfe und Slots mit Fase und Glanzkante bei 1×–4×, gedrückt umgekehrt, gesperrt entsättigt, gedehnte Knöpfe ohne Nähte. |

## M2-28 Welt-Darstellung (freigegeben 2026-09-24)

Generierte Welt (Seed 20260924, Klein) im Renderer: Chunks aus dem Welt-Worker, Autotiles nach der Übergangsregel, Klippen 16 px je Stufe mit AO am Fuß, Wasser mit Uferbank und Tiefenstufen, y-sortierte Objekte, Blätterdach-Durchblick um die Figur (ADR-0025). Schauplatz aus dem Weltplan (`src/render/world/showcase.ts`); jede Generatoränderung verschiebt ihn.

| Bild | Szenario | Geprüft |
|---|---|---|
| `gruenhain-tag.png` | `gruenhain-tag` | Grünhain im Sommer bei Tag: Laubwald (Eiche, Buche, Birke, Weide, Kiefer) über Gras mit Erdflecken, getreppte Steinklippe mit Rand und geditherter Verschattung am Fuß, Fluss mit türkiser Uferbank, dunkleren Tiefenstufen und einem kleinen Wasserfall über die Klippe; Krone vor der Figur nur um den Kopf ausgedithert. Keine Nähte an den Chunkgrenzen, Palettenfarben wie gemalt. |
| `frostkamm-tag.png` | `frostkamm-tag` | Frostkamm im Winter: Schnee mit Gletschereisfeldern, Steinklippen mit Schneekante und blauem Schatten am Fuß, Treppe, Fluss mit Wasserfall über die Kante, verschneite Tannen und Kiefern, Eiskristalle – kalt-weiß mit blauen Schatten (docs/ART.md §5). |
| `glutsand-tag.png` | `glutsand-tag` | Glutsand: Sand mit Hartbodenflecken, Sandsteinklippen in Stufen, Plateauseiten mit Rand und Schattenband auf der tieferen Seite, Kakteen, Dattelpalme, Baumwollbüsche, Felsen – warmgelb, sparsam bewachsen. |
| `ebene-1-roh.png` | `ebene-1-roh` | Ebene −1 (Wurzelhöhlen), Pilzhain: Umgebungslicht ≈ 0, vier stehende Fackeln (eine neben der Figur, eine an einer Felsfront), türkis leuchtende Leuchtpilze, Fels als dunkle Masse mit beleuchteter Front. Neu aufgenommen nach M2-29 (ADR-0026): die Wurzelboden-Varianten tragen ihre Wurzeln in verschiedenen Vierteln, die häufigste ist nackte Erde – kein 16-px-Raster mehr; Lehmnester als ockerne Mulden. |

## M2-29 Spielansicht und Debug-Overlays (freigegeben 2026-09-24)

Die Spielansicht `spiel` auf der Welt der Sitzung (Seed 20260923, Mittel; im Welt-Worker erzeugt, gestreamt aus dem Chunk-Store der Simulation, ADR-0026). Frühling, Tag 1, 06:00 (volles Tageslicht). Die Overlay-Szenarien setzen eine Figur ins Schaufenster eines Bioms (gespawnt mit genau einem Simulationsschritt: die Aktive Zone steht).

| Bild | Szenario | Geprüft |
|---|---|---|
| `spiel-titel.png` | `spiel-titel` | Titelbild: Startstrand, Kamera zum nächsten offenen Meer versetzt – Brandung mit türkiser Uferbank links unten, Sand mit Rippeln, Kiefern, Strandhafer, Muscheln und Treibholz. Palettenrein, keine Nähte. Neu aufgenommen im M2-Gate (M2-31, ADR-0027): hinter dem Strand Dünengras als eigener Boden – blaugrüne Büschel auf Sand, keine blauen Linien mehr; Strandhafer blaugrün statt Marineblau. |
| `overlay-chunks.png` | `overlay-chunks` | Grünhain-Schaufenster mit Figur: Chunkgrenzen als 1-px-Linien im Grün der aktiven Zone, Koordinaten `cx:cy` in der sichtbaren Ecke jedes der vier Chunks, schwache Tönung; Welt darunter lesbar. |
| `overlay-kollision.png` | `overlay-kollision` | Klippenwände violett (genau die Wandkacheln unter der Kante), Baumstämme und Felsen holzfarben mit ihrem Fußabdruck, tiefes Wasser blau (die flache Uferbank bleibt frei), Rampen als grüne Marken. |
| `overlay-temperatur.png` | `overlay-temperatur` | Frostkamm-Schaufenster im Frühling um 06:00: −26 °C auf der tieferen, −29 °C auf der höheren Stufe (−3 °C je Stufe), im 5-°C-Band −30 … −25 blau getönt, Werte alle acht Kacheln lesbar umrandet. |

## M2-15 Weltkarten und M2-Gate (freigegeben 2026-09-24)

`npm run shot -- weltkarte-klein weltkarte-mittel weltkarte-gross`: in Node aus demselben Generator wie das Spiel gezeichnet (Seed 20260924, jeder Chunk der Oberfläche; ohne Zeitangaben im Kopf, zwei Läufe bytegleich; ADR-0027).

| Bild | Szenario | Geprüft |
|---|---|---|
| `weltkarte-klein.png` | `weltkarte-klein` | 1024², ≈ 40 Regionen, 84 Orte, 10 Höhleneingänge: Salzküsten-Ring um die ganze Hauptinsel, Grünhain im Süden mit Startstrand an der Südküste, Frostkamm im Nordwesten, Glutsand im Südosten, Aschenschlund an Frostkamm und Glutsand, Nachtherz im Nordosten im Scherbenhain-Ring; Flüsse, Seen, Lava; Erbauer-Straßen verbinden Leuchtfeuer 1–6 und das Nachtherz, Arenen als Ringe; alle Ortstypen; Untergrund −1/−2/−3 mit Eingängen und Schächten. Keine Probleme. |
| `weltkarte-mittel.png` | `weltkarte-mittel` | 1536², ≈ 70 Regionen, 118 Orte, 16 Höhleneingänge: dieselben Regeln, Frostkamm als Band nördlich des Grünhains, Nebelmoor im Westen fern vom Glutsand im Osten, vorgelagerte Insel im Süden. Keine Probleme. |
| `weltkarte-gross.png` | `weltkarte-gross` | 2048², ≈ 110 Regionen, 155 Orte, 24 Höhleneingänge: Frostkamm mehrfach (im Norden und als hohe Gipfel im Glutsand, §9.2 „Norden bzw. hoch“), Nachtherz im Nordosten im Scherbenhain-Ring, Straßennetz über die ganze Insel. Keine Probleme. |


## M3 Spieler & Überleben – Screenshot-Set M3-37 (freigegeben 2026-09-24)

`npm run shot -- hud-voll hud-kontextuell hud-minimal ui-inventar todesbildschirm nacht-fackel schwimmen sammeln-feedback zustand-frierend zustand-brennen ui-pause ui-pause-einstellungen hud-minimap hud-meldungen licht-abgleich debug-inspektor`: die Spielansicht auf der Welt der Sitzung (Seed 20260923, Mittel), Zustände nur über Game-Commands hergestellt, zwei Läufe pixelgleich. Geprüft nach §4 (Lesbarkeit, Palette, Stimmung, Licht) und §26 (Ausrichtung, Texte mit Lösung); Mängel beim Ansehen wurden behoben, bevor die Bilder hierher kamen (ADR-0034).

| Bild | Szenario | Geprüft |
|---|---|---|
| `hud-voll.png` | `hud-voll` | Kalter Regenmorgen am Startstrand (09:11): vier Leisten mit Symbolen (Leben ≈ 30 rot), Thermometer mit fallendem Kern und Trendpfeil an der Flüssigkeitsoberfläche, Furcht-Auge (Flüstern), fünf Zustände mit Timern und Stapel ×3, Schnellleiste mit Auswahl, kleine Ziffern, Fackel mit Flammenleiste in der Nebenhand, Gürtel mit Q; Hinweis „E Pick up: Flint ×2“ nur unten, über der Figur nur die Tastenkappe (über dem Kopf, sie verdeckt nichts); Minimap mit Himmelsscheibe (Morgensonne), Wetter, Tag und Jahreszeit. Alles 2 px vom Rand, ganzzahlig ×4. |
| `hud-kontextuell.png` | `hud-kontextuell` | Derselbe Zustand: nur Leben (unter dem Maximum) und das Thermometer (Kern fällt, gefühlt unter dem Wohlfühlband); volle Ausdauer, Sättigung und Durst ausgeblendet. |
| `hud-minimal.png` | `hud-minimal` | Nur Warnungen: Leben im Gefahrenbereich, Furcht-Auge, schädliche Zustände; keine Schnellleiste, keine Minimap, kein Hinweis – dafür trägt der Marker über dem Kopf den ganzen Text. |
| `ui-inventar.png` | `ui-inventar` | Ausrüstung mit Figur (Leinenkleidung) und leeren Platz-Silhouetten, Gürtel, Rucksack-Platz; 30 Plätze, Schnellleiste, Sortieren; Werte-Tafel; Fokusrahmen auf den Himbeeren, Tooltip mit Rarität, Nährwerten, Frische, Haltbarkeit, Herkunft und Verwendung – groß, deckt nur Tafeln, die der Fokus gerade nicht braucht. |
| `todesbildschirm.png` | `todesbildschirm` | „Your light has gone out.“ über erloschener Kerze, Ursache Kälte, Folgen auf Pergament (Aufzählungspunkte mit 3 px Luft), Wahl Bett (Fokus) oder Strand; die Welt dahinter abgedunkelt. |
| `nacht-fackel.png` | `nacht-fackel` | 22:00, Startstrand: warme Lichtinseln in kühler Dunkelheit – Lagerfeuer mit Steinkranz, Fackel am Pfahl, Fackel in der Nebenhand; Bänderung mit Bayer-Säumen; Marker „E Add fuel: Campfire“ über dem Kopf der Figur statt über ihren Beinen; die weggeworfene Steinaxt liegt ≈ 11 Kacheln rechts im Dunkeln und glitzert (M3-39). |
| `schwimmen.png` | `schwimmen` | Grünhain-See um 10:00: die Figur im ersten tiefen Wasser vor dem Ufer, nur Kopf und Schultern, Wellenring, türkise Flachwasserbank, Klippe mit Wasserfall oben; zum Betrachter gewandt, „E Drink: Fresh water“ über dem Kopf. |
| `sammeln-feedback.png` | `sammeln-feedback` | Mit fünf Axthieben gefällter Baum: der Stamm liegt vom Spieler weg (Osten), Scheite, Zweige, Rinde und Blätter fliegen auf ihren Bögen, Staub steigt; über dem Stumpf (Umriss) steht der Fortschrittsring halb nach dem ersten Rodungshieb, Späne fliegen. Tageslicht am Strand, Figur mit erhobener Steinaxt. |
| `zustand-frierend.png` | `zustand-frierend` | Frostkamm, Schnee und Gletschereis bei Tag: Figur kältebleich, Zitterstriche beidseits, Atemwölkchen in Blickrichtung. |
| `zustand-brennen.png` | `zustand-brennen` | Startstrand in der Abenddämmerung: emissive Flammenzungen an Kopf und Rumpf, leuchtend ohne die Umgebung zu beleuchten. |
| `ui-pause.png` | `ui-pause` | Holztafel mittig, vier Einträge, Fokusrahmen auf „Continue“, Tastenhinweis darunter. |
| `ui-pause-einstellungen.png` | `ui-pause-einstellungen` | Tafel 248 px: Pfeile in jeder Zeile an derselben Stelle, auch bei „Automatic“ (in Deutsch „Automatisch“, „Umschalten“ gemessen), Fokus innen auf „Game speed“, Beschreibung auf Pergament. |
| `hud-minimap.png` | `hud-minimap` | Runde Minimap aus den Chunkdaten, Eisenring mit Tageszeit-Scheibe, Spielerpfeil, Startstrand- und Grab-Marker, Zoom-Knöpfe, Schild mit Wetter, Tag und Jahreszeit; Kompassbalken mit Markern. |
| `hud-meldungen.png` | `hud-meldungen` | Unten links gestapelt: Entdeckung (Goldstreifen), „Darkness is coming …“ (Warnung, rot), „Flint ×3“, „Glowcap ×2“ in Raritätsfarbe; nie mehr als vier. |
| `licht-abgleich.png` | `licht-abgleich` | Das Lager im Render-Debugger `lightmap-quellen`: Gameplay- und Render-Licht decken sich (gelb), keine blaue Abweichung > 0,05; Sprites violett (nicht vergleichbar). |
| `debug-inspektor.png` | `debug-inspektor` | Entitäts-Inspektor rechts: Komponenten `position`, `player`, `vitals` mit Live-Werten; Debug-Schrift klein, aber scharf. |

Neu aufgenommen (M3): `spiel-titel` – Dünengras-Horste über Kachelgrenzen, kein 16-px-Raster (M3-40); `welt-ui`, `normalmap`, `palette`, `post-grundlage` – einziger Unterschied zur vorigen Referenz ist der Körper der Figur in der Leinenkleidung des Starts (Pixel-Diff 0,01–0,06 %, nur die Figuren). Alle übrigen Referenzen (Welt-Szenen, Overlays, Weltkarten, `aufloesungen-*`, `gruenhain`, M1-Galerien) sind pixelgleich neu gerendert worden.

M3-Gate (2026-09-24, ADR-0035): das Set und `spiel-titel`, `welt-ui` nach den Gate-Korrekturen neu aufgenommen – pixelgleich zu diesen Referenzen; die HUD-Bilder im Gate erneut geöffnet und bestanden.
