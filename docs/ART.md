# ART – Stilregeln, Farbidentität und Kritik-Checkliste

Verbindlich für jedes Sprite in `assets-src/sprites/**`. Ergänzt MASTERPROMPT §4 und §5 sowie docs/RENDER.md. Wer eine Regel bricht, begründet es im Sprite (`ausnahmeFarben`, `einzelpixel`) oder per ADR.

## 1. Leitbild
- **Kernbild:** warme Lichtinseln in kühler, bedrohlicher Dunkelheit. Tagsüber gedämpft-satte Farben; jedes entzündete Leuchtfeuer macht die Welt sichtbar lebendiger.
- **Perspektive:** 3/4-Top-Down wie auf dem SNES. Oberseiten sieht man von oben, Vorderseiten von Süden. Die Spielfigur blickt nach unten, oben, links oder rechts.
- **Arbeitsteilung:** Der Albedo zeigt Material und Form. Licht, Schatten und Glanz rechnet der Renderer über Normalen, Höhe, Emissiv und Materialflags (RENDER.md §2). Ein Sprite ist deshalb nie „beleuchtet gemalt“.
- **Maßstab:** handgemachte 16-Bit-Pixelart. Das Ergebnis darf nie wie Rauschen oder Programmierergrafik aussehen. Generatoren liefern Entwürfe oder Varianten; was in `assets-src/` steht, ist bewusst gesetzt.

## 2. Handwerksregeln (§4.5)
### 2.1 Silhouette
- Jedes Objekt ist als einfarbige Fläche erkennbar; die Emissiv-Ansicht des Kontaktbogens zeigt genau das.
- Große Formen kommen vor Details. Die Kontur hat wenige, klare Richtungswechsel, und Ausbuchtungen sind mindestens 2 px breit.
- Figuren bleiben in allen vier Richtungen verschieden und lesbar: Profil mit Nase und einem Auge, Rücken ohne Gesicht.

### 2.2 Farbcluster
- Farben stehen in bewussten Flächen von mindestens 2 zusammenhängenden Pixeln derselben Farbe. Kein Streusel, kein Rauschen und kein Schachbrett-Dither im Albedo; Dither-Übergänge macht der Shader.
- **Einzelpixel** sind nur erlaubt, wenn sie an einem Cluster hängen (z. B. eine Halmspitze auf ihrem Halm oder eine Pupille) oder im Sprite mit `einzelpixel: 'Begründung'` erklärt sind (Funken, Glanzpunkte). Der Paletten-Validator warnt sonst.
- Texturmotive (Halme, Schollen, Blattkappen) wiederholen eine Formsprache, aber nie im gleichen Abstand.

### 2.3 Schattierung: AO statt Richtung
- **Weiche Form-Schattierung** nach Himmelsöffnung: Oberseiten hell, weil sie den Himmel sehen; Unterseiten, Fugen und Kontaktstellen dunkel (Umgebungsverdeckung). Links und rechts werden gleich behandelt.
- **Keine harten Richtungs-Highlights** und keine Schlagschatten im Sprite, weil gerichtetes Licht über die Normal-Maps kommt. Die Probe dafür ist die Licht-Vorschau in `normals.png`: Licht von links und von rechts müssen beide glaubhaft wirken.
- **Kein Pillow-Shading:** Schatten folgen nicht ringförmig der Kontur. Dunkel wird es dort, wo etwas verdeckt, also am Fuß, unter Überhängen und hinter vorderen Massen.
- **Kein Banding:** Keine parallelen, gleich breiten Farbbänder. Übergänge zwischen Stufen sind gewellt oder gebuchtet, z. B. als Blattkappen, Schollen oder Faltenzüge.

### 2.4 Kontur
- **Selektive Outline** in der dunkelsten Stufe der eigenen Rampe: Krone `gras.0`, Stamm `holz.0`, Fels `stein.0`. Figuren, Items und Lichtquellen nutzen `nacht.1`, weil es auf jedem Biomgrund trennt. Reines Schwarz gibt es in der Palette nicht; `nacht.0` ist den tiefsten Innenschatten vorbehalten.
- Der Bodenkontakt wird mit 1–2 Pixeln `nacht.1` an den Fußecken verankert (Felsen) oder über die Sohle (Figuren).
- Innenlinien stehen nur dort, wo die Form sie braucht: Rindenfurchen, Risse, Gürtel. Doppelkonturen gibt es nicht.
- Die Interaktions-Outline (1 px, Akzentfarbe, §4.6) zeichnet der Shader. Sprites backen sie nie ein.

### 2.5 Linien
- Keine Jaggies: Stufenlängen einer Linie wachsen oder fallen monoton (1-1-2-2-3), nie 1-3-1. Rundungen bestehen aus symmetrischen Stufenfolgen.
- Senkrechte Kanten schwanken in Läufen von mindestens 3 px, nicht Pixel für Pixel (siehe Grasrand links/rechts).

### 2.6 Farben und Rampen
- Höchstens **12 Farben je Sprite inklusive Kontur** (§4.3). Ausnahmen gibt es nur mit `ausnahmeFarben: 'Begründung'`.
- **Ein Material, eine Rampe.** Palettenzeilen färben ganze Rampen um (Jahreszeit, Biom, Elite, Stufe, Charakteranpassung). Deshalb teilen sich zwei Materialien, die unabhängig umfärbbar sein sollen, keine Rampe. Beim Spieler heißt das: Haar `holz`, Haut `haut`, Kleidung `wasser`, Leder `erde`, Kontur `nacht` (§26 Charaktererstellung: Haut- und Haarpaletten, Kleidungsfarben).
- Laubige Vegetation (Kronen, Büsche, Gras) wird mit `gras` gezeichnet, von Natur aus rotes oder goldenes Laub mit `laub`. Werkzeugköpfe entstehen in `stein` und werden über die Materialstufen-Zeilen umgefärbt. Nur T0 Stein bekommt eine eigene Form aus geschlagenem Stein mit Schnurbindung (gleiche Zelle, gleicher Anker, gleiche Sockel; `materialStufen(…, eigeneFormen)`), weil ein grau umgefärbter Metallkopf kein Steinwerkzeug ist. Die Stufenrampen unterscheiden sich im Farbton, nicht nur in der Helligkeit: Eisen dunkel und stumpf, Stahl hell und silbern, Bronze braun-kupfern, Sonnenstahl goldgelb (`tests/unit/assets/werkzeug-stufen.test.ts`).
- Emissiv (`*`) bekommen nur Pixel, die selbst Licht abgeben: Flammen, Glut, Lava, Kristallkanten, Augen der Schattenbrut.

### 2.7 Materialflags und Höhen-Hinweise
| Objekt | Höhen-Hinweis | Materialflags | Occluder |
|---|---|---|---|
| Bodentile, Pfützen, Teppiche | `flach` | `nass` bei Pfützen | – |
| Figuren, Stämme, Pfosten, Fackeln | `zylinder` | `metall` an Beschlägen | Figuren `none`, Pfosten `rect` |
| Kronen, Büsche, runde Kreaturen | `kugel` | Krone: `dach` + `wind`; Busch: `wind` | Ellipse am Stammfuß |
| Felsen, Kisten, Mauersteine, Truhen | `block` | `metall` an Beschlägen, `eis` bei Eis | Ellipse/Rechteck der Standfläche |
| Sonderformen (Klippen, Treppen) | `custom` mit `hoehenRaster` | je Material | `sprite` |

