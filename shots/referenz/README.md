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

Screenshot-Set M5-29: `npm run shot` (alle Szenarien) in zwei vollständigen Läufen **bytegleich** (172 von 172 Bildern), die Biom-Serie nach der letzten Änderung ihres Aufbaus in zwei weiteren Läufen bytegleich (24 von 24). Jedes Bild geöffnet (Vollbild, Ausschnitte bis 6×, Montagen, bei Verdacht die Puffer des Render-Debuggers) und nach §31.5 bewertet – **L** Lesbarkeit · **P** Palette · **S** Stimmung · **Li** Lichtqualität (kein Licht durch Wände, keine Höfe, Schatten plausibel) · **A** Artefakte (Banding, Rauschen, Nähte, Kachelwiederholung, Dither) · **U** UI-Ausrichtung; „–“ = trifft nicht zu. Bemerkungen mit „→ POLISH/BUG“ sind als Tasks vorgeschlagen; ein Bild mit offenem Mangel, der sein Thema betrifft, ist **nicht** freigegeben (Liste unten).

**Neu: Biom-Serie** (`src/debug/biomScenarios.ts`, M5-29): `biom-<id>-tag`, `-daemmerung`, `-nacht` für jedes der acht Oberflächenbiome – Spielansicht auf der Welt der Sitzung (Seed 20260923, Mittel) im Schaufenster des Bioms, Qualität „Hoch“ (Szenario-Stufe), Wetter „Klar“ in allen Regionen (50 min vor dem Bild erzwungen), eingefrorene Zeit, HUD aus; Spieler auf dem freien Feld nächst der Mitte ohne Ziel in Reichweite (keine Marker), in Dämmerung und Nacht mit Fackel. Jahreszeit nach der Farbidentität (docs/ART.md §5): Sommer – Grünhain, Salzküste, Glutsand, Aschenschlund; Herbst – Nebelmoor, Nachtherz; Winter – Frostkamm; Frühling – Scherbenhain. Uhrzeit nach dem Kalender der Jahreszeit: Tag 12:00; Dämmerung 45 min nach dem Sonnenuntergang (Frühling/Herbst 18:45, Sommer 20:15, Winter 17:15 – Tageslicht 0,68, Dämmerungs-Grading bei 0,87 seines Gipfels); Nacht 23:00 bei Halbmond (Phase 2 oder 6, die drei Bilder eines Bioms liegen auf einem Kalendertag).

