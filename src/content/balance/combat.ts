/**
 * Balance values of combat (MASTERPROMPT §19.1 "Steuerung & Gefühl", §19.2 Waffenklassen, §19.3 Schaden, §D
 * Balancing-Rahmen; docs/SPIEL.md §10; M6-01 … M6-09) – group `BALANCE.combat` (src/content/balance.ts re-exports it).
 * Every value states its unit and the reason for it. The weapons themselves are item data (`waffe`, `munition`,
 * `schild` blocks of src/content/schema/item.ts); what no item carries – the bare fist, tools swung as weapons, the
 * rules of parry, block, hitstop, projectiles – lives here. Time is simulated seconds (60 ticks each).
 */
import type { WeaponClass } from './tools';

/** The eight damage types of §19.3 (the same list as `DAMAGE_TYPES` of src/game/combat/targets.ts). */
export const DAMAGE_TYPE_IDS = ['hieb', 'stich', 'wucht', 'feuer', 'frost', 'gift', 'licht', 'schatten'] as const;
/** One damage type. */
export type DamageTypeId = (typeof DAMAGE_TYPE_IDS)[number];

/**
 * Kinds of heavy attack (`waffe.schwer`, §19.2): `schlag` a harder blow, `rundumhieb` the sword's sweep all around,
 * `ruestungsbruch` the axe's blow that breaks armour for a while, `wurf` the spear's throw (the spear becomes a
 * projectile and stays where it lands).
 */
export const HEAVY_ATTACKS = ['schlag', 'rundumhieb', 'ruestungsbruch', 'wurf'] as const;
/** One kind of heavy attack. */
export type HeavyAttack = (typeof HEAVY_ATTACKS)[number];

/** Weapon classes that shoot ammunition (`munition.fuer`). */
export const AMMO_WEAPON_CLASSES = ['bogen', 'armbrust', 'schleuder'] as const satisfies readonly WeaponClass[];
/** One ammunition-shooting class. */
export type AmmoWeaponClass = (typeof AMMO_WEAPON_CLASSES)[number];

/** Ranged classes: the ammunition shooters and the thrown weapons (they carry a `geschoss` block). */
export const RANGED_WEAPON_CLASSES = [...AMMO_WEAPON_CLASSES, 'wurf'] as const satisfies readonly WeaponClass[];

/**
 * What a thrown weapon does where it lands (`waffe.wurf.wirkung`, §19.2 "Wurfwaffen (Wurfmesser, Sprengtopf,
 * Brandflasche, Frostbombe, Blendbombe)"): `einzel` hits one body like a blade and stays as an item, the others burst
 * over a radius – `explosion` knocks back (Sprengtopf), `brand` sets the ground alight (Brandflasche), `frost` slows
 * (Frostbombe), `blendung` blinds (Blendbombe); their conditions are the item's `zustand`.
 */
export const THROW_EFFECTS = ['einzel', 'explosion', 'brand', 'frost', 'blendung'] as const;
/** One throw effect. */
export type ThrowEffect = (typeof THROW_EFFECTS)[number];

/** A melee profile of the balance (the fist, tools swung as weapons): the numbers a `waffe` block would carry. */
export interface MeleeProfile {
  /** Damage type of the blow. */
  readonly schadensart: DamageTypeId;
  /** Reach from the centre of the feet [px]. */
  readonly reichweitePx: number;
  /** Width of the swing [°]. */
  readonly bogenGrad: number;
  /** One whole blow: wind-up, blow, recovery [s]. */
  readonly tempoSekunden: number;
  /** Stamina per blow [points]. */
  readonly ausdauer: number;
  /** Stagger of the target [s]. */
  readonly staggerSekunden: number;
  /** Impact class 1–5 (hitstop, knockback). */
  readonly wucht: number;
}

