# Headless Simulation Mode

This document describes the headless simulation mode for running TurnBasedWarfare games without rendering.

## Overview

Headless mode allows running full game simulations without any rendering, audio, or network dependencies. This is useful for:

- **Automated Testing**: Run game scenarios and verify outcomes
- **AI Training**: Run many simulations quickly for machine learning
- **Balance Testing**: Analyze unit matchups and game balance
- **Regression Testing**: Ensure game logic remains consistent

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
    seed: 12345
});

// Run with instructions
const results = await runner.runWithInstructions([
    { type: 'PLACE_UNIT', team: 'left', unitId: 'soldier', x: 5, z: 5 },
    { type: 'PLACE_UNIT', team: 'right', unitId: 'archer', x: 10, z: 5 },
    { type: 'SUBMIT_PLACEMENT', team: 'left' },
    { type: 'SUBMIT_PLACEMENT', team: 'right' }
]);

console.log('Simulation results:', results);
```

## Instruction Types

All instructions follow this base format:

```javascript
{
    type: 'INSTRUCTION_TYPE',  // Required: instruction type
    trigger: 'immediate',      // Optional: when to execute (default: 'immediate')
    // ... instruction-specific fields
}
```

### Triggers

| Trigger | Description | Required Fields |
|---------|-------------|-----------------|
| `immediate` | Execute immediately (default) | None |
| `tick` | Wait until specific tick | `tick: number` |
| `phase` | Wait for game phase | `phase: 'preparation'|'battle'|'resolution'` |
| `round` | Wait for round number | `round: number` |
| `event` | Wait for game event | `event: 'onBattleStart'|'onBattleEnd'|...` |

### PLACE_UNIT

Place a unit at a grid position.

```javascript
{
    type: 'PLACE_UNIT',
    unitId: 'soldier',     // Required: unit type ID
    x: 5,                  // Required: grid X position
    z: 5,                  // Required: grid Z position
    team: 'left'           // Optional: team name (default: from context)
}
```

### PLACE_BUILDING

Place a building. Supports automatic positioning near town hall.

```javascript
{
    type: 'PLACE_BUILDING',
    buildingId: 'barracks', // Required: building type ID
    x: 3,                   // Optional: grid X (use 'auto' for automatic)
    z: 3,                   // Optional: grid Z (use 'auto' for automatic)
    team: 'left'            // Optional: team name
}
```

### PURCHASE_UNIT

Purchase a unit from a production building.

```javascript
{
    type: 'PURCHASE_UNIT',
    unitId: '1_d_archer',              // Required: unit type ID
    buildingEntityId: 123,             // Optional: specific building entity ID
                                       // Can use 'auto:buildingType:team' format
    team: 'left'                       // Optional: team name
}
```

### SUBMIT_PLACEMENT

Mark a team as ready and submit their placements.

```javascript
{
    type: 'SUBMIT_PLACEMENT',
    team: 'left'           // Optional: team name
}
```

### START_BATTLE

Immediately start the battle phase.

```javascript
{
    type: 'START_BATTLE'
}
```

### MOVE_ORDER

Issue a move order to all units of a team.

```javascript
{
    type: 'MOVE_ORDER',
    team: 'left',           // Optional: team name
    target: 'enemy',        // Option 1: 'center' or 'enemy'
    // OR
    x: 15,                  // Option 2: specific grid coordinates
    z: 10
}
```

### WAIT

Wait for a condition before proceeding.

```javascript
{
    type: 'WAIT',
    trigger: 'phase',
    phase: 'battle'
}
```

## Configuration

### headless.json

The headless configuration file (`collections/settings/configs/headless.json`) controls:

```json
{
    "title": "Headless Skirmish",
    "projectName": "TurnBasedWarfare",
    "tickRate": 20,
    "logLevel": "INFO",
    "appLibrary": "HeadlessECSGame",
    "appLoaderLibrary": "HeadlessGameLoader",
    "initialScene": "headless",
    "libraries": [...],
    "systems": [...]
}
```

### Log Levels

Control verbosity via `logLevel` in config or programmatically:

| Level | Description |
|-------|-------------|
| `ERROR` | Only critical errors |
| `WARN` | Warnings and errors |
| `INFO` | General information (default) |
| `DEBUG` | Detailed debugging |
| `TRACE` | Very detailed trace info |

```javascript
// Set programmatically
GUTS.HeadlessLogger.setLevel('DEBUG');
```

## Simulation Options

### runSimulation Options

```javascript
const results = await engine.runSimulation({
    instructions: [...],    // Array of instructions
    maxTicks: 10000,        // Maximum ticks before timeout (default: 10000)
    timeoutMs: 30000        // Wall-clock timeout in ms (default: 30000)
});
```

### Result Object

```javascript
{
    success: true,           // Whether simulation completed successfully
    completed: true,         // Whether game reached gameOver state
    timedOut: false,         // Whether simulation timed out
    tickCount: 1500,         // Total ticks executed
    gameTime: 75.0,          // In-game time in seconds
    realTimeMs: 250,         // Real wall-clock time
    ticksPerSecond: 6000,    // Simulation speed
    round: 3,                // Final round number
    phase: 'resolution',     // Final phase name
    winner: 'left',          // 'left', 'right', 'draw', or null
    entityCounts: {
        total: 5,
        byTeam: { left: 3, right: 2 }
    },
    instructionsProcessed: 10,
    instructionResults: [...],
    validationErrors: [],
    gameState: {...}
}
```

## Examples

### Simple Battle Test

```javascript
const results = await runner.runWithInstructions([
    // Place units for both teams
    { type: 'PLACE_UNIT', team: 'left', unitId: 'soldier', x: 2, z: 5 },
    { type: 'PLACE_UNIT', team: 'left', unitId: 'soldier', x: 2, z: 7 },
    { type: 'PLACE_UNIT', team: 'right', unitId: 'archer', x: 12, z: 5 },
    { type: 'PLACE_UNIT', team: 'right', unitId: 'archer', x: 12, z: 7 },

    // Submit placements
    { type: 'SUBMIT_PLACEMENT', team: 'left' },
    { type: 'SUBMIT_PLACEMENT', team: 'right' },

    // Wait for battle to start
    { type: 'WAIT', trigger: 'phase', phase: 'battle' },

    // Issue move orders
    { type: 'MOVE_ORDER', team: 'left', target: 'enemy' },
    { type: 'MOVE_ORDER', team: 'right', target: 'enemy' }
]);