## 3. Größen, Raster, Anker (§4.4)
| Objekt | Zelle | Inhalt | Anker (Fußpunkt) |
|---|---|---|---|
| Bodentile | 16×16 | voll deckend, 3–4 Varianten als Frames | `[0, 0]` (links oben) |
| Spieler, Siedler | 32×32 | Körper ≈ 16×24: Kopf 11, Rumpf 10, Beine 3 Zeilen | `[16, 31]` |
| Kreaturen | klein 16×16 · mittel 32×32 · groß 48–64 | – | Mitte der Standfläche |
| Bosse | 96–160 px, auch mehrteilig | – | Mitte der Standfläche |
| Bäume | 32×48 bis 64×96 | Krone ≈ ⅔ der Höhe, Stamm mit Wurzelansatz | Stammfuß |
| Felsen | 16×16 / 32×32 | Fuß in der untersten Konturzeile | Mitte der Standfläche |
| Icons | 16×16 (UI ×2/×3) | Motiv ≤ 14×14, 1 px Luft | – |
| Lichtquellen | Wandfackel 16×16 · stehende Fackel 16×32 | Flamme der stehenden Fackel knapp über Kopfhöhe der Figur, Pfahl zwischen Keilsteinen | Fußpunkt (Wand: Griffende) |
| Klippen | 16 px sichtbare Wand je Höhenstufe | Rampen und Treppen klar lesbar | – |

- **Kacheln sind nahtlos in jeder Anordnung.** Motive liegen vollständig in der Kachel, und der Rand besteht überwiegend aus der Grundfarbe. So treffen sich zwei Varianten immer auf Grundfarbe. Die Varianten werden gewichtet gestreut: ruhige Varianten häufig, auffällige selten (Grünhain-Gras 3 : 3 : 3 : 1, Erde 2 : 2 : 3 : 1). Gegen das 16-px-Raster tragen die Varianten Motive verschiedener Größe und Helligkeit (Halmgruppen, helle Büschel, ein dunkles Büschel) an je anderer Stelle; kein Motiv sitzt in allen Varianten in derselben Zeile, dazwischen bleiben große Flächen Grundton.
- **Übergänge (Autotiling, M2-16/17):** Das höher liegende Terrain zeichnet den Rand. Gras liegt über Erde und zeigt deshalb einen dunklen Saum (`gras.2`) über einem AO-Streifen auf der Erde (`erde.1`). Liegt das Gras unten, stechen helle Halmspitzen in die Erde. Wasser liegt immer unten, Schnee immer oben. Der Saumverlauf endet an gegenüberliegenden Kanten auf derselben Höhe; das Muster ist `boden_gras_kante`.
- **Sockel** (Hände, Kopf, Lichtpunkt) sind Pixelkoordinaten in der Zelle und stehen je Frame auf dem Griff- bzw. Ansatzpixel.

## 4. Animation (§4.5)
- **Prinzipien:** Antizipation vor jeder Aktion (Ausholpose ≥ 2 Frames), Überschwingen und Nachziehen (Haar, Saum, Flammenspitzen), Smear-Frames bei schnellen Bögen. Nie springt ein Pixelcluster ohne Grund mehr als 1 px.
- **Takt:** Figuren 8–12 fps, Effekte schneller (Feuer 10–12, Funken bis 20). Längere Haltephasen entstehen durch wiederholte Frames im Clip, nicht durch mehr Zeichnungen.
- **Namen:** `<aktion>_<richtung>` mit `down | up | left | right` (Renderer-Konvention `src/render/anim/figure.ts`). Spiegeln ist nur mit `spiegelbar: true` erlaubt; wer asymmetrisch ist (Scheitel, Waffe, Schild), zeichnet links und rechts eigens.
- **Idle als Welle:** Kopf sinkt vor, Rumpf folgt, Kopf hebt sich, während der Rumpf noch unten ist. Das sind vier Frames, Ruhe- und Tiefpunkt je drei Bilder gehalten, bei 8 fps ein Zyklus pro Sekunde (`spieler_koerper`).
- **Ausrüstung** sitzt als Layer auf Sockeln (`hand`, `nebenhand`, `kopf`), die jedem Frame folgen. Die Nebenhand trägt das Licht (§12.2).

## 5. Farbidentität der Biome
Jedes Biom hat einen Grundton (Flächen), Akzente (seltene, lesbare Farben), eine Nachtfarbe (Ton der Dunkelheit bzw. Höhlenschwärze) und eine Grading-Absicht (Biom × Tageszeit × Wetter, §6.1 Pass 9). Gemeinsam genutzte Sprites sind in Grünhain-Farben gezeichnet; die Palettenzeile `biom_<id>` tönt `gras`, `erde`, `stein`, `holz` und `laub` in die Identität des Bioms (`assets-src/paletteRows.ts`, `BIOME_TINTS`). Eigene Biom-Tiles (Sand, Schnee, Asche, Kristall) zeichnen direkt in ihren Grundtönen. Jede Tönung verschiebt den Farbton der Wiese (`gras.3`), nicht nur ihre Helligkeit: eine bloß dunklere Grünhain-Wiese liest sich als Grünhain in der Dämmerung. `tests/unit/assets/biom-abstand.test.ts` misst den Farbabstand des Landschaftsbilds je Biompaar (Helligkeit halb gewichtet).

| Biom | Ebene | Grundton | Akzent | Nachtfarbe | Grading-Absicht |
|---|---|---|---|---|---|
| Grünhain (`gruenhain`) | 0 | `gras.3` `gras.2` `erde.2` `holz.2` | `laub.4` Blütengold · `sand.4` Rahmblüten · `laub.2` Beeren | `wasser.1` | Tag warm-neutral, satte Grüns, weiche Kontraste, goldene Lichter; Dämmerung orange-rosa; Nacht kühles Blau mit violetten Schatten. Referenz aller Tönungen. |
| Salzküste (`salzkueste`) | 0 | `sand.3` `sand.2` `wasser.3` `stein.4` | `eis.3` Gischt und Salz · `laub.3` Tang und Koralle · `wasser.5` Brandung | `wasser.0` | Hell und luftig, leicht cyanfarbene Lichter, hoher Weißanteil, dunstige Ferne; Wiese = heller Sand mit türkisem Dünengras; Nacht marineblau mit silbernem Mondlicht auf dem Wasser. |
| Nebelmoor (`nebelmoor`) | 0 | `stein.3` `gras.1` `erde.1` `stein.2` | `gras.5` Moorgas und Irrlichter · `eis.2` Nebelschwaden · `laub.2` Moorbeeren | `gras.0` | Entsättigt, grünlich-grau, flacher Kontrast; Wiese nebelgrau mit petrolgrünen Halmen; Nebel hebt die Schatten an, Lichter wirken diffus; Nacht petrolschwarz. |
| Frostkamm (`frostkamm`) | 0 | `eis.2` `eis.3` `stein.2` `eis.0` | `laub.2` Frostbeeren · `wasser.4` Gletschereis · `eis.4` Glitzern | `eis.0` | Kalt, blaue Schatten, strahlendes Weiß, geringe Sättigung – Feuer wirkt hier besonders warm; Nacht klar und stahlblau. |
| Glutsand (`glutsand`) | 0 | `sand.2` `sand.3` `erde.3` `laub.3` | `wasser.4` Oase · `gras.4` Palmen und Kakteen · `feuer.4` Sonnenglast | `verderb.1` | Heiß: gebleichte Lichter, warmgelbe Mitteltöne, harte Mittagskontraste, Hitzeflimmern; die Nacht kippt kalt-violett (8 °C). |
| Aschenschlund (`aschenschlund`) | 0 | `nacht.2` `stein.1` `stein.2` `nacht.3` | `feuer.3` `feuer.4` Lava und Glut · `laub.2` glimmende Halmspitzen · `sand.3` Schwefel | `feuer.0` | Dunkel und rauchig-entsättigt, Rot-Orange steigt aus der Tiefe, hoher Kontrast zwischen Asche und Glut; Ascheregen dämpft alles. |
| Scherbenhain (`scherbenhain`) | 0 | `wasser.3` `eis.1` `eis.2` `nacht.3` | `verderb.4` Prismenviolett · `eis.4` Lichtfunken · `wasser.5` Kristalltürkis | `verderb.1` | Kühl-pastellig, helle Lichter mit Bloom, prismatische Farbsäume, Lichtanomalien; Nacht tiefviolett mit leuchtenden Kristallen. |
| Nachtherz (`nachtherz`) | 0 | `nacht.2` `verderb.1` `nacht.3` `verderb.2` | `verderb.4` glühende Adern · `eis.4` umgekehrtes Licht · `verderb.3` | `nacht.0` | Umgekehrtes Licht: Lichtquellen kalt-weiß, Schatten violett glühend, stark entsättigt, schwere Vignette. Hier heilt die Welt zuletzt. |
| Wurzelhöhlen (`wurzelhoehlen`) | −1 | `holz.1` `erde.0` `erde.1` `gras.2` | `wasser.4` `wasser.5` Leuchtpilze · `sand.3` Harz und Bernstein | `erde.0` | Umgebungslicht ≈ 0, erdig-warmes Dunkel; Boden aus Wurzelbraun mit Moosspitzen, Wege dunkler festgetreten; Fackeln tragen die Szene, Pilze setzen türkise Inseln. |
| Tiefgrund (`tiefgrund`) | −2 | `stein.1` `stein.2` `wasser.2` `stein.0` | `eis.2` Kristalladern · `wasser.5` · `sand.3` Gold- und Erzglanz | `wasser.0` | Kalt und blaugrau, sparsam; tiefblaue Flechten am Boden, Kristalle leuchten kühl, Erbauer-Ruinen stehen als helle Blöcke. |
| Glutadern (`glutadern`) | −3 | `nacht.1` `erde.0` `laub.0` `feuer.1` | `feuer.3` `feuer.4` Lava · `wasser.4` Lumenit-Adern | `feuer.0` | Heiß: tiefrote Schatten, Orange von unten, Hitzeflimmern; Lumenit als kalter Gegenpol. |

