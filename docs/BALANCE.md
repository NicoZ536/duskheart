# BALANCE – Kampfwerte, Formeln, Stufenkurve

Rahmen: MASTERPROMPT §D (Startwerte, Feinjustierung in M14). Dieses Dokument hält fest, **wie** gerechnet wird, **was** das
Spiel heute misst und **wie** die Stufenkurve bisher verläuft. Die Zahlen stammen nicht aus Formeln von Hand, sondern aus dem
Spiel selbst: `tests/integration/kampf-balance.test.ts` (M6-37) spielt jeden Treffer durch `CombatSystem.resolve` und das
`applyHit` der Kreatur bzw. des Spielers (Resistenzen, Rüstung, Set-Boni, Varianten, Zustände über ihre Sekunden in der
Welt, Griff-Bisse wie `holdStep`) – in der echten Welt (`createSimulation` mit dem Content, `tests/integration/kampf-welt.ts`).
Spätere Abschnitte (Pacing §23.1, Ökonomie, Progressionstests M7-64, M8-56, M10-35, M14-01, M14-04) kommen hier hinzu.

## 1 Formeln

Alle Werte stehen in `src/content/balance/*.ts` (mit Einheit und Begründung), die Formeln in `src/game/combat/formulas.ts`
und `src/game/creatures/formulas.ts`.

**Schlag des Spielers auf eine Kreatur**

```
Schaden = Basis(Stufe) × Klassenfaktor × Kombo-Faktor × Qualität
          × (1 − Resistenz) × (1 − R / (R + 50)) × (Krit ? 1,75 : 1)
```

- `Basis(Stufe)` = `BALANCE.tools.weaponDamageByTier`: T0 8 · T1 12 · T2 17 · T3 24 · T4 33 · T5 45 · T6 60 · T7 78 (§D).
- `Klassenfaktor` = `BALANCE.tools.weaponClassFactor`: Dolch 0,6 · Schwert 1,0 · Speer 0,95 · Keule 1,1 · Axt 1,15 ·
  Bogen 1,1 (voll gespannt) · Armbrust 1,6 · Zweihand 1,8 (§D); Faust 0,35, Schleuder 0,9, Wurfwaffen 1,0 (eigene Werte,
  begründet in `src/content/balance/tools.ts`). Der Item-Wert `waffe.schaden` ist das Produkt (Feuersteinklinge 8,
  Steinkampfaxt 9,2, Holzkeule 8,8, Steinspeer 7,6, Knochendolch 4,8; Bronzeschwert 12, Bronzekampfaxt 13,8,
  Bronzestreitkolben 13,2, Bronzespeer 11,4, Bronzedolch 7,2).
- `Resistenz` je Schadensart −1 … 1 (0,5 halbiert, −0,5 ist eine Schwäche ×1,5); Schattenbrut: Schatten 0,8, Licht −0,5,
  Feuer −0,25, Gift 0,5.
- `R` = Rüstung des Ziels, Konstante 50 (§19.3 `R/(R+50)`, `BALANCE.combat.damage.armorConstant`).
- Krit: 5 % Chance, ×1,75 (`critChance`, `critFactor`); der erste Treffer nach einer Parade ist sicher kritisch.
- Block: Schaden × (1 − Blockkraft) (Holzschild 0,4, Bronzeschild 0,6, Turmschild 0,9); Parade (Block ≤ 9 Ticks vor dem
  Treffer): kein Schaden, der Angreifer taumelt 1,2 s.

**Schlag einer Kreatur auf den Spieler**

```
Schaden = schaden(Angriff) × Schwierigkeit × Variante × (Finstermond ? 1,2 : 1)
          × (1 − Resistenz) × (1 − R / (R + 50)) × (Krit ? 1,75 : 1)
Anteil  = (Schaden + Zustandsschaden über seine Sekunden + Griff-Bisse) / Grundleben 100
```

