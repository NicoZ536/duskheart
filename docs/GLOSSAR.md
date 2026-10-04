# GLOSSAR – ein Begriff pro Ding (DE / EN)
Verbindliche Namen für Texte, Content-IDs, Code-Kommentare und UI (MASTERPROMPT §2.11). Neue Begriffe erst hier eintragen, dann verwenden. Quelle der Namen ist MASTERPROMPT; der Abschnittsverweis steht in der Bedeutung.

## Welt & Geschichte (§8)
| DE | EN | Bedeutung |
|---|---|---|
| Lumara | Lumara | Der Kontinent, auf dem das Spiel spielt |
| Erbauer | Builders | Vergangene Zivilisation, die das Urfeuer bändigen wollte |
| Urfeuer | Primal Fire | Ursprüngliche Lichtquelle der Welt |
| Nachtherz | Nightheart | Wunde im Zentrum der Welt, aus der Dunkelheit sickert; auch das letzte Biom |
| Leuchtfeuer | Beacon | Eines der sechs großen Feuer, je Biom eines |
| Leuchtfeuer-Stätte | Beacon Site | Ort eines Leuchtfeuers mit Boss-Arena; entzündet: Schutzzone, Schnellreisepunkt (§8, §9.2; Ortstyp `leuchtfeuer`, das Leuchtfeuer selbst gehört dem System `beacons`) |
| Leuchtfeuer-Wissen | Beacon Lore | Freischaltungen je entzündetem Leuchtfeuer (§23.1) |
| Schattenbrut | Shadowspawn | Kreaturen der Dunkelheit |
| Gezeichnete | The Marked | Menschen, die der Dunkelheit verfallen sind |
| Glutträger | Emberbearer | Die Spielfigur |
| Funke | Spark | Flammengeist in der Laterne, gibt Hinweise – höchstens zwei Zeilen, nie aufdringlich, abschaltbar; kündigt Weltereignisse an (System `guide`, Kanal `funke`; docs/SPIEL.md §23) |
| Sechsfach-Flamme | Sixfold Flame | Vereinte Flamme aller sechs Leuchtfeuer |
| Verschlinger | Devourer | Endgegner im Nachtherz |
| Vision | Vision | Kurze In-Engine-Sequenz mit Pixel-Standbildern (7 im Spiel; je entzündetem Leuchtfeuer eine, Sammlung `visions`, eigener Bildschirm, pausiert) |
| Erbauer-Tafel | Builder Tablet | Sammelbare Lore-Tafel (60; M7 die ersten zehn `tafel_01…10` in Gewölben und an Orten, Welt-Objekt `erbauer_tafel`); gelesen steht sie im Wissen der Chronik |
| Erbauer-Gewölbe | Builder Vault | Dungeon |
| Gewölbe | Vault | Kurzform für Erbauer-Gewölbe: ein reservierter Kasten (≤ 80 × 80 Kacheln) in Ebene −1 unter seinem Eingang, aus Graph-Grammatik und Raumvorlagen mit Schlüsseln, Rätseln, Fallen und Endkammer – Plan aus dem Seed, Zustand im Teilnehmer `vaults` (docs/SPIEL.md §19) |
| Ort | Place | Besonderer Ort in einem Orts-Slot der Welt (Ortstyp nach §21: Leuchtfeuer-Stätte, Aussichtsturm, Gehöft, Schrein …) mit Name, Kartensymbol, Entdeckung, Truhen, Wächtern und Wirkung; entdeckt, geplündert und gereinigt werden gespeichert (docs/SPIEL.md §18) |
| Erbauer-Straße | Builder Road | Zerfallene Straße zwischen den Leuchtfeuer-Stätten (§9.2) |
| Nachwelt | Afterworld | Spielphase nach dem Abspann |
| Echo-Boss | Echo Boss | Stärkerer Rückkampf gegen einen Boss in der Nachwelt (§20.2) |

## Biome & Ebenen (§9)
| DE | EN | Bedeutung |
|---|---|---|
| Biom | Biome | Klimazone mit eigener Palette, Kreaturen und Ressourcen |
| Stufe | Tier | Fortschrittsstufe T0–T7 von Biomen, Werkzeugen und Ressourcen (§13.2) |
| Grünhain | Greengrove | Startbiom |
| Salzküste | Saltcoast | Küstenbiom |
| Nebelmoor | Mistmoor | Sumpfbiom |
| Frostkamm | Frostcrest | Gebirgs-/Schneebiom |
| Glutsand | Embersand | Wüstenbiom |
| Aschenschlund | Ashmaw | Vulkanbiom |
| Scherbenhain | Shardgrove | Kristallbiom |
| Wurzelhöhlen | Rootcaves | Untergrundebene −1 |
| Tiefgrund | Deepground | Untergrundebene −2 |
| Glutadern | Embervein | Untergrundebene −3 |
| Oberfläche | Surface | Ebene 0 mit Höhenstufen 0–4 |
| Ebene | Layer | Oberfläche oder Untergrundebene (z ∈ {0, −1, −2, −3}), gleiches Koordinatensystem |
| Höhenstufe | Elevation | Höhe 0–4 der Oberfläche; −3 °C je Stufe (§9.1) |
| Übergangsstreifen | Transition Band | Verwischte Biomgrenze, z. B. Taiga zwischen Grünhain und Frostkamm |
| Verderbnis | Corruption | Vom Nachtherz verdorbenes Gebiet; steigert die Furcht (§12.3) |

## Zeit & Ereignisse (§10)
| DE | EN | Bedeutung |
|---|---|---|
| Spieltag | Day | Ein Tag-Nacht-Zyklus (Standard 24 Echtminuten) |
| Jahreszeit | Season | Frühling, Sommer, Herbst, Winter (je 7 Tage) |
| Dämmerung | Twilight | Weich überblendeter Übergang Tag ↔ Nacht (je 2 h) |
| Schattenflut | Shadow Tide | Belagerung der Basis in jeder 7. Nacht |
| Finstermond | Dark Moon | Neumondnacht mit mehr Schattenbrut |
| Lumenregen | Lumen Rain | Sternschnuppen-Ereignis mit glühenden Scherben |
| Nebelnacht | Fog Night | Ereignis mit Irrlichtern |
| Sonnenfinsternis | Eclipse | Seltenes Ereignis: tagsüber eine Stunde Nacht |
| Wandernde Händlerin | Wandering Trader | Besucht die Basis alle 5–7 Tage (§22.3) |

## Welt-Inhalte (§9.3, §10, §13.2, §14; docs/WORLD.md §7)
Namen der Datensätze in `src/content/` (Test `tests/unit/content/world-content.test.ts` gleicht sie mit diesen Zeilen ab). Magmit und Lumenit stehen unter „Items & Fortschritt“.
### Erze (§13.2, `src/content/ores.ts`)
| DE | EN | Bedeutung |
|---|---|---|
| Kupfererz | Copper Ore | Erz `kupfer`, Härte 1 (§13.2); Grünhain, Wurzelhöhlen; im Untergrund als Ader |
| Zinnerz | Tin Ore | Erz `zinn`, Härte 1 (§13.2); Grünhain, Wurzelhöhlen; im Untergrund als Ader |
| Raseneisenerz | Bog Iron Ore | Erz `raseneisen`, Härte 2 (§13.2); Nebelmoor |
| Eisenerz | Iron Ore | Erz `eisen`, Härte 2 (§13.2); Tiefgrund; im Untergrund als Ader |
| Salpeter | Saltpetre | Erz `salpeter`, Härte 2 (§13.2); Wurzelhöhlen; im Untergrund als Ader |
| Steinkohle | Coal | Erz `kohle`, Härte 3 (§13.2); Frostkamm |
| Silbererz | Silver Ore | Erz `silber`, Härte 3 (§13.2); Frostkamm, Tiefgrund; im Untergrund als Ader |
| Golderz | Gold Ore | Erz `gold`, Härte 4 (§13.2); Glutsand, Tiefgrund; im Untergrund als Ader |
| Klarquarz | Clear Quartz | Erz `klarquarz`, Härte 4 (§13.2); Glutsand, Tiefgrund; im Untergrund als Ader |
| Edelstein | Gemstone | Erz `edelstein`, Härte 4 (§13.2); Tiefgrund; im Untergrund als Ader |
| Obsidian | Obsidian | Erz `obsidian`, Härte 5 (§13.2); Aschenschlund, Glutadern; im Untergrund als Ader |
| Schwefel | Sulfur | Erz `schwefel`, Härte 5 (§13.2); Aschenschlund |
| Prismenquarz | Prism Quartz | Erz `prismenquarz`, Härte 6 (§13.2); Scherbenhain |
| Nachtstahl-Erz | Nightsteel Ore | Erz `nachtstahl`, Härte 7 (§13.2); Nachtherz |