- **Kontaktbogen:** `npx tsx tools/assets/tile-preview.ts` schreibt `tools/out/sheets/biome.png`. Er zeigt dieselbe Kleinszene (Gras, Weg, Baum, Felsen, Spieler) durch jede Biomzeile, darunter die Felder für Grundton, Akzent und Nacht.
- **Jahreszeiten** gelten für Laub (Kronen, Büsche): Zeilen `fruehling`, `sommer`, `herbst` und `winter` tauschen nur `gras`/`laub`. Bodentiles tragen die Biomzeile; der Winter kommt über die Schneemaske des Renderers (§6.2). Braucht ein Objekt Biom und Jahreszeit zugleich, wird die Kombination als eigene Zeile vorberechnet.
- **Verderbnis** (`verderbnis`) kippt alles dunkel-violett und fahl und weicht mit jedem Leuchtfeuer. Die Biomzeile des Nachtherzens ist ihre stärkste Form.

## 6. Raritätsfarben
Überall gleich (§4.5): Rahmen im Inventar, Name im Tooltip, Aufsammel-Meldung, Beutestrahl. Die Quelle ist `RARITY_COLORS` in `assets-src/palette.ts`.

| Rarität | Farbe | Palette |
|---|---|---|
| Gewöhnlich | Weiß | `eis.4` |
| Ungewöhnlich | Grün | `gras.4` |
| Selten | Blau (Türkisblau, hebt sich von Grün und Violett ab) | `wasser.4` |
| Episch | Violett | `verderb.4` |
| Legendär | Gold | `feuer.4` |

Raritätsfarben erscheinen im Weltbild nur an Beute und Beutestrahl. Ein Sprite trägt seine Rarität nicht als Farbe; die Rarität kommt aus den Daten.

## 7. Gefahren-Bildsprache (§4.6)
Jede Gefahr hat eine **eigene Farbfamilie** (nie die Grundfarbe des Bioms, in dem sie liegt), eine **Bewegungssignatur**, eine **Vorwarnung** vor dem ersten Schaden, **Lesbarkeit bei Nacht** und dieselbe **Formsprache** in Welt, Icon und Statuseffekt.

| Gefahr | Farbfamilie | Form | Bewegung | Vorwarnung | Nacht |
|---|---|---|---|---|---|
| Gift (Moorseen, Giftdrüsen, Gaswolken) | fahles Giftgrün `gras.5`/`gras.4` über Petrol `gras.0`, Schaumrand `sand.4` | Kreise: Blasen, runde Pfützenränder, Tropfen | blubbern: Blasen steigen und platzen (3 Frames), Gas wabert langsam | grüner Dunst 1 s vor dem Austritt, Blasen verdichten sich | Blasenkerne schwach emissiv (`gras.5*`) |
| Lava | Glut `feuer.3*`–`feuer.5*` unter Kruste `nacht.1`/`erde.0` | Adern und Risse, die glühen; zähe Zungen | fließende Rauschtextur, Kruste bricht auf, Hitzeflimmern | Kruste glüht heller, bevor sie bricht; Funken steigen | immer emissiv – das hellste Element jeder Szene |
| Einsturz (Stollen, Klippenrand, Höhlendecke) | Staub `sand.2`/`stein.4`, Risse `stein.0`/`nacht.1` | Zacken: Radialrisse, Geröll | Risse wachsen in Schüben, Steinchen rieseln, 1 px Erschütterung | Staubrieseln und wachsende Risse 2 s vor dem Fall; die Fallzone ist als Rissring am Boden markiert | Staub hellt den Lichtkegel auf; Rissring als `nacht.1`-Kontur |
| Treibsand | Sand `sand.1`/`sand.0`, matt, ohne Glanzpunkte | Spiralen und konzentrische Rillen (anders als Dünenrippen, die parallel liegen) | langsames Kreisen (4 Frames), einsinkende Körnchen | feuchter, dunklerer Rand `sand.0`; Spuren verschwinden darin | Rillen fangen Streiflicht über die Normalen (`custom`-Höhenraster) |

## 8. Lesbarkeit (§4.6)
- **Figur vor Grund:** Der mittlere Helligkeitswert einer Figur weicht deutlich vom Biomgrund ab. Der Spieler (`wasser.2`, L 0,44) steht vor Gras (`gras.3`, L 0,58) dunkler, vor Schnee und Sand ebenso; in Asche und Tiefgrund tragen Kontur und Hautpartien.
- **Gegner** heben sich in jedem Biom und nachts ab: emissive Augen (`feuer.4*`, `eis.4*` oder `verderb.4*` je Art), Kontur `nacht.1`, Rim-Licht über das Normal-Mapping. Die Schattenbrut ist violett (`verderb`); diese Farbfamilie gehört sonst nur Verderbnis, Nachtherz und Episch.
- **Interagierbares** unter dem Cursor oder in Reichweite bekommt eine 1-px-Outline in der Akzentfarbe (`UI_COLORS.akzent`, Shader). Sprites lassen dafür 1 px Luft zum Zellrand.
- **Telegraphs:** Ausholpose über mindestens 2 Frames, dazu ein kurzer Glint (1–2 Frames, emissiv `eis.4*`) und ein Sound. Boss-Flächenangriffe markieren den Boden (`UI_COLORS.warnung`, im Shader gedithert) vor dem Treffer.

## 9. Kritik-Checkliste für Kontaktbögen
Nach jeder Sprite-Serie: `npm run assets`, danach `npx tsx tools/assets/tile-preview.ts`. Die Bögen in `tools/out/sheets/` werden mit dem Read-Werkzeug geöffnet und Punkt für Punkt geprüft. Ein Punkt gilt erst als bestanden, wenn er auf dem Bogen sichtbar erfüllt ist.