- Schwierigkeit (`BALANCE.creatures.difficulty.damageFactor`): Entspannt 0,6 · Normal 1 · Hart 1,3 · Unbarmherzig 1,5 (§29).
- Zustände eines Angriffs (Gift, Blutung …) zählen mit, als landeten sie sicher; ein Griff (Kriecher) beißt
  `schadenProSekunde × sekunden / bisse` je Biss, unblockbar.
- Varianten der Schattenbrut (`src/content/creatures/schattenbrut.ts` `varianten`): sie tragen die Zahlen der Grundform auf
  die Stufe ihres Bioms –
  `Leben × Basis(Stufe Variante) / Basis(Stufe Grundform)` (gleich viele Treffer mit der Waffe ihrer Stufe) und
  `Schaden × effLeben(Stufe Variante) / effLeben(Stufe Grundform)` mit `effLeben(s) = (Set-Rüstung(s) + 50) / 50`
  (gleicher Anteil am effektiven Leben gegen die Rüstung ihrer Stufe). T1 (Moor, Tiefe): Leben ×1,5, Schaden ×1,107,
  Tempo ×1,05.
- Finstermond (`BALANCE.spawn.shadowBrood.finstermond`): Leben ×1,5, Schaden ×1,2, Tempo ×1,1 (M6-27).

**Rüstung je Set** (§D „T0 6 · T1 12 · T2 20 …“): Fasergewand 1+2+2+1 = 6 · Lederrüstung 2+4+3+1 = 10, mit 4-Teile-Bonus
+2 = 12 · Bronzerüstung 3+4+3+2 = 12, mit Boni +2 +2 = 16 (ein Drittel weniger Schaden als Leder; ihr Preis ist das Gewicht).

**Bänder (§D)**: normale Gegner einer Stufe fallen nach 4–6 Treffern mit stufengerechter Einhandwaffe (Dolch als „schnelle“
Klasse ×0,6: höchstens 10); Elites ×4 (16–24); normaler Treffer 8–12 % des Lebens gegen stufengerechte Rüstung, schwere
telegraphierte Attacke 20–30 %, kein One-Shot auf Normal (jeder Angriff, kritisch, ohne Rüstung, lässt den Spieler aus vollem
Leben stehen). Friedliche (Familie `friedlich`) treffen höchstens 12 % und fallen nach höchstens 6 Treffern.

## 2 Messung M6 (Normal, frischer Kämpfer: alle Fertigkeiten Stufe 1)

Als „schwer“ zählen die telegraphierten Großangriffe: Keiler-Ansturm, Wolfssprung, Dornling-Überfall, Scherenschlag,
Schleicher-Sprung, Kriecher-Packen, Nachtmahr-Stampfen und -Ansturm. Treffer = leichte Erstschläge ohne Krit; Spannweite über
die Einhänder der Stufe (Schwert, Axt, Keule, Speer).

### Stufe 0 – Fasergewand (Rüstung 6), Feuersteinklinge, Steinkampfaxt, Holzkeule, Knochenkeule, Steinspeer; Knochendolch