### Terrain (docs/WORLD.md §3, §7, `src/content/terrain.ts`)
| DE | EN | Bedeutung |
|---|---|---|
| Gras | Grass | Bodentyp `gras`; Schaufel (Härte 1) → `erde` |
| Erde | Dirt | Bodentyp `erde`; Schaufel (Härte 1) → `erde`, gegraben neben gegrabenem Boden → `graben` |
| Sand | Sand | Bodentyp `sand`; Schaufel (Härte 1) → `sand` |
| Dünengras | Dune Grass | Bodentyp `duenengras`: Dünen der Salzküste hinter dem Strand, Sand mit blaugrünen Grasbüscheln; Schaufel (Härte 1) → `sand` (ADR-0027) |
| Schnee | Snow | Bodentyp `schnee`; Schaufel (Härte 1) → `erde` |
| Asche | Ash | Bodentyp `asche`; Schaufel (Härte 1) → `asche` |
| Kristallboden | Crystal Ground | Bodentyp `kristallboden` |
| Moorschlamm | Bog Mud | Bodentyp `moorschlamm` |
| Torf | Peat | Bodentyp `torf`; Schaufel (Härte 2) → `erde` |
| Meeresgrund | Seabed | Bodentyp `meeresgrund` |
| Erbauer-Pflaster | Builder Paving | Bodentyp `strasse` |
| Gletschereis | Glacier Ice | Bodentyp `eis`; Spitzhacke (Härte 3) → `schnee` |
| Lava | Lava | Bodentyp `lava`, nicht begehbar |
| Trockengraben | Trench | Bodentyp `graben`: gegrabene Erde, neben anderem gegrabenen Boden vertieft (M4-36); gegraben neben Wasser → Wassergraben |
| Wassergraben | Water Ditch | Gegrabener Boden neben offenem Wasser, flach geflutet; sein Wasser läuft durch angeschlossene Trockengräben |
| Höhlenboden | Cave Floor | Bodentyp `hoehlenboden` |
| Wurzelboden | Root Floor | Bodentyp `wurzelboden`; Schaufel (Härte 1) → `hoehlenboden` |
| Lehm | Clay | Bodentyp `lehm`; Schaufel (Härte 1) → `hoehlenboden` |
| Obsidianboden | Obsidian Floor | Bodentyp `obsidianboden` |
| Fels | Rock | Festes Wirtsgestein `fels` einer Untergrundebene (Spitzhacke, Härte 1) |
| Tiefenfels | Deep Rock | Festes Wirtsgestein `tiefenfels` einer Untergrundebene (Spitzhacke, Härte 2) |
| Glutfels | Ember Rock | Festes Wirtsgestein `glutfels` einer Untergrundebene (Spitzhacke, Härte 5) |
| Kupfererz-Ader | Copper Ore Vein | Erzader `ader_kupfer` im festen Gestein (Spitzhacke, Härte 1) |
| Zinnerz-Ader | Tin Ore Vein | Erzader `ader_zinn` im festen Gestein (Spitzhacke, Härte 1) |
| Eisenerz-Ader | Iron Ore Vein | Erzader `ader_eisen` im festen Gestein (Spitzhacke, Härte 2) |
| Salpeter-Ader | Saltpetre Vein | Erzader `ader_salpeter` im festen Gestein (Spitzhacke, Härte 2) |
| Silbererz-Ader | Silver Ore Vein | Erzader `ader_silber` im festen Gestein (Spitzhacke, Härte 3) |
| Golderz-Ader | Gold Ore Vein | Erzader `ader_gold` im festen Gestein (Spitzhacke, Härte 4) |
| Klarquarz-Ader | Clear Quartz Vein | Erzader `ader_klarquarz` im festen Gestein (Spitzhacke, Härte 4) |
| Edelstein-Ader | Gemstone Vein | Erzader `ader_edelstein` im festen Gestein (Spitzhacke, Härte 4) |
| Obsidian-Ader | Obsidian Vein | Erzader `ader_obsidian` im festen Gestein (Spitzhacke, Härte 5) |
| Magmit-Ader | Magmite Vein | Erzader `ader_magmit` im festen Gestein (Spitzhacke, Härte 5) |
| Lumenit-Ader | Lumenite Vein | Erzader `ader_lumenit` im festen Gestein (Spitzhacke, Härte 6) |

### Bäume (§14, `baum_<art>`)
| DE | EN | Bedeutung |
|---|---|---|
| Eiche | Oak | Baumart `baum_eiche`; Grünhain |
| Birke | Birch | Baumart `baum_birke`; Grünhain |
| Buche | Beech | Baumart `baum_buche`; Grünhain |
| Kiefer | Pine | Baumart `baum_kiefer`; Grünhain, Salzküste, Frostkamm |
| Weide | Willow | Baumart `baum_weide`; Grünhain, Nebelmoor |
| Mangrove | Mangrove | Baumart `baum_mangrove`; Nebelmoor |
| Tanne | Fir | Baumart `baum_tanne`; Frostkamm |
| Dattelpalme | Date Palm | Baumart `baum_dattelpalme`; Glutsand |
| Aschebaum | Ash Tree | Baumart `baum_aschebaum`; Aschenschlund |
| Lichtbaum | Lighttree | Baumart `baum_lichtbaum`; Scherbenhain |
| Apfelbaum | Apple Tree | Baumart `baum_apfelbaum`; Grünhain |
| Kirschbaum | Cherry Tree | Baumart `baum_kirschbaum`; Grünhain |
| Birnbaum | Pear Tree | Baumart `baum_birnbaum`; Grünhain |
| Walnussbaum | Walnut Tree | Baumart `baum_walnussbaum`; Grünhain |

### Büsche (`busch_<art>`)
| DE | EN | Bedeutung |
|---|---|---|
| Beerenstrauch | Berry Bush | Busch `busch_beeren`; Grünhain |
| Haselstrauch | Hazel Bush | Busch `busch_hasel`; Grünhain |
| Sanddorn | Sea Buckthorn | Busch `busch_sanddorn`; Salzküste |
| Moorbeerenstrauch | Bogberry Bush | Busch `busch_moorbeere`; Nebelmoor |
| Frostbeerenstrauch | Frostberry Bush | Busch `busch_frostbeere`; Frostkamm |
| Wacholder | Juniper | Busch `busch_wacholder`; Frostkamm |
| Wilde Baumwolle | Wild Cotton | Busch `busch_baumwolle`; Glutsand |
| Dornbusch | Thornbush | Busch `busch_dornbusch`; Glutsand |
| Glutdorn | Emberthorn | Busch `busch_glutdorn`; Aschenschlund |
| Kristallstrauch | Crystal Shrub | Busch `busch_kristallstrauch`; Scherbenhain |
| Dornenranke | Thorn Vine | Busch `busch_dornenranke`; Nachtherz |
| Wurzelgeflecht | Root Tangle | Busch `busch_wurzelgeflecht`; Wurzelhöhlen |

