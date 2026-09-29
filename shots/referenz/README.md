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

## M4 Crafting & Bau I – Screenshot-Set (freigegeben 2026-09-27, M4-Gate, ADR-0049)

`npm run shot` (alle Szenarien, zwei Läufe pixelgleich): die Spielansicht auf der Welt der Sitzung, Zustände nur über Game-Commands (Bau-Szenarien: das Holzhaus im Grünhain-Schaufenster; Basis-Szenarien: die Basis am Startstrand). Geprüft nach §4 (Lesbarkeit, Palette, Licht) und §26 (Ausrichtung, Tastensymbole, Texte mit Lösung); Mängel beim Ansehen wurden vor der Übernahme behoben (Beschriftungen der Bau-Overlays halb überdeckt → ADR-0049). Bekannt und als Task geführt: der Lichtschein von Fackel, Kamin, Lampe und Brand liegt nördlich der Quelle und fällt durch Hauswände nach außen (`ui-baumenue`, `haus-*`, `basis-innen`, `brand` → M5-34).

| Bild | Szenario | Geprüft |
|---|---|---|
| `ui-handwerk.png` | `ui-handwerk` | Handwerksmenü (C): Rezeptliste mit Suche und Filter, Steinaxt gewählt und angeheftet, Zutaten 5/4 grün, Faserseil 1/2 rot mit „Missing: 1× Fibre Rope – craftable without a station“, Menge 2, Herstellen gesperrt, Warteschlange 2/10 mit Fortschritt, „From chests: on“, Tastenhinweise. |
| `ui-station.png` | `ui-station` | Werkbank mit Reitern „Craft | Repair“, Lehmofen gewählt, Ton 4/16 mit Lösungshinweis „Dug with a shovel: Clay“, Palisade in Arbeit in der Warteschlange. |
| `ui-station-ofen.png` | `ui-station-ofen` | Lehmofen: Eingang Ton ×6, Brennstoff Holz mit Glutbalken, Ausgang Tontopf, „Working: Clay Pot – 40%“; rechts, was er macht, und die fehlende Zutat „Raw Brick – made on the drying rack“. |
| `ui-station-reparatur.png` | `ui-station-reparatur` | Reiter Reparieren: abgenutzte Steinaxt 58/60 (anteilige Kosten 2 %, Zweig 0/1 mit Herkunft), Bronzeaxt unter „Needs another station“, Knopf „Repair“. |
| `ui-kiste.png` | `ui-kiste` | Kiste „Baustoffe“ 3/16 mit Etikett (Stein), Sortieren, Alles nehmen; Taschen mit Alles einlagern und Schnellablage; Reiter „Bags | Search“. |
| `ui-kiste-suche.png` | `ui-kiste-suche` | Suche „stein“ über drei Kisten im Umkreis 12 (ohne Herdfeuer): je Kiste Ort und Richtung, Funde hervorgehoben, auch in der offenen Kiste. |
| `hud-tracker.png` | `hud-tracker` | Drei angeheftete Rezepte unter der Minimap: „All at hand“, fehlende Zutaten mit Herkunft (gekürzt mit …), „Only at the sawbuck“ rot. |
| `ui-herdfeuer.png` | `ui-herdfeuer` | Brennendes Herdfeuer: Restzeit 23 h 20 min, Glutbalken, Löschen, Vorrat 15/40 in Brennreihenfolge, Schutzzone 12, Wiedereinstieg; Lagerübersicht mit Suche und den Plätzen der gewählten Kiste; keine Glutkern-Nischen (noch kein Glutkern-Item). |
| `ui-herdfeuer-aus.png` | `ui-herdfeuer-aus` | Kaltes Herdfeuer ohne Brennstoff, „Light“ gesperrt, „No protection while it is out“; Tooltip des Holzes mit „In the hearthfire: 1 h per piece“, Herkunft und Verwendung – 261 von 270 px hoch, im Bild. |
| `ui-baumenue.png` | `ui-baumenue` | Baumodus: Kategorienleiste, Suche, Holzwand mit Vorrat und Kosten, Werkzeugleiste 1–4 und B, Hinweise mit Maus- und Tastensymbolen, grüner Geist, Overlay-Leiste. |
| `bau-vorschau.png` | `bau-vorschau` | Roter Geist eines Strohdachs „No support in reach“ über dem Zeiger und in der Statuszeile mit rotem Rand und Lösung. |
| `bau-blaupause.png` | `bau-blaupause` | Blaupausenmodus: Anbau als Blaupausen (blau geditherte Wandformen), Schalter „Blueprint“ und G-Hinweis leuchten blau, „Blueprints still need: 4× Wooden Wall“ (9 geplant, 5 in den Taschen). |
| `bau-blaupausen.png` | `bau-blaupausen` | Bedarfszeile „4× Wooden Wall, 3× Wooden Floor“ über der Statuszeile. |
| `bau-abbauen.png` | `bau-abbauen` | Abbauen der Hausecke nach 30 s: bernsteinfarbene Felder, „Dismantle 8“, Statuszeile mit 60 % und dem, was zurückkommt. |
| `bau-aufwerten.png` | `bau-aufwerten` | Gartenmauer Holz » Stein in einem Zug: grüne Steinwände über den Brettern, Kosten und Rückgabe. |
| `bau-reparieren.png` | `bau-reparieren` | Flächenreparatur nach einem gelöschten Brand: Steinhammer in der Hand, zwei beschädigte Wände grün im eisblauen Rechteck, „2× Plank“. |
| `overlay-raeume.png` | `overlay-raeume` | Raum in der Farbe seines Typs, „Bedroom / 20 tiles“ lesbar über den Feldern, Legende aller Raumtypen. |
| `overlay-raumtemperatur.png` | `overlay-raumtemperatur` | Nacht: Innenraum 17° kühl, draußen 14° blasser, Legende der Stufen. |
| `overlay-licht.png` | `overlay-licht` | Lichtkarte je Kachel: hell um die Fackel im Haus, gedämpft zum Rand, dunkel draußen; die Wände halten das Spiellicht. |
| `overlay-behaglichkeit.png` | `overlay-behaglichkeit` | „Comfort 14/20“ lesbar, Raum in der Stufe 12–15. |
| `overlay-stuetzen.png` | `overlay-stuetzen` | Stützen weiß markiert, Dachtiles mit Abstand 1/2 in ihrer Farbe. |
| `haus-aussen.png` | `haus-aussen` | Holzhaus mit Strohdach, Tür und Marker „E Open: Wooden Door“. |
| `haus-innen.png` | `haus-innen` | Figur im Innenraum: Dach ganz ausgeblendet, vordere Wände geschnitten, Bett, Fackel, Tisch, Stuhl, Regal, Bild, Fenster. |
| `basis-aussen.png` | `basis-aussen` | Basis bei Tag: Strohhütte mit Tür und Fenstern, brennendes Herdfeuer (Marker), Kiste, Werkbank, Trockengestell, Zaun, Steinweg. |
| `basis-innen.png` | `basis-innen` | Innenraum 23:00: Kamin, Harzlampe, Laterne, Bett, Teppich, Tisch, Stuhl; Marker „E Add fuel: Stone Fireplace“. |
| `stationen-nacht.png` | `stationen-nacht` | Alle Stationen T0–T1 um 22:00: Meiler, Lehmofen, Schmelzofen brennen emissiv, Lagerfeuer, drei Fackeln, Spinnrad dreht sich mit Umriss und Marker. |
| `brand.png` | `brand` | Brennender Holzschuppen 27 s nach dem Entzünden: Mitte zur Glut gesunken, Nachbarn in vollen Flammen, Feuerschein auf Wand und Boden. |