| Kreatur | Familie | Stufe | Leben | Treffer Einhänder | Treffer Dolch | Anteil am Leben je Angriff |
|---|---|---|---|---|---|---|
| hase | friedlich | 0 | 10 | 2 | 3 | – |
| reh | friedlich | 0 | 30 | 4 | 7 | Tritt 7,1 % |
| wachtel | friedlich | 0 | 6 | 1 | 2 | – |
| eichhoernchen | friedlich | 0 | 8 | 1–2 | 2 | – |
| gluehwuermchen | friedlich | 0 | 2 | 1 | 1 | – |
| frosch | friedlich | 0 | 5 | 1 | 2 | – |
| krabbe | friedlich | 0 | 10 | 1–2 | 3 | Kneifen 5,4 % |
| moewe | friedlich | 0 | 12 | 2 | 3 | Picken 4,5 % |
| robbe | friedlich | 0 | 36 | 4–6 | 8 | Biss 8,9 % |
| keiler | gegner | 0 | 40 | 5–6 | 8 | Hauer 10,7 % · Ansturm (schwer) 25,0 % |
| dachs | gegner | 0 | 34 | 5 | 8 | Biss 9,8 % · Kratzer 8,9 % |
| wolf | gegner | 0 | 32 | 4–5 | 7 | Biss 9,8 % · Sprung (schwer) 21,4 % |
| dornling | gegner | 0 | 36 | 5–6 | 9 | Peitsche 9,8 % · Überfall (schwer) 23,2 % |
| wespenschwarm | gegner | 0 | 24 | 4–6 | 9 | Stechen 11,1 % (mit Gift) |
| scherenkrebs | gegner | 0 | 30 | 4–6 | 8 | Kneifen 9,8 % · Scherenschlag (schwer) 25,0 % |
| qualle | gegner | 0 | 36 | 4–6 | 8 | Nesseln 10,2 % (mit Gift) |
| strandraeuber | gegner | 0 | 36 | 5 | 8 | Hieb 10,7 % |
| schleicher | schattenbrut | 0 | 32 | 4–5 | 7 | Klaue 9,8 % · Sprung (schwer) 23,2 % |
| kriecher | schattenbrut | 0 | 44 | 5–6 | 10 | Packen mit Bissen (schwer) 21,0 % |
| speier | schattenbrut | 0 | 30 | 4 | 7 | Spucken 11,1 % (mit Gift) |
| lichtfresser | schattenbrut | 0 | 40 | 5–6 | 9 | Saugen 8,0 % · Schlag 8,9 % |
| nachtmahr | schattenbrut | 1 | 180 | 24–29 | 45 | Stampfen (schwer) 26,8 % · Ansturm (schwer) 25,0 % |

### Stufe 1 – Lederrüstung (Rüstung 12), Bronzeschwert, Bronzekampfaxt, Bronzestreitkolben, Bronzespeer; Bronzedolch

| Kreatur | Familie | Stufe | Leben | Treffer Einhänder | Treffer Dolch | Anteil am Leben je Angriff |
|---|---|---|---|---|---|---|
| hase | friedlich | 0 | 10 | 1 | 2 | – |
| reh | friedlich | 0 | 30 | 3 | 5 | Tritt 6,5 % |
| wachtel | friedlich | 0 | 6 | 1 | 1 | – |
| eichhoernchen | friedlich | 0 | 8 | 1 | 2 | – |
| gluehwuermchen | friedlich | 0 | 2 | 1 | 1 | – |
| frosch | friedlich | 0 | 5 | 1 | 1 | – |
| krabbe | friedlich | 0 | 10 | 1–2 | 2 | Kneifen 4,8 % |
| moewe | friedlich | 0 | 12 | 1–2 | 2 | Picken 4,0 % |
| robbe | friedlich | 0 | 36 | 3–4 | 6 | Biss 8,1 % |
| keiler | gegner | 0 | 40 | 4 | 5 | Hauer 9,7 % · Ansturm (schwer) 22,6 % |
| dachs | gegner | 0 | 34 | 3–4 | 5 | Biss 8,9 % · Kratzer 8,1 % |
| wolf | gegner | 0 | 32 | 3 | 5 | Biss 8,9 % · Sprung (schwer) 19,4 % |
| dornling | gegner | 0 | 36 | 3–4 | 6 | Peitsche 8,9 % · Überfall (schwer) 21,0 % |
| wespenschwarm | gegner | 0 | 24 | 3–4 | 6 | Stechen 10,4 % |
| scherenkrebs | gegner | 0 | 30 | 3–4 | 5 | Kneifen 8,9 % · Scherenschlag (schwer) 22,6 % |
| qualle | gegner | 0 | 36 | 3–4 | 6 | Nesseln 9,6 % |
| strandraeuber | gegner | 0 | 36 | 3–4 | 6 | Hieb 9,7 % |
| schleicher | schattenbrut | 0 | 32 | 3 | 5 | Klaue 8,9 % · Sprung (schwer) 21,0 % |
| schleicher / moor, tiefe | schattenbrut | T1-Variante | 48 | 4–5 | 7 | Klaue 9,8 % · Sprung (schwer) 23,2 % |
| kriecher | schattenbrut | 0 | 44 | 4 | 7 | Packen (schwer) 19,0 % |
| kriecher / moor, tiefe | schattenbrut | T1-Variante | 66 | 5–6 | 10 | Packen (schwer) 21,0 % |
| speier | schattenbrut | 0 | 30 | 3 | 5 | Spucken 10,4 % |
| speier / moor, tiefe | schattenbrut | T1-Variante | 45 | 4 | 7 | Spucken 11,1 % |
| lichtfresser | schattenbrut | 0 | 40 | 3–4 | 6 | Saugen 7,3 % · Schlag 8,1 % |
| lichtfresser / moor, tiefe | schattenbrut | T1-Variante | 60 | 5–6 | 9 | Saugen 8,0 % · Schlag 8,9 % |
| nachtmahr | schattenbrut | 1 | 180 | 16–19 | 30 | Stampfen (schwer) 24,2 % · Ansturm (schwer) 22,6 % |