### Wildpflanzen (`pflanze_<art>`)
| DE | EN | Bedeutung |
|---|---|---|
| Fasergras | Fibre Grass | Wildpflanze `pflanze_fasergras`; Grünhain, Nebelmoor, Frostkamm |
| Wildkräuter | Wild Herbs | Wildpflanze `pflanze_kraeuter`; Grünhain |
| Steinpilz | Porcini | Wildpflanze `pflanze_steinpilz`; Grünhain, Nebelmoor |
| Strandhafer | Marram Grass | Wildpflanze `pflanze_strandhafer`; Salzküste (Strand und Dünengras) |
| Schilf | Reed | Wildpflanze `pflanze_schilf`; Nebelmoor |
| Bergtee | Mountain Tea | Wildpflanze `pflanze_bergtee`; Frostkamm |
| Kaktus | Cactus | Wildpflanze `pflanze_kaktus`; Glutsand |
| Feuerwurz | Firewort | Wildpflanze `pflanze_feuerwurz`; Aschenschlund |
| Prismenblüte | Prism Blossom | Wildpflanze `pflanze_prismenbluete`; Scherbenhain |
| Schattenkraut | Shadewort | Wildpflanze `pflanze_schattenkraut`; Nachtherz |
| Leuchtpilz | Glowcap | Wildpflanze `pflanze_leuchtpilz`; Wurzelhöhlen |
| Kristallmoos | Crystal Moss | Wildpflanze `pflanze_kristallmoos`; Tiefgrund |
| Glutmoos | Embermoss | Wildpflanze `pflanze_glutmoos`; Glutadern |

### Felsen (`fels_<groesse>_<biom>`)
| DE | EN | Bedeutung |
|---|---|---|
| Kleiner Feldstein | Small Fieldstone | Fels `fels_klein_gruenhain`; Grünhain |
| Großer Feldstein | Large Fieldstone | Fels `fels_gross_gruenhain`; Grünhain |
| Kleiner Küstenfels | Small Coastal Rock | Fels `fels_klein_salzkueste`; Salzküste |
| Großer Küstenfels | Large Coastal Rock | Fels `fels_gross_salzkueste`; Salzküste |
| Kleiner Moorstein | Small Bogstone | Fels `fels_klein_nebelmoor`; Nebelmoor |
| Großer Moorstein | Large Bogstone | Fels `fels_gross_nebelmoor`; Nebelmoor |
| Kleiner Granitblock | Small Granite | Fels `fels_klein_frostkamm`; Frostkamm |
| Großer Granitblock | Large Granite | Fels `fels_gross_frostkamm`; Frostkamm |
| Kleiner Sandstein | Small Sandstone | Fels `fels_klein_glutsand`; Glutsand |
| Großer Sandstein | Large Sandstone | Fels `fels_gross_glutsand`; Glutsand |
| Kleiner Basaltblock | Small Basalt | Fels `fels_klein_aschenschlund`; Aschenschlund |
| Großer Basaltblock | Large Basalt | Fels `fels_gross_aschenschlund`; Aschenschlund |
| Kleiner Scherbenstein | Small Shardstone | Fels `fels_klein_scherbenhain`; Scherbenhain |
| Großer Scherbenstein | Large Shardstone | Fels `fels_gross_scherbenhain`; Scherbenhain |
| Kleines Nachtgestein | Small Nightrock | Fels `fels_klein_nachtherz`; Nachtherz |
| Großes Nachtgestein | Large Nightrock | Fels `fels_gross_nachtherz`; Nachtherz |
| Kleiner Wurzelfels | Small Rootrock | Fels `fels_klein_wurzelhoehlen`; Wurzelhöhlen |
| Großer Wurzelfels | Large Rootrock | Fels `fels_gross_wurzelhoehlen`; Wurzelhöhlen |
| Kleiner Tiefenstein | Small Deepstone | Fels `fels_klein_tiefgrund`; Tiefgrund |
| Großer Tiefenstein | Large Deepstone | Fels `fels_gross_tiefgrund`; Tiefgrund |
| Kleiner Glutstein | Small Emberstone | Fels `fels_klein_glutadern`; Glutadern |
| Großer Glutstein | Large Emberstone | Fels `fels_gross_glutadern`; Glutadern |

### Kristalle (`kristall_<art>`)
| DE | EN | Bedeutung |
|---|---|---|
| Eiskristall | Ice Crystal | Kristallknoten `kristall_eis`; Frostkamm |
| Glutkristall | Ember Crystal | Kristallknoten `kristall_glut`; Aschenschlund, Glutadern |
| Lumenkristall | Lumen Crystal | Kristallknoten `kristall_lumen`; Scherbenhain |
| Prismenkristall | Prism Crystal | Kristallknoten `kristall_prisma`; Scherbenhain |
| Leerenkristall | Void Crystal | Kristallknoten `kristall_leere`; Nachtherz |
| Tiefenkristall | Deep Crystal | Kristallknoten `kristall_tiefen`; Tiefgrund |

### Erzvorkommen (`erz_<erz>`)
| DE | EN | Bedeutung |
|---|---|---|
| Kupfererz-Vorkommen | Copper Ore Deposit | Erzknoten `erz_kupfer`; Grünhain, Wurzelhöhlen |
| Zinnerz-Vorkommen | Tin Ore Deposit | Erzknoten `erz_zinn`; Grünhain, Wurzelhöhlen |
| Raseneisenerz-Vorkommen | Bog Iron Ore Deposit | Erzknoten `erz_raseneisen`; Nebelmoor |
| Eisenerz-Vorkommen | Iron Ore Deposit | Erzknoten `erz_eisen`; Tiefgrund |
| Salpeter-Vorkommen | Saltpetre Deposit | Erzknoten `erz_salpeter`; Wurzelhöhlen |
| Steinkohle-Vorkommen | Coal Deposit | Erzknoten `erz_kohle`; Frostkamm |
| Silbererz-Vorkommen | Silver Ore Deposit | Erzknoten `erz_silber`; Frostkamm, Tiefgrund |
| Golderz-Vorkommen | Gold Ore Deposit | Erzknoten `erz_gold`; Glutsand, Tiefgrund |
| Klarquarz-Vorkommen | Clear Quartz Deposit | Erzknoten `erz_klarquarz`; Glutsand, Tiefgrund |
| Edelstein-Vorkommen | Gemstone Deposit | Erzknoten `erz_edelstein`; Tiefgrund |
| Obsidian-Vorkommen | Obsidian Deposit | Erzknoten `erz_obsidian`; Aschenschlund, Glutadern |
| Schwefel-Vorkommen | Sulfur Deposit | Erzknoten `erz_schwefel`; Aschenschlund |
| Magmit-Vorkommen | Magmite Deposit | Erzknoten `erz_magmit`; Aschenschlund, Glutadern |
| Lumenit-Vorkommen | Lumenite Deposit | Erzknoten `erz_lumenit`; Scherbenhain, Glutadern |
| Prismenquarz-Vorkommen | Prism Quartz Deposit | Erzknoten `erz_prismenquarz`; Scherbenhain |
| Nachtstahl-Erz-Vorkommen | Nightsteel Ore Deposit | Erzknoten `erz_nachtstahl`; Nachtherz |