Neu aufgenommen (M4): `welt-ui`, `nacht-fackel`, `schwimmen`, `hud-voll`, `hud-kontextuell`, `hud-minimal` – die Tastenkappe ist jetzt das Sprite `hinweis_taste` (M4-38) in Marker und HUD; `ui-inventar` – der Tooltip ist 200 statt 150 px breit (ADR-0045) und deckt die Werte-Tafel, der Tastenhinweis unten bleibt frei; `gruenhain`, `tilemap`, `aufloesungen-*`, `gruenhain-tag`, `frostkamm-tag`, `glutsand-tag`, `ebene-1-roh`, `overlay-chunks`, `overlay-kollision`, `overlay-temperatur` – einziger Unterschied: zwei interne Pixel am Fuß der Figur (Kontaktschatten eine Stufe heller, 32–128 Bildpixel). Alle übrigen Referenzen (M1-Galerien, `spiel-titel`, `palette*`, `normalmap`, `post-grundlage`, Weltkarten, übrige M3-Bilder) sind pixelgleich neu gerendert worden.

## M5 (freigegeben 2026-09-29)
(nachgeprüft 2026-09-29 nach M5-41 … M5-64)

Screenshot-Set M5-29: `npm run shot` (alle Szenarien) in zwei vollständigen Läufen **bytegleich** (172 von 172 Bildern), die Biom-Serie nach der letzten Änderung ihres Aufbaus in zwei weiteren Läufen bytegleich (24 von 24). Jedes Bild geöffnet (Vollbild, Ausschnitte bis 6×, Montagen, bei Verdacht die Puffer des Render-Debuggers) und nach §31.5 bewertet – **L** Lesbarkeit · **P** Palette · **S** Stimmung · **Li** Lichtqualität (kein Licht durch Wände, keine Höfe, Schatten plausibel) · **A** Artefakte (Banding, Rauschen, Nähte, Kachelwiederholung, Dither) · **U** UI-Ausrichtung; „–“ = trifft nicht zu. Bemerkungen mit „→ POLISH/BUG“ sind als Tasks vorgeschlagen; ein Bild mit offenem Mangel, der sein Thema betrifft, ist **nicht** freigegeben (Liste unten).

**Nachprüfung nach den Gate-Fixes M5-41 … M5-64** (PROGRESS „M5“, ADR-0074 … ADR-0078): `npm run shot` (alle Szenarien) in zwei vollständigen Läufen auf ruhiger Maschine (kein weiterer Dev-Server, keine Dateiänderungen) **bytegleich** (174 von 174 Bildern; 2 746 s bzw. 2 770 s je Lauf). Gegen die Referenzen: **16 bytegleich** (`weltkarte-*`, `palette-swap`, `anim-layers`, `gbuffer-*`, `schrift`, `ui-kit`, `glutsand-tag`, `shader-*`, `debug-gi`), **133 verändert** (darunter `ebene-1-roh` und `zustand-brennen` mit ihren alten Referenzen), **25 neu** (die bisher zurückgehaltenen Bilder ohne Referenz, `nebel-tag-fackel`, `bau-abbauen-rot` und die drei technischen Szenen). Jedes veränderte und neue Bild geöffnet (Vollbild halb, Ausschnitte 1–5×, Differenzbilder, Montagen Referenz | neu) und nach §31.5 bewertet, bei Verdacht mit Pixelproben (sRGB-Luma, Farbton), Selbstähnlichkeit der Adern und Autokorrelation des Seegrunds gemessen. **153 Bilder freigegeben** (132 veränderte, 21 neue), **2 zurückgehalten** (unten). Sichtbar bestätigt: Wasser in der Dämmerung blau bis cyan (Farbton 212–228°, `crt` 216°, `zustand-brennen` 213°; Eis im Frostkamm schiefergrau statt braun), Schönwetterwolken nur noch zart und bei Bedeckung 0 keine (`hitzeflimmern`), keine Speichen kleiner Pflanzen (`ebene-1-roh`, `nebel-nacht-fackel`, `bloom`, `fackel-schatten`, `hoehle-fackeln`), AO-Hof kleiner Felsen innerhalb einer Kachel (`tilemap`, `palette`), farbige Buntglasflecken 2,2–2,7× so hell wie die Dielen, Pfützen mit Rand, Nordufer, Lippe und Glanz (`regen`), das Lagerfeuer in allen Nachtlager-Bildern zwei Kacheln unter bzw. neben der Figur ohne Überdeckung, Adern ohne Kachelwiederholung (Treffer beim 176-px-Versatz 2,0–5,3 % statt 44–65 %), Nachtherz-Figur und Aschenschlund-Nacht lesbar, Salzküste mit Strand und Brandung, Kiesel vereinzelt und Kaustik fein, Nebel in Räumen auch an den Seitenwänden (`nebel-innen`), `winter-schnee` ohne Marker. Vergleich Qualitätsstufen: `qualitaet-hoch` ≡ `hoch-gruenhain-nacht` bytegleich, Ultra zu Hoch 0,4 % (Partikellicht), Mittel 4,2 % und Niedrig 6,9 % (ohne Spiegelung bzw. ohne Punktlichtschatten).

**Neu: Biom-Serie** (`src/debug/biomScenarios.ts`, M5-29): `biom-<id>-tag`, `-daemmerung`, `-nacht` für jedes der acht Oberflächenbiome – Spielansicht auf der Welt der Sitzung (Seed 20260923, Mittel) im Schaufenster des Bioms, Qualität „Hoch“ (Szenario-Stufe), Wetter „Klar“ in allen Regionen (50 min vor dem Bild erzwungen), eingefrorene Zeit, HUD aus; Spieler auf dem freien Feld nächst der Mitte ohne Ziel in Reichweite (keine Marker), in Dämmerung und Nacht mit Fackel. Jahreszeit nach der Farbidentität (docs/ART.md §5): Sommer – Grünhain, Salzküste, Glutsand, Aschenschlund; Herbst – Nebelmoor, Nachtherz; Winter – Frostkamm; Frühling – Scherbenhain. Uhrzeit nach dem Kalender der Jahreszeit: Tag 12:00; Dämmerung 45 min nach dem Sonnenuntergang (Frühling/Herbst 18:45, Sommer 20:15, Winter 17:15 – Tageslicht 0,68, Dämmerungs-Grading bei 0,87 seines Gipfels); Nacht 23:00 bei Halbmond (Phase 2 oder 6, die drei Bilder eines Bioms liegen auf einem Kalendertag).

