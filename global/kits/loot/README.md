# Loot kit

Rolled items after Diablo II: rarities with magic find, bases by item level, affix tiers, uniques and sets, identification, drop tables, sockets and runewords, set bonuses, durability; drops on the ground as entities; a grid inventory helper.

**Requires kits:** none (core only)

## Systems

| System | Services it provides |
|---|---|
| `LootDropSystem` | `spawnLoot`, `pickupLoot`, `getLootDrops` |
| `LootSystem` | `rollItem`, `rollTable`, `registerItem`, `getItemDef`, `uniqueCopy`, `identifyItem`, `isUnidentified`, `registerDropType`, `socketItem`, `setBonuses`, `wearItem`, `repairCost`, `isBroken`, `exportItems`, `importItems`, `forgetItems`, `rolledItemIds` |

## Libraries

`ItemGrid`

## Setting it up

1. List `LootSystem` (and `LootDropSystem` for drops on the ground) in the systems of the config
   that runs the game's rules: the server's, or game.json for a local or lockstep game. Add the
   `ItemGrid` library if you want the grid inventory helper.
2. Put item definitions in one collection (`itemDefs` by default). Bases have `"base": true`, a
   `qlvl` (the item level they start dropping at), `slot`, `stats` (`weaponMin`/`weaponMax` or
   `armor`, or an `armorRange`), and optionally `maxSockets`, `maxDur`, `weaponType`. Hand-made
   items have `"unique": true` (with `ilvl`) or `"setItem": true` (with `set` and `qlvl`).
   Socketables have `"socket": { weapon, armor, shield }` stats.
3. Data collections (or point configs/loot.json at your own): `affixes`, `runewords`, `sets`,
   `lootTables`. Formats are described at the top of LootSystem.js.
4. Optional `collections/settings/configs/loot.json`:

   ```json
   { "items": "itemDefs", "idPrefix": "g_", "seeded": true, "affixes": "affixes",
     "runewords": "runewords", "sets": "sets", "tables": "lootTables",
     "ethereal": { "chance": 0.05, "mult": 1.5, "reqMinus": 10 },
     "rarities": [ ... ], "rareWords": { "a": [...], "b": { "weapon": [...] } },
     "drops": { "life": 600, "prefab": "worldObject", "models": { "gold": "...", "default": "..." } } }
   ```

   Any of these can be a dotted path into the collections (`"descent.affixes.affixes"`).

## Rolling

```js
const id = this.call.rollItem(12, { magicFind: 0.5 });          // an item id, its def in itemDefs
const drops = this.call.rollTable('monster', 12, { mf: 0.5 });   // [{ gold } | { item, n }]
this.call.spawnLoot(transform.position, drops);                  // lying on the ground
```

A rarity (the default list is Diablo II's: unique, set, rare, magic, superior, low, normal) has
`chance` (better ones boosted by magic find: `mfK`, or `"mf": "full"`) or `otherwise` (checked
when no chance hit), `quality`, `affixes { min, max, maxPrefix, maxSuffix, byLevel }`, `naming`
(`affixes` | `random`), `title` words, `ed` (enhanced damage/defense), `priceMult`,
`socketChance` or `sockets: false`, and `identified: false` to hide what it does until
`identifyItem`. `from: "unique" | "set"` copies a hand-made item instead.

Rolled items are new definitions: the game hears `onLootItemRegistered { id, def }` (send it to
clients), saves what a character holds with `exportItems(ids)`, brings it back with
`importItems`, and lets go of the rest with `forgetItems(liveIds)`.

## Making it yours

Subclass it in your project (`class MyLootSystem extends GUTS.LootSystem`, listed instead of it,
with LootSystem still in the config's systems so it is compiled) and override the hooks:
`category`, `kindOf`, `kindWeight`, `affixAllows`, `applyAffix` (special stats: skills, procs),
`finishItem`, `finishCopy`, `normalizeStats`, `baseNameOf`, `rarities`. `registerDropType(name, fn)`
adds table entry kinds (potions, gems, runes...).

Randomness comes from `game.rng`'s `loot` strand, so a seeded game rolls the same items
everywhere; a server-only game can set `"seeded": false`.

## What your game supplies

**Components.** This kit ships reference schemas for `lootDrop`, `lootPicker`. A project that lists its kits in game.json gets the schemas of the core and of those kits, except where it has its own file of the same name (yours wins). Its systems use these, which the core or this kit's required kits provide: `transform`.

**Services.** These systems call these services, which no engine system provides. Provide the ones your game needs from one of your systems (`static services = [...]`); a missing service is a no-op that logs one warning:

none

**Optional kits.** It also calls `createEntityFromPrefab` from `units` when present.

## Using it

List the systems you want in your game.json `systems`. To limit a project to some kits, add `"kits": ["loot"]` (required kits come along). Without a `kits` list every kit is available.

To change a system, subclass it in your project's `collections/scripts/systems/js/LootDropSystem.js` (a project file with the same name as an engine file replaces it):

```js
import Base from '@global/scripts/systems/js/LootDropSystem.js';

class LootDropSystem extends Base {
    // override what you need
}
```