1. **Silhouette:** In der Emissiv-Ansicht (dunkle Fläche) ist das Objekt erkennbar, die Richtung einer Figur eindeutig.
2. **Werte:** mindestens drei Helligkeitsgruppen; oben hell, unten und in Fugen dunkel. Kein Schattenring entlang der Kontur (Pillow).
3. **Cluster:** keine Streupixel, kein Rauschen, kein Schachbrett; der Validator meldet keine Einzelpixel.
4. **Kontur:** selektiv, dunkelste Rampenstufe oder `nacht.1`; keine doppelten Konturen, keine unnötigen Innenlinien.
5. **Linien:** keine Jaggies, runde Formen mit symmetrischen Stufenfolgen.
6. **Banding:** keine parallelen, gleich breiten Streifen; Stufenübergänge gebuchtet.
7. **Farben:** ≤ 12, nur Palette, jedes Material auf seiner Rampe (die Zeilen in `biome.png` und `palette.png` färben es sauber um).
8. **Licht:** kein eingebautes Richtungslicht. In `normals.png` wirken Licht von links und von rechts beide glaubhaft, und der Höhen-Hinweis passt zur Form.
9. **Emissiv:** Nur echte Lichtquellen leuchten, und der Kern ist heller als der Rand.
10. **Animation:** Takt nach §4.5, Antizipation und Nachschwingen sichtbar, Haltephasen im Clip, kein unbeabsichtigtes Springen; Sockel folgen dem Körper.
11. **Maßstab und Anker:** Größen nach §3; in der Szene von `vorschau_gruenhain.png` stimmen Proportionen (Figur : Baum : Fels) und y-Sortierung (Figur hinter dem Stamm verdeckt, davor frei).
12. **Kacheln:** Die 6×6-Felder zeigen keine Naht, kein Raster und kein auffällig wiederkehrendes Motiv; Übergänge laufen durch.
13. **Kontext:** In `biome.png` bleibt die Kleinszene in jeder Biomzeile lesbar, und die Figur hebt sich vom Boden ab.
14. **Handarbeit:** Der Bogen wirkt wie handgemachte 16-Bit-Pixelart (Secret of Mana, A Link to the Past), nicht wie Programmierergrafik. Im Zweifel wird überarbeitet.

## 10. Protokoll: erste Serie (M1-22)
Gruppen `gruenhain_basis` (der Bogen heißt `gruenhain_basis.png`, weil Gruppen-Ids snake_case sind), `figuren` und `licht`. Zwei Überarbeitungsrunden gegen §9:

- **Gras:** Die ersten Büschel (Fächer mit dunklem Kern und drei Lichtspitzen) lasen sich im 6×6-Feld wie Pfotenabdrücke. Gestreute Einzelstriche danach wirkten wie Konfetti. Die Lösung sind senkrechte Halmgruppen (2–3 Halme, Spitze `gras.4`, Stiel `gras.2`), sparsam gesetzt. Eine seltene Variante trägt ein dichtes Büschel für die große Form. Punkte 3, 12 und 14 sind bestanden.
- **Erde:** Viele kleine Kiesel und Schollen lasen sich zuerst als „Hütchen“ und Streusel. Jetzt tragen wenige große, weiche Schollen (`erde.3`) und flache Dellen (`erde.1`) das Bild; ein einzelner Kiesel sitzt in der seltenen Variante. Punkte 3 und 12 sind bestanden.
- **Übergang:** Senkrechte Kanten sprangen zuerst Pixel für Pixel (Jaggies). Jetzt laufen sie in Läufen von 3 px; oben liegt ein Saum über einem AO-Streifen, unten stechen Halmspitzen in die Erde. Punkte 5 und 12 sind bestanden.
- **Krone:** Kleine Blattballen wirkten wie Ziegel, geometrische Kugeln wie Trauben. Die Krone besteht jetzt aus neun Blattmassen mit gebuchteten Lichtkappen, Blattkappen als Textur und Kontaktschatten unter vorderen Massen. Punkte 2, 6 und 14 sind bestanden.
- **Felsen:** Die erste Fassung war ein glatter Laib mit Schattenring. Jetzt hat der Fels eine Oberseite mit Moos, eine Front mit Riss, einen Beistein und Bodenkontakt in `nacht.1`. Punkte 2 und 4 sind bestanden.
- **Spieler:** Der Profilkörper war zu schmal, die Hand saß als Loch vor dem Bauch. Jetzt ist der Rumpf breiter, der Ärmel endet am Gürtel und die Hand hängt darunter. Links ist eigens gezeichnet (Scheitel), die Idle-Atmung läuft als Welle. Punkte 1, 10 und 11 sind bestanden.
- **Fackel:** Die Flammen hatten eine Kastenform. Jetzt gibt es vier Formen mit Zungen, Abriss und Ducken; der Kern ist heller als der Rand. Punkte 9 und 10 sind bestanden.

## 11. Protokoll: Polish-Runde M1-29 bis M1-33
Kontaktbögen `vorschau_gruenhain.png`, `werkzeug.png`, `biome.png`, `licht.png`, `ui-kit.png` und die Screenshots `schrift`, `ui-kit`, `welt-ui` nach jeder Runde gegen §9 geprüft:

- **Gras (M1-29):** Große Lichtflecken, die fast die ganze Kachel füllen, lasen sich im Feld als Seerosenblätter auf einem Gitter; ein hügeliger Lichtfleck mit AO-Fuß als Salatkopf in Reihen. Die Lösung sind mehrere kleine Motive je Variante in verschiedenen Zeilen: helle Büschel (`gras.4`, sparsam `gras.5`, AO am Fuß), Halmgruppen und das seltene dunkle Büschel. Wenige `gras.5`-Spitzen, sonst wirkt das Feld wie Konfetti. Weil die Kachelkarte nur waagerecht spiegelt, reihte sich ein großes Lichtbüschel, das nur eine Variante trug, im großen Feld zu Zeilen im 16-px-Abstand; jetzt sitzen zwei verschieden geschnittene Lichtbüschel in zwei Varianten auf verschiedenen Höhen. Punkte 3, 12 und 14 sind bestanden; im 6×6-Feld und in der Szene `tilemap` ist kein Raster zu erkennen.
- **Stufen-Äxte (M1-30):** Stein, Eisen und Stahl waren drei Grautöne derselben Form, Bronze und Sonnenstahl zwei Orangetöne. Jetzt ist die Steinaxt ein geschlagener Keil mit ausgebrochener Kerbe in der Schneide, an den Stiel geschnürt (die Schnur als Drall alle 3 px, kein Schachbrett; ein erster Versuch mit Lederbändern las sich als Holzsprossen). Eisen ist dunkel-violettgrau, Stahl hell-silbern mit eisweißer Schneide, Bronze braun-kupfern, Sonnenstahl goldgelb; Lumenit mint-türkis statt stahlblau. Ein Versuch mit brauner Feuerstein-Sprenkelung wirkte fleckig und wurde verworfen. Punkte 1, 3 und 7 sind bestanden.
- **Biome (M1-31):** Salzküste (grüne Wiese mit Sandweg), Nebelmoor und Wurzelhöhlen (abgedunkeltes Grünhain-Grün) lasen sich als Grünhain. Jetzt: Salzküste heller Sand mit türkisem Dünengras, Nebelmoor nebelgrau mit petrolgrünen Halmen, Wurzelhöhlen wurzelbraun mit Moosspitzen und dunkel festgetretenem Weg; dazu Frostkamm verschneit, Aschenschlund mit glimmenden Halmspitzen, Tiefgrund mit tiefblauen Flechten, damit auch die übrigen Paare auseinanderliegen. Punkt 13 ist bestanden.
- **Stehende Fackel (M1-33):** Die Wandfackel stand mit ihrem Wandring frei in der Wiese. `fackel_stand` ist ein Pfahl mit Pechkopf und Eisenring, im Boden zwischen zwei Keilsteinen verkeilt (erste Fassung: flache Steinplatten, las sich als Sockel); die Flamme und ihr Takt stammen von der Wandfackel. Punkte 1, 9 und 11 sind bestanden.
- **UI-Kit (M1-32):** Knöpfe mit 2 px Fase (außen Glanzkante oben, Licht links, Schatten rechts und unten, innen je eine Mittelstufe), Gehrung in den Ecken, 1 px Eckfase im Umriss; gedrückt kehrt sich die Fase um. Slots als Mulde: oben/links im Schatten, unten/rechts die angeleuchtete Innenwand mit Glanzkante und Glanzpunkt. Bei 1×–4× geprüft: die Ränder bleiben beim Dehnen quer einfarbig, keine Nähte.

