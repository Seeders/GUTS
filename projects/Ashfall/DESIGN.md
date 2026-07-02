# Ashfall — ARPG Design Document

A single-player action RPG in the spirit of **Diablo 2** with **Path of Exile** influence,
built on the GUTS engine as a fork of HeroArena.

## Vision

- **Controls:** WASD moves the character; the mouse aims. Left click = primary attack/skill
  toward cursor, right click + 1–4 = bound skills. Q/W potions, I inventory, S skill tree, etc.
- **Camera:** Overhead follow camera (Diablo-style ~55° pitch), scroll to zoom.
- **World:** A town hub (safe zone with NPCs) connected to a chain of wilderness/dungeon zones.
  Zones are **randomly generated with wave function collapse (WFC)** stitching together
  hand-authored tile-group pieces from the levels collection.
- **Progression:** classes → attributes → skill trees → gems → items → act bosses.

## Classes

Six base classes (HeroArena tier-1 heroes) laid out on the STR/DEX/INT triangle, each with
three ascension classes (their existing `specUnits`) unlocked at level 12 via quest:

| Class      | Attributes | Ascensions |
|------------|-----------|------------|
| Barbarian  | STR       | Berserker, Gladiator, Warlord |
| Soldier    | STR/DEX   | Crossbowman, Hoplite, Knight |
| Archer     | DEX       | Beast Master, Ranger, Trapper |
| Scout      | DEX/INT   | Goblin Bomber, Shadow Assassin, Trickster |
| Apprentice | INT       | Elementalist, Enchanter, Necromancer |
| Acolyte    | INT/STR   | Crusader, Oathbreaker, Paladin |

**Attributes** (D2-style): Strength, Dexterity, Intelligence, Vitality. 5 points per level.
- STR: +melee damage %, armor requirement
- DEX: +ranged damage %, +evasion, +accuracy, +crit chance
- INT: +spell damage %, +max mana, +mana regen
- VIT: +max life, +life regen

**Leveling:** XP from kills (with level-gap penalty), exponential curve. Each level grants
5 attribute points + 1 skill point.

## Skill Trees & Gems

- Each class has a **3-branch skill tree** (one branch per ascension theme), D2-style:
  skills unlock at level milestones, points increase rank (damage/effect scaling),
  synergies between skills in a branch.
- Skills are backed by existing GUTS ability classes (FireBall, ChainLightning, Whirlwind
  via whirlwind component, MultiShot, RaiseDead, SummonWolf, LeapSlam, Bash, ...).
- **Gems (PoE influence):** items drop with sockets; **skill gems** grant an extra usable
  skill while socketed; **support gems** linked in the same item modify the granted skill
  (e.g. +projectiles, faster casting, added fire damage). Gems level up with use.

## Items (D2 core + PoE seasoning)

- **Slots:** mainHand, offHand, helmet, chest, gloves(=legs slot), boots(=feet), ring x2, amulet, belt.
  (Existing `equipment` component slots reused/extended.)
- **Base types:** per-slot bases with implicit stats and attribute requirements
  (swords/axes/maces/daggers/bows/crossbows/wands/staves/shields, armor bases per slot).
- **Rarities:** Normal (white) → Magic (blue, 1 prefix + 1 suffix) → Rare (yellow, up to
  3 prefixes + 3 suffixes) → Unique (gold, fixed themed mods). Rarity weights per monster tier.
- **Affixes:** prefix/suffix pools with tiers gated by item level (zone/monster level),
  e.g. `+# to Maximum Life`, `#% Increased Attack Speed`, `Adds #–# Fire Damage`,
  `+# to All Skills` — implemented on top of StatAggregationSystem's tagged
  `increased`/`more` modifier pipeline plus flat-stat application.
- **Sockets:** items roll 0–3 sockets; gems socket in (see above).
- **Drops:** monsters drop items/gold on death with ground labels; click to pick up.
  Potions (life/mana) drop and stack on the belt.
- **Gold:** currency for vendors, respec, gambling.

## World / Act 1

Zone chain (D2 Act 1 skeleton):

1. **Emberrest (Town)** — hand-authored; NPCs: Warlord Kael (quests), Mira the Smith
   (vendor/repair), Elder Rowan (gems/potions vendor + lore), Stash, Waypoint, Healer.
2. **Ashen Fields** (WFC, forest/grass set, mlvl 1–4) — quest 1 boss: Bonecaller (skeleton mage).
3. **Charred Woods** (WFC, forest set, mlvl 4–8) — waypoint; quest 2: destroy 3 Pyre Totems.
4. **Cinder Quarry** (WFC, rock set, mlvl 8–12) — quest 3: the Stone Colossus (golem boss),
   reward unlocks **ascension** at level 12.