Kein One-Shot: jeder Angriff jeder Kreatur (auch der T1-Varianten), kritisch und ohne Rüstung, lässt den Spieler aus vollem
Leben stehen (`kampf-balance.test.ts`). Messfehler ausgeschlossen: ein echter Schwertschlag in der Welt und ein echter
Wolfsbiss treffen auf die neunte Nachkommastelle genau so hart wie die Messung.

## 3 Stufenkurve bisher (T0 → T1)

| Größe | T0 | T1 | Faktor |
|---|---|---|---|
| Waffenbasis (§D) | 8 | 12 | ×1,5 |
| Set-Rüstung (§D) | 6 (−10,7 % Schaden) | 12 (−19,4 % Schaden) | effektives Leben ×1,107 |
| Normaler Gegner der eigenen Stufe | 4–6 Treffer, 8,9–11,1 % | 4–6 Treffer, 9,8–11,1 % (T1-Varianten) | gleich (gewollt) |
| Gegner der Vorstufe mit Ausrüstung der neuen Stufe | – | 3–4 Treffer, 8,1–10,4 % | ⅔ der Treffer, ~10 % weniger Schaden |
| Elite (Nachtmahr, Stufe 1) | 24–29 Treffer (T0-Waffen) | 16–19 Treffer | Elite ×4 erst mit Stufe 1 |

Lesart: Jede Stufe hebt Waffenschaden und Rüstung so, dass Gegner der eigenen Stufe in denselben Bändern bleiben; der Fortschritt
spürt sich gegen die Vorstufe (zwei Drittel der Treffer) und in der Zeit, die man im Dunkeln überlebt. Die Schattenbrut-
Varianten folgen der Kurve per Formel (Abschnitt 1) bis T6; ab M8 kommen die Gegner der Stufen 2+ mit eigenen Daten dazu und
werden hier in derselben Messung geführt.

## 4 Befund und offene Punkte (M6)

- Keine Ausreißer: alle 22 Kreaturen liegen in den Bändern von §D; an den Kreaturdaten war nichts zu ändern.
- Der Nachtmahr (Stufe 1, bei Furcht 100) braucht mit T0-Waffen 24–29 Treffer – gewollt: in Stufe 0 ist die Antwort
  gleißendes Licht, nicht der Kampf (§20, M6-29).
- Krit-Spitze: der härteste Angriff, kritisch und ohne Rüstung, ist das Stampfen des Nachtmahrs mit 52,5 % – kein One-Shot
  auf Normal; auf „Unbarmherzig“ (×1,5) wären es 78,8 %, also auch dort keiner. Das Maß bleibt für M14 stehen.
- Pacing, Ökonomie und Bossdauern folgen mit M7-64, M8-56, M14-01, M14-04.