### Streudeko (`deko_<typ>`)
| DE | EN | Bedeutung |
|---|---|---|
| Steinchen | Pebbles | Streudeko `deko_steinchen`; Grünhain, Salzküste, Nebelmoor, Frostkamm, Glutsand, Aschenschlund, Scherbenhain, Wurzelhöhlen, Tiefgrund, Glutadern |
| Wildblumen | Wildflowers | Streudeko `deko_blumen`; Grünhain, Scherbenhain |
| Pilzgruppe | Mushroom Cluster | Streudeko `deko_pilze`; Grünhain, Nebelmoor, Wurzelhöhlen |
| Falllaub | Fallen Leaves | Streudeko `deko_laub`; Grünhain |
| Grasbüschel | Grass Tufts | Streudeko `deko_graeser`; Grünhain, Frostkamm |
| Moospolster | Moss Cushion | Streudeko `deko_moos`; Grünhain, Nebelmoor, Wurzelhöhlen |
| Muscheln | Seashells | Streudeko `deko_muscheln`; Salzküste |
| Treibholz | Driftwood | Streudeko `deko_treibholz`; Salzküste |
| Angespülter Tang | Washed-up Kelp | Streudeko `deko_tang`; Salzküste |
| Moorgras | Bog Grass | Streudeko `deko_moorgras`; Nebelmoor |
| Knochen | Bones | Streudeko `deko_knochen`; Frostkamm, Glutsand, Aschenschlund, Nachtherz, Tiefgrund, Glutadern |
| Eisbrocken | Ice Chunks | Streudeko `deko_eisbrocken`; Frostkamm |
| Zapfen | Pine Cones | Streudeko `deko_zapfen`; Frostkamm |
| Trockengras | Dry Grass | Streudeko `deko_trockengras`; Glutsand |
| Tonscherben | Pottery Shards | Streudeko `deko_tonscherben`; Glutsand, Tiefgrund |
| Ruinenbrocken | Ruin Rubble | Streudeko `deko_ruinenbrocken`; Glutsand, Tiefgrund |
| Aschehäufchen | Ash Mound | Streudeko `deko_aschehaufen`; Aschenschlund, Glutadern |
| Schwefelkruste | Sulfur Crust | Streudeko `deko_schwefelkruste`; Aschenschlund |
| Glutsteine | Ember Stones | Streudeko `deko_glutsteine`; Aschenschlund, Glutadern |
| Obsidiansplitter | Obsidian Chips | Streudeko `deko_obsidiansplitter`; Aschenschlund, Glutadern |
| Kristallsplitter | Crystal Splinters | Streudeko `deko_kristallsplitter`; Scherbenhain, Tiefgrund |
| Kristallgras | Crystal Grass | Streudeko `deko_kristallgras`; Scherbenhain |
| Glasscherben | Glass Shards | Streudeko `deko_glasscherben`; Scherbenhain, Nachtherz |
| Verderbnisranken | Corruption Tendrils | Streudeko `deko_verderbnisranken`; Nachtherz |
| Kratersteine | Crater Stones | Streudeko `deko_kratersteine`; Nachtherz |
| Wurzelstränge | Root Strands | Streudeko `deko_wurzelstraenge`; Wurzelhöhlen |
| Leuchtmoos | Glowmoss | Streudeko `deko_leuchtmoos`; Wurzelhöhlen |
| Tiefenflechten | Deep Lichen | Streudeko `deko_flechten`; Tiefgrund |

### Wetter (§10, `src/content/weather.ts`)
| DE | EN | Bedeutung |
|---|---|---|
| Klar | Clear | Wetterzustand `klar` (§10) |
| Bewölkt | Overcast | Wetterzustand `bewoelkt` (§10) |
| Nebel | Fog | Wetterzustand `nebel` (§10) |
| Niesel | Drizzle | Wetterzustand `niesel` (§10) |
| Regen | Rain | Wetterzustand `regen` (§10) |
| Gewitter | Thunderstorm | Wetterzustand `gewitter` (§10) |
| Schneesturm | Blizzard | Wetterzustand `schneesturm` (§10) |
| Hitzewelle | Heatwave | Wetterzustand `hitzewelle` (§10) |
| Sandsturm | Sandstorm | Wetterzustand `sandsturm` (§10) |
| Ascheregen | Ashfall | Wetterzustand `ascheregen` (§10) |
| Sternschnuppen-Nacht | Night of Falling Stars | Wetterzustand `sternschnuppennacht` (§10) |

## Spieler & Überleben (§11)
| DE | EN | Bedeutung |
|---|---|---|
| Leben | Health | Lebenspunkte (HP), 0 → Tod |
| Ausdauer | Stamina | Für Sprint, Rolle, Angriffe, Schwimmen |
| Sättigung | Satiety | Hungerwert 0–100 |
| Durst | Thirst | Wasserwert 0–100 |
| Körpertemperatur | Body Temperature | Kerntemperatur, Ziel 37,0 °C |
| Gefühlte Temperatur | Felt Temperature | Umgebung + Wärmequellen + Raumwert (§11.2) |
| Komfortband | Comfort Band | Temperaturbereich ohne Kälte- oder Hitzestress |
| Nässe | Wetness | 0–100 %, senkt die Isolation |
| Erschöpfung | Fatigue | Müdigkeitswert 0–100, Schlaf senkt ihn |
| Furcht | Fear | 0–100; steigt im Dunkeln, sinkt durch Licht, Feuer und Behaglichkeit (§12.3) |
| Nachtmahr | Nightmare | Erscheint bei Furcht 100 und jagt den Glutträger |
| Zustand | Status Effect | Zeitlich begrenzte Wirkung mit Icon, Dauer, Stapelregel (§11.3) |
| Ausgeruht | Well Rested | Zustand nach Schlaf im Bett |
| Behaglich | Cozy | Zustand in einem behaglichen Raum |
| Erleuchtet | Illuminated | Zustand in einer Leuchtfeuer- oder Lichtwachtzone |
| Morgenrot | Dawnglow | Zustand nach überstandener Schattenflut |
| Erschüttert | Shaken | Zustand nach dem Wiedereinstieg (−15 % max. Leben) |
| Wiedereinstieg | Respawn | Rückkehr nach dem Tod (Bett, Leuchtfeuer, Startstrand) |
| Grab | Grave | Enthält das Inventar am Todesort |
| Glutsplitter | Ember Shard | +5 maximale Ausdauer (12 in der Welt, in den Gewölben; Item `glutsplitter`, Benutzen verbraucht es dauerhaft) |
| Schlafplatz | Sleeping Place | Bett, Grasbett oder ausgerollter Schlafsack (§11.5); Bett und Grasbett setzen den Wiedereinstiegspunkt |
| Grasbett | Grass Bed | Einfaches Bett ohne Station (M3-16), halbe Erholung, setzt den Wiedereinstiegspunkt |
| Nickerchen | Nap | Schlaf außerhalb der Nacht, endet bei Erschöpfung 0 |
| Trugbild | Hallucination | Erscheinung ab Furcht 60, ab 80 mit Schaden; löst sich im Licht auf (§12.3) |
| Leinenkleidung | Linen Clothes | Tunika und Hose des Schiffbrüchigen: kein Item, immer getragen, Grundisolation (ADR-0028) |
| Einflussquelle | Modifier Source | Was die Werte des Spielers je Tick verändert: Kleidung, Ausrüstung, Zustände, Schlaf, Sitzen (`PlayerInfluences`) |
| Wärmequelle | Heat Source | Feuer, Ofen: wärmt die gefühlte Temperatur im Kern um bis zu 15 °C (§11.2) |
| Nutzungsziel | Use Target | Ding, das E benutzt statt erntet: Lagerfeuer, aufgestellte Fackel, Wasser, Baumstumpf, Grab, Schlafplatz (ADR-0028) |
| Nachlegen | Add Fuel | Brennstoff auf ein Feuer legen (E am Lagerfeuer), höchstens 6 min (§15.4) |
| Glut | Embers | Rest eines Lagerfeuers nach dem Brennstoff; neuer Brennstoff entfacht es wieder |
| Baumstumpf | Tree Stump | Rest eines gefällten Baums: roden (Axt) oder daraufsetzen |
| Herzsplitter | Heart Shard | +10 maximales Leben (Boss-Drop; Item `herzsplitter`, Benutzen verbraucht es dauerhaft) |

