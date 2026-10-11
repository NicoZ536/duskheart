/**
 * Knowledge entries for the mechanics up to M6 (Wissen tab of the chronicle; MASTERPROMPT §2.2 "Jede Mechanik wird im Spiel
 * vermittelt (Hinweis, Chronik, Tooltip)"; docs/SPIEL.md §23; M7-45 – strand G). Each unlocks at the first contact with its
 * mechanic and explains it with its numbers, so a player can look up what Funke or the hint line said in passing.
 */
import type { KnowledgeInput } from '../chronik/schema';

export const KNOWLEDGE_G_M3_M6: readonly KnowledgeInput[] = [
  {
    id: 'wissen_hunger_durst',
    titel: { de: 'Hunger und Durst', en: 'Hunger and Thirst' },
    text: {
      de: 'Sättigung und Durst sinken mit der Zeit, beim Laufen und Arbeiten schneller. Hungrig und durstig regenerierst du kein Leben mehr, leer kosten sie Leben. Gekochtes sättigt mehr als Rohes; trink aus Flüssen und Seen – das Meer stillt keinen Durst.',
      en: 'Satiety and thirst drop over time, faster while you run and work. Hungry and thirsty you regain no health, empty they cost health. Cooked food fills more than raw; drink from rivers and lakes – the sea quenches no thirst.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'eines', von: [{ art: 'zustand', zustand: 'hungrig' }, { art: 'zustand', zustand: 'durstig' }, { art: 'ereignis', ereignis: 'itemEaten' }, { art: 'ereignis', ereignis: 'waterDrunk' }] },
  },
  {
    id: 'wissen_temperatur',
    titel: { de: 'Wärme und Kälte', en: 'Warmth and Cold' },
    text: {
      de: 'Deine Kerntemperatur folgt der gefühlten: Wetter, Wind, Nässe, Kleidung, Feuer und Räume. Unter 36 °C frierst du, darunter wird es gefährlich; über 38 °C bist du erhitzt. Ein Feuer wärmt im Umkreis, ein Dach hält Regen ab, trockene Kleidung isoliert.',
      en: 'Your core temperature follows the felt one: weather, wind, wetness, clothing, fire and rooms. Below 36 °C you shiver, below that it gets dangerous; above 38 °C you overheat. A fire warms its surroundings, a roof keeps the rain off, dry clothes insulate.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'eines', von: [{ art: 'zustand', zustand: 'frierend' }, { art: 'zustand', zustand: 'erhitzt' }, { art: 'zustand', zustand: 'durchnaesst' }] },
  },
  {
    id: 'wissen_schlaf',
    titel: { de: 'Schlaf', en: 'Sleep' },
    text: {
      de: 'Ab 19 Uhr oder erschöpft kannst du schlafen – nicht mit Feinden in der Nähe. Im Schlaf vergeht die Zeit dreißigmal schneller. Ein Bett erholt ganz und setzt deinen Wiedereinstieg, ein Grasbett halb.',
      en: 'From 19:00, or when exhausted, you can sleep – not with foes nearby. Asleep, time passes thirty times faster. A bed restores you fully and sets your respawn point, a grass bed half as well.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'eines', von: [{ art: 'zustand', zustand: 'muede' }, { art: 'ereignis', ereignis: 'sleepStarted' }] },
  },
  {
    id: 'wissen_zustaende',
    titel: { de: 'Zustände', en: 'Conditions' },
    text: {
      de: 'Zustände stehen mit Symbol und Restzeit unter deinen Werten. Blutung stillt ein Verband, einen Bruch eine Schiene; Vergiftung und Fieber klingen mit Ruhe ab. Gute Zustände – ausgeruht, behaglich, wohlgenährt – helfen dir.',
      en: 'Conditions show with an icon and their time left under your values. A bandage stops bleeding, a splint sets a fracture; poison and fever wear off with rest. Good ones – rested, cozy, well fed – help you.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'conditionApplied' },
  },
  {
    id: 'wissen_bewegung',
    titel: { de: 'Laufen, Rollen, Schwimmen', en: 'Running, Rolling, Swimming' },
    text: {
      de: 'Sprinten und Rollen kosten Ausdauer, Schleichen ist leise. Eine Rolle trägt dich unverwundbar durch einen Angriff. Schwimmen zehrt an der Ausdauer – ist sie leer, ertrinkst du. Eine Stufe tief springst du gefahrlos, tiefer tut es weh.',
      en: 'Sprinting and rolling cost stamina, sneaking is quiet. A roll carries you unharmed through an attack. Swimming drains stamina – when it is gone, you drown. One level down you jump safely, deeper hurts.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'eines', von: [{ art: 'ereignis', ereignis: 'playerStateChanged', wo: { state: 'sprint' } }, { art: 'ereignis', ereignis: 'playerStateChanged', wo: { state: 'swim' } }, { art: 'ereignis', ereignis: 'playerRolled' }] },
  },
  {
    id: 'wissen_tod',
    titel: { de: 'Tod und Wiedereinstieg', en: 'Death and Respawn' },
    text: {
      de: 'Stirbst du, bleibt ein Grab mit allem, was du trugst; es steht auf der Karte, bis du es leerst. Du kehrst am Bett, am Herdfeuer oder am Strand zurück – erschüttert, mit weniger Leben für eine Weile. Fertigkeiten verlieren etwas Fortschritt, nie eine Stufe.',
      en: 'When you die a grave keeps everything you carried; it stays on the map until you empty it. You return at your bed, a hearth or the beach – shaken, with less health for a while. Skills lose some progress, never a level.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'playerDied' },
  },
  {
    id: 'wissen_licht',
    titel: { de: 'Licht', en: 'Light' },
    text: {
      de: 'Licht ist Leben: Fackeln, Feuer und Lampen schützen vor der Dunkelheit. Eine Fackel brennt einige Stunden und erlischt im Regen schneller; ein Lagerfeuer brennt mit nachgelegtem Holz. F nimmt die Fackel in die Nebenhand.',
      en: 'Light is life: torches, fires and lamps protect you from the dark. A torch burns for a few hours and dies faster in rain; a camp fire burns as long as you add wood. F takes the torch into your off hand.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'eines', von: [{ art: 'ereignis', ereignis: 'lightIgnited' }, { art: 'lichtstufe', hoechstens: 0.15 }] },
  },
  {
    id: 'wissen_furcht',
    titel: { de: 'Furcht', en: 'Fear' },
    text: {
      de: 'Im Dunkeln wächst die Furcht, Licht, Feuer und Behaglichkeit senken sie. Mit ihr kommen Flüstern, Trugbilder – und bei 100 der Nachtmahr, den nur Licht verbannt. Das Auge oben links zeigt, wie es um dich steht.',
      en: 'Fear grows in the dark; light, fire and comfort lower it. With it come whispers, phantoms – and at 100 the Nightmare, banished only by light. The eye at the top left shows how you are.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'fearStageChanged' },
  },
  {
    id: 'wissen_schattenbrut',
    titel: { de: 'Schattenbrut', en: 'Shadowspawn' },
    text: {
      de: 'Die Schattenbrut erwacht nachts außerhalb des Lichts. Grelles Licht verbrennt sie, das Morgenrot lässt sie vergehen; in der Zone eines brennenden Herdfeuers entsteht sie nicht. Der Lichtfresser löscht Fackeln und Laternen.',
      en: 'The shadowspawn wakes at night outside the light. Glaring light burns it, the dawn makes it fade; it never forms in the zone of a burning hearth. The Lighteater puts out torches and lanterns.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'eines', von: [{ art: 'ereignis', ereignis: 'bestiaryUnlocked', wo: { creature: 'schleicher' } }, { art: 'ereignis', ereignis: 'bestiaryUnlocked', wo: { creature: 'kriecher' } }, { art: 'ereignis', ereignis: 'bestiaryUnlocked', wo: { creature: 'speier' } }, { art: 'ereignis', ereignis: 'bestiaryUnlocked', wo: { creature: 'lichtfresser' } }] },
  },
  {
    id: 'wissen_inventar',
    titel: { de: 'Taschen und Ausrüstung', en: 'Bags and Equipment' },
    text: {
      de: 'Tab öffnet Inventar und Ausrüstung: 30 Plätze, die Schnellleiste mit 1–0, Gürtel und Nebenhand. Shift-Klick verschiebt, Rechtsklick teilt. Werkzeuge und Rüstung nutzen sich ab – an der Werkbank lassen sie sich flicken.',
      en: 'Tab opens inventory and equipment: 30 slots, the hotbar on 1–0, belt and off hand. Shift-click moves, right click splits. Tools and armour wear out – at the workbench they can be mended.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'itemsAdded' },
  },
  {
    id: 'wissen_sammeln',
    titel: { de: 'Sammeln', en: 'Gathering' },
    text: {
      de: 'Mit bloßen Händen sammelst du Fasern, Steinchen, Zweige und Beeren. Bäume fällst du mit der Axt, Gestein und Erz brichst du mit der Spitzhacke, die Schaufel gräbt Erde, Sand und Lehm. Pflanzen und Sträucher wachsen nach.',
      en: 'With bare hands you gather fibres, pebbles, twigs and berries. You fell trees with an axe, break rock and ore with a pickaxe, the shovel digs soil, sand and clay. Plants and bushes grow back.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'harvested' },
  },
  {
    id: 'wissen_handwerk',
    titel: { de: 'Handwerk und Stationen', en: 'Crafting and Stations' },
    text: {
      de: 'Ein Rezept erscheint, sobald du jede Zutat einmal besessen hast. Einfaches entsteht in der Hand (C), Besseres an Stationen. Verarbeitungsstationen wie der Schmelzofen arbeiten mit Brennstoff weiter, auch wenn du fort bist. Kisten in der Nähe zählen beim Herstellen mit.',
      en: 'A recipe appears once you have held each ingredient. Simple things are made by hand (C), better ones at stations. Processing stations like the smelting furnace keep working with fuel while you are away. Chests nearby count when you craft.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'recipeDiscovered' },
  },
  {
    id: 'wissen_bronze',
    titel: { de: 'Der Weg zur Bronze', en: 'The Way to Bronze' },
    text: {
      de: 'Kupfer- und Zinnadern glänzen in den Höhlen. Im Schmelzofen werden aus je zwei Erzen Barren; drei Kupferbarren und ein Zinnbarren ergeben Bronze – härter als Stein, gut für Werkzeug und Waffen.',
      en: 'Copper and tin veins gleam in the caves. In the smelting furnace two ores make a bar; three copper bars and a tin bar make bronze – harder than stone, good for tools and weapons.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'eines', von: [{ art: 'besitz', item: 'kupfererz', anzahl: 1 }, { art: 'besitz', item: 'zinnerz', anzahl: 1 }, { art: 'statistik', statistik: 'hergestellt', schluessel: 'schmelzofen', mindestens: 1 }] },
  },
  {
    id: 'wissen_bauen',
    titel: { de: 'Bauen', en: 'Building' },
    text: {
      de: 'B öffnet den Baumodus: Böden, Wände, Türen, Dächer, Möbel. Dächer brauchen Stützen in Reichweite, sonst stürzen sie ein. Blaupausen planen ohne Material, der Hammer füllt sie aus Taschen und Kisten.',
      en: 'B opens the build mode: floors, walls, doors, roofs, furniture. Roofs need supports in reach or they collapse. Blueprints plan without material, the hammer fills them from bags and chests.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'partPlaced' },
  },
  {
    id: 'wissen_raeume',
    titel: { de: 'Räume und Behaglichkeit', en: 'Rooms and Comfort' },
    text: {
      de: 'Wände, Türen und ein Dach schließen einen Raum: kein Regen, wärmer bei gutem Dämmwert. Möbel bestimmen den Raumtyp – Schlafraum, Werkstatt, Lager … Ein behaglicher Raum senkt die Furcht und lässt dich besser schlafen.',
      en: 'Walls, doors and a roof close a room: no rain, warmer with good insulation. Furniture decides its type – bedroom, workshop, storeroom … A cozy room lowers fear and lets you sleep better.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'eines', von: [{ art: 'ereignis', ereignis: 'playerRoomChanged', wo: { interior: true } }, { art: 'zustand', zustand: 'behaglich' }] },
  },
  {
    id: 'wissen_herdfeuer',
    titel: { de: 'Herdfeuer und Basis', en: 'Hearth and Base' },
    text: {
      de: 'Ein brennendes Herdfeuer macht seinen Umkreis zur Basis: es wärmt, leuchtet, hält die Schattenbrut fern und ist ein Wiedereinstiegspunkt. Es braucht Brennstoff; Glutkerne vergrößern seinen Radius.',
      en: 'A burning hearth makes its surroundings a base: it warms, gives light, keeps the shadowspawn away and is a respawn point. It needs fuel; ember cores widen its radius.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'hearthIgnited' },
  },
  {
    id: 'wissen_kampf',
    titel: { de: 'Kampf', en: 'Combat' },
    text: {
      de: 'Linke Maustaste schlägt, gehalten schwer; rechte blockt, im richtigen Moment pariert sie und lässt den Gegner taumeln. Bögen spannt man durch Halten – voll gespannt treffen sie am härtesten. Eine Rolle durch den Angriff kostet Ausdauer, aber kein Leben.',
      en: 'Left mouse button strikes, held for a heavy blow; right blocks, and timed well it parries and staggers the foe. Bows draw while held – fully drawn they hit hardest. A roll through an attack costs stamina, not health.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'eines', von: [{ art: 'ereignis', ereignis: 'attackStarted' }, { art: 'ereignis', ereignis: 'blocked' }, { art: 'ereignis', ereignis: 'projectileFired' }] },
  },
  {
    id: 'wissen_jagd',
    titel: { de: 'Jagd, Zerlegen, Fallen', en: 'Hunting, Carving, Traps' },
    text: {
      de: 'Besiegte Tiere hinterlassen einen Kadaver; mit einem Messer in der Hand zerlegst du ihn mit E in Fleisch, Leder und Knochen. Fallen fangen kleine Tiere, auch wenn du fort bist – hol den Fang mit E.',
      en: 'Defeated animals leave a carcass; with a knife in your hand, E carves it into meat, leather and bone. Traps catch small animals even while you are away – collect the catch with E.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'eines', von: [{ art: 'ereignis', ereignis: 'carcassCarved' }, { art: 'ereignis', ereignis: 'trapPlaced' }, { art: 'statistik', statistik: 'kills', mindestens: 1 }] },
  },
  {
    id: 'wissen_bestiarium',
    titel: { de: 'Das Bestiarium', en: 'The Bestiary' },
    text: {
      de: 'Jede Kreatur, die du siehst, kommt ins Bestiarium der Chronik. Wer sie oft besiegt, erfährt ihre Schwächen und ihre Beute.',
      en: 'Every creature you see goes into the bestiary of the chronicle. Defeat it often and you learn its weaknesses and its loot.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'bestiaryUnlocked' },
  },
  {
    id: 'wissen_fertigkeiten',
    titel: { de: 'Fertigkeiten und Perks', en: 'Skills and Perks' },
    text: {
      de: 'Was du tust, lernst du: zwölf Fertigkeiten steigen durch Übung, jede Stufe wirkt etwas stärker. Auf Stufe 30, 60 und 90 wählst du einen von zwei Perks – er bleibt dir für immer.',
      en: 'What you do, you learn: twelve skills rise with practice, every level works a little stronger. At levels 30, 60 and 90 you choose one of two perks – it stays with you forever.',
    },
    quelle: 'mechanik',
    freischaltung: { art: 'ereignis', ereignis: 'skillLevelUp' },
  },
];