**Nicht freigegeben** (Stand der Nachprüfung; offener Mangel – die Datei bleibt in `shots/latest/`, eine ältere Referenz gleichen Namens bleibt unverändert und ist damit veraltet):
- `nacht-fackel` – der Marker „[E] Add fuel: Campfire“ liegt auf der Flammenspitze des Lagerfeuers: Schrift-Unterkante bei Bild-y ≈ 635, die Flamme ist zwischen den Buchstaben schon ab y ≤ 628 zu sehen (die Flamme ist ≈ 18 interne px hoch – Emissiv-Box 13 × 18 px in `debug-emissiv` –, der Marker sitzt 13 px über dem Kachelfuß). Ursache: für Ziele ohne Sammelregel (Lagerfeuer, Stationen) setzt `src/render/game/objects.ts` die Oberkante auf `FLAT_TARGET_TOP_PX` = 10 statt auf die Sprite- bzw. Flammenhöhe; bis M5-57 hob die daneben stehende Figur den Marker über ihren Kopf, seit das Feuer frei unter ihr steht, fällt er auf die Flamme (→ POLISH). Die Referenz ist die Fassung von M5-29.
- `nebel-tag-fackel` (neu) – das Bild soll zeigen, dass mittags kein warmer Hof im Nebel liegt („wie keiner auf dem Boden daneben“), zeigt aber einen warmen hellen Fleck von ≈ 40–45 internen px Radius um das Lager: auf demselben Pfad sRGB-Luma 156–161 bei Farbton 28–37° am Feuer gegen 117–121 (210°) 300 px darüber und 137–143 (205°) 250 px darunter; dunkler Grund rechts vom Lager 102 (18°) gegen 94 (neutral) weiter rechts. Ob das Boden ist (Punktlicht behält unter dem nebelgedämpften Tageslicht seinen Anteil, ADR-0071) oder Nebel, ist im Endbild nicht zu trennen; Erwartung (Szenariotext) oder Unterdrückung ist zu klären (→ POLISH).
- `testszene`, `sprites-5000`, `licht-debug` – technische Bench-/Testszenen, wie bisher nicht Teil der Referenzen (angesehen, ohne Befund).

**Pixel-Diff der UI-Screens** (Nachprüfung, gegen die Referenzen von M5-29): `ui-kit` und `schrift` bytegleich; bei allen übrigen UI-Bildern sind Tafeln, Texte, Symbole, Leisten, Minimap, Marker, Geister und Tastenkappen pixelgleich (in den Differenzbildern schwarz), anders ist ausschließlich die Welt dahinter, darum oder in Lücken zwischen den Tafeln – kleinere AO-Höfe um Pflanzen und Felsen (M5-61), Uferwasser mit neuer Luma und feinerer Kaustik (M5-47, M5-62), zarte Schönwetterwolken (M5-59): Menüs über abgedunkelter Welt 1,15–4,7 % der Pixel bei höchstens 14–30/255 (`ui-handwerk` 1,6 %, `ui-station` 1,3 %, `ui-station-ofen` 1,2 %, `ui-station-reparatur` 1,6 %, `ui-herdfeuer` 1,3 %, `ui-herdfeuer-aus` 1,15 %, `ui-kiste` 2,9 %, `ui-kiste-suche` 2,9 %, `ui-inventar` 1,4 %, `ui-pause` 4,7 %, `ui-pause-einstellungen` 3,0 %, `todesbildschirm` 4,5 %); HUD über voller Welt 4,0–7,9 % bei höchstens 41–112/255 (`hud-voll` 7,6 %, `hud-kontextuell` 7,7 %, `hud-minimal` 7,9 %, `hud-minimap` 7,5 %, `hud-meldungen` 6,8 %, `hud-tracker` 4,0 %; die hohen Werte am Uferwasser unten links); Bau und Overlays 3,0–4,0 % bei höchstens 10–111/255 (`ui-baumenue`, `bau-*`, `overlay-raeume/-raumtemperatur/-licht/-behaglichkeit/-stuetzen`); `welt-ui` 1,0 % (17/255); `debug-inspektor` 4,8 % (44/255 – halbtransparente Tafel, Werte und Text gleich). Neu ist `bau-abbauen-rot` (ohne ältere Referenz).