## Licht & Dunkelheit (§12)
| DE | EN | Bedeutung |
|---|---|---|
| Lichtkarte | Light Map | CPU-seitige Gameplay-Lichtwerte pro Tile aus derselben Lichtquellenliste wie der Renderer |
| Lichtstufe | Light Level | Dunkel < 0,15 · Dämmrig 0,15–0,4 · Hell 0,4–0,9 · Gleißend > 0,9 |
| Dunkel | Dark | Lichtstufe < 0,15: Schattenbrut darf spawnen |
| Dämmrig | Dim | Lichtstufe 0,15–0,4 |
| Hell | Bright | Lichtstufe 0,4–0,9 |
| Gleißend | Blazing | Lichtstufe > 0,9: Schattenbrut erleidet Schaden |
| Lichtquelle | Light Source | Fackel, Laterne, Feuer, Lampe … (§12.2) |
| Nebenhand | Off-hand | Ausrüstungsplatz für Lichtquelle oder Schild |
| Lumen | Lumen | Lichtenergie; Währung und Ressource |
| Lumen-Scherbe | Lumen Shard | Beute der Schattenbrut, Hauptquelle für Lumen |
| Lumen-Laterne | Lumen Lantern | Laterne mit Lumen-Ladung, schadet Schattenbrut in der Nähe |
| Lichtwacht | Lightwatch | Verteidigungsturm mit Lichtstrahl (Leuchtfeuer 4) |
| Lichtfresser | Lighteater | Schattenbrut, die Lichter löscht und Lumen absaugt |

## Items & Fortschritt (§13, §23)
| DE | EN | Bedeutung |
|---|---|---|
| Abbaukraft | Mining Power | Stärke eines Werkzeugs; muss ≥ Härte der Ressource sein |
| Härte | Hardness | Widerstand einer Ressource gegen Abbau |
| Schlüssel-Drop | Key Drop | Boss-Beute, die die Spitzhacke der nächsten Stufe ermöglicht |
| Rarität | Rarity | Gewöhnlich, Ungewöhnlich, Selten, Episch, Legendär (weiß/grün/blau/violett/gold) |
| Qualität | Quality | 1–3 Sterne aus Handwerks-Skill und Stationsstufe |
| Schnellleiste | Hotbar | 10 Plätze (Tasten 1–0) |
| Gürtel | Belt | 3 Schnellverbrauch-Plätze (Taste Q) |
| Rucksack | Backpack | Ausrüstung im eigenen Platz, gibt das Rucksackfach |
| Rucksackfach | Backpack Pocket | Zusätzliche Plätze des getragenen Rucksacks (+8/+16/+24) |
| Platz | Slot | Ein Feld der Taschen, adressiert als `{bereich, index}` |
| Stapel | Stack | Gleiche Items in einem Platz (Rohstoffe 100, Nahrung 20, Werkzeuge 1, §13.1) |
| Haltbarkeit | Durability | Nutzungen eines Werkzeugs oder einer Rüstung; 0 = kaputt, nie zerstört |
| Frische | Freshness | 0–100 % bei verderblichen Items, beim Stapeln gewichtet gemittelt |
| Verderb-Takt | Spoilage Step | Einmal je voller Spielstunde verliert jeder verderbliche Stapel der Taschen und der Behälter aktiver Chunks n × Verlust (Verlust und Frische auf dem Raster 2⁻¹⁶, darum zerlegbar); eingefrorene Chunks holen mit ihrem Stempel und Behälterfaktor auf (docs/SPIEL.md §21) |
| Tauschwert | Trade Value | Wert eines Items bei der Händlerin |
| Quelle | Source | Woher ein Item kommt (Welt, Rezept, Graben …), abgeleitet |
| Verwendung | Use | Wofür ein Item gebraucht wird (Zutat, Brennstoff, Essen …), abgeleitet |
| Geplante Verwendung | Planned Use | Verwendung, die erst ein späterer Task liefert, mit Task im Validator eingetragen (ADR-0029) |
| Endprodukt | End Product | Item ohne weitere Verwendung (Lagerfeuer, Werkbank …) |
| Rezept | Recipe | Herstellungsvorschrift `rezept_<itemId>` |
| Auftrag | Order | Eintrag der Handwerks-Warteschlange (bis 10), Zutaten beim Einreihen reserviert |
| Zutatengruppe | Ingredient Group | Rezeptzutat „irgendein Mitglied“ (`bauholz` = Holz oder Treibholz); mischbar, Stufe = frühestes Mitglied (ADR-0039) |
| Verarbeitungsprodukt | Processed Good | Zwischenprodukt einer Station (Brett, Ziegel, Barren, Garn …) |
| Charge | Batch | Ein Durchlauf einer Verarbeitungsstation aus Eingang und Brennstoff |
| Aufwerten (Station) | Upgrade (Station) | Rezept, das die Station an Ort und Stelle durch ihre nächste Stufe ersetzt (Werkbank I → II) |
| Reparatur | Repair | Haltbarkeit an Werkbank, Amboss oder Schleifstein zurückholen; kostet anteilig die Hälfte der Zutaten |
| Gating | Gating | Validator-Regel §13.2: Abbaukraft je Stufe, Härte je Ressource, Schlüssel-Drops |
| Faserseil | Fibre Rope | Erstes Rezept aus Fasern, Zutat der Steinwerkzeuge |
| Verband | Bandage | Stillt Blutung |
| Fertigkeit | Skill | Eine der 12 Fertigkeiten, Stufe 1–100 (Learning by Doing) |
| Perk | Perk | Wahlbonus bei Fertigkeitsstufe 30/60/90 |
| Chronik | Chronicle | Journal (J) mit sieben Reitern: Aufgaben, Bestiarium, Herbarium & Fischbuch, Wissen, Rezeptbuch, Statistiken, Erfolge; das Tagebuch entsteht aus den Chronik-Regeln der Stränge (docs/SPIEL.md §23) |
| Bestiarium | Bestiary | Chronik-Reiter mit Kreaturenwissen |
| Schnellreise | Fast Travel | Reise zwischen Leuchtfeuern, Herdfeuern und Wegsteinen |
| Wegstein | Waystone | Schnellreisepunkt (Leuchtfeuer 1; Bauteil `wegstein`, benennbar) |
| Sonnenstahl | Sunsteel | Werkzeugmaterial T4 |
| Magmit | Magmite | Erz und Werkzeugmaterial T5 |
| Lumenit | Lumenite | Erz und Werkzeugmaterial T6 |
| Nachtstahl | Nightsteel | Werkzeugmaterial T7 (Nachwelt) |
| Kernholz | Heartwood | Schlüssel-Drop des Borkenvaters |
| Sumpfherz | Bog Heart | Schlüssel-Drop der Sumpfmutter |
| Wyrmhorn | Wyrm Horn | Schlüssel-Drop von Hrimgar |
| Sonnenchitin | Sun Chitin | Schlüssel-Drop des Skarabäus-Kolosses |
| Glutamboss-Kern | Ember Anvil Core | Schlüssel-Drop des Aschenschmieds |
| Prismenherz | Prism Heart | Schlüssel-Drop der Gefallenen Hüterin |
| Herz der Nacht | Heart of Night | Drop des Verschlingers |

## Bosse (§20.2)
| DE | EN | Bedeutung |
|---|---|---|
| Borkenvater | Barkfather | Boss des Grünhains, verdorbener Uraltbaum |
| Sumpfmutter | Bog Mother | Boss des Nebelmoors, riesige Amphibie |
| Hrimgar, der Frostwyrm | Hrimgar, the Frost Wyrm | Boss des Frostkamms |
| Skarabäus-Koloss | Scarab Colossus | Boss des Glutsands |
| Der Aschenschmied | The Ashsmith | Boss des Aschenschlunds, Feuerelementar am Amboss |
| Die Gefallene Hüterin | The Fallen Warden | Boss des Scherbenhains, verdorbene Lichtwächterin |
| Webmutter | Web Mother | Optionaler Boss der Wurzelhöhlen |
| Salzwyrm | Salt Wyrm | Optionaler Boss der offenen See |

