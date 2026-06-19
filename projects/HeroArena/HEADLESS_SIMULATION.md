# Headless Simulation Mode (Hero Arena)

Runs full Hero Arena matches without rendering, audio, or network — for automated
testing, balance analysis, and regression checks.

## What a simulation runs

A headless simulation plays the **real Hero Arena loop** with the built-in AI
controlling **both** players:

```
leader select → hero select → PREP → BATTLE → resolve → … → Town Hall destroyed
                               │        │
                               │        └─ every AI army gets one attack-move at
                               │           the enemy Town Hall (fog-of-war rules:
                               │           units engage what they see en route)
                               └─ per-round income → shop offers → greedy auto-buy
                                  (units/upgrades/abilities/buildings/TH tiers)
```

There are **no build orders, gold mines, peasants, or supply** — those are
TurnBasedWarfare concepts. The AI players are driven by the autobattler systems
themselves (see `AutobattlerRoundSystem.getAIPlayerIds`):

- **Leader/hero picks**: forced via config, or seeded-random (`rng.strand('ai')`)
- **Shop**: `ArmyShopSystem._aiAutoBuy` — buys the first affordable offer, repeatedly
- **Ready-up**: scheduled 0.5s into each prep on the deterministic game clock
- **Battle orders**: attack-move at the enemy Town Hall each round

Matches end when a Town Hall dies (`townhall_destroyed`) or `maxRounds` passes.

## Quick start

```bash
npm run build                                  # build dist/headless bundle
node projects/HeroArena/headless.js --simulation barbarian_vs_archer
node projects/HeroArena/headless.js --simulation random_match --seed 99
node projects/HeroArena/headless.js --left-hero soldier --right-hero scout --seed 5
node projects/HeroArena/headless.js --batch    # run every simulation
```

Same seed ⇒ same match (all sim randomness flows through seeded RNG strands).

## Simulation config format

`collections/data/simulations/<id>.json`:

```json
{
  "name": "Barbarian vs Archer",
  "description": "Melee STR hero against ranged DEX hero.",
  "seed": 42,
  "level": "forest",
  "heroes":  ["barbarian", "archer"],
  "leaders": ["commander", "ranger"],
  "maxRounds": 20
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `seed` | `Date.now()` | Deterministic RNG seed |
| `level` | `forest` | Level name |
| `heroes` | random | Forced hero class per player (`[left, right]`); valid ids: `barbarian`, `apprentice`, `archer`, `acolyte`, `soldier`, `scout` |
| `leaders` | random | Forced leader per player; ids: `commander`, `alchemist`, `warlord`, `scholar`, `ranger`, `trickster` |
| `maxRounds` | 10 | Round cap before the sim stops |

## Results

Written to `simulation_results/`, including winner + reason, per-round stats,
combat log summary, and surviving units **with positions**:

```
[LEFT] 1_s_barbarian: 180/220 HP (81%) @ (-866, 309)
```

## Architecture

```
headless.js
  ├─ loads dist/headless/game.js (bundle incl. collections)
  ├─ HeadlessSkirmishRunner.setup({ classicSetup: false, heroes, leaders, ... })
  │    └─ creates the two player entities; no TBW economy
  ├─ game.call('startLeaderSelect')   ← kicks the real round loop
  └─ runner.run() ticks the engine until game over / maxRounds
```

System lists for headless live in `collections/data/scenes/headless.json`
(active systems) and `collections/settings/configs/headless.json` (loaded
systems) — both must contain a system for it to run headless.
