# RENDER – Verträge für Asset-Pipeline und Renderer

Ergänzt MASTERPROMPT §4–§6 und docs/ARCHITEKTUR.md. Änderungen nur per ADR.

## 1. Sprite-Quellformat (`assets-src/sprites/**/*.ts`)
```ts
import { sprite } from '../../lib/sprite';
export default sprite({
  id: 'fackel_wand',            // snake_case, global eindeutig
  group: 'licht',               // Kontaktbogen-Gruppe
  size: [16, 16],               // Zellgröße je Frame
  anchor: [8, 15],              // Fußpunkt (y-Sortierung, Platzierung)
  hoehe: 'zylinder',            // flach | zylinder | kugel | block | custom (Normal-/Höhengenerator)
  legende: { '.': null, o: 'holz.2', O: 'holz.4', f: 'feuer.3*', F: 'feuer.5*' }, // * = emissiv
  frames: [`...`, `...`],       // Index-Raster, Zeilen per Template-String, Einrückung wird entfernt
  clips: { idle: { frames: [0, 1, 2, 3], fps: 10, loop: true } },
  hitbox: [4, 10, 8, 6],        // x, y, w, h relativ zur Zelle (optional)
  sockets: { hand: [[10, 12], …] },   // je Frame (optional)
  occluder: { kind: 'ellipse', x: 8, y: 14, rx: 3, ry: 2 },  // none | rect | ellipse | sprite (optional)
  schatten: 'silhouette',       // Sonnenschatten aus Silhouette (Standard) | none
  material: { metall: 'M', nass: 'W' }, // optional: Zeichen mit Materialflags
});
```
- Ein Zeichen = ein Palettenindex (`rampe.stufe`, **Stufen ab 0**: `feuer.0` ist die dunkelste Stufe; das Literal-Beispiel `feuer.6` in MASTERPROMPT §5 zählt ab 1 und entspricht `feuer.5`), `*` markiert emissive Pixel; exakte Palettenfarben als `#rrggbb` sind in der Legende ebenfalls erlaubt. ≤ 12 Farben je Sprite (Ausnahmen per `ausnahmeFarben: 'Begründung'`).
- Ergänzungen (ADR-0014): `group` ist optional (Standard: Ordnername); ein einzelner Sockelpunkt gilt für alle Frames; Clips können `events` tragen; optional `spiegelbar` (Spiegeln erlaubt), `einzelpixel` (Begründung für gewollte Einzelpixel), `hoehenRaster` (manuelle Höhe, Pflicht bei `hoehe: 'custom'`); ein Materialflag `true` gilt für alle deckenden Pixel. Dateien, die mit `_` beginnen, sind Hilfsmodule und werden nicht als Sprite gelesen.
- Dateien exportieren ein Sprite, ein Array oder das Ergebnis eines Generators (`generate(seed, …)` → Sprites). Generatoren sind deterministisch (eigener `Rng` aus `src/engine/rng.ts`).
- Palettenzeilen-Varianten (Jahreszeiten, Biom-Tönung, Elite, Verderbnis, Materialstufen, Charakteranpassung) in `assets-src/paletteRows.ts`: jede Zeile bildet jeden der 64 Indizes auf einen Palettenindex ab.

## 2. Generierte Artefakte (`npm run assets`, gitignored)
- `public/generated/atlas-albedo.png` – RGBA8: **R** = Palettenindex (1…64, 0 = transparent), **G** = Emissiv (0/255), **B** = Materialflags (Bit 0 Metall, Bit 1 nass/glänzend, Bit 2 Eis, Bit 3 Wind-Biegung, Bit 4 Blätterdach/Dach), **A** = Deckung (0/255).
- `public/generated/atlas-normal.png` – RGBA8: **RG** = Normale XY (0.5 + 0.5·n, **+y = oben** auf dem Bildschirm, wie der G-Buffer, ADR-0011), **B** = Höhe (0…255 ≙ 0…32 px über Boden), **A** = Deckung.
- `src/generated/atlas.ts` – Manifest: Atlasgröße, je Sprite: Frames (x, y, w, h), Anker, Hitbox, Sockel je Frame, Clips, Occluder, Höhen-Hinweis (`hoehe`), emissiv (`emissiv`), spiegelbar (`spiegelbar`), Gruppe, dazu `schatten` (`basisY`, `bounds`), `bounds`, `material`, `farben`; Palettenzeilen-Tabelle (`{ id, beschreibung, map }`, `map[i]` = Index für Index `i + 1`); Quell-Hash. Der Renderer liest es über den Adapter `src/render/assets/generated.ts` (zod-geprüft) in sein `AtlasManifest`.
- `src/generated/palette.ts` – Master-Palette (64 + 8 UI), Rampen, Raritätsfarben als Palettenreferenzen (`RARITY_REFS`).
- `tools/out/sheets/<gruppe>.png` – Kontaktbögen (Albedo auf hellem und dunklem Grund, Normalen, Emissiv, Animationsraster, 4× vergrößert); dazu `palette.png`, `normals.png`, `vorschau_gruenhain.png` (Kachelfelder + Szene), `biome.png` (Biom-Tönung), `ui-kit.png`.