## Basis, Bauen & Stationen (§15, §16)
| DE | EN | Bedeutung |
|---|---|---|
| Basis | Base | Siedlungsbereich um ein Herdfeuer (höchstens 3) |
| Herdfeuer | Hearthfire | Basiskern, schützt die Basis |
| Glutkern | Ember Core | Erweitert den Radius des Herdfeuers |
| Baumodus | Build Mode | Bauansicht (Taste B) mit Geister-Vorschau |
| Blaupause | Blueprint | Geplantes Bauteil ohne Material; wird mit Hammer oder von Siedlern fertiggestellt |
| Bauplan | Schematic | Freischaltbares Rezept (Dungeons, Händlerin, Tafeln) – nicht mit Blaupause verwechseln |
| Statik | Structural Support | Regel: jedes Dachtile braucht eine Stütze in Reichweite (§16.3) |
| Stütze | Support | Wand oder Säule, die Dachtiles trägt |
| Raum | Room | Per Flood-Fill erkannter geschlossener Bereich (≤ 400 Tiles) |
| Innenraum | Interior | Raum, der zu mindestens 90 % überdacht ist |
| Raumtyp | Room Type | Automatisch erkannte Funktion (Schlafraum, Küche, Werkstatt …) |
| Behaglichkeit | Coziness | Raumwert 0–20; verlängert „Ausgeruht“, beschleunigt Furchtabbau (§16.4) |
| Station | Station | Herstellungsort für Rezepte (mindestens 30, §15.2) |
| Verarbeitungsstation | Processing Station | Station mit Eingang, Brennstoff und Ausgang, läuft zeitbasiert (Ofen, Meiler …) |
| Lagerfeuer | Campfire | Erste Licht-, Wärme- und Kochstation |
| Werkbank | Workbench | Grundstation, Stufen I–III |
| Schmelzofen | Smelter | Erz → Barren, Stufen I–III |
| Amboss | Anvil | Schmiedestation (Bronze bis Magmit) |
| Runenaltar | Rune Altar | Verzauberung mit Essenzen (§15.3) |
| Forschungspult | Research Desk | Relikte studieren, Rezepte freischalten |
| Lumen-Werkbank | Lumen Workbench | Station für Lumen-Technik (Leuchtfeuer 1) |
| Prismenwerkbank | Prism Workbench | Station für Scherbenhain-Technik (Leuchtfeuer 6) |
| Brennwert | Burn Time | Brenndauer eines Brennstoffs in Echtsekunden (§15.4) |
| Stationslinie | Station Line | Stationen gleicher Art in Stufen (Werkbank I, II …); eine höhere Stufe kann alles der niedrigeren |
| Bauteil | Build Part | Item, das im Bauraster platziert wird (Wand, Boden, Dach, Tür, Möbel …; Sammlung `buildParts`) |
| Bau-Ebene | Build Layer | Boden · Struktur · Objekt · Wandobjekt · Dach – je Kachel ein Teil pro Ebene (§16.1) |
| Wandobjekt | Wall Object | Möbel an der Wand nördlich seiner Kachel (Bild, Regal, Wandlampe …) |
| Steg | Jetty | Boden auf Pfählen im Wasser; macht tiefes Wasser begehbar und trägt Wände |
| Möbelkategorie | Furniture Category | Zweck eines Möbels für Raumtyp und Behaglichkeit (Bett, Sitz, Tisch, Licht, Deko …) |
| Dämmung | Insulation | Anteil, den ein Raum von der Außentemperatur Richtung 18 °C hält (je Material) |
| Einsturz | Collapse | Ungestützte Dachtiles fallen (Staub, 50 % Material zurück) |
| Abbauen | Dismantle | Bauteil entfernen: in den ersten 30 s ganz zurück, danach 60 % der Zutaten |
| Flächenreparatur | Area Repair | Hammer repariert alle beschädigten Teile eines Rechtecks gegen anteiliges Material |
| Holzkiste / Truhe / Lagerregal | Wooden Crate / Chest / Storage Shelf | Kisten mit 16 / 24 / 48 Plätzen (Regal nur Rohstoffe und Barren) |
| Etikett | Label | Item-Icon, mit dem eine Kiste beschriftet wird |
| Schnellablage | Quick Stash | Taschen-Items (außer Schnellleiste) in Kisten im Umkreis 10 legen, die dasselbe Item schon enthalten |
| Schutzzone | Safe Zone | Radius eines brennenden Herdfeuers: keine Schattenbrut spawnt darin |
| Brand | Fire | Feuer auf einer Kachel: schadet Bauten, breitet sich mit dem Wind aus, Regen löscht |
| Brennbarkeit | Flammability | Wie gut ein Material brennt (Holz 1, Fachwerk 0,3, Stein 0) |

## Siedler & Automatisierung (§22, §24)
| DE | EN | Bedeutung |
|---|---|---|
| Siedler | Settler | Geretteter Überlebender, arbeitet in der Basis (bis 12) |
| Beruf | Job | Tätigkeit eines Siedlers (Holzfäller, Bauer, Wache …) |
| Stimmung | Mood | Glücklich · Zufrieden · Unzufrieden · Verzweifelt |
| Begleiter | Companion | Streunerhund, der dem Glutträger folgt |
| Lumen-Netz | Lumen Grid | Stromnetz aus Erzeugern, Verbrauchern und Leitungspfählen |
| Kraft | Power | Leistungseinheit K des Lumen-Netzes (EN-Kürzel P) |
| Leitungspfahl | Power Pole | Verbindet sich automatisch im Umkreis von 8 Tiles |
| Förderband | Conveyor Belt | Transportiert 2 Items/s |
| Greifarm | Grabber Arm | Bewegt Items zwischen Kisten, Bändern und Stationen |
| Sortierer | Sorter | Verteilt Items nach Filter |

