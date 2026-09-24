# WORLD – Verträge für Weltdaten, Generierung und Streaming

Ergänzt MASTERPROMPT §9, §10, §3.3 und docs/ARCHITEKTUR.md. Änderungen nur per ADR.

## 1. Koordinaten
- Welt-Tile `(tx, ty)` ganzzahlig, Ursprung oben links; Welt-Pixel = Tile × 16. Größen: Klein 1024² · Mittel 1536² · Groß 2048² Tiles.
- Chunk 32×32 Tiles: `cx = floorDiv(tx, 32)`, lokaler Index `i = (ty mod 32) × 32 + (tx mod 32)`.
- Ebenen `layer ∈ {0, −1, −2, −3}` (Oberfläche, Wurzelhöhlen, Tiefgrund, Glutadern) im selben Koordinatensystem. Chunk-Schlüssel: `layer:cx:cy`.

## 2. Zweistufige, deterministische Generierung
1. **Weltplan** (`src/world/gen/plan/`, ADR-0021; einmal pro Welt, im Worker): Inselmaske (grob), Poisson-Regionen → Voronoi → Regionsgraph, Biomzuweisung (Constraint-Löser), grobes Höhenfeld, Flüsse/Seen als Polylinien/Polygone (Fließrouting auf grobem Raster), Erbauer-Straßen, Orts-Slots (Leuchtfeuer-Stätten mit Arenen, Nachtherz, Gewölbe, weitere Orte), Höhleneingänge, Validierungs- und Reparaturbericht. Serialisierbar, klein (Oberflächenplan < 2 MB; mit Untergrundplan, Orten, Straßen und Vorkommen ist die ganze Weltbeschreibung Klein 0,95 · Mittel 1,8 · Groß 3,3 MB, ADR-0027), nicht Teil des Spielstands: aus Seed, Größe und Generator-Version reproduzierbar.
2. **Chunk-Generator** (`src/world/gen/chunk.ts`): reine Funktion `(plan, layer, cx, cy) → ChunkData`, unabhängig von der Reihenfolge (Streams aus `hash3(cx, cy, layer, seed)`), rasterisiert Pläne (Flüsse, Straßen, Orte) und erzeugt Details (Domain-Warp-Grenzen, Übergangsstreifen, Ressourcen per Blue-Noise + Cluster, Vegetation, Streudeko, Höhlen per zellulärem Automaten mit Rand-Überlapp für nahtlose Chunkgrenzen).
- Determinismus-Test: gleicher Seed ⇒ identischer Hash aller Chunks (Hash über alle Arrays, Chunks in fester Reihenfolge).

## 3. ChunkData (Typed Arrays, je 1024 Einträge)
| Feld | Typ | Inhalt |
|---|---|---|
| `ground` | Uint8 | Terrain-Typ (Laufzeit-ID aus `src/content/terrain.ts`) |
| `height` | Uint8 | Höhenstufe 0–4 (Oberfläche); Untergrund 0 |
| `biome` | Uint8 | Biom-ID (für Tönung, Temperatur, Spawns) |
| `water` | Uint8 | Bits 0–1 Tiefe (0 keins, 1 flach, 2 tief), Bit 2 Fluss, Bit 3 See, Bit 4 Meer, Bit 5 gefroren, Bit 6 Quelle |
| `solid` | Uint8 | Untergrund: festes Gestein/Erzader-Material (0 = offen) |
| `object` | Uint16 | Welt-Objekt-Typ (Baum, Fels, Busch, Erzknoten, Deko …), 0 = keins |
| `flags` | Uint8 | Rampe, Treppe, Straße, Furt, Brücke, Ortsfläche, Klippenkante, gegraben |
- Flags im Untergrund (Ebenen −1 … −3, ADR-0024): `TILE_FLAG_RAMP` = Weg nach oben (Höhleneingang unter der Oberfläche bzw. Fuß eines Schachts), `TILE_FLAG_STAIRS` = Weg nach unten (auf der Oberfläche der Höhleneingang, im Untergrund die Schachtöffnung), jeweils **dieselbe Kachel** in beiden Ebenen einer Verbindung (`UndergroundPlan.links`, Art `eingang` bzw. `schacht`); `TILE_FLAG_PLACE` = Höhlenort-Slot. Rampe/Treppe/Straße/Furt/Brücke/Klippenkante tragen dort keine andere Bedeutung.
- Objektzustand (Treffer-HP, Wachstum, Nachwachs-Zeitpunkt) sparsam in `Map<tileIndex, ObjectState>`.
- `frozenAtTick` für analytisches Aufholen (Aktive Zone, ARCHITEKTUR.md).
- Speicher: 8 Byte/Tile ⇒ 8 KiB je Chunk-Ebene + Objektzustände.

## 4. Laufzeit-IDs & Content
- Terrain-Typen (`src/content/terrain.ts`), Biome (`src/content/biomes.ts`), Welt-Objekte (`src/content/worldObjects.ts`) sind Content mit String-IDs. Numerische Laufzeit-IDs werden beim Registry-Aufbau vergeben (sortiert nach String-ID). Spielstände speichern die ID-Tabelle und werden beim Laden umgemappt – neue Content-Einträge brechen keine alten Stände.