## 12. Protokoll: M2-Serie (M2-16 … M2-21)
Bögen `terrain.png`, `klippen.png`, `klippen-rampen.png`, `autotile-uebergaenge.png`, `autotile-klippen.png`, die 15 `autotile-<terrain>.png`, `baeume.png`, `vegetation.png`, `pflanzen.png`, `gestein.png`, `erze.png`, `streudeko.png` sowie Vorschauen jedes Baums in allen vier Jahreszeiten und der Streudeko in jeder Biomzeile, je Serie mindestens zwei, meist drei Runden gegen §9:

- **Tilesets (M2-16 … M2-18):** Jeder Frame entsteht aus handgezeichneten Quellstücken (`assets-src/lib/blob.ts`): Kantenprofile je Seite mit passenden Enden, variierte Eckrundungen, 3/4-Kantenfärbung (dunkle Frontlippe an Südkanten, heller Rand mit Halmspitzen an Nordkanten), handgezeichnete Vollfeld-Varianten, deren Motive in Kantenframes nur erscheinen, wo sie hineinpassen. Korrekturen: Pflaster von Ziegelmauer zu polygonalen Platten; Kristallboden umgefärbt (glich der getönten Scherbenhain-Wiese); Lavaschollen lasen sich als Augen, die Kruste nutzt jetzt ungetönte Farben; Schneewehen wirkten wie Wolken, ein Zweig wie ein Vogel; Klippenränder verbreitert (lasen sich als Zaun); Klippenflächen von Mauerwerk zu Findlingen; Asche-Klippen dunkler; unruhige Varianten beruhigt. Punkte 3, 5, 12 und 14 bestanden: keine Naht (Nahtprüfung über alle 1 024 Nachbarschaften, ≤ 1 px Abweichung), ≤ 12 Farben, keine Einzelpixel. Bewusst: Wo drei Terrains zusammenstoßen, zeigt sich das mittlere als schmaler Streifen (Strand zwischen Wiese und Wasser) – Folge des Stapelmodells.
- **Bäume (M2-20):** Kronen lasen sich zuerst als Rauschen, kahle Bäume als Strichmännchen; jetzt klare Blattmassen aus Blattbüscheln und ein echtes Astgerüst mit Schnee auf den dicken Ästen. Aschebaum, Lichtbaum, Palme und Weide neu entworfen; Stümpfe von Kisten zu Schnittflächen. Lichtbaum-Kristallblätter mit hellerem Kern als Rand (Punkt 9), Aschebaum mit glühenden Rissen. Punkte 1, 2, 6 und 14 bestanden.
- **Felsen, Kristalle, Erze (M2-21):** Pfannkuchenformen und waagerechte Bänder behoben (flache Standfläche, Buckel, fleckiger Bewuchs); Erzbrocken und Adern vergrößert, bis jedes Erz auf einen Blick lesbar ist (keine zwei Erze teilen ihre zwei Hauptfarben, Erz deckt ≥ 10 % des Knotens, nur Magmit, Lumenit und Prismenquarz leuchten). Punkte 2, 6 und 7 bestanden.
- **Büsche, Pflanzen, Streudeko (M2-19, M2-21):** Löcher in abgeernteten Frames und ein flacher Wacholder behoben; Büschel, die im Gras verschwanden, und zu kleine Motive vergrößert. Streudeko wird je Biom über die `biom_<id>`-Zeilen getönt; Knochen, Muscheln, Kristalle und Glut bleiben überall gleich. Punkte 3, 7 und 13 bestanden.
- **Urteil:** stimmiges, handgemacht wirkendes 16-Bit-Set. Schwächste Stücke: die schlichten runden Setzlinge und einige sehr kleine Streudekos (Aschehäufchen, Obsidiansplitter) – Nachbesserung in der Politurrunde (M2-GATE).
- **Offen:** Stümpfe und Setzlinge werden erst mit dem Fällen (M3-11) verwendet.

## 13. Protokoll: M2-Integration (M2-29, ADR-0026)
Bögen `autotile-lehm.png`, `autotile-wurzelboden.png` und die Screenshots `ebene-1-roh`, `spiel-titel`, `overlay-*` gegen §9 geprüft:

- **Lehm:** feuchter Ocker-Lehm in `sand` (von der Wurzelhöhlen-Zeile ungetönt, hebt sich warm vom dunklen Wurzelboden ab), kurze Trockenrisse in `holz.1`/`holz.0`, ein Stück Schollenmuster, selten eine rote Eisenader mit eingebackenem Kiesel. Die nasse Stelle las sich zuerst als Buckel (Schattenzeile darunter); jetzt ein flaches Oval mit Glanzpunkt ohne Schatten. Motive je Variante in einem anderen Viertel. Rang zwischen `torf` und `hoehlenboden`: Lehmnester liegen als Mulden, Höhlen- und Wurzelboden zeichnen die Kante.
- **Wurzelboden:** Alle vier Varianten trugen ihren Wurzelbogen oben in der Mitte – im Fackelschein ein 16-px-Raster (ADR-0025). Erste Runde: Motive in verschiedene Viertel verlegt; im Bild blieb eine Wurzel je Kachel (jede Kachel ein Strich). Zweite Runde: die häufigste Variante ist nackte Erde mit zwei Krümeln, die zweite eine kurze flache Wurzel mit Moos, nur die seltenen tragen zwei Wurzeln bzw. den Knoten. `ebene-1-roh` liest sich jetzt als wurzeldurchzogene Erde ohne Raster.
- **Salzküsten-Palette (Befund):** Das Titelbild zeigt den Startstrand. Die Zeile `biom_salzkueste` tönt Gras zu `sand.3` mit Rändern in `wasser.1`–`wasser.3` und Büsche tiefblau (M1-31): Grasflächen lesen sich als hellere Sandflecken mit dünnen blauen Linien, Strandbüsche als blaue Agaven. Ein Versuch mit Dünengras-Tönen (Ränder `sand.0/1`, Halme `wasser.4`/`eis.3`) machte die Linien nur türkis; zurückgenommen. Neuer Politur-Task: Dünengras als eigenes Motiv statt Tönung der Wiese (Rand ohne Lippe, Halme blaugrün), Strandbüsche in einer eigenen Zeile.
- **Overlays:** Palettenfarben mit Alpha (0,42 Füllung, 0,2 Chunk-Tönung), Beschriftung in der Pixelschrift mit dunkler Kontur – auf Gras, Schnee und Wasser lesbar; die Welt bleibt darunter erkennbar.

## 14. Protokoll: M2-31 Salzküsten-Dünen (M2-Gate, ADR-0027)
Bögen `autotile-duenengras.png`, `autotile-uebergaenge.png` (Szene „Salzküste Dünen“), `pflanzen.png`, `biome.png` und der Screenshot `spiel-titel` gegen §9:

- **Dünengras als eigener Boden:** Die Salzküste zeigte hinter dem Strand die Grünhain-Wiese durch ihre Palettenzeile – die Narbe mit Lippe und Seitensaum las sich als dünne blaue Linien auf hellem Sand. Jetzt ein eigenes Tileset in Endfarben: Sand wie der Strand, darauf windschiefe Büschel (Fuß dunkelgrün, Mitte Petrol, oben Türkis, Schaumtürkis-Spitzen, einzelne trockene Halme). Keine Kante: Die Düne endet, wo ihre Büschel enden. Runden: (1) Stempelbüschel lasen sich als blaue Krabben, (2) dicke Fächer als Hände bzw. Topfpflanzen mit Stamm, (3) kleine Kreuze als Symbole – jetzt organische 1-px-Halme verschiedener Neigung; (4) in Kantenframes blieben Büschel-Fragmente als Punktpaare stehen (die Einzelpixel-Bereinigung ersetzte Farben, die im Büschel nur einmal vorkamen) – jede Farbe steht jetzt in jedem Büschel mindestens zweimal; (5) Halmspitzen als Überstand über die Nordkante lasen sich als liegende Striche – entfernt. Punkte 2, 3, 12 und 14 bestanden.
- **Strandhafer:** Marineblau mit fast schwarzer Kontur las sich als blaue Agave; jetzt blaugrün (dunkelgrüner Fuß, Petrol, Türkis, trockene helle Spitzen). Fasergras und Grasbüschel (in Grünhain-Farben gezeichnet, von der Salzküsten-Zeile blau getönt) wachsen nicht mehr auf den Dünen.
- **Salzküsten-Zeile:** tönt nur noch geteilte Sprites und den Biomsaum der Nachbarn: Wiese läuft in Sand aus, dunkle Halme bleiben grün, Lichter werden Salz (vorher Marineblau).
- **Urteil `spiel-titel`:** Strand und Brandung links unten, offene Sandflächen mit Rippeln, dahinter Dünengras-Felder mit blaugrünen Büscheln, Kiefern, Strandhafer, Muscheln und Treibholz – keine blauen Linien mehr, die Salzküste liest sich als helle, luftige Küste (§5). Schwäche: die Büschelfelder wirken im 16-px-Raster noch etwas gleichmäßig (Politur-Task M3-40).