## Technik & Werkzeuge (§3, §31; docs/ARCHITEKTUR.md)
| DE | EN | Bedeutung |
|---|---|---|
| Tile | Tile | Rasterfeld 16×16 px (in älteren Texten „Kachel“) |
| Chunk | Chunk | 32×32 Tiles; Einheit für Generierung, Speichern und Aktive Zone |
| Tick | Tick | Ein fester Simulationsschritt (60 Hz) |
| Welt-Tick | World Tick | Langsamer Takt 1 Hz (Temperaturfelder, Feuer, Verderb) |
| Tages-Tick | Daily Tick | Takt um 06:00 (Wachstum, Tiere, Siedlerplanung) |
| Aktive Zone | Active Zone | Chunks um den Spieler, die voll simuliert werden |
| Einfrieren | Freeze | Chunk außerhalb der Aktiven Zone mit Zeitstempel `frozenAtTick` |
| Aufholen | Catch-up | Analytisches Nachrechnen eines eingefrorenen Chunks beim Aktivieren |
| Weltplan | World Plan | Grobe Beschreibung der ganzen Insel (Regionen, Biome, Höhe, Wasser), aus Seed und Größe erzeugt (docs/WORLD.md §2) |
| Chunk-Generator | Chunk Generator | Reine Funktion (Welt, Ebene, cx, cy) → Chunkdaten, in beliebiger Reihenfolge nahtlos |
| Ladekreis | Load Ring | Chunks um die Kamera, die resident bleiben (Radius je Ebene, `BALANCE.stream`) |
| Chunk-Diff | Chunk Diff | Gespeicherte Abweichung eines Chunks von seinem generierten Zustand; unveränderte Chunks werden nie gespeichert |
| Höhleneingang | Cave Mouth | Weg von der Oberfläche in die Wurzelhöhlen (−1), dieselbe Kachel in beiden Ebenen |
| Schacht | Shaft | Weg von einer Untergrundebene in die nächsttiefere, dieselbe Kachel in beiden Ebenen |
| Aktion | Action | Umbelegbare Eingabeabsicht (z. B. `interact`), aus Tasten, Maus, Gamepad, Touch |
| Belegung | Binding | Zuordnung Taste/Knopf → Aktion |
| Befehl | Command | Einzige Schreibschnittstelle Präsentation → Simulation (§3.2) |
| Ereignis | Event | Meldung Simulation → Präsentation, pro Tick gepuffert |
| System | System | Simulationsteil mit `update`/`worldTick`/`dailyTick` |
| Entität | Entity | ECS-Objekt (Index + Generation) |
| Komponente | Component | Datenbaustein einer Entität |
| Stream | Stream | Benannter, geseedeter Zufallsstrom je System |
| Zustands-Hash | State Hash | Stabiler Hash des Gesamtzustands (Determinismus, Replays) |
| Replay | Replay | Aufgezeichnete Command-Folge, reproduziert einen Spielverlauf |
| Speicherteilnehmer | Save Participant | System mit Zustand, das Serialisierung und Roundtrip-Test liefert |
| Save-Version | Save Version | Gesamtstand aller Teilnehmer und Datenversionen eines Builds; 1 = M3 (ADR-0030) |
| Referenzspielstand | Fixture Save | Gespeicherte Welt je Save-Version in `tests/fixtures/saves/`, die jeder spätere Build verlustfrei laden muss |
| Welt-Dump | World Dump | Alle Datensätze einer Welt als ein Wert (Export, Referenzspielstände) |
| Balancewert | Balance Value | Zahl in `src/content/balance.ts` mit Einheit und Begründung |
| Verbotsliste | Forbidden List | Prüfung auf Platzhalter-Marker und Nichtdeterminismus (`tools/forbidden.ts`) |
| Entwicklermodus | Developer Mode | Einstellung, die Debug-Werkzeuge ohne `?debug=1` freischaltet |
| Entwicklerkonsole | Developer Console | Debug-Konsole (^) mit Befehlsregister und `help` |
| Cheat | Cheat | Schalter der Entwicklerkonsole, die Spielregeln aufheben: Gott-Modus (kein Schaden), Noclip (Bewegung ohne Kollision), Freischalten (§31.6; `src/game/cheats/`) |
| Leistungsanzeige | Performance Overlay | F3-Overlay mit FPS, Frame-, Sim- und Renderzeit |
| Debug-API | Debug API | `window.__dh` für E2E-Tests und Screenshots |
| Palettenzeile | Palette Row | Umfärbung aller 64 Palettenindizes (Jahreszeit, Biom, Verderbnis, Materialstufe) über die Paletten-LUT |
| Weltnahe UI | World UI | Namen, Leisten, Schadenszahlen und Interaktionsmarker an Dingen der Welt, im WebGL-Pass gezeichnet |
| Interaktionsmarker | Interaction Marker | Tastenkappe mit Aktion über einem Interaktionsziel („E Fackel nehmen“); verdeckte er die Spielfigur, steht er über ihrem Kopf |
| Handlungsunfähig | Incapacitated | Tot oder schlafend: der Spieler erntet, benutzt, stellt her und hantiert mit keinem Licht, der Magnet zieht nicht (ADR-0035) |
| Grabmarker | Grave Marker | Das Grab des Spielers auf Minimap und Kompass, bis es geleert ist (§11.6) |
| Schadenszahl | Damage Number | Aufsteigende Zahl über einem Treffer (Heilung grün, kritisch in Akzentfarbe) |
| Szenario | Scenario | Deterministischer Screenshot-/Bench-Zustand (`?scenario=`, `npm run shot`) |
| Frame-Pfad | Frame Path | Alles, was der Renderer je Frame auf der CPU tut (Szene füllen, Sortieren, Instanzdaten, Lichter, Pässe, Welt-UI); muss ohne Allokation laufen (`render:frame-pfad`) |
| Spielansicht | Game View | Render-Szene `spiel`: die Welt der Sitzung unter der Kamera der gesteuerten Figur; hinter dem Titel der Startstrand (ADR-0026) |
| Welt der Sitzung | Session World | Die Welt, auf der die laufende Simulation spielt; beim Start im Welt-Worker erzeugt |
| Titelbild | Title Picture | Das Bild hinter der Titelkarte: Spielansicht am Startstrand, zum Meer versetzt |
| Debug-Overlay | Debug Overlay | Einblendung der Spielansicht in der Render-Debug-Ebene: Chunks, Kollision, Temperaturfeld (Konsole `overlay`) |
| Zeitsprung | Time Jump | Debug-Befehl `time`/`season`: die Uhr springt vorwärts, eingefrorene Chunks holen analytisch auf |
| Systemreihenfolge | System Order | Verbindliche Registrierreihenfolge aller Systeme (`SYSTEM_ORDER`, `src/game/systemOrder.ts`): Schaden vor den Lebenssystemen, Beobachter zuletzt (docs/SPIEL.md §16) |
| Beobachter | Observer | System mit `observeStep`: sieht nach jedem Schritt dessen Ereignisse (ab einer Marke, keines doppelt) und zählt, erzählt oder erklärt sie – Statistiken, Erfolge, Chronik, Aufgaben, Funke (docs/SPIEL.md §17, ADR-0175) |
| Auslöser | Trigger | Bedingung der einen Auslöser-Sprache (`src/content/schema/trigger.ts`): Ereignis mit Filter und Anzahl, Statistik, Besitz, Zustand, Uhr, Lichtstufe, Raum, Freischaltung, Aufgabe, Ort, kombiniert mit alle/eines/nicht |
| Klimaprotokoll | Climate Log | Je Region und Spieltag (06:00 → 06:00) aus den Wetterperioden zusammengefasst: Regen, Regenminuten, tiefster Temperaturversatz – liest Wachstum, Frost, Reusen und Regensammler, auch nach Zeitsprüngen (docs/SPIEL.md §20) |
| Besitz-Kreatur | Owned Creature | Kreatur mit Besitzer (`ort:<slot>`, `gewoelbe:<slot>`, `boss:<id>`) statt aus der Spawntabelle: Wächter, Mini-Boss, Boss-Diener; lebt im Chunk-Bestand, meldet ihren Tod (`CreatureSystem.spawnOwned`) |
| Spawnsperre | Spawn Block | Veto gegen Tabellen-Spawns auf einer Kachel (friedliche Welt, Leuchtfeuerzone, Gewölbe, Arena; `CreatureSystem.addSpawnBlocker`); Besitz-Kreaturen ignorieren sie |
| Item-Block | Item Block | Optionales Feld eines Items für das, was es in einem System tut (`waffe`, `saat`, `mahlzeit`, `splitter` …), je Block ein Eigentümer-Strang (`src/content/schema/itemBlocks.ts`) |
| Gerätepixel | Device Pixel | Physisches Bildschirmpixel; ein CSS-Pixel umfasst `devicePixelRatio` davon, UI-Grafik rastert auf ganze Gerätepixel |