## 5. Streaming & Aktive Zone
- `ChunkManager` hält geladene Chunks je Ebene; lädt im Umkreis der Kamera (Radien in `BALANCE.stream`), entlädt mit Hysterese; Generierung/Deserialisierung im Worker, Budget pro Frame. Ohne Kamera (headless) gibt die Simulation die Chunks frei, die ihre Zone eingefroren hat (`trim`).
- Aktive Zone: Chunks im Aktivradius um den Spieler ticken voll; andere sind eingefroren (`frozenAtTick`) und holen beim Aktivieren über die Aufhol-Registry auf (jedes zeitabhängige System registriert `catchUp(chunk, fromTick, toTick)`; Pflichttest). Der Spielstand hält neben den `frozenAtTick` auch die aktiven Chunks fest; nach dem Laden aktiviert die erste Aktualisierung die Zone um den Spieler und dazu die gespeicherten aktiven Chunks, die noch im Radius + Hysterese liegen (ADR-0024) – so erreicht „speichern → laden → weiter“ denselben Zustand wie ein ununterbrochener Lauf.
- Geänderte Chunks werden als Diff gegen den generierten Zustand gespeichert (Arrays + Objektzustände, RLE), unveränderte nie.
- Fokus der Zone ist die gesteuerte Entität auf ihrer Ebene (`teleport` wechselt die Ebene; bis M3-08 steht sie für den Spieler). Zeitsprünge (Debug-Commands `setTime`, `advanceTime`, `setSeason`) laufen nur vorwärts: Die Zone friert ein, die Uhr springt, die Zone aktiviert im selben Tick wieder und holt über die Aufhol-Registry auf (ADR-0026).

## 6. Kalender, Temperatur, Wetter
- `src/world/calendar.ts` auf `GameClock`: Jahreszeit (je 7 Tage, 3–14), Tag im Jahr, Nachtlänge je Jahreszeit (Frühling/Herbst 8 h, Sommer 5 h, Winter 11 h), Dämmerungen 2 h, Mondphase (8 Tage, Finstermond), Sonnenstand-Vektor (Richtung + Länge für Schatten).
- Temperaturfeld (Welt-Tick 1 Hz): Biombasis §9.3 + Jahreszeit + Tageskurve + Wetter + Höhe (−3 °C je Stufe); Höhlen nahe Basiswert.
- Wetter: Markov-Automat je Biom × Jahreszeit (Matrizen als Content), Zustand pro Region, weiche Übergänge (Wolkendecke, Wind, Niederschlag interpoliert).

## 7. Namenskonventionen (verbindlich für parallele Arbeit)
- **Biome** (`src/content/biomes.ts`, 11): `gruenhain`, `salzkueste`, `nebelmoor`, `frostkamm`, `glutsand`, `aschenschlund`, `scherbenhain`, `nachtherz`, `wurzelhoehlen`, `tiefgrund`, `glutadern`. Übergangsstreifen (z. B. Taiga) sind Mischzonen, keine eigenen Biome.
- **Terrain-Typen** (`src/content/terrain.ts`): Oberfläche `gras`, `erde`, `sand`, `duenengras` (Dünen der Salzküste, ADR-0027), `schnee`, `asche`, `kristallboden`, `moorschlamm`, `torf`, `meeresgrund`, `strasse` (Erbauer-Pflaster), `eis`, `lava`; Untergrund `hoehlenboden`, `wurzelboden`, `obsidianboden`, `lehm` (Lehmnester der Wurzelhöhlen, ADR-0024); festes Gestein (`solid`): `fels`, `tiefenfels`, `glutfels` + Erzadern (`ader_<erz>`). Klippenwände entstehen aus Höhendifferenzen, Wasser aus dem `water`-Feld.
- **Tileset-Sprites** (Autotiling, 47er-Blob): je Terrain-Typ ein Sprite `tileset_<terrain>` mit 16×16-Frames; Frame 0–46 = Blob-Index nach `src/world/autotile.ts` (`BLOB_MASKS`), Frames 47+ = Varianten des Vollfeldes (3–4); ihre Streugewichte und ob sie gespiegelt werden dürfen, stehen am Terrain-Datensatz (`tileset` in `src/content/terrain.ts`, ADR-0024). Klippen: `tileset_klippe_<biomgruppe>` (Wandstücke 16 px je Stufe, Kanten, Rampe, Treppe).
- **Welt-Objekte** (`src/content/worldObjects.ts`, Gameplay-Daten ohne Sprite-Referenz): Bäume `baum_<art>` (14 Arten: `eiche`, `birke`, `buche`, `kiefer`, `weide`, `mangrove`, `tanne`, `dattelpalme`, `aschebaum`, `lichtbaum`, `apfelbaum`, `kirschbaum`, `birnbaum`, `walnussbaum`), Büsche `busch_<art>`, Felsen `fels_<groesse>_<biom>`, Kristalle `kristall_<art>`, Erzknoten `erz_<erz>`, Streudeko `deko_<typ>`, Pflanzen `pflanze_<art>`. Das Sprite trägt dieselbe ID wie das Objekt (Zuordnung per Konvention, Integrationstest prüft Vollständigkeit). Jahreszeitliches Laub über Palettenzeilen.
- **Erze**: `kupfer`, `zinn`, `raseneisen`, `eisen`, `kohle`, `silber`, `gold`, `klarquarz`, `salpeter`, `obsidian`, `schwefel`, `magmit`, `lumenit`, `prismenquarz`, `nachtstahl`, `edelstein`.