## 15. Kreaturen (M6)
Alle 22 kanonischen Kreaturen (docs/SPIEL.md §14) entstehen aus einem datengetriebenen Generator: `assets-src/lib/creature*.ts` baut aus Bauplan und Posen kleine 3D-Szenen und rastert sie je Richtung in Palettenpixel. Die Sprites stehen in `assets-src/sprites/kreaturen/<id>.ts` (Katalog und Gruppen in `_katalog.ts`), das Geschoss des Speiers in `geschoss_spucken.ts`. Prüfung: `tests/unit/assets/kreaturen.test.ts`.

### 15.1 Generator
| Datei | Aufgabe |
|---|---|
| `creatureRender.ts` | Raster: Ellipsoide (Strahlschnitt), Flächen, Linien fester Breite, Merkmal-Stempel (Augen, Nase, Funken). Schattierung nach Himmelsöffnung (`0,3 + 0,7·Licht von oben`, AO nach Höhe), je Formgruppe geglättet, Sprenkel entfernt; Kontaktschatten und Innenkontur an Tiefensprüngen zwischen Gruppen; Kontur `nacht.1` bzw. Saum; Krümel ≤ 3 px ohne Merkmal fallen weg; Einzelpixel-Bereinigung nach der Validator-Regel (ein Merkmal, dessen Farbe nur einmal vorkommt, wächst um 1 px nach innen). |
| `creatureBau.ts` | Schräge 3/4-Projektion je Richtung (Neigung: rechts 0,55, unten 0,65, oben 0,7; in `down`/`up` Tiefe × 0,66, Breite × 1,3), Rahmen und Gelenke, `Bau` sammelt Grundformen; `nachzieher` legt Smear-Kopien in die zweithellste Stufe (schmaler, hinter dem Körper). |
| `creatureAnim.ts` | Posen als Zahlenwerte, `mische`, `ueberschwinge`, `smear`; Clip-Bausteine `idleClip` (Welle, 8 Positionen bei 8 fps), `zyklusClip` (Gang/Schweben), `angriffClip` (Ausholen ≥ 2 Posen plus Halten, optional Anlauf, Schlag mit Smear, Treffer, Nachschwingen), `trefferClip` (2 Frames), `todClip`, `klip` (Sonderclips). |
| `creature.ts` | `kreatur(def)` → `{ sprite, clips, erzeuge }`; `geschoss(def)` → `geschoss_<name>`; `renderePose` rastert eine einzelne Pose (für Prüfskripte). `KreaturDef`: `id`, `zelle`, `anker`, `hoehe`, `plan`, `clips`, optional `massstab` (Körpergröße in der Zelle), `jeRichtung` (Posenzuschlag je Ansicht, z. B. Ohren in der Frontansicht), `einzelpixel`, `ausnahmeFarben`. Gleiche Frames werden per Hash geteilt. |

**Baupläne** (jede Art ist ein Datensatz, keine Sonderlogik im Sprite):

| Bauplan | Datei | Kreaturen | Posenwerte (Auswahl) |
|---|---|---|---|
| Vierbeiner klein/mittel/groß | `creatureVierbeiner.ts` | hase, eichhoernchen, reh, keiler, dachs, wolf, robbe (nur Vorderbeine + Flossen), schleicher, nachtmahr | `hub`, `vor`, `nick`, `roll`, `liegen`, `kopfNick/Gier/Vor/Hub`, `maul`, `augenZu`, `ohren`, Beinwerte `vlF`/`vlU` … `hrF`/`hrU`, `schwanz`, `wedel`; `gangPose` (Galopp, Trab, Schleichen, Hoppeln, Hüpfen) |
| Vogel (Boden + Flug) | `creatureVogel.ts` | wachtel, moewe | `schlag` (Flügel), `fluegel`, `schnabel`, `beineEin` |
| Amphibie | `creatureFrosch.ts` | frosch | `sprung` (Z-Faltung der Hinterbeine), `kehle`, `maul` |
| Krebstier | `creatureKrebs.ts` | krabbe, scherenkrebs (Hinterleib mit Grundkrümmung) | `gang`, `schereL/R`, `zangeL/R`, `schereVor`, `schwanz` |
| Insektenschwarm | `creatureSchwarm.ts` | gluehwuermchen, wespenschwarm | `phase`, `dichte`, `streuung`, `fall`, `leuchten` |
| Qualle | `creatureQualle.ts` | qualle | `puls`, `phase`, `nessel`, `liegen`, `flach` |
| Buschkreatur | `creatureBusch.ts` | dornling | `offen` (Tarnung → Höhle, Augen, Dornen, Wurzelbeine), `ranke`, `wackeln`, `welk` |
| Humanoid | `creatureMensch.ts` | strandraeuber | Spieler-Rig (`figure.ts`) mit eigener Legende und Waffe am Sockel `hand`; offene Augen werden erkannt und emissiv gemalt |
| Schattenbrut | `creatureSchatten.ts` | kriecher, speier, lichtfresser; Materialien und Rauch auch für schleicher, nachtmahr | `rauch`, `zerfall` (Tod: sinkt und zerfasert), `saugen`, `funken`, `peitsche`, `sack`, `greifen` |

### 15.2 Regeln
- **Richtungen:** gerendert werden `down`, `up`, `right`; `left` spiegelt der Renderer (`spiegelbar: true`, Kreaturen sind symmetrisch). Ausnahme `strandraeuber`: vier eigene Richtungen (Waffenhand, Stapelfolge der Waffe).
- **Größen (§4.4):** 16×16 hase, wachtel, eichhoernchen, gluehwuermchen, frosch, krabbe; 64×64 nachtmahr; alle übrigen 32×32. Anker x = Zellmitte, y = Standfläche; in jedem Frame 1 px Luft zum Zellrand (Interaktions-Outline).
- **Farben:** jedes Material auf seiner Rampe (Palettenzeilen färben sauber um), ≤ 12 Farben. Kontur `nacht.1`; der Dornling trägt getarnt die Buschkontur `gras.0`.
- **Emissiv:** Augen aller Nachtjäger (keiler, dachs, wolf, dornling, scherenkrebs, strandraeuber) und der ganzen Schattenbrut; dazu echte Lichtquellen: Glühwürmchen, Quallenrand und jeder zweite Nesselfaden, Glutsack und Rachen der Schattenbrut, Lichtfunken des Lichtfressers. Friedliche Tagtiere und der Wespenschwarm leuchten nicht.
- **Schattenbrut:** Körper aus Tintenrauch (`nacht.0–2`, `verderb.1`), keine harte Kontur, stattdessen ein violetter Saum `verderb.2` auf oberen und seitlichen Kanten; Rauchfahnen steigen auf. Der Tod (`zerfall`) lässt den Körper sinken und in Rauch zerfasern; den Auflöse-Shader liefert der Renderer später dazu.
- **Animation:** Figurentakt 8–12 fps; Ausholen ≥ 2 Clip-Positionen und 0,2–1,0 s, sichtbar andere Pose als die Ruhe; Schlag mit Smear, Treffer mit Überschwingen; Tod mit Aufprall-Event.