## Render & Shader (§6; docs/RENDER.md, ADR-0051 … ADR-0065)
| DE | EN | Bedeutung |
|---|---|---|
| Render-Pass | Render Pass | Ein Schritt der Render-Pipeline mit festem Platz in `PASS_ORDER` (§6.1); einzeln abschaltbar (`__dh.call('renderPass', name, an)`) |
| G-Buffer | G-Buffer | Die Bildziele des Frames vor dem Licht: G0 Albedo, G1 Normale + Höhe + Materialflags, G2 Emission + Glanz/Nässe + Masken (§6.1 Pass 2) |
| Occluder | Occluder | Was Licht aufhält: die Standfläche eines Objekts in der Occluder-Maske, mit Klasse (Deko, strukturell, Gelände; Dach und Öffnung nur als Markierung) |
| Occluder-Maske | Occluder Mask | RGBA8-Bild der Standflächen je Frame: Deko-Oberkante, strukturell, Geländeoberkante, Bodenhöhe (§6.1 Pass 3) |
| Distanzfeld (SDF) | Distance Field (SDF) | Abstand jedes Pixels zum nächsten Occluder, per Jump-Flood aus der Occluder-Maske; Grundlage der Punktlichtschatten und der SDF-AO |
| Jump-Flood | Jump Flood | Verfahren, das das Distanzfeld in wenigen Vollbild-Durchgängen (Sprünge 32 … 1 px) von Saatpunkten aus ausbreitet |
| Wasser-Distanzfeld | Water Distance Field | Abstand eines Wasserpixels zum Ufer; Uferschaum, Tiefenfärbung, Schelfeis |
| Strukturell | Structural | Occluder-Klasse der Wände, geschlossenen Türen und Tore und des massiven Felsens: sperrt Licht auf jeder Qualitätsstufe wie die Lichtkarte |
| Öffnung | Opening | Fenster, offene Tür oder offenes Tor in der Occluder-Maske: lässt Licht durch, im Lichtkarten-Abgleich nicht vergleichbar |
| Gehäuse | Housing | Deko-Standfläche, in der ein Licht brennt (Ofen, Meiler, Kamin, Lampe, Herdfeuer-Ring): seine Strahlen gehen hindurch, den eigenen Körper erhellt es nur schwach |
| Dachabdeckung | Roof Cover | Ein Licht unter einem Dach des Bauraster erreicht Dächer und Kronen nicht von außen |
| Nahfeld der Flamme | Flame Near Field | Was direkt unter einer Flamme steht (Fackelstab, Lampenpfosten), wird nur von oben beleuchtet |
| Silhouettenschatten | Silhouette Shadow | Sonnen- oder Mondschatten eines Sprites: seine Silhouette nach dem Sonnenstand geschert und gestreckt (§6.1 Pass 4) |
| Wolkenschatten | Cloud Shadow | Weiche Schattenflecken der Wolken, die mit dem Wind der Wetterperiode ziehen |
| Blätterdach-Sprenkel | Canopy Dapple | Lichtflecken im Schatten der Baumkronen, die im Wind wiegen |
| Himmelslicht | Sky Light | Ungerichteter Anteil des Tageslichts (× SDF-AO, unter Dächern gedämpft); der Rest ist gerichtetes Licht von Sonne oder Mond mit Normal-Mapping und Schatten |
| SDF-AO | SDF AO | Abdunklung des Himmelslichts am Fuß von Occludern, aus dem Distanzfeld |
| Lichtbänder | Light Bands | Optionale Stufung des Lichts in 6–10 Helligkeitsbänder mit 4×4-Bayer-Dither (Einstellung „Licht-Bänderung“, §6.1 Pass 6) |
| Bayer-Dither | Bayer Dither | Geordnetes Rastermuster, das Stufen und Übergänge pixelig statt weich verbindet |
| Lichtkarten-Abgleich | Light Map Comparison | Debug-Vergleich von Gameplay-Lichtkarte und gerendertem Licht (Render-Debugger `lightmap`, M5-28) |
| GPU-Partikel | GPU Particles | Partikel, die per Transform Feedback auf der GPU simuliert werden (≥ 20 000 gleichzeitig, §6.2) |
| Partikelart | Particle Kind | Aussehen und Verhalten einer Partikelsorte (Sammlung `particleKinds`) |
| Partikelquelle | Particle Emitter | Wo, wie oft und wie Partikel einer Art entstehen (Sammlung `particleEmitters`) |
| Wetterpartikel | Weather Particles | Regen, Schnee, Asche und Sand in einer Box um die Kamera, aus dem Wetter der Simulation |
| Vorlauf | Prewarm | Simulierte Sekunden vor dem ersten Bild nach einem Partikel-Neustart, damit Screenshots den eingeschwungenen Zustand zeigen |
| Vollbildblitz | Lightning Flash | Kaltes Aufleuchten des ganzen Bildes bei einem Blitzeinschlag (Blitzreduktion: ein weicher Puls) |
| Hitzeflimmern | Heat Shimmer | Zeilenweises Verschieben des Bildes über heißer Luft (Feuer, heiße Biome) |
| Verzerrungsfeld | Distortion Field | Versatzbild für Schockwellen, Hitze und Unterwasser, das der Post-Pass liest |
| Schockwelle | Shock Wave | Ringförmige Verzerrung, die sich von einem Punkt ausbreitet |
| Nebelschicht | Fog Layer | Driftende Rauschschicht des Nebels; mit der Höhe über dem Nebelboden dünner |
| Nebelboden | Fog Floor | Bodenhöhe an der Kamera, über der der Nebel dünner wird |
| Streulicht | Scattered Light | Licht der Punktlichter, das der Nebel zurückwirft; endet, wo deren Schatten das Licht enden lassen |
| Bloom | Bloom | Weiches Überstrahlen heller Pixel (Einstellung „Leuchten (Bloom)“) |
| Grading-LUT | Grading LUT | 16³-Farbtabelle aus Grading-Parametern (Biom × Tageszeit × Wetter), trägt auch den Farbenblind-Filter |
| Farbenblind-Filter | Colour-Blind Filter | Einstellung, die die Farben des Weltbilds für Protanopie, Deuteranopie oder Tritanopie korrigiert |
| Zustandseffekt | State Effect | Bildweiter Effekt eines Spielerzustands (Furcht, niedriges Leben, Kälte, Hitze, Erschöpfung, Gift, Rausch) |
| CRT-Filter | CRT Filter | Optionaler Röhrenlook der Präsentation: Krümmung, Scanlines, Streifenmaske (Standard aus) |
| Verderbnis-Adern | Corruption Veins | Glühende, pulsierende Risslinien im flachen Boden verdorbener Gebiete |
| Uferschaum | Shore Foam | Atmende weiße Linie an der Uferlinie des Wassers |
| Kaustik | Caustics | Wandernde Lichtlinien auf dem Grund flachen, besonnten Wassers |
| Eintauchmaske | Immersion Mask | Schneidet eine Figur an der Wasserlinie ab und zeigt ihren Körper darunter als hellen Schatten |
| Interaktive Wellen | Interactive Waves | Wellengleichung um die Kamera, angestoßen durch Impulse von Figuren, Regentropfen, Pfeilen und Fischen |
| Schelfeis | Shelf Ice | Bei Frost vom Ufer wachsendes Eis der Darstellung (Betreten erst M8-36) |
| Interaktionstextur | Interaction Texture | Weltfeste Textur um die Kamera mit dem Druck der Figuren auf das Gras und den Fußspuren |
| Kreis-Dither | Circle Dither | Durchblick-Kreis um den Spieler, in dem Kronen und Dächer mit Bayer-Rand ausblenden |
| Schneedecke | Snow Cover | Weltfeste Schneemaske der Darstellung: wächst mit Schneefall auf nach oben zeigenden Flächen, schmilzt bei Wärme |
| Bodennässe | Ground Wetness | Globaler Nässewert der Darstellung (dunklerer, glänzender Boden, Pfützen) – nicht die Nässe des Spielers |
| Pfütze | Puddle | Senke, die bei Regen vollläuft und Himmel und Lichter spiegelt |
| Laubwechsel | Foliage Change | Wechsel der Laub-Palettenzeile einer Jahreszeit über zwei Tage, Pixel für Pixel |
| Weißblitz | White Flash | Kurzes weißes Aufleuchten eines Sprites |
| Outline-Glanz | Outline Glint | Weltfester Glanz der helleren Akzentstufe, der über die Interaktions-Outline läuft |
| Dither-Fade | Dither Fade | Ein- und Ausblenden eines Sprites im Bayer-Raster statt mit Transparenz |