| Bild | Szenario | Geprüft |
|---|---|---|
| `weltkarte-klein.png` | `weltkarte-klein` | bytegleich zur Referenz (Node-Karte, von M5 unberührt) |
| `weltkarte-mittel.png` | `weltkarte-mittel` | bytegleich zur Referenz |
| `weltkarte-gross.png` | `weltkarte-gross` | bytegleich zur Referenz |
| `palette-swap.png` | `palette-swap` | bytegleich zur Referenz |
| `ysort.png` | `ysort` | L ✓ · P ✓ · S – · Li ✓ · A ✓ · U – · Teich mit feinerem Kaustiknetz (M5-62), Durchblick-Kreis final (0,32 % der Pixel anders, höchstens 139/255) |
| `anim-layers.png` | `anim-layers` | bytegleich zur Referenz |
| `gbuffer-albedo.png` | `gbuffer-albedo` | Anhang unverändert; neu: Debugger-Beschriftung unten links (ADR-0073) und Wiegen je Zeile an den Kronen (0,6 %) ✓ |
| `gbuffer-normal.png` | `gbuffer-normal` | wie `gbuffer-albedo` (0,8 %) ✓ |
| `gbuffer-emissiv.png` | `gbuffer-emissiv` | wie `gbuffer-albedo` (0,9 %) ✓ |
| `gruenhain.png` | `gruenhain` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Fackelinseln in blau-violetter Nacht; anders nur kleinere AO-Höfe (M5-61) und feinere Kaustik (2,5 % der Pixel anders, höchstens 18/255) |
| `tilemap.png` | `tilemap` | L ✓ · P ✓ · S – · Li ✓ · A ✓ · U – · AO-Hof um kleine Felsen jetzt innerhalb einer Kachel (M5-61 behoben; 1,2 % der Pixel anders, höchstens 65/255) |
| `aufloesungen-1920x1080.png` | `aufloesungen` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · wie `gruenhain` (2,5 % der Pixel anders, höchstens 18/255); interne Größe und Schärfe vom Werkzeug geprüft (ganzzahlig ×4) |
| `aufloesungen-2560x1440.png` | `aufloesungen` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · ×5,33, alle Blöcke einfarbig, Balken schwarz (2,5 % der Pixel anders, höchstens 18/255) |
| `aufloesungen-3440x1440.png` | `aufloesungen` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · 640 × 270, ×5,33, seitliche Balken schwarz (2,0 % der Pixel anders, höchstens 18/255) |
| `aufloesungen-3840x2160.png` | `aufloesungen` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · ×8 (2,5 % der Pixel anders, höchstens 18/255) |
| `palette.png` | `palette` | L ✓ · P ✓ · S – · Li ✓ · A ✓ · U ✓ · Palettenzeilen unverändert; AO-Höfe an Stämmen und Felsen jetzt klein (M5-61; 3,4 % der Pixel anders, höchstens 87/255) |
| `welt-ui.png` | `welt-ui` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Namen, Leisten, Zahlen, Marker pixelgleich; anders nur die AO-Höfe der Welt (M5-61; 1,0 % der Pixel anders, höchstens 17/255) |
| `normalmap.png` | `normalmap` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Relief und SDF-Schatten der Felsen im Laternen- und Fackellicht; AO kleiner (1,5 % der Pixel anders, höchstens 21/255) |
| `post-grundlage.png` | `post-grundlage` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · blaue Stunde, HDR-Kern hellgolden, Schattenkeil hinter dem Fels; AO kleiner (1,5 % der Pixel anders, höchstens 20/255) |
| `gruenhain-tag.png` | `gruenhain-tag` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Kaustik jetzt feines, gebogenes, schwaches Netz statt „Eisrisse“, Kiesel nur noch vereinzelt (M5-62 behoben; 6,6 % der Pixel anders, höchstens 145/255); Sonnenschatten nach Norden |
| `frostkamm-tag.png` | `frostkamm-tag` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · kalt, Winter-Eis mit Rissen, blaue Schatten; Fluss mit feinerer Kaustik (3,6 % der Pixel anders, höchstens 145/255) |
| `glutsand-tag.png` | `glutsand-tag` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · harte Mittagsschatten, Sandsteinstufen |
| `ebene-1-roh.png` | `ebene-1-roh` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Wurzelhöhle, Umgebungslicht ≈ 0: Pfahlfackeln und Leuchtpilze tragen die Szene, Fels und Wurzeln werfen weiche Schatten; keine Speichen kleiner Pflanzen mehr (M5-56 behoben) |
| `spiel-titel.png` | `spiel-titel` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · hell und luftig, Brandung mit Uferschaum; Schönwetterwolken nur noch zart (M5-59), Kaustik fein, Kiesel locker (4,1 % der Pixel anders, höchstens 117/255) |
| `overlay-chunks.png` | `overlay-chunks` | Overlay (Linien, Koordinaten) pixelgleich; darunter AO und Wasser neu (6,4 % der Pixel anders, höchstens 104/255) ✓ |
| `overlay-kollision.png` | `overlay-kollision` | Overlay pixelgleich; darunter AO und Wasser neu (6,5 % der Pixel anders, höchstens 130/255) ✓ |
| `overlay-temperatur.png` | `overlay-temperatur` | Werte und Bänder pixelgleich; darunter die Welt (Frostkamm im Frühling, 1,4 % der Pixel anders, höchstens 62/255) ✓ |
| `schrift.png` | `schrift` | pixelgleich zur Referenz |
| `ui-kit.png` | `ui-kit` | pixelgleich zur Referenz |
| `ui-inventar.png` | `ui-inventar` | U ✓ Tafeln, Texte, Symbole pixelgleich zur Referenz; anders nur die Welt dahinter bzw. darum (1,4 % der Pixel anders, höchstens 30/255: kleinere AO-Höfe an Deko, Wasser mit feinerer Kaustik) ✓ |
| `hud-minimap.png` | `hud-minimap` | U ✓ Minimap, Rahmen, Symbole pixelgleich; anders nur die Welt (7,5 % der Pixel anders, höchstens 112/255: Uferwasser mit feinerer Kaustik, AO) ✓ |
| `hud-meldungen.png` | `hud-meldungen` | U ✓ Meldungen, Symbole, Farben pixelgleich; anders nur die Welt (6,8 % der Pixel anders, höchstens 112/255: Uferwasser, AO) ✓ |
| `ui-pause.png` | `ui-pause` | U ✓ Tafeln, Texte, Symbole pixelgleich zur Referenz; anders nur die Welt dahinter bzw. darum (4,7 % der Pixel anders, höchstens 30/255: kleinere AO-Höfe an Deko, Wasser mit feinerer Kaustik) ✓ |
| `ui-pause-einstellungen.png` | `ui-pause-einstellungen` | U ✓ Tafeln, Texte, Symbole pixelgleich zur Referenz; anders nur die Welt dahinter bzw. darum (3,0 % der Pixel anders, höchstens 29/255: kleinere AO-Höfe an Deko, Wasser mit feinerer Kaustik) ✓ |
| `todesbildschirm.png` | `todesbildschirm` | U ✓ Tafeln, Texte, Symbole pixelgleich zur Referenz; anders nur die abgedunkelte Welt dahinter (4,5 % der Pixel anders, höchstens 14/255: AO-Höfe um Pflanzen) ✓ |
| `nacht-fackel.png` | `nacht-fackel` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · **U ✗** · **nicht freigegeben** (siehe oben: Marker auf der Flammenspitze); die Referenz ist die Fassung von M5-29 und damit veraltet (95,5 % der Pixel anders, höchstens 233/255) |
| `lichtbaender-an.png` | `lichtbaender-an` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Nachtlager: Feuer zwei Kacheln unter der Figur, kein Überdecken (M5-57 behoben); Punktlicht in flachen Stufen mit Bayer-Säumen |
| `lichtbaender-aus.png` | `lichtbaender-aus` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · dasselbe mit stufenlosem Licht (22,5 % der Pixel anders, höchstens 48/255) |
| `qualitaet-niedrig.png` | `qualitaet-niedrig` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · nur Sonnen-/Mondschatten, Wasser ohne Spiegelung; Feuer unter der Figur |
| `qualitaet-mittel.png` | `qualitaet-mittel` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · harte SDF-Schatten, Wasser ohne Spiegelung |
| `qualitaet-hoch.png` | `qualitaet-hoch` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · weiche Schatten, Mond und Sterne im See; bytegleich zu `hoch-gruenhain-nacht` |
| `qualitaet-ultra.png` | `qualitaet-ultra` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · wie Hoch plus Partikellicht am Feuer (0,4 % der Pixel, höchstens 25/255) |
| `hoch-gruenhain-nacht.png` | `hoch-gruenhain-nacht` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Bench-Szene, bytegleich zu `qualitaet-hoch` |
| `licht-abgleich.png` | `licht-abgleich` | gelb, wo Gameplay- und Render-Licht übereinstimmen; Lagerfeuer jetzt zwei Kacheln unter der Figur (M5-57; 37,8 % der Pixel anders, höchstens 195/255) ✓ |
| `debug-sdf.png` | `debug-sdf` | L ✓ · P – (Debug-Farben) · Li ✓ Höhenlinien alle 8 px, Stämme/Felsen ocker, Stufen violett, Uferabstand blau; kleine Pflanzen nicht mehr in der Occluder-Maske (M5-56; 16,2 % der Pixel anders, höchstens 106/255) · A ✓ · U ✓ |
| `sonne-0800.png` | `sonne-0800` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · lange weiche Schatten nach Westen; Wolkenschatten bei „Klar“ nur noch zart (M5-59), See mit feinerer Kaustik (45,5 % der Pixel anders, höchstens 187/255); Marker „Gather: Wildflowers“ über dem Kopf |
| `sonne-1200.png` | `sonne-1200` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · kurze Schatten nach Norden, Sonnenglitzer; zarte Schönwetterwolken, feinere Kaustik (46,6 % der Pixel anders, höchstens 188/255) |
| `sonne-1700.png` | `sonne-1700` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · goldener Nachmittag, lange Schatten nach Osten, kein Sprung am Bildrand; zarte Wolken (44,5 % der Pixel anders, höchstens 134/255) |
| `wolkenschatten.png` | `wolkenschatten` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Wolkenschatten (Wetter mit Wolken) und Blätterdach-Sprenkel in Dither-Stufen; AO kleiner (11,4 % der Pixel anders, höchstens 98/255) |
| `wolkenschatten-spaeter.png` | `wolkenschatten-spaeter` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Schatten windabwärts weitergezogen (Vergleichsbild des E2E-Tests; 11,3 % der Pixel anders, höchstens 98/255) |
| `mond-voll.png` | `mond-voll` | L ✓ (Figur ohne Fackel kaum sichtbar – gewollt) · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · kühles Mondlicht, Glitzerpfad und Sterne im See; Wasser mit Luma und Kaustik von M5-47/M5-62 (45,1 % der Pixel anders, höchstens 35/255) |
| `mond-neu.png` | `mond-neu` | L ✓ (bewusst fast schwarz) · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Finstermond ohne Mond und Schatten (8,5 % der Pixel anders, höchstens 16/255) |
| `fackel-schatten.png` | `fackel-schatten` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Stämme, Baum und Klippenkante werfen weiche Schatten von jeder Flamme weg; die Pilze werfen keine Keile mehr (M5-56; 7,3 % der Pixel anders, höchstens 70/255) |
| `sammeln-feedback.png` | `sammeln-feedback` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Fortschrittsring, Späne, Staub; AO und Wasser neu (14,3 % der Pixel anders, höchstens 158/255) |
| `zustand-frierend.png` | `zustand-frierend` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Zitterstriche, Atem, Eis mit Rissen (9,7 % der Pixel anders, höchstens 81/255) |
| `zustand-brennen.png` | `zustand-brennen` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Flammen lecken am Körper und glühen in der Dämmerung am Startstrand; See blau (Farbton 213°, M5-54 behoben) |
| `schwimmen.png` | `schwimmen` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Eintauchmaske, Wellenring; Wasser mit neuer Luma und feinerer Kaustik (43,5 % der Pixel anders, höchstens 190/255) |
| `debug-inspektor.png` | `debug-inspektor` | Werte und Text pixelgleich; die halbtransparente Tafel zeigt die veränderte Welt (4,8 % der Pixel anders, höchstens 44/255) ✓ |
| `hud-voll.png` | `hud-voll` | U ✓ Leisten, Minimap, Schnellleiste, Texte pixelgleich; anders nur die Welt (7,6 % der Pixel anders, höchstens 41/255: Wolkenschatten bei Regen, AO, Wasser am Strand; Sand sammelt keine Pfützen) ✓ |
| `hud-kontextuell.png` | `hud-kontextuell` | U ✓ HUD-Teile pixelgleich; anders nur die Welt (7,7 % der Pixel anders, höchstens 41/255: Regen, Fackelschein, AO) ✓ |
| `hud-minimal.png` | `hud-minimal` | U ✓ HUD-Teile pixelgleich; anders nur die Welt (7,9 % der Pixel anders, höchstens 41/255: Regen, Fackelschein, AO) ✓ |
| `ui-handwerk.png` | `ui-handwerk` | U ✓ Tafeln, Texte, Symbole pixelgleich zur Referenz; anders nur die Welt dahinter bzw. darum (1,6 % der Pixel anders, höchstens 17/255: kleinere AO-Höfe an Deko, Wasser mit feinerer Kaustik) ✓ |
| `ui-station.png` | `ui-station` | U ✓ Tafeln, Texte, Symbole pixelgleich zur Referenz; anders nur die Welt dahinter bzw. darum (1,3 % der Pixel anders, höchstens 17/255: kleinere AO-Höfe an Deko, Wasser mit feinerer Kaustik) ✓ |
| `ui-station-ofen.png` | `ui-station-ofen` | U ✓ Tafeln, Texte, Symbole pixelgleich zur Referenz; anders nur die Welt dahinter bzw. darum (1,2 % der Pixel anders, höchstens 17/255: kleinere AO-Höfe an Deko, Wasser mit feinerer Kaustik) ✓ |
| `ui-kiste.png` | `ui-kiste` | U ✓ Tafeln, Texte, Symbole pixelgleich zur Referenz; anders nur die Welt dahinter bzw. darum (2,9 % der Pixel anders, höchstens 17/255: kleinere AO-Höfe an Deko, Wasser mit feinerer Kaustik) ✓ |
| `ui-station-reparatur.png` | `ui-station-reparatur` | U ✓ Tafeln, Texte, Symbole pixelgleich zur Referenz; anders nur die Welt dahinter bzw. darum (1,6 % der Pixel anders, höchstens 17/255: kleinere AO-Höfe an Deko, Wasser mit feinerer Kaustik) ✓ |
| `ui-kiste-suche.png` | `ui-kiste-suche` | U ✓ Tafeln, Texte, Symbole pixelgleich zur Referenz; anders nur die Welt dahinter bzw. darum (2,9 % der Pixel anders, höchstens 17/255: kleinere AO-Höfe an Deko, Wasser mit feinerer Kaustik) ✓ |
| `hud-tracker.png` | `hud-tracker` | U ✓ Tracker-Tafel pixelgleich; anders nur die Welt (4,0 % der Pixel anders, höchstens 44/255: AO, Wasser) ✓ |
| `ui-herdfeuer.png` | `ui-herdfeuer` | U ✓ Tafeln, Texte, Symbole pixelgleich zur Referenz; anders nur die Welt dahinter bzw. darum (1,3 % der Pixel anders, höchstens 17/255: kleinere AO-Höfe an Deko, Wasser mit feinerer Kaustik) ✓ |
| `ui-herdfeuer-aus.png` | `ui-herdfeuer-aus` | U ✓ Tafeln, Texte, Symbole pixelgleich zur Referenz; anders nur die Welt dahinter bzw. darum (1,2 % der Pixel anders, höchstens 17/255: kleinere AO-Höfe an Deko, Wasser mit feinerer Kaustik) ✓ |
| `bau-blaupausen.png` | `bau-blaupausen` | Leisten, Bedarfszeile, Geister pixelgleich; Welt mit kleineren AO-Höfen (3,3 % der Pixel anders, höchstens 44/255) ✓ |
| `ui-baumenue.png` | `ui-baumenue` | Kategorien, Werkzeugleiste, Hinweise, grüner Geist pixelgleich; Welt mit kleineren AO-Höfen und zarteren Wolken (3,5 % der Pixel anders, höchstens 47/255) ✓ |
| `bau-vorschau.png` | `bau-vorschau` | roter Geist, Begründung und Statuszeile pixelgleich; Welt (3,0 % der Pixel anders, höchstens 47/255) ✓ |
| `bau-blaupause.png` | `bau-blaupause` | Blaupausen, Schalter, Bedarf pixelgleich; Welt (3,4 % der Pixel anders, höchstens 47/255) ✓ |
| `bau-abbauen.png` | `bau-abbauen` | Felder, „Dismantle 8“, Statuszeile pixelgleich; Welt (3,8 % der Pixel anders, höchstens 111/255: AO, Wolkenschatten, Uferwasser) ✓ |
| `bau-abbauen-rot.png` | `bau-abbauen-rot` | L ✓ · P ✓ · S – · Li ✓ · A ✓ · U ✓ · neu (M5-52): zwei Wände bernsteinfarben (`feuer.4`), die volle Kiste rot (Geist „abgelehnt“, Rand `feuer.3`), „Dismantle 2“ über dem Zeiger, Statuszeile „The rest stays: Something is still inside …“ |
| `bau-aufwerten.png` | `bau-aufwerten` | Steinwände, Kosten, Rückgabe pixelgleich; Welt (3,3 % der Pixel anders, höchstens 111/255) ✓ |
| `bau-reparieren.png` | `bau-reparieren` | Rechteck, Felder, „2× Plank“ pixelgleich; Welt (3,9 % der Pixel anders, höchstens 111/255) ✓ |
| `overlay-raeume.png` | `overlay-raeume` | Overlay und Legende pixelgleich; Welt mit kleineren AO-Höfen (3,6 % der Pixel anders, höchstens 47/255) ✓ |
| `overlay-raumtemperatur.png` | `overlay-raumtemperatur` | Overlay und Legende pixelgleich; Welt (3,1 % der Pixel anders, höchstens 12/255) ✓ |
| `overlay-licht.png` | `overlay-licht` | Overlay und Legende pixelgleich; Welt (3,2 % der Pixel anders, höchstens 10/255) ✓ |
| `overlay-behaglichkeit.png` | `overlay-behaglichkeit` | „Comfort 14/20“ und Legende pixelgleich; Welt (4,0 % der Pixel anders, höchstens 47/255) ✓ |
| `overlay-stuetzen.png` | `overlay-stuetzen` | Stützen, Abstände, Legende pixelgleich; Welt (4,0 % der Pixel anders, höchstens 47/255) ✓ |
| `haus-aussen.png` | `haus-aussen` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Holzhaus mit Sonnenschatten, Marker an der Tür; zarte Wolken, AO kleiner (7,4 % der Pixel anders, höchstens 111/255) |
| `haus-innen.png` | `haus-innen` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Fackelschein bleibt in den Wänden (5,8 % der Pixel anders, höchstens 44/255) |
| `basis-aussen.png` | `basis-aussen` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Herdfeuer bei Tag ohne Hof; Wolkenschatten nur noch zart (M5-59; 17,6 % der Pixel anders, höchstens 76/255) |
| `basis-innen.png` | `basis-innen` | L ✓ · P ✓ · S ✓ · Li ✓ Kamin- und Lampenschein nur innen; Tisch wirft einen großen harten Schatten · A ✓ · U ✓ · AO kleiner (4,8 % der Pixel anders, höchstens 22/255) |
| `stationen-nacht.png` | `stationen-nacht` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Meiler, Öfen und Lagerfeuer werfen Licht; Marker über dem Kopf (7,5 % der Pixel anders, höchstens 26/255) |
| `brand.png` | `brand` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Feuerschein um die Quelle, Funken und Rauch (4,8 % der Pixel anders, höchstens 25/255) |
| `nebel-innen.png` | `nebel-innen` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · im Raum nur Dunst im Lampenlicht, auch an den Seitenwänden (M5-49), draußen Nebelbänke, kein Schein durch die Wände (5,3 % der Pixel anders, höchstens 21/255) |
| `buntglas.png` | `buntglas` | L ✓ · P ✓ · S ✓ · Li ✓ (Flecken 2,2–2,7× so hell wie die Dielen daneben, M5-58 behoben) · A ✓ · U – · rote (10°), goldene (30°) und olivgrüne (72°) Flecken auf den Dielen; die blaue Scheibe erscheint nur als 2 × 2 px graugrüner Fleck (52/70/57, 137°) → POLISH |
| `hitzeflimmern.png` | `hitzeflimmern` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · keine Wolkenschatten mehr bei Bedeckung 0 (M5-59 behoben); Zeilenversatz in ganzen Pixeln (39,7 % der Pixel anders, höchstens 210/255) |
| `nebel-nacht-fackel.png` | `nebel-nacht-fackel` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Nebelbänke im Mondlicht, warme Höfe um Fackel, Lagerfeuer und Pfahlfackel ohne dunkle Keile (M5-56 behoben), Feuer unter der Figur (M5-57) |
| `bloom.png` | `bloom` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Lagerfeuer unter der Figur (M5-57), Grasbüschel ohne Punktlichtkeile (M5-56); Flammen glühen über, Schein in Bayer-Stufen (26,6 % der Pixel anders, höchstens 229/255) |
| `schockwelle.png` | `schockwelle` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Schönwetterwolken nur noch zart (M5-59 behoben); Ring in ganzen Pixeln (18,7 % der Pixel anders, höchstens 187/255) |
| `crt.png` | `crt` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Scanlines und Wölbung über der Dämmerung am See; Wasser blau (216°, M5-54 behoben) |
| `daemmerung-gruenhain-1700.png` | `daemmerung-gruenhain-1700` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · später Nachmittag, See blau, zarte Wolken (19,1 % der Pixel anders, höchstens 138/255) |
| `daemmerung-gruenhain-1800.png` | `daemmerung-gruenhain-1800` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Sonnenuntergang, noch neutral (4,6 % der Pixel anders, höchstens 138/255) |
| `daemmerung-gruenhain-1845.png` | `daemmerung-gruenhain-1845` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · orange-rosa Dämmerung, See blau (214°, M5-54 behoben) |
| `daemmerung-gruenhain-1845-roh.png` | `daemmerung-gruenhain-1845-roh` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · dasselbe ohne Grading: See blau (212°) |
| `daemmerung-gruenhain-1930.png` | `daemmerung-gruenhain-1930` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · blaue Stunde, Fackelinsel, See blau (219°) |
| `daemmerung-gruenhain-2030.png` | `daemmerung-gruenhain-2030` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Nacht, kühles Blau, Fackelinsel (12,3 % der Pixel anders, höchstens 66/255) |
| `effekt-furcht.png` | `effekt-furcht` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Ranken vom Rand, Farben entsättigt (4,6 % der Pixel anders, höchstens 121/255) |
| `effekt-leben.png` | `effekt-leben` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · roter Rand als glattes Band (7,9 % der Pixel anders, höchstens 71/255) |
| `effekt-kaelte.png` | `effekt-kaelte` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · kalte Entsättigung, Frostfinger (7,4 % der Pixel anders, höchstens 78/255) |
| `effekt-hitze.png` | `effekt-hitze` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · warmer Stich, Zeilenflimmern; ohne Wolkenschatten, die Palmkrone liegt jetzt in voller Sonne (gebleichte Lichter der Glutsand-Tönung; 43,6 % der Pixel anders, höchstens 215/255) |
| `effekt-erschoepfung.png` | `effekt-erschoepfung` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Lider halb geschlossen (2,6 % der Pixel anders, höchstens 39/255) |
| `effekt-gift.png` | `effekt-gift` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Giftrand in Flecken (7,9 % der Pixel anders, höchstens 104/255) |
| `effekt-rausch.png` | `effekt-rausch` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Wellen und blasses Doppelbild (9,9 % der Pixel anders, höchstens 85/255) |
| `effekt-uebergang.png` | `effekt-uebergang` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · 2 × 2-Zellen vom Rand (3,1 % der Pixel anders, höchstens 183/255) |
| `verderbnis-voll.png` | `verderbnis-voll` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Adern nur im Gelände, ohne Kachelwiederholung (Treffer beim 176-px-Versatz 2,0 % rechts / 5,3 % unten statt 44 % / 50 %, M5-55 behoben); See blau (Farbton 224° statt 253°, M5-54); Fackel bleibt warm (24,9 % der Pixel anders, höchstens 240/255) |
| `verderbnis-halb.png` | `verderbnis-halb` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Flecken mit Bayer-Saum; See blau (217° statt 248°; 16,3 % der Pixel anders, höchstens 239/255) |
| `partikel.png` | `partikel` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Rauch von unten orange, Lumen-Sturm türkis, Glühwürmchen (2,9 % der Pixel anders, höchstens 19/255) |
| `partikel-20000.png` | `partikel-20000` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Stressbild (2,8 % der Pixel anders, höchstens 21/255) |
| `partikel-gewitter.png` | `partikel-gewitter` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Blitzschleier, Regen im Fackelschein (8,7 % der Pixel anders, höchstens 18/255) |
| `regen.png` | `regen` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Pfützen mit Rand, dunklem Nordufer, heller Südlippe und Glanzstrichen (M5-60 behoben); Windwinkel, Parallaxe, Spritzer (16,7 % der Pixel anders, höchstens 124/255) |
| `schnee.png` | `schnee` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Flocken in drei Schichten, am Punktlicht nicht überstrahlt (M5-41; 3,5 % der Pixel anders, höchstens 56/255) |
| `ascheregen.png` | `ascheregen` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · rauchig, glimmende Glut (3,5 % der Pixel anders, höchstens 28/255) |
| `sandsturm.png` | `sandsturm` | L ✓ (bewusst verschleiert) · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Schleier in Windrichtung; Oase mit feinerer Kaustik (43,1 % der Pixel anders, höchstens 113/255) |
| `gras-interaktiv.png` | `gras-interaktiv` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Schauplatz durch das neue Salzküsten-Schaufenster (M5-64) an der Küste unter bewölktem Himmel: Spieler hinter dem Strandhafer-Horst, dessen Halme sich neigen; am Weg nur spärliches Dünengras – die Druckspur ist so zart wie in der alten Referenz (→ POLISH Szenario; 97,1 % der Pixel anders, höchstens 222/255) |
| `kronen-dither.png` | `kronen-dither` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Kreis weltfest im Bayer-Muster; Wolken zart (38,3 % der Pixel anders, höchstens 188/255) |
| `herbst.png` | `herbst` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Laub Baum für Baum im Übergang; Wolken zart (36,3 % der Pixel anders, höchstens 189/255) |
| `winter-schnee.png` | `winter-schnee` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Spieler auf freier Wiese ohne Ziel in Reichweite, kein Markertext mehr (M5-64 behoben); Schneecluster, Hauben auf Kiefern (97,4 % der Pixel anders, höchstens 221/255) |
| `fussspuren.png` | `fussspuren` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · alte Spur flach, frische tief; Wolkenschatten nur noch zart (29,5 % der Pixel anders, höchstens 103/255) |
| `regen-nacht-pfuetzen.png` | `regen-nacht-pfuetzen` | L ✓ (dunkel, gewollt) · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Pfützen nachts dunkler mit Rand (M5-60), Flammen spiegeln (21,4 % der Pixel anders, höchstens 87/255) |
| `gruenhain-nacht.png` | `gruenhain-nacht` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Glühwürmchen, Fackelinsel, Sterne im See (8,3 % der Pixel anders, höchstens 80/255) |
| `hoehle-fackeln.png` | `hoehle-fackeln` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Umgebungslicht ≈ 0, nur Fackeln und Leuchtpilze; Leuchtpilze ohne Schattenkeile (M5-56; 1,5 % der Pixel anders, höchstens 61/255) |
| `shader-outline.png` | `shader-outline` | L ✓ · P ✓ · Li ✓ · A ✓ 1-px-Umriss in Akzentfarbe · S/U – |
| `shader-weissblitz.png` | `shader-weissblitz` | L ✓ · P ✓ · Li ✓ · A ✓ · S/U – |
| `shader-palettentausch.png` | `shader-palettentausch` | L ✓ · P ✓ · Li ✓ · A ✓ Pixel für Pixel nach Rampenstufe · S/U – |
| `shader-dither.png` | `shader-dither` | L ✓ · P ✓ · Li ✓ · A ✓ · S/U – |
| `wasser-ufer.png` | `wasser-ufer` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Kaustik nur im Flachen, fein und schwach; Kiesel vereinzelt ohne Raster (M5-62 behoben); Uferschaum (31,1 % der Pixel anders, höchstens 184/255) |
| `wasser-spiegelung-tag.png` | `wasser-spiegelung-tag` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Figur und Bäume gespiegelt; Kaustik fein (21,4 % der Pixel anders, höchstens 188/255) |
| `wasser-spiegelung-nacht.png` | `wasser-spiegelung-nacht` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Mond, Sterne und Feuer im See; Lagerfeuer jetzt neben der Figur, ohne sie zu verdecken (M5-57; 36,5 % der Pixel anders, höchstens 243/255) |
| `wasser-wellen.png` | `wasser-wellen` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Ringe um Figur und Tropfen (13,5 % der Pixel anders, höchstens 63/255) |
| `wasser-eis.png` | `wasser-eis` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Eis mit Rissen, Tiefblau darunter (15,7 % der Pixel anders, höchstens 173/255) |
| `debug-albedo.png` | `debug-albedo` | Palettenfarben ohne Licht, Beschriftung lesbar; Lagerfeuer unter der Figur (M5-57; 2,8 % der Pixel anders, höchstens 229/255) ✓ |
| `debug-normalen.png` | `debug-normalen` | Boden lavendel, Relief an Stämmen, Kronen, Felsen, Klippen (0,43 % der Pixel anders, höchstens 171/255) ✓ |
| `debug-hoehe.png` | `debug-hoehe` | Boden je Stufe, Stämme und Kronen hell nach Höhe (0,66 % der Pixel anders, höchstens 50/255) ✓ |
| `debug-emissiv.png` | `debug-emissiv` | nur Flammen und Glut (0,21 % der Pixel anders, höchstens 255/255) ✓ |
| `debug-sonnenschatten.png` | `debug-sonnenschatten` | lange Silhouetten nach Osten, Klippe als Band; Wolkenschatten zart (44,0 % der Pixel anders, höchstens 234/255) ✓ |
| `debug-licht.png` | `debug-licht` | Punktlicht allein, weiche Stammschatten; keine Keile kleiner Pflanzen (29,8 % der Pixel anders, höchstens 250/255) ✓ |
| `debug-gi.png` | `debug-gi` | leer, Beschriftung „nicht aktiv“ ✓ |
| `debug-lichtkarte.png` | `debug-lichtkarte` | gelb/oliv, wo Gameplay- und Render-Licht übereinstimmen (37,1 % der Pixel anders, höchstens 228/255) ✓ |
| `debug-naesse.png` | `debug-naesse` | Pfützen hell, trocken unter den Kronen (3,5 % der Pixel anders, höchstens 55/255) ✓ |
| `debug-nebel.png` | `debug-nebel` | driftende Bänke, höheres Gelände dunkel, ohne Naht am unteren Rand (M5-44; 0,57 % der Pixel anders, höchstens 176/255) ✓ |
| `biom-gruenhain-tag.png` | `biom-gruenhain-tag` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Sommer 12:00: satte Grüns, kurze Schatten, Klippe mit Treppe, See mit Uferschaum; Wolkenschatten zart (33,6 % der Pixel anders, höchstens 183/255) |
| `biom-gruenhain-daemmerung.png` | `biom-gruenhain-daemmerung` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · 20:15: Wiese oliv im Dämmerlicht, See blau (Farbton 217°, M5-54 behoben), Fackel warm |
| `biom-gruenhain-nacht.png` | `biom-gruenhain-nacht` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Halbmond 23:00: kühles Blau, Glühwürmchen, Sterne im See, Fackelinsel (28,2 % der Pixel anders, höchstens 22/255) |
| `biom-salzkueste-tag.png` | `biom-salzkueste-tag` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ (dunkle Senken des Meeresgrunds im 16-px-Raster → POLISH) · U – · Strand, Brandung und offene See (M5-64 behoben), Figur hebt sich vor hellem Sand ab; Wolkenschatten zart (91,4 % der Pixel anders, höchstens 201/255) |
| `biom-salzkueste-daemmerung.png` | `biom-salzkueste-daemmerung` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · 20:15: Sand warm, See schieferblau, Fackel golden (83,3 % der Pixel anders, höchstens 215/255) |
| `biom-salzkueste-nacht.png` | `biom-salzkueste-nacht` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · marineblau, Sterne im Meer, Fackelinsel mit weichem Stammschatten (93,6 % der Pixel anders, höchstens 191/255) |
| `biom-nebelmoor-tag.png` | `biom-nebelmoor-tag` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Herbst: entsättigt grünlich-grau, Torf und nebelgraue Wiese, flacher Kontrast (15,8 % der Pixel anders, höchstens 60/255) |
| `biom-nebelmoor-daemmerung.png` | `biom-nebelmoor-daemmerung` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · 18:45: gedämpft, Fackelschein diffus (8,8 % der Pixel anders, höchstens 38/255) |
| `biom-nebelmoor-nacht.png` | `biom-nebelmoor-nacht` | L ✓ (dunkel, Weg lesbar) · P ✓ · S ✓ · Li ✓ · A ✓ · U – · petrolblau-schwarz (15,0 % der Pixel anders, höchstens 17/255) |
| `biom-frostkamm-tag.png` | `biom-frostkamm-tag` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Winter: strahlendes Weiß, blaue Schatten, Gletschereis mit Rissen, verschneite Tannen (11,6 % der Pixel anders, höchstens 107/255) |
| `biom-frostkamm-daemmerung.png` | `biom-frostkamm-daemmerung` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · 17:15: Schnee im rosa Abendlicht, Eis schiefergrau (106/105/119, kein Braun mehr, M5-54), Fackelschein warm |
| `biom-frostkamm-nacht.png` | `biom-frostkamm-nacht` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · stahlblau, Sterne, Fackel besonders warm (15,5 % der Pixel anders, höchstens 28/255) |
| `biom-glutsand-tag.png` | `biom-glutsand-tag` | L ✓ · P ✓ · S ✓ · Li ✓ (nur zarte Schönwetterwolken, M5-59 behoben) · A ✓ (Kiesel locker; dunkle Senken des Grunds im 16-px-Raster → POLISH) · U – · Sommer: gebleichter Sand, Oase mit feiner Kaustik, Palmen, Sandsteinstufen (42,1 % der Pixel anders, höchstens 212/255) |
| `biom-glutsand-daemmerung.png` | `biom-glutsand-daemmerung` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · 20:15: Sand rostrot, Oase blau (219°, M5-54 behoben), Palme und Stufen lesbar |
| `biom-glutsand-nacht.png` | `biom-glutsand-nacht` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · kalt-violett gekippt, Sterne in der Oase (36,0 % der Pixel anders, höchstens 44/255) |
| `biom-aschenschlund-tag.png` | `biom-aschenschlund-tag` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Sommer: dunkle Asche, glühende Halmspitzen und Risse, Klippenstufen (26,2 % der Pixel anders, höchstens 71/255) |
| `biom-aschenschlund-daemmerung.png` | `biom-aschenschlund-daemmerung` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Glut tritt hervor (100,0 % der Pixel anders, höchstens 52/255) |
| `biom-aschenschlund-nacht.png` | `biom-aschenschlund-nacht` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · lesbar (M5-63 behoben): Bildmittel sRGB-Luma 20 statt 4, Asche pflaumen-dunkel mit `feuer.0`-Stich, Kronen als Silhouetten mit Glutspitzen, Fackelinsel (100,0 % der Pixel anders, höchstens 50/255) |
| `biom-scherbenhain-tag.png` | `biom-scherbenhain-tag` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Frühling: kühl-pastellig, Kristallbäume, Prismenquarz, See (64,7 % der Pixel anders, höchstens 103/255) |
| `biom-scherbenhain-daemmerung.png` | `biom-scherbenhain-daemmerung` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · 18:45: Kristallbäume golden, See dunkel-schieferblau (228°, M5-54 behoben), Ufer lesbar |
| `biom-scherbenhain-nacht.png` | `biom-scherbenhain-nacht` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · tiefviolett, Kristalle leuchten, Sterne im See (55,6 % der Pixel anders, höchstens 30/255) |
| `biom-nachtherz-tag.png` | `biom-nachtherz-tag` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Herbst: verdorbenes Violett, glühende Adern ohne Kachelwiederholung (Treffer beim 176-px-Versatz 2,5 %, M5-55 behoben), Fluss mit hellem Saum; Figur dunkel vor hellerem Grund (M5-63) |
| `biom-nachtherz-daemmerung.png` | `biom-nachtherz-daemmerung` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Adern treten rosa hervor (Versatz-Treffer 5,2 % / 2,8 %, Grundrauschen 3–6 %), Fackel kalt-weiß |
| `biom-nachtherz-nacht.png` | `biom-nachtherz-nacht` | L ✓ (dunkel, Figur als Silhouette mit Fackel) · P ✓ · S ✓ · Li ✓ · A ✓ (Adern ohne Tapeten-Eindruck: 176-px-Versatz 4,6 % gegen 3–6 % bei beliebigem Versatz) · U – · nur Adern und Fackelschein |