### 15.3 Sprites und Clips (verbindlich für die Kreatur-Daten)
Clip-Namen: `idle_<dir>`, `move_<dir>`, `attack_<name>_<dir>`, `hit_<dir>`, `death_<dir>` (+ Sonderclips), `<dir>` ∈ `down | up | left | right`. Angaben als Positionen@fps; **Ausholen** sind die Clip-Positionen von–bis (inklusive), dahinter die Events `schlag`/`treffer` (Position). Jeder Angriff sendet `ausholen` auf Position 0, `hit` sendet `getroffen` (0), `death` sendet `aufprall`.

| Id | Zelle · Anker | Clips | Angriffe: Ausholen · schlag · treffer | Rampen | Emissiv |
|---|---|---|---|---|---|
| `hase` | 16 · [8,12] | idle 8@8, move 6@12 (`hoppeln`), hit 2@8, death 6@8 | – | nacht, haut, erde, sand, eis | – |
| `reh` | 32 · [16,26] | idle 8@8, move 6@12, hit 2@8, death 6@8 | `tritt` 8@10: 0–3 (0,4 s) · 4 · 5 | nacht, sand, holz, eis | – |
| `wachtel` | 16 · [8,12] | idle 8@8, move 4@12, `flug` 4@12, hit 2@8, death 5@8 | – | nacht, erde, sand, haut | – |
| `eichhoernchen` | 16 · [8,12] | idle 8@8, move 6@12 (`hoppeln`), hit 2@8, death 6@8 | – | nacht, laub, sand | – |
| `gluehwuermchen` | 16 · [8,13] | idle 8@8, move 6@10 (`summen`), hit 2@8, death 4@8 | – | nacht, erde, feuer, gras, eis, sand | Leuchtkörper `gras.5*`, `feuer.5*` |
| `frosch` | 16 · [8,11] | idle 8@8, move 5@10 (`absprung` 1, `landung` 4), hit 2@8, death 5@8 | – | nacht, laub, gras, sand | – |
| `keiler` | 32 · [16,24] | idle 8@8, move 6@12, hit 2@8, death 6@8 | `ansturm` 12@10: 0–5 (0,6 s), Anlauf 6–7 · 8 · 9 (Schlag nach 0,8 s); `hauer` 7@10: 0–2 (0,3 s) · 3 · 4 | nacht, erde, feuer, eis, haut | Augen `feuer.3*` |
| `dachs` | 32 · [16,22] | idle 8@8, move 6@10, hit 2@8, death 6@8 | `biss` 8@10: 0–3 · 4 · 5; `kratzer` 8@10: 0–3 · 4 · 5 | nacht, stein, eis, feuer | Augen `feuer.4*` |
| `wolf` | 32 · [16,25] | idle 8@8, move 6@12, hit 2@8, death 6@8 | `biss` 8@10: 0–3 · 4 · 5; `sprung` 9@10: 0–3 (0,4 s), Anlauf (Abstoß) 4 · 5 · 6 (Schlag nach 0,5 s) | nacht, stein, feuer | Augen `feuer.4*` |
| `dornling` | 32 · [16,26] | idle 8@8, move 6@10, `tarnung` 8@8 (Busch), `erwachen` 5@10 (`erwacht` 3), hit 2@8, death 5@8 | `peitsche` 9@10: 0–4 · 5 · 6; `ueberfall` 9@10: 0–4 (aus der Tarnung: Busch bebt, ab Position 2 Dornen, Wurzelbeine und Augen auch im Profil) · 5 · 6 | gras, laub, nacht, feuer, holz | Augen `feuer.4*` |
| `wespenschwarm` | 32 · [16,26] | idle 8@12, move 6@12 (`summen`), hit 2@8, death 5@8 | `stechen` 9@10: 0–4 · 5 · 6 | nacht, eis, erde, feuer | – |
| `krabbe` | 16 · [8,10] | idle 8@8, move 4@12, hit 2@8, death 5@8 | `kneifen` 8@10: 0–3 · 4 · 5 | nacht, laub, sand | – |
| `moewe` | 32 · [16,25] | idle 8@8, move 6@10 (Flug, `fluegelschlag`), `gehen` 4@8, `landen` 4@10, hit 2@8, death 6@8 | `picken` 8@10: 0–3 · 4 · 5 | nacht, stein, eis, feuer, haut | – |
| `robbe` | 32 · [16,22] | idle 8@8, move 6@10 (`robben`), hit 2@8, death 6@8 | `biss` 8@10: 0–3 · 4 · 5 | nacht, stein | – |
| `scherenkrebs` | 32 · [16,23] | idle 8@8, move 6@12, hit 2@8, death 5@8 | `kneifen` 8@10: 0–3 · 4 · 5; `scherenschlag` 10@10: 0–5 (0,6 s) · 6 · 7 | nacht, wasser, eis, laub | Augen `eis.4*` |
| `qualle` | 32 · [16,26] | idle 6@8, move 6@10 (`stoss` 2), hit 2@8, death 5@8 | `nesseln` 9@10: 0–4 · 5 · 6 | nacht, wasser, eis | Schirmkappe, Schirmrand, Nesselfäden `wasser.5*`, `eis.4*` |
| `strandraeuber` | 32 · [16,29] | idle 8@8, move 6@12, hit 2@8, death 6@8 (4 eigene Richtungen) | `hieb` 8@10: 0–4 · 5 · 6 (Entermesser) | nacht, stein, verderb, laub, erde | Augen `verderb.4*` |
| `schleicher` | 32 · [16,24] | idle 8@8, move 6@12, hit 2@8, death 5@8 | `klaue` 8@10: 0–3 · 4 · 5; `sprung` 9@10: 0–4 · 5 · 6 | verderb, nacht, eis | Augen `eis.4*` |
| `kriecher` | 32 · [16,24] | idle 8@8, move 6@10, `festhalten` 3@8 (Schleife), hit 2@8, death 5@8 | `packen` 9@10: 0–4 · 5 · 6 | verderb, nacht | Augen `verderb.4*`, Rachen `verderb.2*/3*` |
| `speier` | 32 · [16,28] | idle 8@8, move 6@10, hit 2@8, death 5@8 | `spucken` 9@10: 0–4 · 5 · 6 (Geschoss `geschoss_spucken`) | verderb, nacht, eis | Augen `eis.4*`, Glutsack `verderb.2*–4*` |
| `lichtfresser` | 32 · [16,27] | idle 6@8, move 6@10 (`gleiten`), hit 2@8, death 5@8 | `saugen` 11@10: 0–5 (0,6 s), Anlauf 6 (0,1 s) · 7 · 8; `schlag` 8@10: 0–3 · 4 · 5 | verderb, nacht, eis, feuer | Augen `eis.4*`, Schlund `verderb.2*/3*`, Lichtfunken `feuer.4*` |
| `nachtmahr` | 64 · [32,54] | idle 8@8, move 6@12, hit 2@8, death 6@8 | `stampfen` 11@10: 0–6 (0,7 s) · 7 · 8; `ansturm` 12@10: 0–5 (0,6 s), Anlauf 6–7 · 8 · 9 | verderb, nacht, eis | Augen `eis.4*` (3 px), Glutrisse und Glutherz (Brustriss) `verderb.3*/4*`, offenes Maul `verderb.2*/3*` |

Ohne Dauer angegeben: 4 Ausholpositionen bei 10 fps = 0,4 s, 5 = 0,5 s. `move` sendet `schritt` (Gänge mit 6 Positionen auf 0 und 3, mit 4 Positionen auf 0 und 2) bzw. die genannten Events. **Geschoss** `geschoss_spucken` (16×16, Anker [8,12], nur `right` gezeichnet, spiegelbar): `flug` 4@12 (Schleife), `aufprall` 4@12 (Event `aufprall` 0); Glutkern `verderb.3*/4*`, Saum `verderb.2`.

