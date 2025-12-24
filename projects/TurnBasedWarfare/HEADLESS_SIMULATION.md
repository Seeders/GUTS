# Headless Simulation Mode

This document describes the headless simulation mode for running TurnBasedWarfare games without rendering.

## Overview

Headless mode allows running full game simulations without any rendering, audio, or network dependencies. This is useful for:

- **Automated Testing**: Run game scenarios and verify outcomes
- **AI Training**: Run many simulations quickly for machine learning
- **Balance Testing**: Analyze unit matchups and game balance
- **Regression Testing**: Ensure game logic remains consistent

## Architecture

The headless simulation uses the same behavior tree AI system as skirmish mode:

```
HeadlessSkirmishRunner.setup()
    ├── Creates player entities for both teams
    ├── Spawns AI opponent entity for left team (behavior tree)
    └── Spawns AI opponent entity for right team (behavior tree)

HeadlessEngine.runSimulation()
    └── Runs game tick loop
        └── BehaviorSystem.update()
            └── AI opponents execute build orders via behavior trees
                └── GameInterfaceSystem (ui_*) handles all game actions
```

## Quick Start

```javascript
// Load the headless bundle
const COMPILED_GAME = require('./dist/headless/game.js');

// Import the headless engine
const { HeadlessEngine } = require('./engine/HeadlessEngine.js');

// Create and initialize engine
const engine = new HeadlessEngine();
await engine.init('TurnBasedWarfare');

// Create a skirmish runner
const runner = new GUTS.HeadlessSkirmishRunner(engine);
await runner.setup({
    level: 'level_1',
    startingGold: 100,
    seed: 12345,
    leftBuildOrder: 'basic',   // Build order for left team
    rightBuildOrder: 'basic'   // Build order for right team
});

// Run the simulation - AI opponents handle everything via behavior trees
const results = await runner.run({ maxTicks: 10000 });

console.log('Simulation results:', results);
```

## Build Orders

Build orders are data-driven configurations that tell the AI what to do each round. They are stored in `collections/data/buildOrders/`.

### Build Order Format

```json
{
  "name": "Basic Barracks Rush",
  "description": "Build a barracks in round 1, purchase barbarians and attack",
  "rounds": {
    "1": [
      { "type": "PLACE_BUILDING", "buildingId": "barracks" }
    ],
    "2": [
      { "type": "PURCHASE_UNIT", "unitId": "1_s_barbarian", "building": "barracks" },
      { "type": "MOVE_ORDER", "unitType": "1_s_barbarian", "target": "center" }
    ],
    "3": [
      { "type": "PURCHASE_UNIT", "unitId": "1_s_barbarian", "building": "barracks" },
      { "type": "MOVE_ORDER", "unitType": "1_s_barbarian", "target": "enemy" }
    ]
  }
}
```

### Action Types

| Action | Description | Required Fields |
|--------|-------------|-----------------|
| `PLACE_BUILDING` | Place a building using an available peasant | `buildingId` |
| `PURCHASE_UNIT` | Purchase a unit from a building | `unitId`, `building` |
| `MOVE_ORDER` | Issue a move order to units | `unitType`, `target` |

### Move Order Targets

| Target | Description |
|--------|-------------|
| `center` | Move to the center of the map (0, 0) |
| `enemy` | Move to the enemy's starting location |

## Configuration Options

### HeadlessSkirmishRunner.setup()

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `level` | string | `'level_1'` | Level name to use |
| `startingGold` | number | `100` | Starting gold for each team |
| `seed` | number | `Date.now()` | Random seed for deterministic simulation |
| `leftBuildOrder` | string | `'basic'` | Build order ID for left team |
| `rightBuildOrder` | string | `'basic'` | Build order ID for right team |

### HeadlessSkirmishRunner.run()

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxTicks` | number | `10000` | Maximum ticks before timeout |

## Results Format

```javascript
{
    success: true,
    completed: true,           // true if game reached game over
    tickCount: 1500,           // Total ticks run
    gameTime: 75000,           // Game time in milliseconds
    realTimeMs: 250,           // Real time taken
    ticksPerSecond: 6000,      // Simulation speed
    round: 3,                  // Final round number
    phase: 'battle',           // Final phase
    winner: 'left',            // Winning team (or 'draw')
    entityCounts: {
        total: 5,
        byTeam: { left: 3, right: 2 }
    },
    unitStatistics: {
        livingUnits: [...],    // Array of surviving unit data
        deadUnits: [...]       // Array of killed unit data
    },
    gameState: {...}           // Full game state summary
}
```

## AI Behavior Tree System

The AI opponents use the same behavior tree system as unit AI:

1. **AIOpponentBehaviorTree**: Root tree that runs during placement phase
2. **AIExecuteBuildOrderBehaviorAction**: Executes build order actions for current round
3. **AIReadyForBattleBehaviorAction**: Marks AI as ready for battle

All actions use GameInterfaceSystem services (`ui_placeUnit`, `ui_purchaseUnit`, `ui_issueMoveOrder`, `ui_toggleReadyForBattle`) - the same code path as player input.

## Creating Custom Build Orders

1. Create a new JSON file in `collections/data/buildOrders/`
2. Define rounds with actions for each round
3. Reference the build order ID in your simulation setup

Example: `collections/data/buildOrders/archery.json`
```json
{
  "name": "Archer Rush",
  "description": "Build fletcher's hall and spam archers",
  "rounds": {
    "1": [
      { "type": "PLACE_BUILDING", "buildingId": "fletchersHall" }
    ],
    "2": [
      { "type": "PURCHASE_UNIT", "unitId": "1_d_archer", "building": "fletchersHall" }
    ],
    "3": [
      { "type": "PURCHASE_UNIT", "unitId": "1_d_archer", "building": "fletchersHall" },
      { "type": "MOVE_ORDER", "unitType": "1_d_archer", "target": "center" }
    ]
  }
}
```

Then use it:
```javascript
await runner.setup({
    leftBuildOrder: 'archery',
    rightBuildOrder: 'basic'
});
```