export const COMBAT_BALANCE = {
  aim: {
    /**
     * Hysteresis of the facing while fighting [°]. §19.1 "Sprites in 4 Richtungen", "Figur blickt zum Cursor": the facing
     * turns only once the aim leaves its 90° quarter by more than this angle – a cursor resting on a diagonal would
     * otherwise flip the sprite with every pixel of hand tremor; 12° is about a quarter of a tile at three tiles.
     */
    facingHysteresisDeg: 12,
    /**
     * How long the facing keeps following the aim after the last blow, shot, block or hit [s]. §19.1: between two blows of
     * a combo (≤ 0,5 s apart) the figure must not turn back to its walking direction.
     */
    fightingSeconds: 1,
    /** Distance of the aim point in front of the figure while the right stick aims [px]. Three tiles: beyond every melee reach. */
    stickReachPx: 48,
  },
  body: {
    /**
     * Radius of the player's body for hits [px]. The figure's torso is ≈ 12 px wide (`spieler_koerper`); its collision
     * circle (5 px, `BALANCE.player.movement.colliderRadiusPx`) only covers the feet.
     */
    playerRadiusPx: 6,
  },
  attack: {
    /**
     * Share of a blow's `tempo` spent winding up before it lands [fraction]. §19.1 "Eingaben wirken im nächsten Frame": the
     * wind-up starts in the next tick and is short (a sword of 0,5 s lands after 0,175 s); the rest is recovery.
     */
    windupShare: 0.35,
    /** How long the button must be held for a heavy attack on release [s]. §19.1 "schwerer Angriff (halten)"; a click is 0,1–0,2 s. */
    heavyHoldSeconds: 0.4,
    heavy: {
      /** Damage of a heavy blow [× the light blow]. §19.1: worth the wait and the stamina of two light blows. */
      damageFactor: 1.8,
      /** Stamina of a heavy blow [× the light blow]. */
      staminaFactor: 2,
      /** Stagger of a heavy blow [× the light blow]. */
      staggerFactor: 1.6,
      /** Recovery after a heavy blow [× the light recovery]: the price of the big swing. */
      recoveryFactor: 1.5,
      /** Impact classes a heavy blow adds (longer hitstop, farther knockback; at most 5). */
      wuchtBonus: 1,
    },
    /** Time after a blow's recovery in which the next light attack continues the combo [s] (§19.2 "Schwert 3er-Kombo"). */
    comboWindowSeconds: 0.4,
    /** Walking speed while winding up, charging or recovering [× normal]. §19.1 "freie Bewegung", but a swing roots the feet a little. */
    moveFactor: 0.5,
  },
  /** The bare fist (`faust`, no item; §D names no fist): damage = T0 base damage × `BALANCE.tools.weaponClassFactor.faust`. */
  fist: {
    schadensart: 'wucht',
    reichweitePx: 14,
    bogenGrad: 70,
    tempoSekunden: 0.4,
    ausdauer: 4,
    staggerSekunden: 0.1,
    wucht: 1,
  } satisfies MeleeProfile,
  /**
   * A tool swung as a weapon (a tool without a `waffe` block; §19.2 names tools no class). It hits like an improvised
   * weapon: its tier's base damage × `damageFactor`, the damage type of its head (`schadensart`, default wucht).
   */
  tool: {
    /** Damage [× the tier's base damage]: an axe is no battle axe – 60 % of a sword of its tier. */
    damageFactor: 0.6,
    schadensart: 'wucht' as DamageTypeId,
    reichweitePx: 18,
    bogenGrad: 80,
    tempoSekunden: 0.6,
    ausdauer: 8,
    staggerSekunden: 0.15,
    wucht: 2,
    /** Damage type by tool head (§19.3): blades cut, points pierce; the rest (shovel, hammer, bucket …) strikes blunt. */
    headTypes: { axt: 'hieb', messer: 'hieb', sichel: 'hieb', spitzhacke: 'stich', schere: 'stich' } as Readonly<Record<string, DamageTypeId>>,
    /**
     * Weapon class whose motion a tool's swing takes (the clip `attack_<klasse>_<r>`, docs/SPIEL.md §13): axe and pickaxe
     * chop like an axe, blades stab like a dagger, the rest swings like a club (`keule`, the default).
     */
    classes: { axt: 'axt', spitzhacke: 'axt', messer: 'dolch', sichel: 'dolch', schere: 'dolch' } as Readonly<Record<string, WeaponClass>>,
  },
  parry: {
    /** Parry window [s]. §19.1: "Block in den letzten 0,15 s vor dem Treffer" – 9 ticks, exact. */
    windowSeconds: 0.15,
    /** Stagger of a parried attacker [s]. §19.1 "Gegner taumelt": long enough for one light blow of any class to land. */
    staggerSeconds: 1.2,
    /** How long the parried attacker stays marked: its next hit is critical [s] (§19.1 "der nächste Treffer ist kritisch"). */
    riposteSeconds: 2.5,
  },
  block: {
    /** Arc in front of the body a block covers [°]: the front half; a blow from behind always lands. */
    arcDeg: 180,
    /** Block power of a melee weapon or tool without a shield [0–1]. docs/SPIEL.md §10 "ohne Schild mit Nahkampfwaffe parieren/abwehren": a third of a wooden shield's 40 %… rounded up. */
    weaponPower: 0.35,
    /** Block power of the bare fists [0–1]: they parry, but hardly soften a blow. */
    fistPower: 0.15,
    /** Stamina per point of damage a weapon or fist absorbs [points/HP] (a shield carries its own `ausdauerJeSchaden`). */
    staminaPerDamage: 1.2,
    /** Walking speed while blocking [× normal] (a shield's `tempoFaktor` multiplies it further). */
    moveFactor: 0.6,
    /** Stagger of a blocker whose stamina runs out under a blow (guard break) [s]. */
    guardBreakSeconds: 0.6,
  },
  /** Aiming a ranged weapon with the block button (docs/SPIEL.md §10 "mit Fernwaffe zielen = ruhigere Hand, langsameres Gehen"). */
  aimMode: {
    /** Walking speed while aiming [× normal]. */
    moveFactor: 0.6,
    /** Spread while aiming [× the weapon's spread]. */
    spreadFactor: 0.3,
  },
  damage: {
    /** Armour constant of §19.3 [points]: reduction = R / (R + 50). */
    armorConstant: 50,
    /** Base crit chance [0–1]. §19.3: "Kritisch 5 % Basis". */
    critChance: 0.05,
    /** Crit damage [× damage]. §19.3: "×1,75". */
    critFactor: 1.75,
  },
  impact: {
    /** Hitstop by impact class 1–5 [ticks]. docs/SPIEL.md §10: "hitstopTicks = 2–6 Ticks nach Wucht" – both bodies stand still. */
    hitstopTicksByWucht: [2, 3, 4, 5, 6],
    /** Knockback by impact class 1–5 [px]. A dagger nudges (2 px), a war hammer throws a wolf a tile back (16 px). */
    knockbackPxByWucht: [2, 4, 7, 11, 16],
    /** Ticks over which a knockback moves the player [ticks]: a tenth of a second, readable, never a teleport. */
    knockbackTicks: 6,
  },
  dagger: {
    /** Backstab damage [× damage]. §19.2: "Dolch (schnell, Rückenangriff ×3 beim Schleichen)" – sneaking, unseen by the target. */
    backstabFactor: 3,
  },
  axe: {
    /** Armour points the axe's heavy blow breaks [points]. §19.2 "Axt (schwer: Rüstungsbruch)": a T1 set's armour (12) mostly gone. */
    armorBreakPoints: 10,
    /** How long broken armour stays broken [s]. */
    armorBreakSeconds: 8,
    /** Share of its mining power a battle axe fells trees with [fraction]. §19.2: "fällt Bäume mit 50 %". */
    fellPowerFactor: 0.5,
  },
  spear: {
    /** Speed of a thrown spear [px/s]: 22 tiles per second, a javelin's throw. */
    throwSpeedPxPerSecond: 360,
    /** Farthest throw of a spear [px] (10 tiles): the heavy attack of §19.2 "Speer (schwer: Wurf)". */
    throwRangePx: 160,
  },
  /**
   * Weapon classes that need both hands (§12.2 "Mit Schild oder Zweihandwaffe hängt sie am Gürtel (−40 % Radius)"): the
   * carried light then hangs on the belt (`LightSystem.addTwoHandedRule`).
   */
  twoHandedClasses: ['zweihand'] as readonly WeaponClass[],
  ranged: {
    /** Draw time of a bow to full tension [s]. §19.2: "Bogen (Spannen 0,8 s)"; a weapon's `geschoss.spannen` overrides it. */
    bowDrawSeconds: 0.8,
    /** Wind-up of a sling to full swing [s]: a sling whirls faster than a bow is drawn. */
    slingDrawSeconds: 0.5,
    /** Wind-up of a throw [s]: the arm goes back once. */
    throwDrawSeconds: 0.3,
    /** Reload of a crossbow [s]. §19.2: "Armbrust (Nachladen 1,5 s)"; a weapon's `geschoss.nachladen` overrides it. */
    crossbowReloadSeconds: 1.5,
    /** Least tension a shot leaves with [0–1]: a bow let go at once still flicks its arrow (damage × tension). */
    minTension: 0.2,
    /** Speed of a shot at the least tension [× full speed]; full tension shoots at the weapon's speed. */
    minSpeedShare: 0.5,
    /** Spread (half angle) by class [°]: the crossbow rests steady, a sling stone wobbles. Aiming narrows it (`aimMode.spreadFactor`). */
    spreadDeg: { bogen: 4, armbrust: 1.5, schleuder: 7, wurf: 3 } satisfies Record<(typeof RANGED_WEAPON_CLASSES)[number], number>,
  },
  projectile: {
    /** Radius of a projectile for sweeps [px]: an arrow is a point with a little tolerance. */
    radiusPx: 1.5,
    /** Height of a flat shot above the ground [px] (the presentation draws it there). */
    flightHeightPx: 8,
    /**
     * Sideways acceleration by full wind [px/s²]. docs/SPIEL.md §10 "Wind aus dem Wetter lenkt ab": a full-draw arrow
     * (≈ 0,5 s over 12 tiles) drifts ≈ 5 px in a storm (wind 1) – noticeable at range, harmless up close.
     */
    windAccelPxPerSecond2: 40,
    /** Chance that a spent arrow or bolt can be picked up again [0–1] (docs/SPIEL.md §10 "Pfeile stecken (Drop mit Chance)"). */
    recoverChance: 0.5,
    /** Longest flight of any projectile [s]: a lost shot ends even over open water. */
    maxFlightSeconds: 4,
  },
  throw: {
    /** Arc height of a throw per pixel of distance [px/px] (§19.2 "Wurfbogen"): a flask thrown 8 tiles peaks 32 px high. */
    arcHeightPerPx: 0.25,
    /** Shortest throw [px]: a throw at the own feet still lands a tile ahead. */
    minRangePx: 16,
  },
  /** The light of a glowing arrow once it stuck (§12.2 "Leuchtpfeil | 3 | 60 s | steckt im Boden oder im Gegner"): radius and time are the ammunition's `licht`. */
  glow: {
    /** Brightness [light level at the centre]. As bright as a torch: the point is to see what hides there. */
    intensity: 1,
    /** Flicker of the flare [0–1]. */
    flicker: 0.15,
    /** Height of the glowing head above the ground [px]. */
    heightPx: 3,
    /** Colour: palette reference of a bright flare (docs/RENDER.md §1). */
    farbe: 'feuer.5',
  },
  wear: {
    /** Uses a blow that lands costs the weapon or tool [uses] (§D counts durability in uses). */
    perStrike: 1,
    /** Uses a blocked hit costs the shield [uses]. */
    perBlock: 1,
    /** Uses a hit taken costs every worn armour piece [uses] (EquipmentSystem.wear "an absorbed blow"). */
    perHitTaken: 1,
  },
};