5. **Ashfall Keep Approach** (WFC, brick set, mlvl 12–15) — waypoint.
6. **The Ember Throne** (authored arena, mlvl 16) — **Act Boss: Pyrelord Vazruk**
   (red dragon), completing Act 1.

**Quests:** kill-boss / destroy-objects / talk chains, tracked in a quest log; rewards:
gold, items, skill point, ascension unlock.
**Waypoints:** teleport network between discovered waypoints + town.
**Town portal scrolls:** consumable, opens return portal.

**Monsters** from existing units: skeletons (0_skeleton packs + Bonecaller variants),
golems (stone/fire/ice as champions/bosses), wolves (SummonWolf model), peasant→cultist
reskins, ballista→siege engines in Keep, dragon_red as act boss. Rarity tiers: Normal,
Magic (blue, 1 modifier aura), Rare (yellow champion, 2–3 modifiers), Unique (bosses).
Modifiers: Extra Fast, Extra Strong, Fire Enchanted, Cold Enchanted, Lightning Enchanted,
Stoneskin, Vampiric, Multishot-style.

## WFC Level Generation

- **Pieces:** authored 8×8 tile-group chunks stored in the levels collection as regular
  level JSONs under `piece_<set>_<name>` (e.g. `piece_forest_clearing`). A piece's
  terrainMap/heightMap/levelEntities define its content; its 4 edges get **connector
  signatures** derived from edge tiles (+ optional explicit sockets in a `wfc` block).
- **Generator:** `WFCLevelGenerator` library — lays out an N×N grid of piece slots,
  runs wave function collapse with adjacency constraints from edge compatibility,
  entropy-minimizing collapse with seeded RNG, backtracking on contradiction.
- **Post-pass:** guarantees connectivity (flood fill on walkable tiles, carves paths),
  places entrance/exit portals, waypoint (if zone has one), monster pack spawn points
  (density by zone), chests, and the quest objective/boss arena piece.
- **Output:** a full 64×64 (or larger multiple of piece size) level JSON written into
  `collections.levels[placeholder key]` at runtime before scene switch (placeholder keys
  `generated_zone_a/b/c` pre-registered so enum indices exist).

## New Systems (collections/scripts/systems/js/)

| System | Role |
|--------|------|
| `ArpgGameSystem` | Adventure scene bootstrap: local mode, player entity, zone loading/transitions, town vs wild, death/respawn |
| `PlayerControllerSystem` | WASD velocity, mouse-aim raycast, click-to-attack/skill, pickup clicks, interact (NPC/portal/waypoint) |
| `ArpgCameraSystem` | Overhead follow camera w/ zoom |
| `ArpgStatsSystem` | Attributes, derived stats, XP/levels, points; recomputes combat/health/resourcePool from base+attributes+items+tree |
| `SkillTreeSystem` | Tree data, point spend, rank scaling, granting abilities, gem-granted skills |
| `ItemSystem` | Item generation (bases+affixes+rarity+sockets), loot drops, ground item entities/labels |
| `InventorySystem` | Grid inventory, equip/unequip, belt, stash, gold |
| `VendorSystem` | Buy/sell/gamble/heal at NPCs |
| `QuestSystem` | Quest chain state machine, objectives, rewards, log |
| `ZoneSystem` | Zone graph, WFC invocation, portals/waypoints/town portal |
| `EnemyPackSystem` | Pack/champion/boss spawning with rarity modifiers, XP on kill hookup |
| `ArpgHudSystem` | HUD: health/mana globes, skill bar, XP bar, zone name, boss bar |
| `ArpgUiSystem` | Panels: inventory, character, skill tree, quest log, vendor, dialogue, class select |

New library: `WFCLevelGenerator` (collections/scripts/libraries/js).
New scene: `adventure` (+ `interface: arpg`).
New collections: `data/itemBases`, `data/affixes`, `data/uniqueItems`, `data/gems`,
`data/skillTrees`, `data/quests`, `data/zones`, `data/monsterMods`, `data/classes`.

## Phases

A. Adventure scene + WASD/mouse controller + camera + basic HUD (kill skeletons on forest map)
B. Stats/XP/leveling + class select + enemy packs
C. Item system + inventory/equipment UI + drops
D. Skill trees + gems
E. WFC generation + zone graph
F. Town + NPCs + quests + waypoints/portals
G. Act 1 content, bosses, balance, polish