console.log(`Winner: ${results.winner}`);
```

### Multi-Round Simulation

```javascript
const results = await runner.runWithInstructions([
    // Round 1 setup
    { type: 'PLACE_BUILDING', team: 'left', buildingId: 'barracks', x: 'auto', z: 'auto' },
    { type: 'SUBMIT_PLACEMENT', team: 'left' },
    { type: 'SUBMIT_PLACEMENT', team: 'right' },

    // Wait for round 2
    { type: 'WAIT', trigger: 'round', round: 2 },

    // Round 2: purchase units
    { type: 'PURCHASE_UNIT', team: 'left', unitId: 'soldier', buildingEntityId: 'auto:barracks:left' },
    { type: 'SUBMIT_PLACEMENT', team: 'left' },
    { type: 'SUBMIT_PLACEMENT', team: 'right' }
], { maxTicks: 20000 });
```

## Validation

Instructions are validated before execution. Invalid instructions will throw an error:

```javascript
try {
    await runner.runWithInstructions([
        { type: 'INVALID_TYPE' }  // Will fail validation
    ]);
} catch (error) {
    console.error('Validation failed:', error.message);
}
```

To skip validation (not recommended):

```javascript
simSystem.setupSimulation(instructions, { skipValidation: true });
```

## Event Log

The simulation logs events for debugging:

```javascript
const log = runner.getEventLog();  // Returns array of events

const details = runner.getEventLogDetails();  // Returns { events, overflowCount, maxSize }
```

Event log is automatically capped at 10,000 entries to prevent memory issues.