### 15.4 Kontaktbögen und Protokoll
`npm run assets` (Schritt „Kreaturen“, Cache `tools/out/cache/kreaturen.json`) schreibt `tools/out/sheets/kreaturen-m6-gruenhain.png`, `-kueste.png`, `-schattenbrut.png`; einzeln: `npx tsx tools/assets/kreaturen-preview.ts --nur <id> <datei.png>` (`--force` ignoriert den Cache). Je Kreatur: Kopfzeile (Zelle, Farben, Frames, Emissiv, Spiegelung), Clipliste mit Ausholdauer, Spielgröße 1× auf Biomgrund, hell, dunkel und Nacht (nur Emissiv) plus 2×, dann jeder Clip in vier Richtungen; Ausholphase orange, Treffer rot unterstrichen. Der Gruppenbogen `kreaturen.png` zeigt nur die Übersicht.

Runden gegen §9 (Auswahl): fleckige, zu dunkle Körper → Licht von oben mit Himmelsanteil, Glättung je Formgruppe; Front- und Rückansichten wie Säulen → Neigung je Richtung, Verkürzung und Verbreiterung; halbe Augen und zweifarbige Schnauzen als Einzelpixel → Stempel rücken ganz auf die Oberfläche, Merkmale einfarbig; Ohren falsch gespreizt, Krabbe zu breit, Hummer im Profil als Stab mit Kamm-Beinen → Hinterleib mit Grundkrümmung, fächerförmige Beine, hellerer Panzer; Tode mit Beinen durch den Boden → Beine an den Leib, Kopf sinkt, Tentakel und Fäden liegen am Boden auf; Froschpupillen saßen auf der Kontur → Pupille auf der oberen Kuppel, im Profil nur am nahen Auge; Wolf einfarbig → dunkler Sattel; Schleicher zu dünn → kräftigerer Rumpf; Rauchkonfetti → Krümelfilter; weit ausholende Angriffe am Zellrand → `massstab`, `jeRichtung`, kürzere Ausfälle.

**Urteil (§9):**
- `kreaturen-m6-gruenhain.png`: 1 Silhouette ✓ (Nachtansicht zeigt jede Form, Richtung eindeutig), 2 Werte ✓, 3 Cluster ✓ (Validator ohne Einzelpixel; Schwärme mit `einzelpixel`-Begründung), 4 Kontur ✓, 5 Linien ✓ (1-px-Beine und Ohren an 16 px mit kleinen Stufen), 6 Banding ✓, 7 Farben ✓ (≤ 12), 8 Licht ✓ (kein Richtungslicht, Höhe `kugel`), 9 Emissiv ✓ (Augen, Leuchtkörper), 10 Animation ✓ (Ausholen gehalten, Smear, Überschwingen), 11 Maßstab ✓, 13 Kontext ✓ auf Gras, Sand und Nacht. Schwächer: Front-/Rückansicht von Hase und Eichhörnchen sehr klein, Keilerbeine schlank.
  - Nacharbeit M6-20 … M6-22 nach dem Blick ins Spiel (Screenshots `kreaturen-gruenhain-gegner`, `-gegner-nacht`, `-klein`, `-lauer`; Einzelbögen `--nur <id>`): **Keiler** `ansturm` 0,6 s Ausholen + 0,2 s Anlauf statt 0,7 + 0,2 s (§19.4: Schlag nach höchstens 0,8 s); er scharrt jetzt mit dem Vorderlauf, und der Kopf senkt sich nur so tief, dass das Auge im Profil die ganze Ausholphase über glüht (vorher fiel es in 4 von 7 Positionen weg – nachts war der Ansturm von der Seite nicht zu sehen). **Wolf** `sprung`: 0,4 s geduckt, dann eine Abstoß-Pose als Anlauf (0,1 s), in der die Simulation den Körper zum Ziel trägt – vorher sprang der Wolf in einem einzigen Tick. **Dornling** `ueberfall`: die gehaltene Ausholpose öffnet den Busch weiter (`offen` 0,85 statt 0,5), so zeigen Dornen, Wurzelbeine und das glühende Auge den Überfall auch im Profil und von hinten; Position 0 bleibt Busch. Im Spiel ✓: alle acht heben sich auf Gras und Pflaster ab (Kontur `nacht.1`, Wölfe grau auf grauem Pflaster über Kontur und Augen); in der Dämmerung und nachts tragen die Augen (`feuer.3*/4*`), am Tag ist der getarnte Dornling nicht von einem Beerenstrauch zu unterscheiden (gewollt), sein Überfall schon. Glühwürmchen leuchten nachts mit `emissiveBoost` 1 wie die schwebenden der Oberfläche; die kleinen Tagtiere (Eichhörnchen, Frosch) verschwinden nachts im Dunkel (friedlich, keine Nachtjäger).
- `kreaturen-m6-kueste.png`: Punkte 1–11 und 13 ✓; Qualle mit gemalter Transluzenz (heller Schirm, durchscheinende Gonaden, leuchtender Rand). Schwächer: Hummerprofil unruhig (viele Beine), Robbe von vorn klein; der Strandräuber übernimmt die großen Köpfe des Spieler-Rigs, graue Haut und violette Augen zeigen ihn als Gezeichneten.
  - Nacharbeit M6-23/M6-24 nach dem Blick ins Spiel (Screenshots `kreaturen-kueste`, `kreaturen-kueste-nacht`; Einzelbögen `--nur <id>`): **Scherenkrebs** las sich von vorn als Fledermaus (vier Beinpaare mit hohen Knien als Flügellappen, die Scheren verdeckt vor dem Gesicht) → drei Beinpaare mit flachen Knien, Scheren 55° gespreizt (`scheren.spreizung`, Standard 18°) und leicht gehoben mit offenen Zangen, `massstab` 1; jetzt von vorn ein blauer Hummer mit zwei orangen Scheren neben dem Leib. **Möwe** von vorn ein Block ohne Schnabel → längerer, gesenkter Schnabel (in allen Idle-Posen sichtbar, der Kopf nickt nicht mehr darüber), Flügel tiefer angelegt. **Robbe** von vorn helle Schnauze und große dunkle Augen. **Qualle** nachts ein dunkler Schirm → die Schirmkappe leuchtet (`wasser.5*`, `eis.4*`), im Wasser ein kalter Lichtfleck. Im Spiel ✓: am Tag heben sich alle sechs vom Sand ab; nachts tragen Augen (Scherenkrebs `eis.4*`, Strandräuber `verderb.4*`) und die leuchtende Qualle.
- `kreaturen-m6-schattenbrut.png`: 1 ✓ (violetter Saum trennt auf Nachtgrund), 2 ✓ in bewusst enger Rampe, 3 ✓, 4 ✓ als Saum statt Kontur, 7 ✓ (8–10 Farben), 9 ✓ (Augen, Glut, Funken), 10 ✓ (Zerfall im Tod). Schwächer: Rauch bleibt stilisiert, Frontansicht des Nachtmahrs schmal; die Auflösung übernimmt der Shader.
  - Nacharbeit M6-25/M6-29 nach dem Blick ins Spiel (Screenshots `schattenbrut-materialisierung`, `schattenbrut-augen-nacht`, `nachtmahr`): im Dunkeln waren **keine Augen** zu sehen – die Tönung ins Schwarz (§12.2 „nur als Augen erkennbar“) färbte auch die emissiven Pixel, und das Compositing leuchtet mit Albedo × Emission. `sprite_gbuffer.frag` tönt emissive Pixel und den Rauchsaum nicht mehr (Test `tests/unit/render/materialisierung.test.ts`); das gilt für alle Nachtjäger. **Nachtmahr** von vorn nur zwei Augen → Glutherz: ein glühender Zickzackriss die Brust hinab (`verderb.3*/4*`), nachts zeichnet er die Gestalt zwischen Augen und Hufen. Im Spiel ✓: die formende Brut zeigt Saumfetzen und Augen, vom Boden her ganz; ganz geformt im Dunkeln nur Augen, Glutsack und Schlund; der Nachtmahr am Rand des Fackelscheins als gehörnter Schatten mit Augen und Glutherz.