**Nicht freigegeben** (offener Mangel; die Datei bleibt in `shots/latest/`, eine ältere Referenz gleichen Namens bleibt unverändert und ist damit veraltet):
- `biom-gruenhain-daemmerung`, `biom-frostkamm-daemmerung`, `biom-glutsand-daemmerung`, `biom-scherbenhain-daemmerung`, `daemmerung-gruenhain-1845`, `daemmerung-gruenhain-1930`, `daemmerung-gruenhain-1845-roh`, `crt`, `zustand-brennen` (alte M3-Referenz bleibt) – Wasser (und Eis) in der Dämmerung violett bzw. schlammbraun: der gespiegelte Dämmerungshimmel `SKY.duskZenith = 'verderb.3'`/`duskHorizon = 'laub.3'` (`src/render/water/params.ts`) nimmt bei Tageslicht 0,3–0,7 bis zur Hälfte der Wasserfarbe ein; Violett ist nach docs/ART.md §8 Verderbnis, Schattenbrut und Episch vorbehalten, der See liest sich als verdorben (→ BUG).
- `biom-nachtherz-tag`, `-daemmerung`, `-nacht` – das Adernmuster der Verderbnis wiederholt sich sichtbar alle 704 Bildpixel (176 Weltpixel = `VEINS.tilePx`, `src/render/post/corruption.ts`): 48 % der Adernpixel liegen genau 704 px rechts, 65 % genau 704 px tiefer wieder auf einer Ader (Nachbarversätze 700/708 px: 25 %); nachts, wo nur die glühenden Adern bleiben, liest sich der Boden als Tapete (→ BUG). Dazu: die Figur hebt sich im verdorbenen Violett kaum ab (→ POLISH).
- `lichtbaender-an`, `lichtbaender-aus`, `qualitaet-niedrig`, `-mittel`, `-hoch`, `-ultra`, `hoch-gruenhain-nacht` – das Lagerfeuer des Nachtlagers steht auf `FIRE_SPOTS[0]` = (+1, +1) neben der Figur am Ufer und verdeckt ihre rechte Körperhälfte (Steinkranz und Flamme vor dem Spieler; `src/render/game/lightsSzenario.ts`) (→ POLISH Szenario). Licht, Bänder und Stufenunterschiede selbst sind in Ordnung (`qualitaet-hoch` ≡ `hoch-gruenhain-nacht` bytegleich; Ultra zu Hoch 0,5 % der Pixel, Partikellicht).
- `ebene-1-roh` (alte M2-Referenz bleibt), `nebel-nacht-fackel` – kleine Pflanzen mit Occluder-Ellipse (`pflanze_leuchtpilz`, `_steinpilz`, `_kraeuter` …, 3 × 1,5 px, 16-px-Sprite) werfen im Licht der Pfahlfackeln 100–150 px lange schwarze Speichen (Höhle) bzw. dunkle Keile durch den Nebelschein; ein leuchtender Pilz wirft den dunkelsten Schatten (→ BUG).
- `buntglas` – das farbige Licht der zwei Buntglasfenster ist im Puffer `sun` deutlich (rot/grün/gelb), im Endbild aber nur ein trüber bernsteinfarbener Fleck (Boden 26–30/255 gegen 15–32/255 daneben): die Wirkung, die das Bild zeigen soll, ist auf einen Blick nicht zu erkennen (→ POLISH).
- `testszene`, `sprites-5000`, `licht-debug` – technische Bench-/Testszenen, wie bisher nicht Teil der Referenzen (angesehen, ohne Befund).

**Pixel-Diff der UI-Screens** gegen die bisherigen Referenzen (`ui-*`, `hud-*`, `welt-ui`, `todesbildschirm`): `ui-kit` pixelgleich; bei allen übrigen sind Tafeln, Texte, Symbole, Leisten, Minimap, Marker und Tastenkappen pixelgleich (in den Differenzbildern schwarz), anders ist ausschließlich die Welt dahinter oder darum – Sonnen- und Mondschatten, SDF-AO, Wasser-Pass, Grading, Vignette und Korn von M5: Menü-Tafeln mit abgedunkeltem Hintergrund 10–54 % der Pixel bei höchstens 32–76/255 (`ui-handwerk` 14,5 %, `ui-station` 13,7 %, `ui-station-ofen` 14,6 %, `ui-station-reparatur` 13,5 %, `ui-herdfeuer` 14,7 %, `ui-herdfeuer-aus` 9,6 %, `ui-kiste` 50,6 %, `ui-kiste-suche` 50,2 %, `ui-inventar` 28,9 %, `ui-pause` 86,3 %, `ui-pause-einstellungen` 53,8 %, `todesbildschirm` 76,7 %); HUD über der vollen Welt 63–98 % bei höchstens 155–219/255 (`hud-voll` 84,5 %, `hud-kontextuell` 86,4 %, `hud-minimal` 97,6 %, `hud-minimap` 94,6 %, `hud-meldungen` 86,8 %, `hud-tracker` 75,7 %, `ui-baumenue` 62,7 %); `welt-ui` 25,7 % (Licht, Figuren, Baumfüße; Namen, Leisten, Zahlen, Marker gleich). `debug-inspektor` (98,9 %): die Tafel ist halbtransparent, die veränderte Welt scheint durch, Werte und Text sind gleich.