## 3. Renderer (`src/render`)
- `gl/` Kontext, Programme (`#include`), Ressourcen (Textur, Framebuffer inkl. MRT, Buffer, VAO), Float-RT-Erkennung mit RGBA8-Fallback, Kontextverlust → alles neu aufbauen.
- `assets/atlas.ts` lädt Atlanten + Manifest; `palette/lut.ts` baut die Paletten-LUT (64 × Zeilen, RGBA8).
- `camera.ts`: Welt in Pixeln; Kamera ganzzahlig, Nachkommaanteil als Subpixel-Offset im Präsentationspass; Szene mit 1 px Rand.
- `batch/spriteBatcher.ts`: instanzierte Quads. Instanzattribute: Position (Welt-px, Anker), Atlas-Rect, Palettenzeile, Tiefe (y-Sortierung), Höhe-Basis, Flags (Spiegeln, Outline, Weißblitz, Emissiv-Verstärkung, Dither-Ausblendung), Wind-Parameter, Tönung RGBA8, Rotation. Keine Allokation pro Frame (vorab reservierte Typed Arrays).
- `tilemap/chunkMesh.ts`: statische Boden-Meshes je Chunk, Neuaufbau nur bei Änderung.
- Pässe (`passes/`): G-Buffer (MRT: G0 Albedo · G1 Normale XY + Höhe + Materialflags · G2 Emissiv + Glanz/Nässe) → Occluder/SDF → Sonnenschatten → Licht (RGBA16F) → Komposition → Wasser → Atmosphäre → Post (Bloom, Grading-LUT, Zustände, Vignette, Korn) → Präsentation (scharfes Hochskalieren + Subpixel).
- `RenderScene` (pro Frame von der Präsentationsschicht befüllt): Kamera, Tiles/Chunks, Sprite-Instanzen, Lichter (`LightInstance`: Position, Höhe, Radius, Farbe, Intensität, Flackern, Kegel), Umgebungslicht, Zeit, Wetter-/Grading-Parameter. Die Lichtliste stammt aus derselben Quelle wie die Gameplay-Lichtkarte (§12.1).
- Weltnahe UI (ADR-0014): `RenderScene.worldUi` (Namen, Leisten, Schadenszahlen, Interaktionsmarker in Weltpixeln) zeichnet der Pass `welt-ui` (`passes/worldUiPass.ts`, `PASS_ORDER.worldUi`, nach Outline) mit dem Glyphenatlas der Pixelschrift (`text/`) ins LDR-Ziel – unbeleuchtet, auf ganzen internen Pixeln, ein Draw-Call. Ein Interaktionsmarker trägt eine Sperrfläche (die Figur des Spielers, `WorldUiList.marker(…, avoid)`): würde er sie verdecken, hebt der Pass ihn über ihren Kopf (`markerBottomClearOf`, ADR-0034); zeigt das HUD den Hinweis, ist der Marker nur die Tastenkappe.
- Standardszene der Seite ist `spiel` (Spielansicht, ADR-0026): die Welt der Sitzung unter der Kamera der gesteuerten Figur, hinter dem Titel der Startstrand; die M1-Lichtung `gruenhain` und die übrigen Szenen über `__dh.call('renderScene', id)` bzw. Szenarien.
- **Welt-Darstellung** (`world/`, ADR-0025): `tables.ts` (Laufzeit-Ids → Tileset-Frames, Biomzeilen, Klippengruppen, Objekt-Sprites), `window.ts` (Chunk + Nachbarrand), `terrainMesh.ts`/`terrainPass.ts` (statische Instanz-Meshes je Chunk, ein Draw-Call je sichtbarem Chunk, Neubau nur bei geänderter Inhaltssignatur des Chunks oder eines Nachbarn, `shaders/world/terrain.*`), `shading.ts` (Schatten als Palettenstufen aus dem Höhenfeld), `objects.ts` (y-sortierte Objekte, Jahreszeit-/Abgeerntet-Frames, Blätterdach-Ausblendung), `signature.ts`, `showcase.ts`, `worldHost.ts` (Welt im Welt-Worker + Streaming über den `ChunkManager`; fällt der Worker vor der Welt aus, erzeugt derselbe Code sie im Hauptthread, sonst meldet `onError` den Grund, ADR-0027; fällt er während der Sitzung aus – abgelehnter Auftrag oder 5 s ohne Antwort –, lädt `WorkerFailover` die Chunks mit einer Warnung im Hauptthread weiter, im Frame-Budget, ADR-0033; Modus `adopt`: die Welt der Sitzung geht an die Simulation, gestreamt wird deren Chunk-Store), `groundDecor.ts` (Dünengras-Horste der Salzküste als flache Streuobjekte über Kachelgrenzen, M3-40, ADR-0033), `worldScene.ts` (Debug-Szenen `gruenhain-tag`, `frostkamm-tag`, `glutsand-tag`, `ebene-1-roh` mit eigener Welt), `gameScene.ts` (Spielansicht `spiel`: Kamera folgt der Figur samt Ebene, sonst freie Kamera ab dem Titelbild; Licht aus Kalender und Wetter; Handlicht der Figur bei Dunkelheit), `debugCamera.ts` (Pfeiltasten, nur im Debug-Modus).
- **Debug-Overlays** (M2-29, ADR-0026): `RenderScene.debugOverlay` (gepoolte Rechtecke und Beschriftungen in Weltpixeln), gezeichnet vom Pass `debug-overlay` (`PASS_ORDER.debugOverlay`, nach Umriss, vor der Welt-UI, unbeleuchtet, ein Draw-Call, Glyphenatlas der Pixelschrift). Erzeuger `world/overlays.ts`: `chunks` (Zustand aktiv/eingefroren/lädt/fehlt, Koordinaten), `kollision` (Kategorien des `CollisionGrid`, Rampen/Treppen), `temperatur` (5-°C-Bänder, Werte alle acht Kacheln); Schalter `__dh.call('worldOverlay', name, an)` bzw. Konsole `overlay`.
- **Spielfigur und Spielgeschehen** (`game/`, ADR-0033): `playerFigure.ts` (Körper-Clips, Gegenstände an den Hand-Sockeln, Kleidung, Zustands-Look), `figureFx.ts` (Zittern, Atem, Flammen), `objects.ts` (Fokus-Umriss, Marker, Fortschrittsring, Drops mit Glitzern im Dunkeln), `lights.ts` (die Lichtquellenliste der Simulation als `LightInstance`, Lagerfeuer- und Fackel-Sprites), `graves.ts`.
- **Entitäts-Inspektor** (nur Debug, `src/debug/inspector.ts`, `inspectorView.tsx`; M3-35): Alt + Klick (oder Klick nach `inspect an`) wählt die Entität unter dem Zeiger und listet ihre Komponenten live; Esc schließt.
- Render-Debugger: jeder Puffer einzeln (`__dh.call('renderDebug', 'albedo' | 'normal' | 'height' | 'emissive' | 'sdf' | 'sun' | 'light' | 'gi' | 'wet' | 'fog' | 'lightmap' | 'off')`).
- Statistiken je Frame: Draw-Calls, Sprites, Lichter, Partikel, Render-Vorbereitung (ms) → F3-Overlay und `npm run bench`; `__dh.call('glErrors')` leert die WebGL-Fehlerflags (E2E „keine GL-Fehler“, ADR-0015). Der Frame-Pfad allokiert nichts je Frame; `npm run bench` misst es je Szene mit einem Heap-Profil (`render:frame-pfad`).