| Bild | Szenario | Geprüft |
|---|---|---|
| `weltkarte-klein.png` | `weltkarte-klein` | bytegleich zur Referenz (Node-Karte, von M5 unberührt) |
| `weltkarte-mittel.png` | `weltkarte-mittel` | bytegleich zur Referenz |
| `weltkarte-gross.png` | `weltkarte-gross` | bytegleich zur Referenz |
| `palette-swap.png` | `palette-swap` | bytegleich zur Referenz |
| `ysort.png` | `ysort` | L ✓ · P ✓ · S – · Li ✓ · A ✓ · U – · Teich jetzt durch den Wasser-Pass (Uferschaum, Kaustiken), Durchblick-Kreis final; 0,5 % der Pixel anders |
| `anim-layers.png` | `anim-layers` | bytegleich zur Referenz |
| `gbuffer-albedo.png` | `gbuffer-albedo` | Anhang unverändert; neu: Debugger-Beschriftung unten links (ADR-0073) und Wiegen je Zeile an den Kronen (0,6 %) ✓ |
| `gbuffer-normal.png` | `gbuffer-normal` | wie `gbuffer-albedo` (0,8 %) ✓ |
| `gbuffer-emissiv.png` | `gbuffer-emissiv` | wie `gbuffer-albedo` (0,9 %) ✓ |
| `gruenhain.png` | `gruenhain` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Fackelinseln in blau-violetter Nacht, Stab liest als Holz (M5-31), Felsen werfen weiche Punktlichtschatten von der Flamme weg |
| `tilemap.png` | `tilemap` | L ✓ · P ✓ · S – · Li ✓ · A ✓ (SDF-AO legt einen dunklen Hof von ≈ 2 × Grundfläche um jeden kleinen Fels → POLISH AO) · U – · 1,2 % anders |
| `aufloesungen-1920x1080.png` | `aufloesungen` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · interne Größe und Schärfe vom Werkzeug geprüft (ganzzahlig ×4) |
| `aufloesungen-2560x1440.png` | `aufloesungen` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · ×5,33, alle Blöcke einfarbig, Balken schwarz |
| `aufloesungen-3440x1440.png` | `aufloesungen` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · 640 × 270, ×5,33, seitliche Balken schwarz |
| `aufloesungen-3840x2160.png` | `aufloesungen` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · ×8 |
| `palette.png` | `palette` | L ✓ · P ✓ · S – · Li ✓ · A ✓ · U ✓ · Palettenzeilen unverändert, nur AO-Höfe an Stämmen und Felsen (3,5 %); Beschriftung unverändert |
| `welt-ui.png` | `welt-ui` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Namen, Leisten, Zahlen, Marker pixelgleich; anders nur Licht, Schatten und AO der Welt (25,7 %) |
| `normalmap.png` | `normalmap` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Relief und SDF-Schatten der Felsen im Laternen- und Fackellicht |
| `post-grundlage.png` | `post-grundlage` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · blaue Stunde, HDR-Kern hellgolden, Schattenkeil hinter dem Fels |
| `gruenhain-tag.png` | `gruenhain-tag` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ (Kaustik-Netz im Flachen liest sich fast wie Eisrisse; Kiesel des Seegrunds im 16-px-Raster → POLISH Wasser) · U – · Sonnenschatten nach Norden, AO |
| `frostkamm-tag.png` | `frostkamm-tag` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · kalt, Winter-Eis mit Rissen, blaue Schatten |
| `glutsand-tag.png` | `glutsand-tag` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · harte Mittagsschatten, Sandsteinstufen |
| `spiel-titel.png` | `spiel-titel` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · hell und luftig, Brandung mit Uferschaum; 100 % der Pixel anders (Grading der Salzküste, Wasser-Pass) |
| `overlay-chunks.png` | `overlay-chunks` | Overlay (Linien, Koordinaten) pixelgleich; darunter die M5-Welt ✓ |
| `overlay-kollision.png` | `overlay-kollision` | Overlay pixelgleich; darunter die M5-Welt ✓ |
| `overlay-temperatur.png` | `overlay-temperatur` | Werte und Bänder pixelgleich; darunter die M5-Welt (Frostkamm im Frühling) ✓ |
| `schrift.png` | `schrift` | pixelgleich zur Referenz |
| `ui-kit.png` | `ui-kit` | pixelgleich zur Referenz |
| `ui-inventar.png` | `ui-inventar` | U ✓ pixelgleich zur Referenz (Tafeln, Texte, Symbole); anders ist nur die Welt dahinter bzw. darum (höchstens 41/255, abgedunkelter Hintergrund) ✓ |
| `hud-minimap.png` | `hud-minimap` | U ✓ pixelgleich zur Referenz (Tafeln, Texte, Symbole); anders ist nur die Welt dahinter bzw. darum (Sonnenschatten, Grading) ✓ |
| `hud-meldungen.png` | `hud-meldungen` | U ✓ pixelgleich zur Referenz (Tafeln, Texte, Symbole); anders ist nur die Welt dahinter bzw. darum ✓ |
| `ui-pause.png` | `ui-pause` | U ✓ pixelgleich zur Referenz (Tafeln, Texte, Symbole); anders ist nur die Welt dahinter bzw. darum (höchstens 41/255) ✓ |
| `ui-pause-einstellungen.png` | `ui-pause-einstellungen` | U ✓ pixelgleich zur Referenz (Tafeln, Texte, Symbole); anders ist nur die Welt dahinter bzw. darum (höchstens 41/255) ✓ |
| `todesbildschirm.png` | `todesbildschirm` | U ✓ pixelgleich zur Referenz (Tafeln, Texte, Symbole); anders ist nur die Welt dahinter bzw. darum (höchstens 32/255) ✓ |
| `nacht-fackel.png` | `nacht-fackel` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Lagerfeuer, Pfahlfackel und Fackel in der Hand mit weichen Schatten, Bänder mit Bayer-Säumen; Marker über dem Kopf |
| `licht-abgleich.png` | `licht-abgleich` | gelb, wo Gameplay- und Render-Licht übereinstimmen; Debugger-Beschriftung neu (ADR-0073) ✓ |
| `debug-sdf.png` | `debug-sdf` | L ✓ · P – (Debug-Farben) · Li ✓ Höhenlinien alle 8 px, Stämme/Felsen ocker, Stufen violett, Uferabstand blau · A ✓ · U ✓ Beschriftung |
| `sonne-0800.png` | `sonne-0800` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · lange weiche Schatten nach Westen; Marker „Gather: Wildflowers“ über dem Kopf |
| `sonne-1200.png` | `sonne-1200` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · kurze Schatten nach Norden, Sonnenglitzer auf dem See |
| `sonne-1700.png` | `sonne-1700` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · goldener Nachmittag, lange Schatten nach Osten, kein Sprung am Bildrand |
| `wolkenschatten.png` | `wolkenschatten` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Wolkenschatten und Blätterdach-Sprenkel in Dither-Stufen |
| `wolkenschatten-spaeter.png` | `wolkenschatten-spaeter` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Schatten windabwärts weitergezogen (Vergleichsbild des E2E-Tests) |
| `mond-voll.png` | `mond-voll` | L ✓ (Figur ohne Fackel kaum sichtbar – gewollt) · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · kühles gerichtetes Mondlicht, Mond mit Glitzerpfad und Sterne im See, Glühwürmchen |
| `mond-neu.png` | `mond-neu` | L ✓ (bewusst fast schwarz) · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Finstermond ohne Mond und Schatten |
| `fackel-schatten.png` | `fackel-schatten` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · weiche Schatten von Stämmen und Felsen weg von jeder Flamme |
| `sammeln-feedback.png` | `sammeln-feedback` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Fortschrittsring, Späne, Staub |
| `zustand-frierend.png` | `zustand-frierend` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Zitterstriche, Atem, Eis mit Rissen |
| `schwimmen.png` | `schwimmen` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Eintauchmaske, Wellenring, Kaustiken |
| `debug-inspektor.png` | `debug-inspektor` | Werte und Text pixelgleich; die Tafel ist halbtransparent, darin scheint die veränderte Welt durch ✓ |
| `hud-voll.png` | `hud-voll` | U ✓ pixelgleich zur Referenz (Tafeln, Texte, Symbole); anders ist nur die Welt dahinter bzw. darum (Regenstrand: nasser Boden mit blassen Pfützenflächen, → POLISH Pfützen bei Tag) ✓ |
| `hud-kontextuell.png` | `hud-kontextuell` | U ✓ pixelgleich zur Referenz (Tafeln, Texte, Symbole); anders ist nur die Welt dahinter bzw. darum ✓ |
| `hud-minimal.png` | `hud-minimal` | U ✓ pixelgleich zur Referenz (Tafeln, Texte, Symbole); anders ist nur die Welt dahinter bzw. darum ✓ |
| `ui-handwerk.png` | `ui-handwerk` | U ✓ pixelgleich zur Referenz (Tafeln, Texte, Symbole); anders ist nur die Welt dahinter bzw. darum (13–15 % der Pixel, höchstens 59/255) ✓ |
| `ui-station.png` | `ui-station` | U ✓ pixelgleich zur Referenz (Tafeln, Texte, Symbole); anders ist nur die Welt dahinter bzw. darum ✓ |
| `ui-station-ofen.png` | `ui-station-ofen` | U ✓ pixelgleich zur Referenz (Tafeln, Texte, Symbole); anders ist nur die Welt dahinter bzw. darum ✓ |
| `ui-kiste.png` | `ui-kiste` | U ✓ pixelgleich zur Referenz (Tafeln, Texte, Symbole); anders ist nur die Welt dahinter bzw. darum ✓ |
| `ui-station-reparatur.png` | `ui-station-reparatur` | U ✓ pixelgleich zur Referenz (Tafeln, Texte, Symbole); anders ist nur die Welt dahinter bzw. darum ✓ |
| `ui-kiste-suche.png` | `ui-kiste-suche` | U ✓ pixelgleich zur Referenz (Tafeln, Texte, Symbole); anders ist nur die Welt dahinter bzw. darum ✓ |
| `hud-tracker.png` | `hud-tracker` | U ✓ pixelgleich zur Referenz (Tafeln, Texte, Symbole); anders ist nur die Welt dahinter bzw. darum ✓ |
| `ui-herdfeuer.png` | `ui-herdfeuer` | U ✓ pixelgleich zur Referenz (Tafeln, Texte, Symbole); anders ist nur die Welt dahinter bzw. darum ✓ |
| `ui-herdfeuer-aus.png` | `ui-herdfeuer-aus` | U ✓ pixelgleich zur Referenz (Tafeln, Texte, Symbole); anders ist nur die Welt dahinter bzw. darum ✓ |
| `bau-blaupausen.png` | `bau-blaupausen` | Leisten, Bedarfszeile, Geister pixelgleich; Welt mit M5-Licht ✓ |
| `ui-baumenue.png` | `ui-baumenue` | Kategorien, Werkzeugleiste, Hinweise, grüner Geist pixelgleich; Welt mit M5-Licht ✓ |
| `bau-vorschau.png` | `bau-vorschau` | roter Geist, Begründung und Statuszeile pixelgleich ✓ |
| `bau-blaupause.png` | `bau-blaupause` | Blaupausen, Schalter, Bedarf pixelgleich ✓ |
| `bau-abbauen.png` | `bau-abbauen` | Felder, „Dismantle 8“, Statuszeile pixelgleich ✓ |
| `bau-aufwerten.png` | `bau-aufwerten` | Steinwände, Kosten, Rückgabe pixelgleich ✓ |
| `bau-reparieren.png` | `bau-reparieren` | Rechteck, Felder, „2× Plank“ pixelgleich ✓ |
| `overlay-raeume.png` | `overlay-raeume` | Overlay und Legende pixelgleich; Welt mit M5-Licht ✓ |
| `overlay-raumtemperatur.png` | `overlay-raumtemperatur` | Overlay und Legende pixelgleich ✓ |
| `overlay-licht.png` | `overlay-licht` | Overlay und Legende pixelgleich ✓ |
| `overlay-behaglichkeit.png` | `overlay-behaglichkeit` | „Comfort 14/20“ und Legende pixelgleich ✓ |
| `overlay-stuetzen.png` | `overlay-stuetzen` | Stützen, Abstände, Legende pixelgleich ✓ |
| `haus-aussen.png` | `haus-aussen` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Holzhaus mit Sonnenschatten, Marker an der Tür |
| `haus-innen.png` | `haus-innen` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Fackelschein bleibt in den Wänden (M5-34) |
| `basis-aussen.png` | `basis-aussen` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Herdfeuer bei Tag ohne Hof (ADR-0071) |
| `basis-innen.png` | `basis-innen` | L ✓ · P ✓ · S ✓ · Li ✓ Kamin- und Lampenschein nur innen (M5-34 behoben); Tisch wirft einen großen harten Schatten · A ✓ · U ✓ |
| `stationen-nacht.png` | `stationen-nacht` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Meiler, Öfen und Lagerfeuer werfen Licht (M5-35) |
| `brand.png` | `brand` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Feuerschein um die Quelle, nicht nördlich versetzt (M5-34 behoben), Funken und Rauch |
| `nebel-innen.png` | `nebel-innen` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · im Raum nur Dunst im Lampenlicht, draußen Nebelbänke, kein Schein durch die Wände |
| `hitzeflimmern.png` | `hitzeflimmern` | L ✓ · P ✓ · S ✓ · Li ✓ (Wolkenschatten trotz Hitzewelle mit Bedeckung 0 → POLISH Wolken) · A ✓ · U ✓ · Zeilenversatz in ganzen Pixeln |
| `bloom.png` | `bloom` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Flammen glühen über, Schein in Bayer-Stufen |
| `schockwelle.png` | `schockwelle` | L ✓ · P ✓ · S ✓ · Li ✓ (Wolkenschatten bei „Klar“ dunkel wie Rußflecken, → POLISH Wolken) · A ✓ · U ✓ · Ring in ganzen Pixeln |
| `daemmerung-gruenhain-1700.png` | `daemmerung-gruenhain-1700` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · später Nachmittag, See blau |
| `daemmerung-gruenhain-1800.png` | `daemmerung-gruenhain-1800` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Sonnenuntergang, noch neutral |
| `daemmerung-gruenhain-2030.png` | `daemmerung-gruenhain-2030` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Nacht, kühles Blau, Fackelinsel |
| `effekt-furcht.png` | `effekt-furcht` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Ranken vom Rand, Farben entsättigt |
| `effekt-leben.png` | `effekt-leben` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · roter Rand als glattes Band |
| `effekt-kaelte.png` | `effekt-kaelte` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · kalte Entsättigung, Frostfinger |
| `effekt-hitze.png` | `effekt-hitze` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · warmer Stich, Zeilenflimmern |
| `effekt-erschoepfung.png` | `effekt-erschoepfung` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Lider halb geschlossen |
| `effekt-gift.png` | `effekt-gift` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Giftrand in Flecken |
| `effekt-rausch.png` | `effekt-rausch` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Wellen und blasses Doppelbild |
| `effekt-uebergang.png` | `effekt-uebergang` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · 2 × 2-Zellen vom Rand |
| `verderbnis-voll.png` | `verderbnis-voll` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ (Adernmuster wiederholt sich messbar alle 704 px, hier von den Flecken gebrochen → BUG Adern-Kachel) · U ✓ · Adern nur im Gelände, Fackel bleibt warm; See lavendel (Dämmerungshimmel, schwächer als 18:45) |
| `verderbnis-halb.png` | `verderbnis-halb` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Flecken mit Bayer-Saum; See lavendel (wie `verderbnis-voll`) |
| `partikel.png` | `partikel` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Rauch von unten orange, Lumen-Sturm türkis, Glühwürmchen |
| `partikel-20000.png` | `partikel-20000` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Stressbild |
| `partikel-gewitter.png` | `partikel-gewitter` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Blitzschleier, Regen im Fackelschein |
| `regen.png` | `regen` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ (Pfützen bei Tag als blasse Flächen ohne Rand → POLISH Pfützen) · U – · Windwinkel, Parallaxe, Spritzer |
| `schnee.png` | `schnee` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Flocken in drei Schichten |
| `ascheregen.png` | `ascheregen` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · rauchig, glimmende Glut |
| `sandsturm.png` | `sandsturm` | L ✓ (bewusst verschleiert) · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Schleier in Windrichtung |
| `gras-interaktiv.png` | `gras-interaktiv` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Halme um die Füße niedergedrückt |
| `kronen-dither.png` | `kronen-dither` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Kreis weltfest im Bayer-Muster |
| `herbst.png` | `herbst` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Laub Baum für Baum im Übergang |
| `winter-schnee.png` | `winter-schnee` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ (Marker-Text „… bears nothing right now – come back in its season“ läuft über die halbe Bildbreite → POLISH Szenario) · Schneecluster, Hauben auf Kiefern |
| `fussspuren.png` | `fussspuren` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · alte Spur flach, frische tief |
| `regen-nacht-pfuetzen.png` | `regen-nacht-pfuetzen` | L ✓ (dunkel, gewollt) · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Flammen spiegeln in Pfützen |
| `gruenhain-nacht.png` | `gruenhain-nacht` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Glühwürmchen, Fackelinsel, Sterne im See |
| `hoehle-fackeln.png` | `hoehle-fackeln` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Umgebungslicht ≈ 0, nur Fackeln und Leuchtpilze |
| `shader-outline.png` | `shader-outline` | L ✓ · P ✓ · Li ✓ · A ✓ 1-px-Umriss in Akzentfarbe · S/U – |
| `shader-weissblitz.png` | `shader-weissblitz` | L ✓ · P ✓ · Li ✓ · A ✓ · S/U – |
| `shader-palettentausch.png` | `shader-palettentausch` | L ✓ · P ✓ · Li ✓ · A ✓ Pixel für Pixel nach Rampenstufe · S/U – |
| `shader-dither.png` | `shader-dither` | L ✓ · P ✓ · Li ✓ · A ✓ · S/U – |
| `wasser-ufer.png` | `wasser-ufer` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ (Kiesel des Seegrunds im 16-px-Raster → POLISH) · U ✓ · Kaustiken nur im Flachen, Uferschaum |
| `wasser-spiegelung-tag.png` | `wasser-spiegelung-tag` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Figur und Bäume gespiegelt |
| `wasser-spiegelung-nacht.png` | `wasser-spiegelung-nacht` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Mond, Sterne und Feuer im See |
| `wasser-wellen.png` | `wasser-wellen` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Ringe um Figur und Tropfen |
| `wasser-eis.png` | `wasser-eis` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U ✓ · Eis mit Rissen, Tiefblau darunter |
| `debug-albedo.png` | `debug-albedo` | Palettenfarben ohne Licht, Beschriftung lesbar ✓ |
| `debug-normalen.png` | `debug-normalen` | Boden lavendel, Relief an Stämmen, Kronen, Felsen, Klippen ✓ |
| `debug-hoehe.png` | `debug-hoehe` | Boden je Stufe, Stämme und Kronen hell nach Höhe ✓ |
| `debug-emissiv.png` | `debug-emissiv` | nur Flammen und Glut ✓ |
| `debug-sonnenschatten.png` | `debug-sonnenschatten` | lange Silhouetten nach Osten, Klippe als Band ✓ |
| `debug-licht.png` | `debug-licht` | Punktlicht allein, weiche Stammschatten ✓ |
| `debug-gi.png` | `debug-gi` | leer, Beschriftung „nicht aktiv“ ✓ |
| `debug-lichtkarte.png` | `debug-lichtkarte` | gelb/oliv, wo Gameplay- und Render-Licht übereinstimmen ✓ |
| `debug-naesse.png` | `debug-naesse` | Pfützen hell, trocken unter den Kronen ✓ |
| `debug-nebel.png` | `debug-nebel` | driftende Bänke, höheres Gelände dunkel ✓ |
| `biom-gruenhain-tag.png` | `biom-gruenhain-tag` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Sommer 12:00: satte Grüns, kurze Schatten, Klippe mit Treppe, See mit Uferschaum |
| `biom-gruenhain-nacht.png` | `biom-gruenhain-nacht` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Halbmond 23:00: kühles Blau, Glühwürmchen, Sterne im See, Fackelinsel |
| `biom-salzkueste-tag.png` | `biom-salzkueste-tag` | L ✓ · P ✓ · S ✓ · Li ✓ (Wolkenschatten bei „Klar“ als dunkles Band rechts → POLISH Wolken) · A ✓ · U – · Sommer: heller Sand, türkises Dünengras, Kiefern; der Schauplatz zeigt Dünenwald, nicht die Küste |
| `biom-salzkueste-daemmerung.png` | `biom-salzkueste-daemmerung` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · 20:15: Sand warm, Fackel golden |
| `biom-salzkueste-nacht.png` | `biom-salzkueste-nacht` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · marineblau, Fackelinsel mit weichen Stammschatten |
| `biom-nebelmoor-tag.png` | `biom-nebelmoor-tag` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Herbst: entsättigt grünlich-grau, Torf und nebelgraue Wiese, flacher Kontrast |
| `biom-nebelmoor-daemmerung.png` | `biom-nebelmoor-daemmerung` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · 18:45: gedämpft, Fackelschein diffus |
| `biom-nebelmoor-nacht.png` | `biom-nebelmoor-nacht` | L ✓ (dunkel, Weg lesbar) · P ✓ · S ✓ · Li ✓ · A ✓ · U – · petrolblau-schwarz |
| `biom-frostkamm-tag.png` | `biom-frostkamm-tag` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Winter: strahlendes Weiß, blaue Schatten, Gletschereis mit Rissen, verschneite Tannen |
| `biom-frostkamm-nacht.png` | `biom-frostkamm-nacht` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · stahlblau, Sterne, Fackel besonders warm |
| `biom-glutsand-tag.png` | `biom-glutsand-tag` | L ✓ · P ✓ · S ✓ · Li ✓ (Wolkenschatten bei „Klar“ 38 % dunkler als der Sand → POLISH Wolken) · A ✓ · U – · Sommer: gebleichter Sand, Oase, Palmen, Sandsteinstufen |
| `biom-glutsand-nacht.png` | `biom-glutsand-nacht` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · kalt-violett gekippt, Sterne in der Oase |
| `biom-aschenschlund-tag.png` | `biom-aschenschlund-tag` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Sommer: dunkle Asche, glühende Halmspitzen und Risse, Klippenstufen |
| `biom-aschenschlund-daemmerung.png` | `biom-aschenschlund-daemmerung` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Glut tritt hervor |
| `biom-aschenschlund-nacht.png` | `biom-aschenschlund-nacht` | L ✓ (sehr dunkel: nur Glut und Fackelinsel; Kronen zerfallen in schwebende Glutfetzen → POLISH Nacht-Lesbarkeit) · P ✓ · S ✓ · Li ✓ · A ✓ · U – |
| `biom-scherbenhain-tag.png` | `biom-scherbenhain-tag` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · Frühling: kühl-pastellig, Kristallbäume, Prismenquarz, See |
| `biom-scherbenhain-nacht.png` | `biom-scherbenhain-nacht` | L ✓ · P ✓ · S ✓ · Li ✓ · A ✓ · U – · tiefviolett, Kristalle leuchten, Sterne im See |
